'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '../../dashboard/_ui';
import { Spinner } from './_components/ui';
import { OverviewTab } from './_components/OverviewTab';
import { PlansTab } from './_components/PlansTab';
import { TopUpsTab } from './_components/TopUpsTab';
import { FeaturesTab } from './_components/FeaturesTab';
import { CreditRatesTab } from './_components/CreditRatesTab';
import { TranslationTab } from './_components/TranslationTab';
import { SettingsTab } from './_components/SettingsTab';
import { SubscriptionsTab } from './_components/SubscriptionsTab';
import { PaymentsTab } from './_components/PaymentsTab';
import { CustomPlansTab } from './_components/CustomPlansTab';
import { CreditPricingTab } from './_components/CreditPricingTab';
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
    <div>
      <PageHeader
        title="Prepaid Billing"
        description="Published credit prices, credit usage rates, payments and billing settings. Historical billing records are retained read-only for audit purposes. Pricing changes are audit-logged."
      />

      <div role="tablist" className="mb-8 flex gap-6 overflow-x-auto border-b border-[#ECE8F2]">
        {BILLING_TABS.map((t) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => select(t.key)}
              className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors ${
                active ? 'border-[#7F40E8] font-medium text-[#170B2E]' : 'border-transparent text-[#6B6478] hover:text-[#170B2E]'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'plans' && <PlansTab />}
        {tab === 'topups' && <TopUpsTab />}
        {tab === 'features' && <FeaturesTab />}
        {tab === 'credit-rates' && <CreditRatesTab />}
        {tab === 'credit-pricing' && <CreditPricingTab />}
        {tab === 'translation' && <TranslationTab />}
        {tab === 'subscriptions' && <SubscriptionsTab />}
        {tab === 'payments' && <PaymentsTab />}
        {tab === 'custom-plans' && <CustomPlansTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>
    </div>
  );
}
