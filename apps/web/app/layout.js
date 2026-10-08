import Script from "next/script";
import "./globals.css";
import SiteHeader from "./components/layout/SiteHeader";
import SiteFooter from "./components/layout/SiteFooter";
import { siteUrl, defaultDescription } from "./lib/seo";

export const metadata = {
  metadataBase: siteUrl,
  title: { default: "Video Calling API & WebRTC SDK | PurpleCallio", template: "%s | PurpleCallio" },
  description: defaultDescription,
  applicationName: "PurpleCallio",
  authors: [{ name: "PurpleCallio" }],
  robots: { index: true, follow: true },
  openGraph: { type: "website", siteName: "PurpleCallio", locale: "en_US", images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "PurpleCallio" }] },
  twitter: { card: "summary_large_image", images: ["/opengraph-image"] },
};

// Google Analytics 4 (gtag.js).
const GA_MEASUREMENT_ID = "G-PDQPD5RJ6C";

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className="h-full antialiased scroll-smooth"
    >
      <body className="min-h-screen bg-white text-[#170B2E] overflow-x-hidden">
        <SiteHeader />
        {children}
        <SiteFooter />
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
      </body>
    </html>
  );
}
