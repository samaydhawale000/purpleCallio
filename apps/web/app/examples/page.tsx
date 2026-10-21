import type { Metadata } from "next";
import Link from "next/link";
import { ContentSection, PublicPage } from "../components/marketing/PublicPage";
import { Reveal, RevealGroup, RevealItem } from "../components/motion/Reveal";
import { pageMetadata } from "../lib/seo";

export const metadata: Metadata = pageMetadata({
   title: "Integration Examples for Video & Audio Calls",
   description:
      "Official PurpleCallio examples for JavaScript, React, audio, video, screen sharing, and hosted UI integrations.",
   path: "/examples",
});

const examples = [
   ["JavaScript video", "/examples/javascript-video"],
   ["JavaScript audio", "/examples/javascript-audio"],
   ["React video", "/examples/react-video"],
   ["React audio", "/examples/react-audio"],
   ["Screen sharing", "/examples/screen-sharing"],
   ["Hosted UI", "/examples/hosted-ui"],
] as const;

export default function ExamplesPage() {
   return <PublicPage eyebrow="Examples" title="PurpleCallio integration examples" intro="Use these official, minimal examples as a starting point for a PurpleCallio integration." crumbs={[{ label: "Home", href: "/" }, { label: "Examples", href: "/examples" }]}><Reveal><ContentSection title="Choose an example"><RevealGroup stagger={0.08} className="grid gap-4 sm:grid-cols-2">{examples.map(([label, href]) => <RevealItem key={href} variant="zoom-up" className="h-full"><Link href={href} className="block h-full rounded-xl border border-[#E7DFF5] bg-white p-5 font-medium text-[#6425C4] hover:text-[#170B2E]">{label} →</Link></RevealItem>)}</RevealGroup></ContentSection></Reveal></PublicPage>;
}
