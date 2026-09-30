import LegalLayout, { LegalSection, LegalBullets } from "../components/LegalLayout";
import { PURPLECALLIO_URL } from "../lib/brand";
import { pageMetadata } from "../lib/seo";

export const metadata = pageMetadata({ title: "Terms of Service", description: "Terms governing use of PurpleCallio's website, APIs, SDKs, hosted communication interfaces, and services.", path: "/terms" });

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms of Service"
      lastUpdated="24 August 2025"
      intro="Welcome to PurpleCallio. These Terms of Service govern your access to and use of PurpleCallio's website, APIs, SDKs, hosted communication interfaces, React components, dashboards, and related services (collectively, the Service)."
    >
      <LegalSection num="1" title="About PurpleCallio">
        <p>
          PurpleCallio provides communication infrastructure that allows developers and businesses to
          integrate audio calls, video calls, and screen sharing into their applications.
        </p>
        <p>Depending on the product configuration, PurpleCallio may provide:</p>
        <LegalBullets items={[
          "Hosted communication interfaces",
          "REST APIs",
          "WebSocket-based communication infrastructure",
          "JavaScript/TypeScript SDKs",
          "React components",
          "Developer dashboards",
          "Project and API key management",
          "Usage tracking and billing",
          "Related developer services",
        ]} />
        <p>Features may change, be added, or be discontinued as PurpleCallio evolves.</p>
      </LegalSection>

      <LegalSection num="2" title="Account Registration">
        <p>You must provide accurate information when creating an account.</p>
        <p>You are responsible for:</p>
        <LegalBullets items={[
          "Maintaining the confidentiality of your account credentials",
          "Protecting your API keys",
          "All activity performed through your account",
          "Immediately notifying PurpleCallio if you believe your account or credentials have been compromised",
        ]} />
        <p>
          You must not share your account credentials or API keys in a way that allows unauthorized
          access.
        </p>
      </LegalSection>

      <LegalSection num="3" title="Projects and API Keys">
        <p>PurpleCallio allows customers to create projects and associated API credentials.</p>
        <p>You are responsible for:</p>
        <LegalBullets items={[
          "Using API keys only for authorized applications",
          "Keeping secret credentials secure",
          "Rotating compromised credentials",
          "Revoking credentials that are no longer required",
        ]} />
        <p>
          You must not expose secret API credentials in publicly accessible client-side code unless
          the specific credential is explicitly designed for public use.
        </p>
      </LegalSection>

      <LegalSection num="4" title="Acceptable Use">
        <p>
          You agree to use PurpleCallio only for lawful purposes and in accordance with the Acceptable
          Use Policy.
        </p>
        <p>You must not use PurpleCallio to:</p>
        <LegalBullets items={[
          "Facilitate illegal activity",
          "Harass or abuse others",
          "Distribute malware",
          "Conduct fraud",
          "Circumvent security controls",
          "Abuse the communication infrastructure",
          "Attempt unauthorized access to other accounts or systems",
          "Overload or intentionally disrupt the Service",
        ]} />
        <p>
          PurpleCallio may suspend or restrict accounts that violate these Terms or pose a security or
          operational risk.
        </p>
      </LegalSection>

      <LegalSection num="5" title="Communication Content">
        <p>
          PurpleCallio provides communication infrastructure but generally does not control the content
          transmitted through customer applications.
        </p>
        <p>
          You are responsible for ensuring that your use of the Service and the content transmitted
          through your application complies with applicable laws.
        </p>
        <p>
          If your application enables communication between users, you are responsible for providing
          appropriate user notices, consent mechanisms, moderation controls, and other safeguards
          required by applicable law.
        </p>
      </LegalSection>

      <LegalSection num="6" title="Usage-Based Billing">
        <p>PurpleCallio may charge customers based on their actual usage.</p>
        <p>Depending on the applicable pricing model, usage may include:</p>
        <LegalBullets items={[
          "Audio participant-minutes",
          "Video participant-minutes",
          "Screen-sharing participant-minutes",
          "Other billable services explicitly listed on the applicable pricing page",
        ]} />
        <p>
          A participant-minute represents one participant using the applicable communication service
          for one minute.
        </p>
        <p>
          For example, a five-minute video call involving two participants results in approximately
          ten video participant-minutes.
        </p>
        <p>
          Actual billing calculations may account for applicable rounding rules and usage events
          defined by PurpleCallio.
        </p>
      </LegalSection>

      <LegalSection num="7" title="Payment">
        <p>Paid services require a valid payment method.</p>
        <p>
          Payments may be processed through third-party payment providers such as Razorpay.
        </p>
        <p>
          By providing a payment method, you authorize PurpleCallio and its payment provider to process
          charges applicable to your account according to your selected plan and actual usage.
        </p>
        <p>
          PurpleCallio does not store complete payment card details on its own servers when those
          details are handled by the payment provider.
        </p>
      </LegalSection>

      <LegalSection num="8" title="Failed Payments">
        <p>If a payment fails, PurpleCallio may:</p>
        <LegalBullets items={[
          "Notify you of the failed payment",
          "Retry the payment where supported",
          "Restrict paid functionality",
          "Suspend usage",
          "Suspend or terminate the account after applicable grace periods",
        ]} />
        <p>Customers remain responsible for charges incurred before suspension or termination.</p>
      </LegalSection>

      <LegalSection num="9" title="Taxes">
        <p>
          Applicable taxes, including GST, VAT, or other taxes, may be added to charges where required
          by law.
        </p>
        <p>Customers are responsible for providing accurate billing and tax information.</p>
      </LegalSection>

      <LegalSection num="10" title="Service Availability">
        <p>
          PurpleCallio aims to provide reliable service but does not guarantee uninterrupted or
          error-free operation unless a separate written service-level agreement applies.
        </p>
        <p>Service availability may be affected by:</p>
        <LegalBullets items={[
          "Internet connectivity",
          "Third-party infrastructure",
          "Cloud providers",
          "Network conditions",
          "Browser/device limitations",
          "Scheduled maintenance",
          "Force majeure events",
        ]} />
      </LegalSection>

      <LegalSection num="11" title="Third-Party Services">
        <p>PurpleCallio may rely on third-party services including:</p>
        <LegalBullets items={[
          "Cloud infrastructure providers",
          "Payment processors",
          "Authentication providers",
          "TURN/STUN infrastructure",
          "Email providers",
          "Analytics and monitoring providers",
        ]} />
        <p>Your use of third-party services may also be subject to their respective terms.</p>
      </LegalSection>

      <LegalSection num="12" title="Intellectual Property">
        <p>
          PurpleCallio and its underlying software, SDKs, APIs, documentation, branding, designs, and
          technology are owned by PurpleCallio or its licensors.
        </p>
        <p>
          Except as expressly permitted, these Terms do not grant you ownership of PurpleCallio's
          intellectual property.
        </p>
        <p>You retain ownership of your own application, data, and content.</p>
      </LegalSection>

      <LegalSection num="13" title="Customer Data">
        <p>
          You retain ownership of data and content that you submit or transmit through PurpleCallio.
        </p>
        <p>
          You grant PurpleCallio the limited rights necessary to provide, maintain, secure, and improve
          the Service.
        </p>
        <p>Additional details are provided in the Privacy Policy.</p>
      </LegalSection>

      <LegalSection num="14" title="Security">
        <p>
          PurpleCallio takes reasonable measures to protect the Service and customer information.
        </p>
        <p>However, no internet-based service can guarantee absolute security.</p>
        <p>
          Customers are responsible for securing their own applications, API keys, user accounts, and
          devices.
        </p>
      </LegalSection>

      <LegalSection num="15" title="Suspension and Termination">
        <p>PurpleCallio may suspend or terminate accounts if:</p>
        <LegalBullets items={[
          "These Terms are violated",
          "Payment obligations remain unpaid",
          "The Service is abused",
          "The account creates a security or operational risk",
          "Required by law",
        ]} />
        <p>
          You may terminate your account at any time through the available account controls or by
          contacting support.
        </p>
        <p>Termination does not eliminate payment obligations incurred before termination.</p>
      </LegalSection>

      <LegalSection num="16" title="Disclaimers">
        <p>
          To the maximum extent permitted by applicable law, PurpleCallio provides the Service on an
          "as available" basis and makes no guarantees that the Service will always be uninterrupted,
          secure, or error-free.
        </p>
      </LegalSection>

      <LegalSection num="17" title="Limitation of Liability">
        <p>
          To the maximum extent permitted by applicable law, PurpleCallio will not be liable for
          indirect, incidental, special, consequential, or punitive damages arising from your use of
          the Service.
        </p>
        <p>
          PurpleCallio's total liability arising from the Service will be limited to the amount paid by
          the customer to PurpleCallio during the twelve months preceding the event giving rise to the
          claim, except where applicable law requires otherwise.
        </p>
      </LegalSection>

      <LegalSection num="18" title="Changes to These Terms">
        <p>PurpleCallio may update these Terms from time to time.</p>
        <p>Material changes will be communicated through the Service or other reasonable means.</p>
        <p>
          Continued use of the Service after the effective date of updated Terms constitutes
          acceptance of the revised Terms.
        </p>
      </LegalSection>

      <LegalSection num="19" title="Governing Law">
        <p>These Terms shall be governed by the laws of India.</p>
      </LegalSection>

      <LegalSection num="20" title="Contact">
        <p>For questions regarding these Terms:</p>
        <LegalBullets items={[
          "PurpleCallio",
          "Email: purplecallio@gmail.com",
          `Website: ${PURPLECALLIO_URL}`,
        ]} />
      </LegalSection>
    </LegalLayout>
  );
}
