"use client";

import Link from "next/link";

const links: { label: string; href: string; badge?: string }[] = [
  {
    label: "Features",
    href: "/features",
  },
  {
    label: "Live Translate",
    href: "/features/live-translation",
    badge: "New",
  },
  {
    label: "Developers",
    href: "/developers",
  },
  {
    label: "Pricing",
    href: "/pricing",
  },
  {
    label: "Docs",
    href: "/docs",
  },
  {
    label: "FAQ",
    href: "/faq",
  },
];

export default function NavLinks({
  mobile = false,
  onClick,
}: {
  mobile?: boolean;
  onClick?: () => void;
}) {
  return (
    <>
      {links.map((link) => (
        <Link
          key={link.label}
          href={link.href}
          onClick={onClick}
          className={`
            relative
            transition-all
            duration-300
            hover:text-[#170B2E]

            ${
              mobile
                ? "block py-3 text-lg text-[#3D3650]"
                : "text-sm text-[#3D3650] after:absolute after:left-0 after:-bottom-1 after:h-[2px] after:w-0 after:bg-[#7F40E8] after:transition-all hover:after:w-full"
            }
          `}
        >
          {link.label}
          {link.badge && (
            <span
              className={`ml-1.5 rounded-full bg-[#7F40E8] px-1.5 py-0.5 align-middle font-semibold text-white ${
                mobile ? "text-[10px]" : "text-[9px]"
              }`}
            >
              {link.badge}
            </span>
          )}
        </Link>
      ))}
    </>
  );
}
