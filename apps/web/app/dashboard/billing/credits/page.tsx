import { redirect } from 'next/navigation';

// Transactions was folded into Overview (credit lots) and Payments & receipts;
// keep old links and bookmarks working.
export default function CreditsPage() {
  redirect('/dashboard/billing');
}
