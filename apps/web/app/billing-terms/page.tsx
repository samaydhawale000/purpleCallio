import LegalLayout, { LegalSection, LegalBullets } from "../components/LegalLayout";
import { PricingAuthority } from "../components/PricingAuthority";

export default function BillingTermsPage() {
  return (
    <LegalLayout
      title="Billing & Usage Terms"
      lastUpdated="7 October 2026"
      intro="These Billing & Usage Terms explain how PurpleCallio's prepaid plans, usage credits, top-ups and payments work, and how usage is measured."
    >
      <LegalSection num="1" title="Prepaid Plans">
        <p>
          PurpleCallio services are provided through prepaid plans. You choose a plan, review the price
          and included credits, and pay upfront. A paid plan becomes active only after PurpleCallio
          confirms your payment, at which point the plan's included credits are added to your account.
        </p>
        <p>
          The plans, prices, included credits, features, limits and credit rates currently offered are
          published on the pricing page and are loaded from PurpleCallio's billing service. The terms
          shown to you at checkout are the terms of your purchase.
        </p>
        <PricingAuthority className="mt-5" />
      </LegalSection>

      <LegalSection num="2" title="Plan Duration and Renewal">
        <p>
          Each paid plan runs for the plan period shown at checkout (for example, one month). Paid plans
          do not renew automatically, and PurpleCallio does not automatically charge your payment method.
        </p>
        <p>
          To continue on a paid plan after its period ends, you renew it manually from the Billing page
          and pay for the next period. If you do not renew, your account moves to the Free plan when the
          paid period ends. Renewal is priced at the plan's then-current price and included credits,
          which are shown to you before you pay.
        </p>
        <p>
          The Free plan includes a monthly amount of credits as published on the pricing page.
          PurpleCallio may change the Free plan's included credits, features or limits.
        </p>
      </LegalSection>

      <LegalSection num="3" title="Usage Credits">
        <p>
          Usage consumes credits from your credit balance. Credits are a prepaid allowance for using the
          Service; they have no cash value, are not transferable and cannot be exchanged for money.
        </p>
        <p>
          Plan credits expire at the end of the plan period they were issued for. Unused plan credits do
          not carry over unless PurpleCallio states otherwise. Top-up credits expire according to the
          top-up expiry policy shown at the time of purchase. Your Billing page shows when each set of
          credits expires. When several sets of credits are available, PurpleCallio may consume the
          credits that expire soonest first.
        </p>
        <p>
          When your available credits run out, new calls cannot be started until you add credits by
          purchasing a top-up, renewing or upgrading your plan. Calls already in progress are not
          disconnected because your balance runs out; credits consumed by such calls are recorded against
          your account. PurpleCallio may require a minimum available balance to start a call.
        </p>
      </LegalSection>

      <LegalSection num="4" title="Participant-Minutes">
        <p>
          Usage is measured in participant-minutes. One participant using the applicable service for one
          minute equals one participant-minute. For example:
        </p>
        <LegalBullets items={[
          "Audio: 2 participants × 10 minutes = 20 audio participant-minutes",
          "Video: 3 participants × 20 minutes = 60 video participant-minutes",
        ]} />
        <p>
          Credits are consumed per participant, not per room. Audio, video and screen sharing are
          independently tracked categories, each with its own credit rate (credits per
          participant-minute). Screen-sharing participant-minutes are not automatically added as a
          surcharge to video participant-minutes.
        </p>
      </LegalSection>

      <LegalSection num="5" title="Usage Transitions and Participant Changes">
        <p>
          If a session changes communication modes during a call, PurpleCallio calculates usage separately
          for the applicable periods — for example, 10 minutes of audio + 5 minutes of video + 3 minutes of
          screen sharing — and each segment consumes credits at its applicable rate.
        </p>
        <p>
          If participants join or leave a session, usage is calculated according to the number of
          participants using the service during each period, so a single call can produce different
          participant-minute totals over its lifetime.
        </p>
      </LegalSection>

      <LegalSection num="6" title="Usage Records and Rounding">
        <p>
          PurpleCallio's backend usage records are the authoritative source for credit consumption.
          Dashboards may show current or estimated usage while a call is in progress.
        </p>
        <p>
          PurpleCallio tracks usage in per-second increments. For display, usage may be rounded up to the
          nearest minute per usage segment.
        </p>
      </LegalSection>

      <LegalSection num="7" title="Top-ups">
        <p>
          Top-ups are one-time purchases of additional credits. Top-up packages, prices and credit amounts
          are shown on the pricing page and in your dashboard. A top-up does not change your plan.
        </p>
      </LegalSection>

      <LegalSection num="8" title="Upgrades, Downgrades and Cancellation">
        <LegalBullets items={[
          "Upgrade: you pay the full price of the new plan, the new plan starts immediately with its included credits, and any remaining credits from your previous plan stay usable until they expire.",
          "Downgrade: a downgrade is scheduled for the end of your current paid period. You keep your current plan and its credits until then.",
          "Cancellation: cancelling takes effect at the end of your current paid period. Your plan remains active, and its credits remain usable, until that date.",
        ]} />
      </LegalSection>

      <LegalSection num="9" title="Custom Plans">
        <p>
          Custom plans are available by agreement. Their price, included credits, limits, features and
          duration are set out in a private offer that you can review and accept from your dashboard.
          Payment for a custom plan is made upfront in the same way as for other plans unless otherwise
          agreed in writing.
        </p>
      </LegalSection>

      <LegalSection num="10" title="Payments and Taxes">
        <p>
          Payments are processed by our third-party payment provider (such as Razorpay). Each payment is
          a one-time payment that you authorise at checkout. A receipt is available for every successful
          payment.
        </p>
        <p>
          Prices are shown excluding GST. GST at the rate shown at checkout is added to the price of
          plans, renewals, custom plans and top-ups. Any customer-specific discount agreed with
          PurpleCallio is applied before GST.
        </p>
        <p>
          If a payment fails or is not completed, the plan or top-up is not activated and no credits are
          added. You can try again from the Billing page.
        </p>
      </LegalSection>

      <LegalSection num="11" title="Refunds">
        <p>
          Payments for plans, renewals, custom plans and top-ups are not refunded automatically. Refunds
          may be issued where required by applicable law, for duplicate or erroneous charges, or at
          PurpleCallio's discretion, as described in the Refund &amp; Cancellation Policy. If a payment is
          refunded, the credits it added may be removed and a refunded plan may end.
        </p>
      </LegalSection>

      <LegalSection num="12" title="Usage Notifications">
        <p>
          PurpleCallio may notify you when your credit balance runs low, when credits are about to expire
          and when a plan period is about to end. Customers remain responsible for monitoring their
          credit balance.
        </p>
      </LegalSection>

      <LegalSection num="13" title="Legacy Usage Invoices">
        <p>
          Before PurpleCallio moved to prepaid plans, some accounts were billed for usage after the fact
          (pay-as-you-go). Legacy usage invoices issued under that model before the change remain valid
          historical records, and any amounts due under them remain payable. They remain viewable from the
          Billing page.
        </p>
      </LegalSection>

      <LegalSection num="14" title="Billing Disputes">
        <p>
          Customers should report suspected billing errors within 30 days of the applicable payment or
          receipt. PurpleCallio may review:
        </p>
        <LegalBullets items={[
          "Call records",
          "Participant events",
          "Usage segments",
          "Credit transactions",
          "Payment records",
        ]} />
      </LegalSection>
    </LegalLayout>
  );
}
