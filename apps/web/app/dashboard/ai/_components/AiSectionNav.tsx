'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard/ai', label: 'Agents' },
  { href: '/dashboard/ai/calls', label: 'Calls' },
  { href: '/dashboard/ai/analytics', label: 'Analytics' },
];

/** Agents / Calls / Analytics switcher shown at the top of the AI pages. */
export function AiSectionNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === '/dashboard/ai'
      ? pathname === href
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="flex gap-1 rounded-lg border border-[#E7DFF5] p-1 w-fit" style={{ background: '#FFFFFF' }}>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? 'page' : undefined}
          className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
            active(l.href)
              ? 'bg-[#7F40E8]/10 text-[#6425C4] font-medium'
              : 'text-[#3D3650] hover:text-[#170B2E]'
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
