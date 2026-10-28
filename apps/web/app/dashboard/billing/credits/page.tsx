'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import {
  billingErrorMessage,
  CREDIT_TX_LABEL,
  describeCreditTransaction,
  downloadReceipt,
  formatDate,
  getCreditHistory,
  type CreditTransactionRow,
  type CreditTransactionType,
} from '../../../lib/billing';
import { Block, Empty, ErrorNote, Pager, Table, buttonCls, fmtNumber, inputCls, useResource } from '../../_ui';
import { BillingHeader } from '../BillingShell';

const TYPES = Object.keys(CREDIT_TX_LABEL) as CreditTransactionType[];

export default function TransactionsPage() {
  const router = useRouter();
  const [type, setType] = useState<CreditTransactionType | ''>('');
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Old "Add credits" links pointed here with #topups; buying now lives on the overview.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#topups') router.replace('/dashboard/billing?add=1');
  }, [router]);

  const ledger = useResource(() => getCreditHistory(page, type || undefined), [page, type]);

  const receipt = async (row: CreditTransactionRow) => {
    if (!row.referenceId) return;
    setDownloading(row.referenceId);
    setError(null);
    try {
      await downloadReceipt(row.referenceId, `PurpleCallio-credit-purchase-${formatDate(row.createdAt).replaceAll(' ', '-')}`);
    } catch (e) {
      setError(billingErrorMessage(e, 'Could not download this receipt. Please try again.'));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <BillingHeader
        title="Billing"
        subtitle="Every credit added to or taken from your balance."
        actions={
          <select
            aria-label="Filter by type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as CreditTransactionType | '');
              setPage(1);
            }}
            className={`${inputCls} w-auto`}
          >
            <option value="">All activity</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {CREDIT_TX_LABEL[t]}
              </option>
            ))}
          </select>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      <Block res={ledger} loadingLabel="Loading transactions…">
        {(res) => (
          <div data-testid="credit-ledger">
            <Table
              rows={res.data}
              rowKey={(r) => r.id}
              empty={<Empty title="No credit activity yet" />}
              columns={[
                { key: 'date', label: 'Date', render: (r) => formatDate(r.createdAt) },
                {
                  key: 'type',
                  label: 'Type',
                  render: (r) => (r.type === 'SUBSCRIPTION_ALLOCATION' ? 'Historical plan credits' : CREDIT_TX_LABEL[r.type] ?? r.type),
                },
                {
                  key: 'desc',
                  label: 'Description',
                  className: 'max-w-[320px] truncate text-[#6B6478]',
                  render: (r) => describeCreditTransaction(r),
                },
                {
                  key: 'amount',
                  label: 'Credits',
                  align: 'right',
                  render: (r) => (
                    <span className={r.amount >= 0 ? 'text-emerald-700' : ''}>
                      {r.amount >= 0 ? '+' : '−'}
                      {fmtNumber(Math.abs(r.amount))}
                    </span>
                  ),
                },
                { key: 'balance', label: 'Balance', align: 'right', className: 'text-[#6B6478]', render: (r) => fmtNumber(r.balanceAfter) },
                {
                  key: 'receipt',
                  label: '',
                  align: 'right',
                  render: (r) =>
                    r.type === 'TOPUP_PURCHASE' && r.referenceType === 'Payment' && r.referenceId ? (
                      <button
                        type="button"
                        className={buttonCls('ghost', 'px-2 py-1 text-xs')}
                        disabled={downloading === r.referenceId}
                        onClick={() => receipt(r)}
                      >
                        <Download size={13} aria-hidden="true" />
                        {downloading === r.referenceId ? 'Downloading…' : 'Receipt'}
                      </button>
                    ) : null,
                },
              ]}
            />
            <Pager page={res.page} pageCount={res.pageCount} total={res.total} onChange={setPage} />
          </div>
        )}
      </Block>
    </>
  );
}
