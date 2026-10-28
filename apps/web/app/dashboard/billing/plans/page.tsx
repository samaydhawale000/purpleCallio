import Link from 'next/link';
import { buttonCls } from '../../_ui/styles';
import { BillingHeader, SectionCard } from '../BillingShell';

export default function PlansPage() {
  return (
    <div className="flex flex-col gap-6">
      <BillingHeader title="Prepaid credits" subtitle="Subscription plans and recurring renewals are no longer offered." />
      <SectionCard title="Buy credits when you need them">
        <p className="max-w-2xl text-sm text-[#6B6478]">
          Credits are purchased in advance and consumed by eligible calling and AI features. Your wallet keeps the balance
          and credit history.
        </p>
        <Link href="/dashboard/billing?add=1" className={buttonCls('primary', 'mt-4')}>
          Go to wallet
        </Link>
      </SectionCard>
    </div>
  );
}
