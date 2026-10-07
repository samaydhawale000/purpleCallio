'use client';

import { FormEvent, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import {
  listAdminPlans,
  listAdminSubscriptions,
  migrationSourceLabel,
  SUBSCRIPTION_STATUSES,
} from '../../../lib/admin-billing';
import { formatCredits, formatDate, formatMoney, intervalLabel } from '../../../lib/billing';
import { Badge } from '../../../components/ui/Badge';
import { Pagination } from '../../../components/ui/Pagination';
import { Checkbox, ErrorText, inputCls, Panel, rowCls, Spinner, StatusBadge, Table, tdCls, useResource } from './ui';

export function SearchBox({ placeholder, onSearch }: { placeholder: string; onSearch: (q: string) => void }) {
  const [value, setValue] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(value.trim());
  };
  return (
    <form onSubmit={submit} className="relative flex-1 min-w-[220px] max-w-md">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3D3650]" />
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className={`${inputCls} pl-9`} />
    </form>
  );
}

export function SubscriptionsTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [planId, setPlanId] = useState('');
  const [search, setSearch] = useState('');
  const [legacy, setLegacy] = useState(false);
  const plans = useResource(listAdminPlans, []);
  const { data, loading, error } = useResource(
    () => listAdminSubscriptions({ page, status, planId, search, legacy }),
    [page, status, planId, search, legacy],
  );
  const planNames = useMemo(() => new Map((plans.data ?? []).map((p) => [p.id, p.name])), [plans.data]);

  const filter = <T,>(setter: (v: T) => void) => (v: T) => {
    setPage(1);
    setter(v);
  };

  return (
    <Panel title="Subscriptions" subtitle="Each customer's current and past plan periods.">
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <SearchBox placeholder="Search customer email, name, company… (Enter)" onSearch={filter(setSearch)} />
        <select aria-label="Status" className={`${inputCls} w-auto`} value={status} onChange={(e) => filter(setStatus)(e.target.value)}>
          <option value="">All statuses</option>
          {SUBSCRIPTION_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>
          ))}
        </select>
        <select aria-label="Plan" className={`${inputCls} w-auto`} value={planId} onChange={(e) => filter(setPlanId)(e.target.value)}>
          <option value="">All plans</option>
          {(plans.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <Checkbox label="Legacy accounts only" checked={legacy} onChange={filter(setLegacy)} />
      </div>
      {loading ? (
        <Spinner tall={false} />
      ) : error || !data ? (
        <ErrorText>{error || 'Failed to load'}</ErrorText>
      ) : (
        <>
          <Table
            headers={['Customer', 'Plan', 'Status', 'Price', 'Credits', 'Period end', 'Changes']}
            empty={data.data.length === 0 ? 'No subscriptions match these filters.' : undefined}
          >
            {data.data.map((s) => {
              const legacyLabel = migrationSourceLabel(s.migrationSource);
              return (
                <tr key={s.id} className={rowCls}>
                  <td className={tdCls}>
                    <Link href={`/admin/customers/${s.customer.id}`} className="text-[#170B2E] hover:text-[#6425C4]">
                      {s.customer.companyName || s.customer.name || s.customer.email}
                    </Link>
                    <div className="text-[11px]">{s.customer.email}</div>
                  </td>
                  <td className={tdCls}>
                    <span className="text-[#170B2E]">{s.planName ?? '—'}</span>
                    {s.planType && <div className="text-[11px]">{s.planType}</div>}
                    {legacyLabel && (
                      <Badge variant={s.migrationSource === 'legacy_payg_paying' ? 'warning' : 'default'} className="mt-1">
                        {legacyLabel}
                      </Badge>
                    )}
                  </td>
                  <td className={tdCls}><StatusBadge status={s.status} /></td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    {s.planType === 'FREE' ? 'Free' : `${formatMoney(s.pricePaise, s.currency)}${s.billingInterval ? ` / ${intervalLabel({ billingInterval: s.billingInterval, intervalCount: s.intervalCount })}` : ''}`}
                  </td>
                  <td className={tdCls}>{formatCredits(s.includedCredits)}</td>
                  <td className={`${tdCls} whitespace-nowrap`}>{formatDate(s.currentPeriodEnd)}</td>
                  <td className={tdCls}>
                    {s.cancelAtPeriodEnd && <div className="text-[11px] text-amber-700">Cancels at period end</div>}
                    {s.scheduledPlanId && (
                      <div className="text-[11px] text-[#6425C4]">Downgrade to {planNames.get(s.scheduledPlanId) ?? 'another plan'} at period end</div>
                    )}
                    {!s.cancelAtPeriodEnd && !s.scheduledPlanId && '—'}
                  </td>
                </tr>
              );
            })}
          </Table>
          <Pagination page={page} pageCount={data.pageCount} totalItems={data.total} pageSize={data.pageSize} onPageChange={setPage} />
        </>
      )}
    </Panel>
  );
}
