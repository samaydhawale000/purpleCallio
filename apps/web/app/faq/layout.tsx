import type { Metadata } from "next";
import { pageMetadata } from "../lib/seo";
export const metadata: Metadata = pageMetadata({
   title: "Video Calling API FAQ",
   description:
      "Answers to common questions about PurpleCallio, video calling APIs, WebRTC, hosted UI, React components, screen sharing, prepaid plans, and usage credits.",
   path: "/faq",
});
export default function Layout({ children }: { children: React.ReactNode }) {
   return children;
}
