import type { Metadata } from "next";
import PricingSection from "../components/PricingSection";
import { pageMetadata } from "../lib/seo";

export const metadata: Metadata = pageMetadata({
   title: "Pricing: Prepaid Credits for Calling & AI APIs",
   description:
      "Prepaid credits for PurpleCallio's video, audio and AI voice APIs. See the published per-credit price, buy credits when you need them, and avoid surprise usage bills.",
   path: "/pricing",
});

export default function PricingPage() {
   return (
      <main className="min-h-screen bg-white pt-20">
         <PricingSection variant="full" />
      </main>
   );
}
