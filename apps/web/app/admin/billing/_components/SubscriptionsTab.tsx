'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import {
  listAdminSubscriptions,
  migrationSourceLabel,
} from '../../../lib/admin-billing';
import { formatCredits, formatDate, formatMoney } from '../../../lib/billing';
import { Badge } from '../../../components/ui/Badge';
import { Pagination } from '../../../components/ui/Pagination';
import { ErrorText, inputCls, Panel, rowCls, Spinner, Table, tdCls, useResource } from './ui';

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
  const [search, setSearch] = useState('');
  const { data, loading, error } = useResource(
    () => listAdminSubscriptions({ page, search }),
    [page, search],
  );

  const filter = <T,>(setter: (v: T) => void) => (v: T) => {
    setPage(1);
    setter(v);
  };

  return (
    <Panel title="Legacy billing records" subtitle="Read-only records retained from the retired subscription model. They do not control prepaid wallet access, pricing or renewals.">
      <div className="mb-4 rounded-lg border border-[#E7DFF5] bg-[#F8F4FD] px-3 py-2 text-xs text-[#3D3650]">
        New credit purchases are managed through Credit Pricing and Payments. These records are shown only for historical support and audit work.
      </div>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <SearchBox placeholder="Search customer email, name or company… (Enter)" onSearch={filter(setSearch)} />
      </div>
      {loading ? (
        <Spinner tall={false} />
      ) : error || !data ? (
        <ErrorText>{error || 'Failed to load'}</ErrorText>
      ) : (
        <>
          <Table
            headers={['Customer', 'Former plan', 'Recorded status', 'Original price', 'Credits granted', 'Recorded end', 'Notes']}
            empty={data.data.length === 0 ? 'No legacy billing records match this search.' : undefined}
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
                    <span className="text-[#170B2E]">{s.planName ?? 'No recorded plan'}</span>
                    {s.planType && <div className="text-[11px]">{s.planType}</div>}
                    {legacyLabel && (
                      <Badge variant={s.migrationSource === 'legacy_payg_paying' ? 'warning' : 'default'} className="mt-1">
                        {legacyLabel}
                      </Badge>
                    )}
                  </td>
                  <td className={tdCls}><Badge variant="default">Historical record</Badge></td>
                  <td className={`${tdCls} whitespace-nowrap`}>
                    {s.planType === 'FREE' ? 'No charge' : formatMoney(s.pricePaise, s.currency)}
                  </td>
                  <td className={tdCls}>{formatCredits(s.includedCredits)}</td>
                  <td className={`${tdCls} whitespace-nowrap`}>{formatDate(s.currentPeriodEnd)}</td>
                  <td className={tdCls}>
                    <span className="text-[11px] text-[#3D3650]">Retained for audit only</span>
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
