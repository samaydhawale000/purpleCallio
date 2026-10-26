'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Plus, RefreshCw, X } from 'lucide-react';
import { useRequireAuth } from '../../../hooks/useRequireAuth';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Pagination } from '../../../components/ui/Pagination';
import {
  billingErrorMessage,
  CREDIT_TX_LABEL,
  describeCreditTransaction,
  downloadReceipt,
  formatCredits,
  formatDate,
  formatMoney,
  getCreditHistory,
  getCreditSummary,
  getPublishedCreditPrices,
  getAutoTopUp,
  saveAutoTopUp,
  enableAutoTopUp,
  disableAutoTopUp,
  type AutoTopUpState,
  AUTO_TOPUP_ATTENTION_TEXT,
  type CreditTransactionRow,
  type CreditTransactionType,
  type Paginated,
  type WalletSummary,
  type PublishedCreditPricing,
  walletSplit,
} from '../../../lib/billing';
import { runAutoTopUpMandateSetup } from '../../../lib/checkout';
import {
  BillingHeader,
  ErrorBanner,
  PageLoader,
  SectionCard,
  useAuthErrorHandler,
} from '../BillingShell';

const TYPES = Object.keys(CREDIT_TX_LABEL) as CreditTransactionType[];
const amountToMinor = (raw: string): number | null => {
  const value = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amount) ? amount : null;
};

export default function CreditsPage() {
  const router = useRouter();
  const { isReady, isAuthed } = useRequireAuth();
  const handleAuthError = useAuthErrorHandler();

  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [creditPricing, setCreditPricing] =
    useState<PublishedCreditPricing | null>(null);
  const [creditPrices, setCreditPrices] = useState<PublishedCreditPricing[]>(
    [],
  );
  const [purchaseAmount, setPurchaseAmount] = useState('');
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [showAutoTopUpSetup, setShowAutoTopUpSetup] = useState(false);
  const [autoTopUp, setAutoTopUp] = useState<AutoTopUpState | null>(null);
  const [autoTopUpBusy, setAutoTopUpBusy] = useState(false);
  const [ledger, setLedger] = useState<Paginated<CreditTransactionRow> | null>(
    null,
  );
  const [type, setType] = useState<CreditTransactionType | ''>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingReceiptId, setDownloadingReceiptId] = useState<string | null>(null);

  const topUpSetting = autoTopUp?.setting ?? null;
  const topUpStage = autoTopUpStage(topUpSetting);

  const loadSummary = useCallback(async () => {
    try {
      const [w, publishedPrices] = await Promise.all([
        getCreditSummary(),
        getPublishedCreditPrices().catch(() => [] as PublishedCreditPricing[]),
      ]);
      const published =
        publishedPrices.find((p) => p.currency === 'INR') ??
        publishedPrices[0] ??
        null;
      setWallet(w);
      setCreditPricing(published);
      setCreditPrices(publishedPrices);
      setAutoTopUp(await getAutoTopUp().catch(() => null));
      setError(null);
    } catch (e) {
      if (!handleAuthError(e))
        setError(
          billingErrorMessage(
            e,
            'Failed to load your credits. Please try again.',
          ),
        );
    } finally {
      setLoading(false);
    }
  }, [handleAuthError]);

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    try {
      setLedger(await getCreditHistory(page, type || undefined));
    } catch (e) {
      if (!handleAuthError(e))
        setError(billingErrorMessage(e, 'Failed to load credit history.'));
    } finally {
      setLedgerLoading(false);
    }
  }, [page, type, handleAuthError]);

  useEffect(() => {
    if (isReady && isAuthed) loadSummary();
  }, [isReady, isAuthed, loadSummary]);

  useEffect(() => {
    if (isReady && isAuthed) loadLedger();
  }, [isReady, isAuthed, loadLedger]);

  // Scroll to #topups once the section exists.
  useEffect(() => {
    if (
      !loading &&
      typeof window !== 'undefined' &&
      window.location.hash === '#topups'
    ) {
      document
        .getElementById('topups')
        ?.scrollIntoView?.({ behavior: 'smooth' });
    }
  }, [loading]);

  useEffect(() => {
    if (!purchaseModalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPurchaseModalOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [purchaseModalOpen]);

  const header = (
    <BillingHeader
      title="Credits"
      subtitle="Your credit balance, purchases and credit activity."
    />
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <PageLoader label="Loading credits…" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      {error && (
        <ErrorBanner
          message={error}
          onRetry={() => {
            loadSummary();
            loadLedger();
          }}
        />
      )}

      <SectionCard id="topups" className="max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-[#170B2E]">Your Credits</h2>
              <Badge variant="purple">Prepaid</Badge>
            </div>
            <p className="mt-1 text-sm text-[#3D3650]">Manage your wallet and purchases.</p>
            <p className="mt-5 text-sm text-[#3D3650]">Available balance</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-[#170B2E]" data-testid="wallet-summary">
              {wallet ? formatCredits(wallet.available) : '—'}
            </p>
            {wallet && walletSplit(wallet).free > 0 && (
              <p className="mt-1 text-sm text-[#3D3650]" data-testid="wallet-split">
                {formatCredits(walletSplit(wallet).paid)} paid · {formatCredits(walletSplit(wallet).free)} free (audio, video and screen share only)
              </p>
            )}
            {creditPricing ? (
              <p className="mt-3 text-sm text-[#3D3650]">
                {formatMoney(creditPricing.creditPricePaise, creditPricing.currency)} per credit · Purchased credits expire after {creditPricing.purchasedValidityDays} days.
              </p>
            ) : (
              <p className="mt-3 text-sm text-[#3D3650]">Credit pricing is not available yet.</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={!creditPricing}
              onClick={() => setPurchaseModalOpen(true)}
            >
              <Plus size={16} aria-hidden="true" /> Add Credits
            </Button>
          </div>
        </div>

        {wallet && wallet.available <= 0 && (
          <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-700">
            New calls are paused until you add credits.
          </p>
        )}

        <div className="mt-6 border-t border-[#E7DFF5] pt-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-[#F8F4FD] p-2 text-[#6425C4]">
              <RefreshCw size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-[#170B2E]">Auto Top-Up</h3>
                  <p className="mt-1 text-sm text-[#3D3650]">Keep your wallet ready for calls when your balance gets low.</p>
                </div>
                <Badge variant={topUpStage.badge}>{topUpStage.label}</Badge>
              </div>
              <p className="mt-3 text-sm text-[#3D3650]" data-testid="auto-topup-status">{topUpStage.text}</p>
              {topUpSetting && topUpSetting.mandateStatus && topUpSetting.mandateStatus !== 'NONE' && (
                <p className="mt-2 text-sm text-[#3D3650]" data-testid="auto-topup-summary">
                  When your balance falls below {formatCredits(topUpSetting.thresholdCredits)} credits, add {formatMoney(topUpSetting.amountPaise, topUpSetting.currency)} of credits (up to {formatMoney(topUpSetting.monthlyLimitPaise, topUpSetting.currency)} a month, plus GST).
                </p>
              )}
              {topUpSetting?.attentionReason && <p role="alert" className="mt-2 text-sm text-red-700">{AUTO_TOPUP_ATTENTION_TEXT[topUpSetting.attentionReason] ?? topUpSetting.attentionReason}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {topUpStage.key === 'ready' && <Button type="button" disabled={autoTopUpBusy} onClick={async () => { setAutoTopUpBusy(true); try { await enableAutoTopUp(); await loadSummary(); } finally { setAutoTopUpBusy(false); } }}>Turn on Auto Top-Up</Button>}
                {topUpStage.key === 'pending' && <Button type="button" variant="secondary" disabled={autoTopUpBusy} onClick={async () => { setAutoTopUpBusy(true); try { await loadSummary(); } finally { setAutoTopUpBusy(false); } }}>Check status</Button>}
                <Button type="button" variant="secondary" disabled={autoTopUpBusy} onClick={() => setShowAutoTopUpSetup(true)}>{topUpStage.key === 'off' ? 'Set up' : topUpStage.key === 'attention' ? 'Authorize again' : 'Change settings'}</Button>
                {topUpSetting?.enabled && <Button type="button" variant="secondary" disabled={autoTopUpBusy} onClick={async () => { setAutoTopUpBusy(true); try { await disableAutoTopUp(); await loadSummary(); } finally { setAutoTopUpBusy(false); } }}>Turn off</Button>}
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      {showAutoTopUpSetup && creditPricing && (
        <AutoTopUpDialog pricing={creditPricing} existing={topUpSetting} busy={autoTopUpBusy} onClose={() => setShowAutoTopUpSetup(false)} onSave={async (thresholdCredits, amountPaise, monthlyLimitPaise) => {
          setAutoTopUpBusy(true);
          try {
            await saveAutoTopUp({ thresholdCredits, amountPaise, monthlyLimitPaise, currency: creditPricing.currency });
            await runAutoTopUpMandateSetup();
            setShowAutoTopUpSetup(false);
            // Razorpay confirms the mandate a moment after the window closes: check for a few seconds.
            for (let i = 0; i < 5; i++) {
              const state = await getAutoTopUp().catch(() => null);
              if (state?.setting?.mandateStatus !== 'PENDING') break;
              await new Promise((r) => setTimeout(r, 2000));
            }
            await loadSummary();
          }
          catch (e) { setError(billingErrorMessage(e, 'Could not start eMandate authorization.')); }
          finally { setAutoTopUpBusy(false); }
        }} />
      )}

      {purchaseModalOpen && creditPricing && (
        <AddCreditsDialog
          pricing={creditPricing}
          currencies={creditPrices}
          amount={purchaseAmount}
          onAmountChange={setPurchaseAmount}
          onCurrencyChange={(currency) => {
            const selected = creditPrices.find((price) => price.currency === currency);
            if (selected) {
              setCreditPricing(selected);
              setPurchaseAmount('');
            }
          }}
          onClose={() => setPurchaseModalOpen(false)}
          onContinue={(amountPaise) => {
            setPurchaseModalOpen(false);
            router.push(`/dashboard/billing/checkout?amountPaise=${amountPaise}&currency=${encodeURIComponent(creditPricing.currency)}`);
          }}
        />
      )}

      <SectionCard
        id="credit-history"
        title="Credit activity"
        actions={
          <select
            aria-label="Filter by type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as CreditTransactionType | '');
              setPage(1);
            }}
            className="text-xs rounded-lg border border-[#E7DFF5] px-2 py-1.5 text-[#3D3650] bg-white"
          >
            <option value="">All activity</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {CREDIT_TX_LABEL[t]}
              </option>
            ))}
          </select>
        }
      >
        {ledgerLoading && !ledger ? (
          <PageLoader label="Loading history…" />
        ) : !ledger || ledger.data.length === 0 ? (
          <p className="text-sm text-[#3D3650] py-4 text-center">
            No credit activity yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="credit-ledger">
              <thead>
                <tr className="text-left text-xs text-[#3D3650] border-b border-[#E7DFF5]">
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Description</th>
                  <th className="py-2 pr-4 font-medium text-right">Credits</th>
                  <th className="py-2 font-medium text-right">Balance after</th>
                  <th className="py-2 pl-4 font-medium text-right">Receipt</th>
                </tr>
              </thead>
              <tbody className={ledgerLoading ? 'opacity-60' : ''}>
                {ledger.data.map((row) => {
                  const hasReceipt = row.type === 'TOPUP_PURCHASE' && row.referenceType === 'Payment' && Boolean(row.referenceId);
                  const isLegacyPlanAllocation = row.type === 'SUBSCRIPTION_ALLOCATION';
                  return (
                  <tr
                    key={row.id}
                    className="border-b border-[#E7DFF5]/60 last:border-0"
                  >
                    <td className="py-2.5 pr-4 text-[#3D3650] whitespace-nowrap">
                      {formatDate(row.createdAt)}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      <Badge variant={row.amount >= 0 ? 'success' : 'default'}>
                        {isLegacyPlanAllocation ? 'Historical plan credits' : CREDIT_TX_LABEL[row.type] ?? row.type}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-[#3D3650]">
                      {describeCreditTransaction(row)}
                    </td>
                    <td
                      className={`py-2.5 pr-4 text-right font-medium whitespace-nowrap ${row.amount >= 0 ? 'text-emerald-700' : 'text-[#170B2E]'}`}
                    >
                      {row.amount >= 0 ? '+' : '−'}
                      {formatCredits(Math.abs(row.amount))}
                    </td>
                    <td className="py-2.5 text-right text-[#3D3650]">
                      {formatCredits(row.balanceAfter)}
                    </td>
                    <td className="py-2.5 pl-4 text-right">
                      {hasReceipt ? (
                        <button
                          type="button"
                          disabled={downloadingReceiptId === row.referenceId}
                          onClick={async () => {
                            if (!row.referenceId) return;
                            setDownloadingReceiptId(row.referenceId);
                            try {
                              await downloadReceipt(row.referenceId, `PurpleCallio-credit-purchase-${formatDate(row.createdAt).replaceAll(' ', '-')}`);
                            } catch (e) {
                              if (!handleAuthError(e)) setError(billingErrorMessage(e, 'Could not download this receipt. Please try again.'));
                            } finally {
                              setDownloadingReceiptId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-[#D6C4EE] px-2 py-1 text-xs font-medium text-[#6425C4] hover:bg-[#F8F4FD] disabled:cursor-wait disabled:opacity-60"
                        >
                          <Download size={13} aria-hidden="true" />
                          {downloadingReceiptId === row.referenceId ? 'Downloading…' : 'Receipt'}
                        </button>
                      ) : (
                        <span className="text-xs text-[#81758F]">—</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              page={ledger.page}
              pageCount={ledger.pageCount}
              totalItems={ledger.total}
              pageSize={ledger.pageSize}
              onPageChange={setPage}
            />
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function AddCreditsDialog({
  pricing,
  currencies,
  amount,
  onAmountChange,
  onCurrencyChange,
  onClose,
  onContinue,
}: {
  pricing: PublishedCreditPricing;
  currencies: PublishedCreditPricing[];
  amount: string;
  onAmountChange: (amount: string) => void;
  onCurrencyChange: (currency: string) => void;
  onClose: () => void;
  onContinue: (amountPaise: number) => void;
}) {
  const amountPaise = amountToMinor(amount);
  const amountError = getPurchaseAmountError(amount, amountPaise, pricing);
  const estimatedCredits = amountPaise == null
    ? null
    : Math.floor(amountPaise / pricing.creditPricePaise);
  const allocatedPaise = estimatedCredits == null
    ? null
    : estimatedCredits * pricing.creditPricePaise;
  const remainderPaise = amountPaise != null && allocatedPaise != null
    ? amountPaise - allocatedPaise
    : 0;
  const quickAmounts = getQuickAmounts(pricing);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-credits-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E7DFF5] bg-white p-5 shadow-2xl sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!amountError && amountPaise != null) onContinue(amountPaise);
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="add-credits-title" className="text-lg font-semibold text-[#170B2E]">Add Credits</h2>
            <p className="mt-1 text-sm text-[#3D3650]">Choose how much you want to add to your wallet. Review the estimated credits before proceeding to checkout.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#3D3650] hover:bg-[#F8F4FD] hover:text-[#170B2E]"
            aria-label="Close Add Credits"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 rounded-lg bg-[#F8F4FD] p-3 text-sm text-[#3D3650]">
          <p><strong className="text-[#170B2E]">{formatMoney(pricing.creditPricePaise, pricing.currency)} per credit</strong></p>
          <p className="mt-1">Minimum purchase: {formatMoney(pricing.minimumPurchasePaise, pricing.currency)} · Credit validity: {pricing.purchasedValidityDays} days</p>
        </div>

        {currencies.length > 1 && (
          <label className="mt-5 block text-xs font-medium text-[#3D3650]">
            Currency
            <select
              value={pricing.currency}
              onChange={(event) => onCurrencyChange(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#E7DFF5] bg-white px-3 py-2 text-sm text-[#170B2E]"
            >
              {currencies.map((currency) => <option key={currency.currency} value={currency.currency}>{currency.currency}</option>)}
            </select>
          </label>
        )}

        <label className="mt-5 block text-xs font-medium text-[#3D3650]">
          Amount to add ({pricing.currency})
          <input
            autoFocus
            inputMode="decimal"
            placeholder={`Min: ${formatMoney(pricing.minimumPurchasePaise, pricing.currency)}`}
            value={amount}
            onChange={(event) => {
              const next = event.target.value;
              if (/^\d*(\.\d{0,2})?$/.test(next)) onAmountChange(next);
            }}
            aria-invalid={Boolean(amount && amountError)}
            aria-describedby="purchase-amount-error"
            className="mt-1 w-full rounded-lg border border-[#E7DFF5] bg-white px-3 py-2 text-sm text-[#170B2E] outline-none focus:border-[#7F40E8] focus:ring-2 focus:ring-[#7F40E8]/20"
          />
        </label>
        {amount && amountError && <p id="purchase-amount-error" className="mt-1 text-xs text-red-700">{amountError}</p>}

        <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick amounts">
          {quickAmounts.map((quickAmount) => (
            <button
              key={quickAmount}
              type="button"
              onClick={() => onAmountChange((quickAmount / 100).toFixed(2))}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${amountPaise === quickAmount ? 'border-[#7F40E8] bg-[#7F40E8]/10 text-[#6425C4]' : 'border-[#E7DFF5] text-[#3D3650] hover:bg-[#F8F4FD]'}`}
            >
              {formatMoney(quickAmount, pricing.currency)}
            </button>
          ))}
        </div>

        <div className="mt-5 rounded-xl border border-[#E7DFF5] bg-[#F8F4FD] p-4" aria-live="polite">
          <h3 className="text-sm font-semibold text-[#170B2E]">Estimated credits</h3>
          {amountError || estimatedCredits == null || allocatedPaise == null ? (
            <p className="mt-2 text-sm text-[#3D3650]">Enter a valid amount to see your estimate.</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <PurchaseEstimate label="Amount allocated to credits" value={formatMoney(allocatedPaise, pricing.currency)} />
              <PurchaseEstimate label="Estimated credits" value={formatCredits(estimatedCredits)} />
              <PurchaseEstimate label="Price per credit" value={formatMoney(pricing.creditPricePaise, pricing.currency)} />
              <PurchaseEstimate label="Credit validity" value={`${pricing.purchasedValidityDays} days`} />
              <p className="sm:col-span-2 text-xs leading-5 text-[#3D3650]">
                The final credit quantity, tax, discounts and payable amount are confirmed by the checkout quote.
                {remainderPaise > 0 ? ` ${formatMoney(remainderPaise, pricing.currency)} is not allocated to a whole credit and is not carried forward.` : ''}
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={Boolean(amountError) || amountPaise == null}>Continue to Checkout</Button>
        </div>
      </form>
    </div>
  );
}

function PurchaseEstimate({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white p-3"><p className="text-xs text-[#5D536E]">{label}</p><p className="mt-1 text-base font-semibold text-[#170B2E]">{value}</p></div>;
}

type TopUpStage = { key: 'off' | 'pending' | 'ready' | 'on' | 'attention'; label: string; badge: 'default' | 'warning' | 'info' | 'purple' | 'error'; text: string };

/** Where the customer is in setup: authorize → Razorpay confirms → turn on. */
function autoTopUpStage(s: AutoTopUpState['setting']): TopUpStage {
  const status = s?.mandateStatus ?? 'NONE';
  if (s?.enabled) return { key: 'on', label: 'On', badge: 'purple', text: 'Auto Top-Up is on. Credits are added automatically using your confirmed Razorpay eMandate.' };
  if (status === 'ACTIVE') return { key: 'ready', label: 'Ready to turn on', badge: 'info', text: 'Razorpay has confirmed your eMandate. Turn on Auto Top-Up to start. Nothing is charged until you do.' };
  if (status === 'PENDING') return { key: 'pending', label: 'Awaiting confirmation', badge: 'warning', text: 'Your eMandate is waiting for Razorpay to confirm it. This usually takes a few seconds; some banks take up to a few days. Once confirmed, you can turn Auto Top-Up on here.' };
  if (status === 'FAILED' || status === 'REVOKED' || status === 'EXPIRED') return { key: 'attention', label: 'Needs attention', badge: 'error', text: 'Your eMandate is no longer active. Authorize it again to use Auto Top-Up.' };
  return { key: 'off', label: 'Off', badge: 'default', text: 'Authorize a Razorpay eMandate to add credits when your balance reaches your chosen threshold. Charges stay off until you turn Auto Top-Up on after Razorpay confirms the mandate.' };
}

function AutoTopUpDialog({ pricing, existing, busy, onClose, onSave }: { pricing: PublishedCreditPricing; existing: AutoTopUpState['setting']; busy: boolean; onClose: () => void; onSave: (threshold: number, amount: number, cap: number) => Promise<void> }) {
  // A first setup starts empty (the customer chooses every value); a change starts from the saved values.
  const rupees = (paise: number) => (paise / 100).toFixed(2).replace(/\.00$/, '');
  const [threshold, setThreshold] = useState(existing ? String(existing.thresholdCredits) : '');
  const [amount, setAmount] = useState(existing ? rupees(existing.amountPaise) : '');
  const [cap, setCap] = useState(existing ? rupees(existing.monthlyLimitPaise) : '');
  const [error, setError] = useState<string | null>(null);
  const minimum = formatMoney(pricing.minimumPurchasePaise, pricing.currency);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = Number(threshold);
    const a = amountToMinor(amount);
    const c = amountToMinor(cap);
    if (!threshold.trim() || !Number.isSafeInteger(t) || t < 0) return setError('Enter the credit balance that should trigger a top-up (a whole number).');
    if (!a) return setError('Enter a top-up amount with up to 2 decimal places.');
    const amountError = getPurchaseAmountError(amount, a, pricing);
    if (amountError) return setError(amountError.replace('purchase', 'top-up'));
    if (!c) return setError('Enter a monthly maximum with up to 2 decimal places.');
    if (c < a) return setError('The monthly maximum must be at least the top-up amount.');
    setError(null);
    void onSave(t, a, c);
  };
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-[#170B2E]/45 p-4"><form noValidate className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onSubmit={submit}><h2 className="text-lg font-semibold text-[#170B2E]">{existing ? 'Update Auto Top-Up' : 'Configure Auto Top-Up'}</h2><p className="mt-2 text-sm text-[#3D3650]">You will authorize an eMandate in Razorpay. No automatic charge is enabled until Razorpay confirms it and you turn Auto Top-Up on.</p><label className="mt-4 block text-sm">Credit threshold<input required min="0" type="number" placeholder="Top up when credits fall below…" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="mt-1 w-full rounded border p-2" /></label><label className="mt-3 block text-sm">Top-up amount ({pricing.currency})<input required inputMode="decimal" placeholder={`Minimum ${minimum}`} value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded border p-2" /></label><label className="mt-3 block text-sm">Monthly maximum ({pricing.currency})<input required inputMode="decimal" placeholder="At least the top-up amount" value={cap} onChange={(e) => setCap(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}<div className="mt-5 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Starting…' : 'Authorize eMandate'}</Button></div></form></div>;
}

function getPurchaseAmountError(amount: string, paise: number | null, pricing: PublishedCreditPricing) {
  if (!amount) return 'Enter an amount.';
  if (paise == null || paise <= 0) return 'Enter a valid positive amount with up to 2 decimal places.';
  if (paise < pricing.minimumPurchasePaise) return `The minimum purchase is ${formatMoney(pricing.minimumPurchasePaise, pricing.currency)}.`;
  if (pricing.maximumPurchasePaise != null && paise > pricing.maximumPurchasePaise) return `The maximum purchase is ${formatMoney(pricing.maximumPurchasePaise, pricing.currency)}.`;
  return null;
}

function getQuickAmounts(pricing: PublishedCreditPricing) {
  const options = [pricing.minimumPurchasePaise, 200_000, 500_000, 1_000_000]
    .filter((value) => value >= pricing.minimumPurchasePaise && (pricing.maximumPurchasePaise == null || value <= pricing.maximumPurchasePaise));
  return [...new Set(options)].slice(0, 4);
}
