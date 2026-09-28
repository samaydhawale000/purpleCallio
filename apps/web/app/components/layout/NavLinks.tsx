"use client";

import Link from "next/link";

const links = [
  {
    label: "Features",
    href: "/features/video-calling",
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
        </Link>
      ))}
    </>
  );
}
