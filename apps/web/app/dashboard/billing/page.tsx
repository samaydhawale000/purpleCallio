'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AUTO_TOPUP_ATTENTION_TEXT,
  billingErrorMessage,
  disableAutoTopUp,
  enableAutoTopUp,
  formatMoney,
  getAutoTopUp,
  getCreditSummary,
  getPublishedCreditPrices,
  isFreeCreditSource,
  saveAutoTopUp,
  walletSplit,
  type PublishedCreditPricing,
} from '../../lib/billing';
import { runAutoTopUpMandateSetup } from '../../lib/checkout';
import { Block, ErrorNote, Panel, Pill, Section, Stat, Table, buttonCls, fmtDate, fmtNumber, useResource } from '../_ui';
import { BillingHeader } from './BillingShell';
import { AddCreditsDialog, AutoTopUpDialog, autoTopUpStage } from './_components/wallet-dialogs';

export default function BillingOverviewPage() {
  return (
    <Suspense fallback={null}>
      <BillingOverview />
    </Suspense>
  );
}

function BillingOverview() {
  const router = useRouter();
  const params = useSearchParams();

  const wallet = useResource(getCreditSummary);
  const topUp = useResource(() => getAutoTopUp().catch(() => null));
  const prices = useResource(() => getPublishedCreditPrices().catch(() => [] as PublishedCreditPricing[]));

  const [currency, setCurrency] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const allPrices = prices.data ?? [];
  const pricing = allPrices.find((p) => p.currency === (currency ?? 'INR')) ?? allPrices[0] ?? null;
  const setting = topUp.data?.setting ?? null;
  const stage = autoTopUpStage(setting);

  // ?add=1 (from "Add credits" links anywhere in the app) opens the dialog.
  useEffect(() => {
    if (params?.get('add') === '1' && pricing) setAdding(true);
  }, [params, pricing]);

  const closeAdd = () => {
    setAdding(false);
    if (params?.get('add')) router.replace('/dashboard/billing');
  };

  const runTopUp = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await Promise.all([topUp.reload(), wallet.reload()]);
    } catch (e) {
      setActionError(billingErrorMessage(e, 'Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const purchaseBlocked = wallet.data?.purchase?.eligible === false;

  return (
    <>
      <BillingHeader
        title="Billing"
        subtitle="Your prepaid credit balance and payments."
        actions={
          <button type="button" className={buttonCls('primary')} disabled={!pricing || purchaseBlocked} onClick={() => setAdding(true)}>
            Add credits
          </button>
        }
      />

      {actionError && (
        <div className="mb-6">
          <ErrorNote message={actionError} />
        </div>
      )}

      <div className="mb-10 grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <Block res={wallet} loadingLabel="Loading your balance…">
            {(w) => {
              const split = walletSplit(w);
              return (
                <>
                  <Stat
                    label="Available credits"
                    value={<span data-testid="wallet-summary">{fmtNumber(w.available)}</span>}
                    tone={w.available <= 0 ? 'danger' : undefined}
                    hint={w.available <= 0 ? 'New calls are paused until you add credits.' : undefined}
                  />
                  <p className="mt-4 text-[13px] text-[#6B6478]" data-testid="credit-split">
                    {fmtNumber(split.paid)} paid · {fmtNumber(split.free)} free
                    {split.free > 0 && ' (free credits cover audio, video and screen share only)'}
                    {w.reserved > 0 && ` · ${fmtNumber(w.reserved)} reserved for live calls`}
                  </p>
                  {pricing && (
                    <p className="mt-1 text-[13px] text-[#6B6478]">
                      {formatMoney(pricing.creditPricePaise, pricing.currency)} per credit · purchased credits last {pricing.purchasedValidityDays} days
                    </p>
                  )}
                  {purchaseBlocked && (
                    <p className="mt-3 text-sm text-amber-800">{w.purchase?.reason ?? 'Credit purchases are unavailable for this account.'}</p>
                  )}
                </>
              );
            }}
          </Block>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] text-[#6B6478]">Auto top-up</p>
            <Pill tone={stage.tone}>{stage.label}</Pill>
          </div>
          <p className="mt-3 text-sm text-[#170B2E]" data-testid="auto-topup-status">
            {setting?.enabled && setting.mandateStatus !== 'NONE'
              ? `Below ${fmtNumber(setting.thresholdCredits)} credits, add ${formatMoney(setting.amountPaise, setting.currency)} (max ${formatMoney(
                  setting.monthlyLimitPaise,
                  setting.currency,
                )}/month).`
              : stage.text}
          </p>
          {setting?.attentionReason && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {AUTO_TOPUP_ATTENTION_TEXT[setting.attentionReason] ?? setting.attentionReason}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {stage.key === 'ready' && (
              <button type="button" className={buttonCls('primary')} disabled={busy} onClick={() => runTopUp(enableAutoTopUp)}>
                Turn on
              </button>
            )}
            {stage.key === 'pending' && (
              <button type="button" className={buttonCls('secondary')} disabled={busy} onClick={() => runTopUp(async () => undefined)}>
                Check status
              </button>
            )}
            <button type="button" className={buttonCls('secondary')} disabled={busy || !pricing} onClick={() => setSettingUp(true)}>
              {stage.key === 'off' ? 'Set up' : stage.key === 'attention' ? 'Authorize again' : 'Change'}
            </button>
            {setting?.enabled && (
              <button type="button" className={buttonCls('ghost')} disabled={busy} onClick={() => runTopUp(disableAutoTopUp)}>
                Turn off
              </button>
            )}
          </div>
        </Panel>
      </div>

      <Section title="Upcoming expiries" description="Each purchase keeps its own expiry date.">
        <Block res={wallet}>
          {(w) => {
            const lots = w.buckets
              .filter((b) => b.remaining > 0 && b.expiresAt)
              .sort((a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''))
              .slice(0, 8);
            return lots.length === 0 ? (
              <p className="text-sm text-[#6B6478]">No credits are due to expire.</p>
            ) : (
              <Table
                rows={lots}
                rowKey={(b) => b.id}
                columns={[
                  { key: 'credits', label: 'Credits', render: (b) => fmtNumber(b.remaining) },
                  { key: 'kind', label: 'Type', render: (b) => (isFreeCreditSource(b.source) ? 'Free' : 'Paid') },
                  { key: 'expires', label: 'Expires', align: 'right', render: (b) => fmtDate(b.expiresAt) },
                ]}
              />
            );
          }}
        </Block>
      </Section>

      {adding && pricing && (
        <AddCreditsDialog
          pricing={pricing}
          currencies={allPrices}
          onCurrencyChange={setCurrency}
          onClose={closeAdd}
          onContinue={(amountPaise) =>
            router.push(`/dashboard/billing/checkout?amountPaise=${amountPaise}&currency=${encodeURIComponent(pricing.currency)}`)
          }
        />
      )}

      {settingUp && pricing && (
        <AutoTopUpDialog
          pricing={pricing}
          existing={setting}
          busy={busy}
          onClose={() => setSettingUp(false)}
          onSave={(thresholdCredits, amountPaise, monthlyLimitPaise) =>
            runTopUp(async () => {
              await saveAutoTopUp({ thresholdCredits, amountPaise, monthlyLimitPaise, currency: pricing.currency });
              await runAutoTopUpMandateSetup();
              setSettingUp(false);
              // Razorpay confirms the mandate a moment after the window closes: check for a few seconds.
              for (let i = 0; i < 5; i++) {
                const state = await getAutoTopUp().catch(() => null);
                if (state?.setting?.mandateStatus !== 'PENDING') break;
                await new Promise((r) => setTimeout(r, 2000));
              }
            })
          }
        />
      )}
    </>
  );
}
