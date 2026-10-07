import LegalLayout, { LegalSection, LegalBullets } from "../components/LegalLayout";
import { pageMetadata } from "../lib/seo";

export const metadata = pageMetadata({ title: "Refund & Cancellation Policy", description: "PurpleCallio's policy for cancelling prepaid plans, refunds for plan and top-up payments, credits, and billing disputes.", path: "/refund" });

export default function RefundPage() {
  return (
    <LegalLayout
      title="Refund & Cancellation Policy"
      lastUpdated="7 October 2026"
      intro="This policy explains how cancellations and refunds work for PurpleCallio's prepaid plans, custom plans and credit top-ups."
    >
      <LegalSection num="1" title="Cancellation">
        <p>
          You can cancel a paid plan at any time from the Billing page or by contacting support.
          Cancellation takes effect at the end of your current paid period: your plan remains active, and
          its credits remain usable, until that date. Because paid plans do not renew automatically, no
          further payment is taken after cancellation.
        </p>
        <p>
          You may also close your PurpleCallio account. Cancellation or account closure does not by itself
          entitle you to a refund of payments already made.
        </p>
      </LegalSection>

      <LegalSection num="2" title="Prepaid Plans and Top-ups">
        <p>
          Plans, renewals, custom plans and top-ups are paid upfront. Payments are not refunded
          automatically, including for unused or expired credits, unless a refund is required by
          applicable law or PurpleCallio decides, at its discretion, to issue one.
        </p>
        <p>
          Because credits are consumed in real time as calls happen, credits that have already been used
          are generally non-refundable.
        </p>
      </LegalSection>

      <LegalSection num="3" title="Incorrect Charges">
        <p>If you believe your account was incorrectly charged, contact:</p>
        <LegalBullets items={["purplecallio@gmail.com"]} />
        <p>within 30 days of the charge.</p>
        <p>Please provide:</p>
        <LegalBullets items={[
          "Account email",
          "Receipt number (or legacy invoice number)",
          "Transaction ID",
          "Description of the issue",
        ]} />
        <p>We will review the usage records, credit transactions and payment information.</p>
      </LegalSection>

      <LegalSection num="4" title="Duplicate Payments">
        <p>
          If a duplicate payment occurs because of a technical or processing error, PurpleCallio will
          investigate and, where appropriate, issue a refund or adjustment.
        </p>
      </LegalSection>

      <LegalSection num="5" title="Failed or Incomplete Payments">
        <p>
          If a payment fails or is not completed, the plan, renewal or top-up is not activated and no
          credits are added. If money was debited for a payment that PurpleCallio did not confirm, it is
          handled under the Duplicate Payments section above or returned by the payment provider
          according to its policies.
        </p>
      </LegalSection>

      <LegalSection num="6" title="Effect of a Refund">
        <p>
          When a payment is refunded, the credits it added may be removed from your balance, and a
          refunded plan may end, returning your account to the Free plan.
        </p>
      </LegalSection>

      <LegalSection num="7" title="Promotional Credits">
        <p>Promotional or complimentary credits:</p>
        <LegalBullets items={[
          "Have no cash value",
          "Cannot be transferred",
          "Cannot normally be refunded",
          "May expire according to the applicable promotion",
        ]} />
      </LegalSection>

      <LegalSection num="8" title="Legacy Usage Invoices">
        <p>
          Legacy usage invoices issued under PurpleCallio's former pay-as-you-go billing, before the move to
          prepaid plans, remain valid, and amounts due under them remain payable.
        </p>
      </LegalSection>

      <LegalSection num="9" title="Account Termination">
        <p>
          If an account is terminated because of a violation of our Terms or Acceptable Use Policy,
          payments already made are generally non-refundable and amounts already owed remain payable.
        </p>
      </LegalSection>

      <LegalSection num="10" title="Refund Processing">
        <p>Approved refunds will be processed through the applicable payment provider.</p>
        <p>
          The time required for the funds to appear in your account may depend on the payment
          provider and customer's financial institution.
        </p>
      </LegalSection>

      <LegalSection num="11" title="Policy Changes">
        <p>PurpleCallio may update this policy from time to time.</p>
      </LegalSection>
    </LegalLayout>
  );
}
