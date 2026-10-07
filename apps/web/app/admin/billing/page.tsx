'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner } from './_components/ui';
import { OverviewTab } from './_components/OverviewTab';
import { PlansTab } from './_components/PlansTab';
import { TopUpsTab } from './_components/TopUpsTab';
import { FeaturesTab } from './_components/FeaturesTab';
import { CreditRatesTab } from './_components/CreditRatesTab';
import { SettingsTab } from './_components/SettingsTab';
import { SubscriptionsTab } from './_components/SubscriptionsTab';
import { PaymentsTab } from './_components/PaymentsTab';
import { CustomPlansTab } from './_components/CustomPlansTab';
import { BILLING_TABS, type BillingTab } from './_components/tabs';

export default function AdminBillingPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <BillingConsole />
    </Suspense>
  );
}

function BillingConsole() {
  const router = useRouter();
  const params = useSearchParams();
  const requested = params.get('tab');
  const tab: BillingTab = BILLING_TABS.some((t) => t.key === requested) ? (requested as BillingTab) : 'overview';

  const select = (key: BillingTab) => {
    router.replace(key === 'overview' ? '/admin/billing' : `/admin/billing?tab=${key}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#170B2E]">Plans &amp; Pricing</h1>
        <p className="text-sm text-[#3D3650] mt-1">
          Prepaid plans, credit top-ups, credit rates, subscriptions, payments and custom plans. Changes apply without a
          deployment and are audit-logged.
        </p>
      </div>

      <div className="border-b border-[#E7DFF5] -mx-1 overflow-x-auto">
        <div role="tablist" className="flex gap-1 px-1 min-w-max">
          {BILLING_TABS.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => select(t.key)}
                className={`px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-[#7F40E8] text-[#170B2E] font-medium'
                    : 'border-transparent text-[#3D3650] hover:text-[#170B2E]'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'plans' && <PlansTab />}
        {tab === 'topups' && <TopUpsTab />}
        {tab === 'features' && <FeaturesTab />}
        {tab === 'credit-rates' && <CreditRatesTab />}
        {tab === 'subscriptions' && <SubscriptionsTab />}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'custom-plans' && <CustomPlansTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}
