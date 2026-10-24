import Link from 'next/link';
import { ArrowRight, Coins } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { BillingHeader } from '../BillingShell';

export default function PlansPage() {
  return (
    <div className="flex flex-col gap-6">
      <BillingHeader title="Prepaid credits" subtitle="Subscription plans and recurring renewals are no longer offered." />
      <section className="rounded-2xl border border-[#E7DFF5] bg-white p-6">
        <div className="flex items-start gap-4">
          <Coins className="mt-1 text-[#6425C4]" />
          <div>
            <h2 className="font-semibold text-[#170B2E]">Buy credits when you need them</h2>
            <p className="mt-1 text-sm text-[#3D3650]">Credits are purchased in advance and consumed by eligible calling and AI features. Your wallet keeps the balance and credit history.</p>
            <Link href="/dashboard/billing/credits#topups" className="mt-4 inline-flex">
              <Button size="sm">Go to wallet <ArrowRight size={14} /></Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
