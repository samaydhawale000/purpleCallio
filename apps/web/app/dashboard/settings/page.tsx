'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, toAuthUser } from '../../store/auth.store';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { api } from '../../lib/api';
import {
  AboutFields,
  CompanyFields,
  FormError,
  SECTION_FIELDS,
  UsageFields,
  useProfileForm,
} from '../../components/auth/profileForm';
import type { AuthUser } from '../../store/auth.store';
import { Loading, PageHeader, Panel, Section, buttonCls } from '../_ui';

interface Me {
  userId: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
  phone?: string | null;
}

export default function SettingsPage() {
  const { token, user, logout, setUser } = useAuthStore();
  const router = useRouter();
  const { isReady } = useRequireAuth();

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      const data = res.data as Me;
      setMe(data);
      // Keep the global store in sync so the avatar/name show everywhere.
      setUser(toAuthUser(data));
    } catch (e: any) {
      if (e?.response?.status === 401) {
        logout();
        router.replace('/login');
      } else {
        // Read the store directly so `user` isn't a dependency — setUser()
        // above would otherwise re-trigger this fetch on every response.
        const user = useAuthStore.getState().user;
        setMe(user ? {
          userId: user.userId,
          email: user.email ?? undefined,
          name: user.name ?? undefined,
          avatarUrl: user.avatarUrl ?? undefined,
        } : null);
      }
    } finally {
      setLoading(false);
    }
  }, [logout, router, setUser]);

  useEffect(() => {
    if (!isReady) return;
    if (!token) { router.push('/login'); return; }
    fetchMe();
  }, [isReady, token, fetchMe, router]);

  if (loading) return <Loading label="Loading settings…" />;

  const email = me?.email ?? user?.email ?? me?.userId;

  return (
    <>
      <PageHeader title="Settings" description="Your account and company details." />

      <Section title="Profile" className="max-w-3xl">
        <Panel>
          {user && <ProfileSettingsForm key={user.userId} user={user} onSaved={setUser} />}
        </Panel>
      </Section>

      <Section title="Security" className="max-w-3xl">
        <p id="security" className="text-sm text-[#6B6478]">
          Signed in with Google as <span className="text-[#170B2E]">{email}</span>
        </p>
      </Section>
    </>
  );
}

/**
 * Every profile field collected during onboarding, editable in one place.
 * Uses the same fields, validation and PATCH /auth/profile call as the
 * onboarding steps on /login.
 */
function ProfileSettingsForm({
  user,
  onSaved,
}: {
  user: AuthUser;
  onSaved: (user: AuthUser) => void;
}) {
  const form = useProfileForm(user);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const ok = form.validate([...SECTION_FIELDS.about, ...SECTION_FIELDS.company]);
    if (!ok) return;
    setError('');
    setSaving(true);
    try {
      onSaved(await form.save());
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <fieldset disabled={saving} className="flex min-w-0 flex-col gap-8">
        <SettingsGroup title="Personal information">
          <AboutFields form={form} />
        </SettingsGroup>
        <SettingsGroup title="Company">
          <CompanyFields form={form} />
        </SettingsGroup>
        <SettingsGroup title="Usage">
          <UsageFields form={form} />
        </SettingsGroup>

        <FormError message={error} />

        <div>
          <button type="submit" className={buttonCls('primary')} disabled={saving}>
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save changes'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-[13px] font-medium text-[#6B6478]">{title}</h3>
      {children}
    </div>
  );
}
