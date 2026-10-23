import { redirect } from 'next/navigation';

// API keys are managed per project on the Projects page; keep old links working.
export default function ApiKeysPage() {
  redirect('/dashboard/projects');
}
