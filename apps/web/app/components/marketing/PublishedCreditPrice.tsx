"use client";

import Link from "next/link";
import { ArrowRight, Coins } from "lucide-react";
import { Button } from "../ui/Button";
import { formatMoney } from "../../lib/billing";
import { PRICE_NOT_PUBLISHED, usePublishedCreditPricing, validityPhrase } from "../../lib/public-pricing";
import { useAuthStore } from "../../store/auth.store";

/** The admin-published price per credit (GET /billing/credit-pricing/current). Never hard-coded. */
export function PublishedCreditPrice() {
  const state = usePublishedCreditPricing();
  const pricing = state.status === "ready" ? state.data : null;
  const token = useAuthStore((s) => s.token);

  return (
    <section
      data-testid="published-credit-price"
      className="rounded-3xl border border-[#E7DFF5] bg-[#F8F4FD] p-6 sm:p-8"
    >
      <div className="flex items-start gap-4">
        <Coins className="mt-1 text-[#6425C4]" aria-hidden="true" />
        <div className="flex-1">
          <h2 className="text-xl font-bold text-[#170B2E]">Prepaid credits</h2>
          {pricing ? (
            <>
              <p className="mt-2 text-sm text-[#3D3650]">
                <strong className="text-[#170B2E]">
                  {formatMoney(pricing.creditPricePaise, pricing.currency)} per credit
                </strong>
                . Purchases start at {formatMoney(pricing.minimumPurchasePaise, pricing.currency)}; GST is added at
                checkout and shown before you pay. Credits from each purchase expire{" "}
                {validityPhrase(pricing.purchasedValidityDays)}.
              </p>
              <p className="mt-2 text-xs text-[#3D3650]">
                Credits are rounded down to whole units at the published price. Feature consumption rates are set
                separately and don&apos;t change with the purchase price.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-[#3D3650]">
              {state.status === "loading"
                ? "Loading published credit pricing…"
                : state.status === "error"
                  ? "Credit pricing is temporarily unavailable. Please try again in a moment."
                  : PRICE_NOT_PUBLISHED}
            </p>
          )}
          <Link href={token ? "/dashboard/billing/credits#topups" : "/signup"} className="mt-5 inline-flex">
            <Button size="sm">
              {token ? "Buy credits" : "Create account"} <ArrowRight size={14} />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}
