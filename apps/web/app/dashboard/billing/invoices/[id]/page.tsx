'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import { useAuthStore } from '../../../../store/auth.store';
import { useRequireAuth } from '../../../../hooks/useRequireAuth';
import { api } from '../../../../lib/api';
import { ErrorNote, Loading, Panel, Pill, buttonCls, type Tone } from '../../../_ui';
import { formatMinutes } from '../../../../lib/duration';

interface LineItem {
  id: string;
  callId: string | null;
  mediaType: string;
  minutes: number;
  participants: number;
  amountPaise: number;
}

interface InvoiceDetail {
  id: string;
  invoiceNumber: string;
  cycleStart: string;
  cycleEnd: string;
  audioMinutes: number;
  videoMinutes: number;
  screenShareMinutes: number;
  audioPaise: number;
  videoPaise: number;
  screenSharePaise: number;
  subtotalPaise: number;
  discountPercent: number | null;
  discountPaise: number;
  discountReason: string | null;
  taxPaise: number;
  totalPaise: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
  lineItems: LineItem[];
}

const paiseToINR = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

const statusTone: Record<string, Tone> = {
  open: 'accent',
  processing: 'accent',
  paid: 'success',
  dunning: 'warning', // shown as "Unpaid"
  failed: 'danger',
};

const backCls = 'inline-flex w-fit items-center gap-1 text-[13px] text-[#6B6478] hover:text-[#170B2E]';

export default function InvoiceDetailPage() {
  const { token, logout } = useAuthStore();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { isReady } = useRequireAuth();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const fetchInvoice = useCallback(async () => {
    try {
      const res = await api.get(`/billing/usage-invoices/${params.id}`);
      setInvoice(res.data);
      setError(null);
    } catch (e: any) {
      if (e?.response?.status === 401) {
        logout();
        router.push('/login');
      } else {
        setError('Could not load this legacy invoice.');
      }
    } finally {
      setLoading(false);
    }
  }, [params.id, logout, router]);

  useEffect(() => {
    if (!isReady) return;
    if (!token) { router.push('/login'); return; }
    fetchInvoice();
  }, [isReady, token, fetchInvoice, router]);

  const downloadPdf = async () => {
    if (!invoice) return;
    setDownloading(true);
    try {
      const res = await api.get(`/billing/usage-invoices/${invoice.id}/pdf`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber ?? invoice.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return <Loading label="Loading invoice…" />;
  }

  if (error || !invoice) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/dashboard/billing/payments" className={backCls}>
          <ArrowLeft size={14} /> Back to Payments
        </Link>
        <ErrorNote message={error ?? 'Invoice not found.'} />
      </div>
    );
  }

  const adjustments = invoice.lineItems.filter((li) => li.mediaType === 'adjustment');

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/billing/payments" className={backCls}>
          <ArrowLeft size={14} /> Back to Payments
        </Link>
        <button type="button" onClick={downloadPdf} disabled={downloading} className={buttonCls('secondary')}>
          <Download size={14} />
          {downloading ? 'Preparing PDF…' : 'Download PDF'}
        </button>
      </div>

      <p className="text-[13px] text-[#6B6478]">
        This invoice is from the previous billing model and is kept for your records. PurpleCallio now uses prepaid credit purchases.
      </p>

      <Panel>
        <div className="flex items-start justify-between mb-6">
          <div>
            <p className="mb-1 text-xs text-[#6B6478]">Legacy usage invoice</p>
            <p className="font-mono text-lg font-semibold text-[#170B2E]">{invoice.invoiceNumber}</p>
          </div>
          <Pill tone={statusTone[invoice.status] ?? 'neutral'}>{invoice.status === 'dunning' ? 'UNPAID' : invoice.status.toUpperCase()}</Pill>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <p className="text-xs text-[#6B6478] mb-0.5">Billing period</p>
            <p className="text-[#170B2E]">
              {new Date(invoice.cycleStart).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
              {' – '}
              {new Date(invoice.cycleEnd).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#6B6478] mb-0.5">Invoice date</p>
            <p className="text-[#170B2E]">
              {new Date(invoice.createdAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          {invoice.paidAt && (
            <div>
              <p className="text-xs text-[#6B6478] mb-0.5">Paid on</p>
              <p className="text-[#170B2E]">
                {new Date(invoice.paidAt).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-[#E4DEEE] pt-4 mb-4">
          <p className="text-sm font-semibold text-[#170B2E] mb-3">Usage</p>
          <div className="flex flex-col gap-2 text-sm">
            <Row label={`Audio — ${formatMinutes(invoice.audioMinutes)} participant time`} value={paiseToINR(invoice.audioPaise)} />
            <Row label={`Video — ${formatMinutes(invoice.videoMinutes)} participant time`} value={paiseToINR(invoice.videoPaise)} />
            <Row label={`Screen share — ${formatMinutes(invoice.screenShareMinutes)} participant time`} value={paiseToINR(invoice.screenSharePaise)} />
          </div>
        </div>

        {adjustments.length > 0 && (
          <div className="border-t border-[#E4DEEE] pt-4 mb-4">
            <p className="text-sm font-semibold text-[#170B2E] mb-3">Adjustments</p>
            <div className="flex flex-col gap-2 text-sm">
              {adjustments.map((a) => (
                <Row
                  key={a.id}
                  label={a.amountPaise < 0 ? 'Plan-change credit' : 'Plan-change charge'}
                  value={paiseToINR(Math.abs(a.amountPaise))}
                />
              ))}
            </div>
          </div>
        )}

        <div className="border-t border-[#E4DEEE] pt-4 flex flex-col gap-2 text-sm">
          <Row label="Subtotal" value={paiseToINR(invoice.subtotalPaise)} />
          {invoice.discountPaise > 0 && (
            <Row
              label={
                invoice.discountPercent != null
                  ? `Volume discount (${invoice.discountPercent}%)`
                  : 'Discount'
              }
              value={`-${paiseToINR(invoice.discountPaise)}`}
            />
          )}
          <Row label="Tax (GST)" value={paiseToINR(invoice.taxPaise)} />
          <div className="flex items-center justify-between text-base font-semibold text-[#170B2E] pt-2 border-t border-[#E4DEEE]">
            <span>Total</span>
            <span>{paiseToINR(invoice.totalPaise)}</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[#6B6478]">
      <span className="text-[#6B6478]">{label}</span>
      <span className="font-medium text-[#170B2E]">{value}</span>
    </div>
  );
}
