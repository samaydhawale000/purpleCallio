import type { Metadata } from "next";
import PricingSection from "../components/PricingSection";
import { FaqList } from "../components/marketing/FaqItem";
import { JsonLd } from "../components/seo/JsonLd";
import { formatMoney, type CreditRates, type PublishedCreditPricing } from "../lib/billing";
import { formatRate, validityPhrase } from "../lib/pricing-format";
import { getServerPricing } from "../lib/public-pricing-server";
import { pageMetadata, siteUrl } from "../lib/seo";

export const metadata: Metadata = pageMetadata({
   title: "Pricing: Prepaid Credits for Calling & AI APIs",
   description:
      "Prepaid credits for PurpleCallio's video, audio, Live Translate and AI voice APIs. See the per-credit price and per-minute rates. No subscriptions.",
   path: "/pricing",
});

/**
 * Pricing Q&A built from the live rates when the server could read them, so
 * the page's HTML (and FAQPage data) answers "how much does it cost" with
 * real numbers. Falls back to rate-free wording otherwise.
 */
function pricingFaq(rates?: CreditRates, credit?: PublishedCreditPricing | null): [string, string][] {
   const price = credit ? `${formatMoney(credit.creditPricePaise, credit.currency)} per credit` : null;
   const perMin = (credits: number) =>
      credit ? ` (about ${formatMoney(Math.round(credits * credit.creditPricePaise), credit.currency)})` : "";
   const credits = (n: number) => `${formatRate(n)} ${n === 1 ? "credit" : "credits"}`;
   const rateList = rates
      ? [
           `audio ${credits(rates.audioCreditsPerMinute)}${perMin(rates.audioCreditsPerMinute)}`,
           `video ${credits(rates.videoCreditsPerMinute)}${perMin(rates.videoCreditsPerMinute)}`,
           `screen sharing ${credits(rates.screenShareCreditsPerMinute)}${perMin(rates.screenShareCreditsPerMinute)}`,
           ...(rates.aiCreditsPerMinute != null
              ? [`AI voice agents ${credits(rates.aiCreditsPerMinute)}${perMin(rates.aiCreditsPerMinute)} per call-minute`]
              : []),
        ].join(", ")
      : null;
   return [
      [
         "How does PurpleCallio pricing work?",
         `PurpleCallio uses prepaid credits instead of subscriptions. You add credits to your wallet${price ? ` at ${price}` : ""}, and each feature uses credits per minute at its own rate. There are no monthly plans or surprise usage bills.`,
      ],
      [
         "How much does a minute of calling cost?",
         rateList
            ? `Credits are charged per participant-minute: ${rateList}. Each media type is rounded up to whole credits per call.`
            : "Audio, video and screen sharing are charged per participant-minute at separate credit rates, shown on this page. AI voice agents are charged per call-minute.",
      ],
      [
         "How is Live Translate priced?",
         "Live Translate is charged per minute for each person who has translation turned on: one side costs 1× the rate and both sides 2×. Voice translation and captions have separate rates, the same for every language pair, and translation is billed on top of the call's own minutes.",
      ],
      [
         "Are there free credits?",
         "New accounts may receive welcome credits, and we sometimes grant promotional credits. Free credits cover audio, video and screen share only. AI features (Live Translate, AI voice agents and post-call reports) always use purchased credits.",
      ],
      [
         "Do credits expire?",
         `Each purchase is a separate credit lot with its own expiry: purchased credits expire ${validityPhrase(credit?.purchasedValidityDays)}. Welcome and promotional credits show their own expiry date in your wallet.`,
      ],
      [
         "Is GST included?",
         rates
            ? `Prices are shown before tax. GST at ${formatRate(rates.taxPercent)}% is added at checkout, and you see the credits, tax and total before you pay.`
            : "Prices are shown before tax. GST is added at checkout, and you see the credits, tax and total before you pay.",
      ],
   ];
}

export default async function PricingPage() {
   const { rates, credit } = await getServerPricing();
   const faq = pricingFaq(rates?.creditRates, credit);
   const url = new URL("/pricing", siteUrl).toString();

   return (
      <main className="min-h-screen bg-white pt-20">
         <JsonLd
            data={[
               {
                  "@context": "https://schema.org",
                  "@type": "BreadcrumbList",
                  itemListElement: [
                     { "@type": "ListItem", position: 1, name: "Home", item: new URL("/", siteUrl).toString() },
                     { "@type": "ListItem", position: 2, name: "Pricing", item: url },
                  ],
               },
               {
                  "@context": "https://schema.org",
                  "@type": "FAQPage",
                  mainEntity: faq.map(([name, text]) => ({
                     "@type": "Question",
                     name,
                     acceptedAnswer: { "@type": "Answer", text },
                  })),
               },
               ...(credit
                  ? [
                       {
                          "@context": "https://schema.org",
                          "@type": "Offer",
                          name: "PurpleCallio prepaid credit",
                          url,
                          price: (credit.creditPricePaise / 100).toFixed(2),
                          priceCurrency: credit.currency,
                          description: "One prepaid credit, used across PurpleCallio calling and AI features at per-minute rates.",
                          seller: { "@type": "Organization", name: "PurpleCallio", url: siteUrl.toString() },
                       },
                    ]
                  : []),
            ]}
         />
         <PricingSection variant="full" initialRates={rates} initialCredit={credit} />
         <section aria-labelledby="pricing-faq" className="px-6 pb-24">
            <div className="mx-auto max-w-3xl">
               <h2 id="pricing-faq" className="mb-6 text-2xl font-bold text-[#170B2E]">
                  Pricing questions
               </h2>
               <FaqList items={faq} />
            </div>
         </section>
      </main>
   );
}
