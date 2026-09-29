"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Mail, ArrowUpRight } from "lucide-react";

import logo from "../../assets/images/logo.webp";

const footerLinks = {
   Product: [
      { name: "Video Calling", href: "/features/video-calling" },
      { name: "Audio Calling", href: "/features/audio-calling" },
      { name: "Screen Sharing", href: "/features/screen-sharing" },
      { name: "WebRTC", href: "/features/webrtc" },
      { name: "Pricing", href: "/pricing" },
      { name: "Documentation", href: "/docs" },
   ],

   Developers: [
      { name: "Developers", href: "/developers" },
      { name: "SDKs", href: "/sdks" },
      { name: "Quickstart", href: "/docs/quickstart" },
      { name: "React SDK", href: "/docs/react" },
      { name: "Angular SDK", href: "/docs/angular" },
      { name: "React Native SDK", href: "/docs/react-native" },
      { name: "Vue SDK", href: "/docs/vue" },
      { name: "Svelte SDK", href: "/docs/svelte" },
      { name: "JavaScript SDK", href: "/docs/javascript" },
      { name: "REST API", href: "/docs/rest-api" },
      { name: "Webhooks", href: "/docs/webhooks" },
   ],

   Resources: [
      { name: "FAQ", href: "/faq" },
      { name: "Support", href: "mailto:purplecallio@gmail.com" },
      { name: "Docs", href: "/docs" },
   ],

   Legal: [
      { name: "Terms of Service", href: "/terms" },
      { name: "Privacy Policy", href: "/privacy" },
      { name: "Refund & Cancellation", href: "/refund" },
      { name: "Acceptable Use", href: "/acceptable-use" },
      { name: "Billing & Usage", href: "/billing-terms" },
   ],
};

export default function Footer() {
   const pathname = usePathname();
   // Dashboard has its own app layout — hide the marketing footer there.
   if (pathname?.startsWith("/dashboard")) {
      return null;
   }
   // Login/signup are auth pages — hide the marketing footer there too.
   if (pathname?.startsWith("/login") || pathname?.startsWith("/signup")) {
      return null;
   }

   return (
      <footer className="relative overflow-hidden border-t border-[#E7DFF5] bg-[#F8F4FD]">
         {/* Glow */}

         <div className="absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-[#7F40E8]/8 blur-[120px]" />

         <div className="relative mx-auto max-w-7xl px-6 py-20">
            <div className="grid gap-16 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr]">
               {/* Left */}

               <div>
                  <Link href="/" className="flex items-center">
                     <Image
                        src={logo}
                        alt="PurpleCallio"
                        width={198}
                        height={48}
                        className="h-auto w-[198px]"
                     />
                  </Link>

                  <p className="mt-6 max-w-sm leading-8 text-[#3D3650]">
                     Communication infrastructure for modern software. Build
                     secure video meetings with APIs, WebSocket signaling and
                     hosted UI.
                  </p>

                  <div className="mt-8 flex gap-3">
                     <Social href="mailto:purplecallio@gmail.com">
                        <Mail size={18} />
                     </Social>
                  </div>
               </div>

               {Object.entries(footerLinks).map(([title, items]) => (
                  <div key={title}>
                     <h3 className="mb-5 font-semibold text-[#170B2E]">{title}</h3>

                     <div className="space-y-4">
                        {items.map((item) => (
                           <Link
                              key={item.name}
                              href={item.href}
                              className="group flex items-center gap-1 text-sm text-[#3D3650] transition hover:text-[#170B2E]"
                           >
                              {item.name}

                              <ArrowUpRight
                                 size={14}
                                 className="opacity-0 transition group-hover:opacity-100"
                              />
                           </Link>
                        ))}
                     </div>
                  </div>
               ))}
            </div>

            <div className="my-12 h-px bg-gradient-to-r from-transparent via-[#E7DFF5] to-transparent" />

            <div className="flex flex-col items-center justify-between gap-4 text-sm text-[#3D3650] md:flex-row">
               <span>
                  © {new Date().getFullYear()} PurpleCallio. All rights reserved.
               </span>

               <div className="flex items-center gap-6">
                  <Link href="/privacy" className="transition hover:text-[#170B2E]">
                     Privacy
                  </Link>

                  <Link href="/terms" className="transition hover:text-[#170B2E]">
                     Terms
                  </Link>

                  <Link href="/refund" className="transition hover:text-[#170B2E]">
                     Refund Policy
                  </Link>

                  <Link
                     href="/billing-terms"
                     className="transition hover:text-[#170B2E]"
                  >
                     Billing &amp; Usage
                  </Link>
               </div>
            </div>
         </div>
      </footer>
   );
}

function Social({ href, children }) {
   return (
      <Link
         href={href}
         className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E7DFF5] bg-white text-[#3D3650] transition-all duration-300 hover:-translate-y-1 hover:border-[#7F40E8] hover:text-[#170B2E]"
      >
         {children}
      </Link>
   );
}
