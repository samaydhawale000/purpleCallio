import type { Metadata } from "next";
import { pageMetadata } from "../lib/seo";
export const metadata: Metadata = pageMetadata({ title: "Billing & Usage Terms", description: "PurpleCallio billing and usage terms, including prepaid plans, usage credits, top-ups, renewals and participant-minute measurement.", path: "/billing-terms" });
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
