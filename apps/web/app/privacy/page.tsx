import LegalLayout, { LegalSection, LegalBullets } from "../components/LegalLayout";
import { PURPLECALLIO_URL } from "../lib/brand";
import { pageMetadata } from "../lib/seo";

export const metadata = pageMetadata({ title: "Privacy Policy", description: "How PurpleCallio collects, uses, stores, and protects personal information for its website and services.", path: "/privacy" });

export default function PrivacyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      lastUpdated="24 August 2025"
      intro="This Privacy Policy explains how PurpleCallio collects, uses, stores, and protects personal information when you use our website and services."
    >
      <LegalSection num="1" title="Information We Collect">
        <p>Depending on how you use PurpleCallio, we may collect:</p>
        <p className="font-semibold text-[#3D3650]">Account Information</p>
        <LegalBullets items={[
          "Name",
          "Email address",
          "Profile information provided through authentication providers",
          "Company information",
          "Account identifiers",
        ]} />
        <p className="font-semibold text-[#3D3650]">Developer Information</p>
        <LegalBullets items={[
          "Project names",
          "API keys and related metadata",
          "API usage",
          "Webhook configuration",
          "Application configuration",
        ]} />
        <p className="font-semibold text-[#3D3650]">Billing Information</p>
        <LegalBullets items={[
          "Billing address",
          "Billing contact",
          "Transaction information",
          "Subscription information",
          "Payment status",
        ]} />
        <p>
          Payment card details may be processed directly by our payment provider and may not be
          stored directly by PurpleCallio.
        </p>
        <p className="font-semibold text-[#3D3650]">Usage Information</p>
        <LegalBullets items={[
          "Calls started",
          "Calls ended",
          "Call duration",
          "Participant counts",
          "Audio/video usage",
          "Screen-sharing usage",
          "API requests",
          "WebSocket connections",
          "Error information",
          "Usage and billing metrics",
        ]} />
        <p className="font-semibold text-[#3D3650]">Technical Information</p>
        <LegalBullets items={[
          "IP address",
          "Browser type",
          "Device information",
          "Operating system",
          "Log information",
          "Approximate location derived from IP address",
          "Security events",
        ]} />
      </LegalSection>

      <LegalSection num="2" title="Communication Data">
        <p>
          PurpleCallio provides communication infrastructure. Depending on the implementation,
          communication data may pass through or be processed by infrastructure necessary to
          establish and maintain calls.
        </p>
        <p>
          PurpleCallio does not intentionally use customer communication content for advertising.
        </p>
        <p>
          PurpleCallio provides real-time communication infrastructure and does not store recorded
          call audio or video content on our servers.
        </p>
      </LegalSection>

      <LegalSection num="3" title="How We Use Information">
        <p>We use information to:</p>
        <LegalBullets items={[
          "Provide the Service",
          "Authenticate users",
          "Establish communication sessions",
          "Manage projects and API keys",
          "Calculate usage",
          "Generate invoices",
          "Process payments",
          "Detect fraud and abuse",
          "Maintain security",
          "Troubleshoot technical issues",
          "Monitor reliability",
          "Communicate with customers",
          "Improve the Service",
          "Comply with legal obligations",
        ]} />
      </LegalSection>

      <LegalSection num="4" title="Payment Providers">
        <p>Payments may be processed by third-party providers such as Razorpay.</p>
        <p>
          When you submit payment information, that information may be transmitted directly to the
          payment provider.
        </p>
        <p>Payment providers may process information according to their own privacy policies.</p>
      </LegalSection>

      <LegalSection num="5" title="Google Authentication">
        <p>
          If you use Google authentication, PurpleCallio may receive information provided by Google,
          such as your name, email address, and profile information permitted by the authentication
          flow.
        </p>
        <p>We use this information to create and manage your PurpleCallio account.</p>
      </LegalSection>

      <LegalSection num="6" title="Cookies">
        <p>PurpleCallio may use cookies and similar technologies for:</p>
        <LegalBullets items={[
          "Authentication",
          "Session management",
          "Security",
          "Preferences",
          "Analytics",
        ]} />
        <p>
          You may configure your browser to reject certain cookies, although some functionality may
          stop working.
        </p>
      </LegalSection>

      <LegalSection num="7" title="Data Sharing">
        <p>PurpleCallio may share information with service providers necessary to operate the Service.</p>
        <p>Examples include:</p>
        <LegalBullets items={[
          "Cloud infrastructure providers",
          "Payment processors",
          "Authentication providers",
          "Email providers",
          "Monitoring providers",
          "Security providers",
        ]} />
        <p>We do not sell customer personal information as a business model.</p>
      </LegalSection>

      <LegalSection num="8" title="Data Retention">
        <p>We retain information for as long as reasonably necessary to:</p>
        <LegalBullets items={[
          "Provide the Service",
          "Maintain business records",
          "Resolve disputes",
          "Prevent fraud",
          "Comply with legal requirements",
        ]} />
        <p>Retention periods may vary depending on the type of information.</p>
      </LegalSection>

      <LegalSection num="9" title="Data Security">
        <p>
          We use reasonable technical and organizational safeguards designed to protect personal
          information.
        </p>
        <p>However, no method of transmission or storage is completely secure.</p>
      </LegalSection>

      <LegalSection num="10" title="International Data Transfers">
        <p>
          Because PurpleCallio may use infrastructure and service providers located in different
          countries, information may be processed outside the country where you live.
        </p>
        <p>Where required, PurpleCallio will take appropriate measures for international transfers.</p>
      </LegalSection>

      <LegalSection num="11" title="Your Rights">
        <p>Depending on applicable law, you may have rights regarding your personal information, including rights to:</p>
        <LegalBullets items={[
          "Access information",
          "Correct information",
          "Delete information",
          "Request restriction of processing",
          "Object to certain processing",
          "Request data portability",
        ]} />
        <p>Requests can be submitted to: purplecallio@gmail.com</p>
      </LegalSection>

      <LegalSection num="12" title="Children's Privacy">
        <p>
          PurpleCallio is intended for businesses and developers and is not directed toward children.
        </p>
        <p>
          We do not knowingly collect personal information from children in violation of applicable
          law.
        </p>
      </LegalSection>

      <LegalSection num="13" title="Changes">
        <p>We may update this Privacy Policy periodically.</p>
        <p>The updated version will include a revised "Last Updated" date.</p>
      </LegalSection>

      <LegalSection num="14" title="Contact">
        <LegalBullets items={[
          "PurpleCallio",
          "Privacy Email: purplecallio@gmail.com",
          `Website: ${PURPLECALLIO_URL}`,
        ]} />
      </LegalSection>
    </LegalLayout>
  );
}
