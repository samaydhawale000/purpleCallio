import LegalLayout, { LegalSection, LegalBullets } from "../components/LegalLayout";
import { PricingAuthority } from "../components/PricingAuthority";
import { GstRate } from "../components/GstRate";

export default function BillingTermsPage() {
  return (
    <LegalLayout
      title="Billing & Usage Terms"
      lastUpdated="23 October 2026"
      intro="These Billing & Usage Terms explain prepaid credit purchases, wallet expiry, payments and how service usage is measured."
    >
      <LegalSection num="1" title="Prepaid Credit Purchases">
        <p>
          PurpleCallio uses a prepaid credit wallet. You choose a monetary purchase amount, review the
          price, applicable taxes and credits to be granted, and pay upfront. Credits are added only after
          PurpleCallio verifies payment with its payment provider.
        </p>
        <p>
          The administrator publishes the credit price and purchase limits. Checkout records the applicable
          pricing version, amount, taxes, discounts, credit quantity and expiry policy. A valid quote is not
          silently changed by a later pricing update.
        </p>
        <PricingAuthority className="mt-5" />
      </LegalSection>

      <LegalSection num="2" title="Subscription Plans">
        <p>
          PurpleCallio does not offer new recurring subscription plans or monthly subscription credit
          grants. Free accounts do not receive recurring monthly subscription credits. An authorized
          administrator may grant promotional credits under the applicable campaign or account rules.
        </p>
        <p>
          Existing subscription records and pre-existing customer terms are retained as historical records.
          They are not converted or cancelled by these terms; contact support for help with an existing
          subscription.
        </p>
      </LegalSection>

      <LegalSection num="3" title="Usage Credits">
        <p>
          Usage consumes credits from your credit balance. Credits are a prepaid allowance for using the
          Service; they have no cash value, are not transferable and cannot be exchanged for money.
        </p>
        <p>
          Purchased credits expire one year after purchase unless the checkout quote states a different
          published validity period. Expiry uses the UTC calendar-date anniversary. Each purchase is a
          separate credit lot and does not extend earlier lots. Promotional credits are tracked separately
          and follow the expiry date shown when granted. The wallet shows lot balances and expiry dates;
          eligible credits are consumed earliest-expiring first.
        </p>
        <p>
          When your available credits run out, new calls cannot be started until you add credits by
          purchasing additional credits. Calls already in progress are not
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
          "Video: 2 participants × 30 minutes = 60 video participant-minutes",
        ]} />
        <p>
          Credits are consumed per participant, not per room. Audio, video and screen sharing are
          independently tracked categories, each with its own credit rate (credits per
          participant-minute). Screen-sharing participant-minutes are not automatically added as a
          surcharge to video participant-minutes.
        </p>
      </LegalSection>

      <LegalSection num="4A" title="Live Translate (Early Access)">
        <p>
          Live Translate is an early-access feature. During early access PurpleCallio may change its availability,
          rates and limits, and will show current terms on the pricing page and in your dashboard before they apply
          to new translation sessions.
        </p>
        <LegalBullets items={[
          "Rates: translation is billed in credits per translated participant-minute, meaning each minute that a listener receives translation, at the voice or captions rate set by PurpleCallio and shown on the pricing page and in your dashboard. This is in addition to the call's own audio or video participant-minutes. Calls without translation are not charged for it.",
          "Rate changes: a translation session keeps the rate in effect when it started. New rates apply only to sessions started after the change.",
          "Minimum balance: starting translation requires enough credits for at least one minute of the chosen mode.",
          "Post-Call Suite: if you opt in, each generated report is charged once at the report rate shown in your dashboard.",
          "CostGuard limits: when a per-call limit, project budget or your credit balance is reached, translation steps down from voice to captions or pauses, according to your settings. The call itself continues and is billed as usual.",
          "Trial minutes: where PurpleCallio offers trial minutes for accounts whose plan does not include translation, trial minutes are not charged and end once used.",
        ]} />
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

      <LegalSection num="7" title="Credit Purchases and Auto Top-Up">
        <p>
          Manual credit purchases are one-time payments. Auto Top-Up is not currently available. If
          introduced, it will require explicit customer authorization, a monetary purchase amount and a
          disclosed spending limit before an automatic payment can be initiated.
        </p>
      </LegalSection>

      <LegalSection num="8" title="Payments and Taxes">
        <p>
          Payments are processed by our third-party payment provider (such as Razorpay). Credit purchases
          are charged as shown in the verified checkout quote. A receipt is available for successful
          payments.
        </p>
        <p>
          Prices are shown excluding GST. GST at <GstRate fallback="the rate shown at checkout" /> is added to the price of
          credit purchases. Any customer-specific discount agreed with
          PurpleCallio is applied before GST.
        </p>
        <p>
          If a payment fails or is not completed, no credits are
          added. You can try again from the Billing page.
        </p>
      </LegalSection>

      <LegalSection num="9" title="Refunds">
        <p>
          Credit purchase payments are not refunded automatically. Refunds
          may be issued where required by applicable law, for duplicate or erroneous charges, or at
          PurpleCallio's discretion, as described in the Refund &amp; Cancellation Policy. If a payment is
          refunded, the credits it added may be removed.
        </p>
      </LegalSection>

      <LegalSection num="10" title="Usage Notifications">
        <p>
          PurpleCallio may notify you when your credit balance runs low, when credits are about to expire
          Customers remain responsible for monitoring their
          credit balance.
        </p>
      </LegalSection>

      <LegalSection num="11" title="Legacy Billing Records">
        <p>
          Before PurpleCallio moved to prepaid credits, some accounts were billed for usage after the fact
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
