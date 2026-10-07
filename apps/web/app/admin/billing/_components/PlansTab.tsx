'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import {
  archivePlan,
  duplicatePlan,
  listAdminPlans,
  listPlanSubscribers,
  updatePlan,
  type AdminPlan,
} from '../../../lib/admin-billing';
import { formatCredits, formatDate, formatMoney, intervalLabel } from '../../../lib/billing';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { Pagination } from '../../../components/ui/Pagination';
import { ToastHost, type ToastState } from '../../../dashboard/billing/Toast';
import { ErrorText, linkBtn, Modal, Panel, rowCls, Spinner, StatusBadge, Table, tdCls, useAdminErrorHandler, useResource } from './ui';

export function planPriceLabel(p: Pick<AdminPlan, 'customPricing' | 'version'>) {
  if (p.customPricing || !p.version) return 'Custom pricing';
  return `${formatMoney(p.version.pricePaise, p.version.currency)} / ${intervalLabel(p.version)}`;
}

export function PlansTab() {
  const router = useRouter();
  const handle = useAdminErrorHandler();
  const { data: plans, loading, error, reload } = useResource(listAdminPlans, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [subscribersOf, setSubscribersOf] = useState<AdminPlan | null>(null);

  const run = async (id: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(id);
    try {
      await fn();
      setToast({ id: Date.now(), type: 'success', message: success });
      await reload();
    } catch (e) {
      const msg = handle(e, 'Action failed');
      if (msg) setToast({ id: Date.now(), type: 'error', message: msg });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Spinner />;
  if (error || !plans) return <ErrorText>{error || 'Failed to load plans'}</ErrorText>;

  return (
    <>
      <ToastHost toast={toast} onDismiss={() => setToast(null)} />
      <Panel
        title="Plans"
        subtitle="Plans are never deleted. Archive a plan to retire it — existing subscribers keep the terms they purchased."
        actions={
          <Button size="sm" onClick={() => router.push('/admin/billing/plans/new')}>
            <Plus size={14} /> New plan
          </Button>
        }
      >
        <Table
          headers={['Plan', 'Type', 'Status', 'Price', 'Credits', 'Visibility', 'Subscribers', 'Updated', 'Actions']}
          empty={plans.length === 0 ? 'No plans yet.' : undefined}
        >
          {plans.map((p) => (
            <tr key={p.id} className={rowCls}>
              <td className={tdCls}>
                <Link href={`/admin/billing/plans/${p.id}`} className="font-medium text-[#170B2E] hover:text-[#6425C4]">
                  {p.name}
                </Link>
                <div className="text-[11px] text-[#6B6478] font-mono">{p.slug}</div>
                {p.isPopular && <Badge variant="purple" className="mt-1">Popular</Badge>}
              </td>
              <td className={tdCls}>{p.type}</td>
              <td className={tdCls}><StatusBadge status={p.status} /></td>
              <td className={`${tdCls} whitespace-nowrap text-[#170B2E]`}>{planPriceLabel(p)}</td>
              <td className={tdCls}>{p.version ? formatCredits(p.version.includedCredits) : '—'}</td>
              <td className={tdCls}>
                {p.isPublic ? 'Public' : 'Private'}
                {!p.isPublic && p.assignedUser && (
                  <div className="text-[11px]">
                    for{' '}
                    <Link href={`/admin/customers/${p.assignedUser.id}`} className="text-[#6425C4] hover:underline">
                      {p.assignedUser.email}
                    </Link>
                  </div>
                )}
              </td>
              <td className={tdCls}>{p.activeSubscribers}</td>
              <td className={`${tdCls} whitespace-nowrap`}>{formatDate(p.updatedAt)}</td>
              <td className={tdCls}>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <Link href={`/admin/billing/plans/${p.id}`} className={linkBtn}>Edit</Link>
                  <button className={linkBtn} disabled={busy === p.id} onClick={() => run(p.id, () => duplicatePlan(p.id), `Duplicated ${p.name} (inactive copy)`)}>
                    Duplicate
                  </button>
                  {p.status !== 'ARCHIVED' && (
                    <button
                      className={linkBtn}
                      disabled={busy === p.id}
                      onClick={() =>
                        run(
                          p.id,
                          () => updatePlan(p.id, { status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
                          p.status === 'ACTIVE' ? `${p.name} deactivated` : `${p.name} activated`,
                        )
                      }
                    >
                      {p.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </button>
                  )}
                  {p.status === 'ARCHIVED' ? (
                    <button className={linkBtn} disabled={busy === p.id} onClick={() => run(p.id, () => updatePlan(p.id, { status: 'INACTIVE' }), `${p.name} restored as inactive`)}>
                      Restore
                    </button>
                  ) : (
                    <button
                      className="text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-40"
                      disabled={busy === p.id}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Archive "${p.name}"? It will no longer be offered to customers. Existing subscribers keep their current terms until their period ends.`,
                          )
                        ) {
                          run(p.id, () => archivePlan(p.id), `${p.name} archived`);
                        }
                      }}
                    >
                      Archive
                    </button>
                  )}
                  <button className={linkBtn} onClick={() => setSubscribersOf(p)}>
                    Subscribers
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>
      {subscribersOf && <SubscribersModal plan={subscribersOf} onClose={() => setSubscribersOf(null)} />}
    </>
  );
}

function SubscribersModal({ plan, onClose }: { plan: AdminPlan; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useResource(() => listPlanSubscribers(plan.id, page), [plan.id, page]);
  return (
    <Modal title={`Subscribers — ${plan.name}`} onClose={onClose} wide>
      {loading ? (
        <Spinner tall={false} />
      ) : error || !data ? (
        <ErrorText>{error || 'Failed to load'}</ErrorText>
      ) : (
        <>
          <Table headers={['Customer', 'Status', 'Price', 'Credits', 'Period end']} empty={data.data.length === 0 ? 'No active subscribers.' : undefined}>
            {data.data.map((s) => (
              <tr key={s.id} className={rowCls}>
                <td className={tdCls}>
                  <Link href={`/admin/customers/${s.company.id}`} className="text-[#170B2E] hover:text-[#6425C4]">
                    {s.company.companyName || s.company.name || s.company.email}
                  </Link>
                  <div className="text-[11px]">{s.company.email}</div>
                </td>
                <td className={tdCls}><StatusBadge status={s.status} /></td>
                <td className={tdCls}>{formatMoney(s.pricePaise, s.currency)}</td>
                <td className={tdCls}>{formatCredits(s.includedCredits)}</td>
                <td className={tdCls}>
                  {formatDate(s.currentPeriodEnd)}
                  {s.cancelAtPeriodEnd && <div className="text-[11px] text-amber-700">Cancels at period end</div>}
                </td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} pageCount={data.pageCount} totalItems={data.total} pageSize={data.pageSize} onPageChange={setPage} />
        </>
      )}
    </Modal>
  );
}
