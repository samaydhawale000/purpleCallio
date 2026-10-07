import type { Metadata } from "next";
import { ContentSection, PublicPage } from "../components/marketing/PublicPage";
import PricingSection from "../components/PricingSection";
import { PlanEstimator } from "../components/marketing/InteractiveTools";
import { pageMetadata } from "../lib/seo";

export const metadata: Metadata = pageMetadata({
   title: "PurpleCallio Pricing | Prepaid Plans for Audio & Video APIs",
   description:
      "Simple prepaid plans for PurpleCallio's audio, video and screen sharing APIs. Pay upfront, get included usage credits, top up when you need more and upgrade as you grow — no surprise usage bills.",
   path: "/pricing",
});

export default function PricingPage() {
   return (
      <main className="min-h-screen bg-white pt-20">
         <PublicPage
            eyebrow="Pricing"
            title="Simple prepaid plans for real-time communication"
            intro="Choose a plan, pay upfront and get usage credits. Calls are measured in participant-minutes and consume credits from your balance — two participants in a ten-minute call use twenty participant-minutes. Predictable monthly pricing, no surprise usage bills."
            crumbs={[
               { label: "Home", href: "/" },
               { label: "Pricing", href: "/pricing" },
            ]}
         >
            <PricingSection variant="full" bare />
            <ContentSection title="Estimate your monthly credits">
               <PlanEstimator />
            </ContentSection>
         </PublicPage>
      </main>
   );
}
