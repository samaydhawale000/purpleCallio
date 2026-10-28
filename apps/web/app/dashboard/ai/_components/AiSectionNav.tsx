'use client';

import { Tabs } from '../../_ui';

const LINKS = [
  { href: '/dashboard/ai', label: 'Agents', exact: true },
  { href: '/dashboard/ai/calls', label: 'Calls' },
  { href: '/dashboard/ai/analytics', label: 'Analytics' },
];

/** Agents / Calls / Analytics switcher shown at the top of the AI pages. */
export function AiSectionNav() {
  return <Tabs items={LINKS} />;
}
