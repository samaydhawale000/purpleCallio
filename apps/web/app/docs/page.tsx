import DocsHub from "./DocsHub";
import { JsonLd } from "../components/seo/JsonLd";
import { siteUrl } from "../lib/seo";

const DOCS = [
   ["Quickstart", "/docs/quickstart"],
   ["Authentication", "/docs/authentication"],
   ["REST API", "/docs/rest-api"],
   ["JavaScript SDK", "/docs/javascript"],
   ["React", "/docs/react"],
   ["Hosted UI", "/docs/hosted-ui"],
   ["Audio calls", "/docs/audio"],
   ["Video calls", "/docs/video"],
   ["Screen sharing", "/docs/screen-sharing"],
   ["Live Translate", "/docs/live-translate"],
   ["AI voice agents", "/docs/ai-agents"],
   ["Webhooks", "/docs/webhooks"],
   ["Security", "/docs/security"],
   ["Usage and billing", "/docs/usage-billing"],
] as const;

/** Server wrapper: structured data for the docs hub (the hub itself is interactive). */
export default function DocsPage() {
   const url = (path: string) => new URL(path, siteUrl).toString();
   return (
      <>
         <JsonLd
            data={[
               {
                  "@context": "https://schema.org",
                  "@type": "BreadcrumbList",
                  itemListElement: [
                     { "@type": "ListItem", position: 1, name: "Home", item: url("/") },
                     { "@type": "ListItem", position: 2, name: "Documentation", item: url("/docs") },
                  ],
               },
               {
                  "@context": "https://schema.org",
                  "@type": "CollectionPage",
                  name: "PurpleCallio documentation",
                  url: url("/docs"),
                  hasPart: DOCS.map(([name, path]) => ({ "@type": "TechArticle", name, url: url(path) })),
               },
            ]}
         />
         <DocsHub />
      </>
   );
}
