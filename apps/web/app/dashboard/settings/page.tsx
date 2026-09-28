'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  User,
  Mail,
  Shield,
  Lock,
  LogOut,
  Check,
  Phone,
  Laptop,
} from 'lucide-react';
import { useAuthStore, toAuthUser } from '../../store/auth.store';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import {
  AboutFields,
  CompanyFields,
  FormError,
  SECTION_FIELDS,
  UsageFields,
  useProfileForm,
} from '../../components/auth/profileForm';
import { countryByCode } from '../../lib/onboarding';
import type { AuthUser } from '../../store/auth.store';

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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-6 w-6 text-[#7F40E8]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-[#3D3650]">Loading settings…</span>
        </div>
      </div>
    );
  }

  const avatar = me?.avatarUrl || user?.avatarUrl || '';
  const name = user?.name || me?.name || '';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#170B2E]">Settings</h1>
        <p className="text-sm text-[#3D3650] mt-1">
          Manage your account and preferences.
        </p>
      </div>

      {/* ── Profile ── */}
      <section id="profile" className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center gap-2 mb-1">
          <User size={16} style={{ color: '#7F40E8' }} />
          <p className="text-base font-semibold text-[#170B2E]">Profile</p>
        </div>
        <p className="text-sm text-[#3D3650] mb-6">Your account, company and usage details.</p>

        <div className="flex flex-wrap items-center gap-4 mb-6">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt="Profile"
              className="w-16 h-16 rounded-2xl object-cover shrink-0"
            />
          ) : (
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shrink-0"
              style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
            >
              {(name || 'U')[0].toUpperCase()}
            </div>
          )}
<div>
            <p className="text-sm font-medium text-[#170B2E]">{name || 'Your Account'}</p>
            <p className="text-xs text-[#3D3650]">{me?.email ?? user?.email ?? me?.userId}</p>
          </div>
          <Badge variant="success" className="ml-auto">
            <Mail size={12} /> Google Verified
          </Badge>
        </div>

        {user && <ProfileSettingsForm key={user.userId} user={user} onSaved={setUser} />}
      </section>

      {/* ── Security ── */}
      <section id="security" className="rounded-2xl border border-[#E7DFF5] p-6" style={{ background: '#FFFFFF' }}>
        <div className="flex items-center gap-2 mb-1">
          <Shield size={16} style={{ color: '#34D399' }} />
          <p className="text-base font-semibold text-[#170B2E]">Security</p>
        </div>
        <p className="text-sm text-[#3D3650] mb-6">Authentication &amp; account security.</p>

        <div className="divide-y divide-[#E7DFF5] rounded-xl border border-[#E7DFF5]">
          <SettingRow
            icon={Shield}
            title="Google Account Connected"
            desc="Signed in with Google OAuth"
            right={<Badge variant="success">Connected</Badge>}
          />
          <SettingRow
            icon={Lock}
            title="Two-Factor Authentication"
            desc="Will be available soon"
            right={<Badge variant="default">Future</Badge>}
          />
        </div>

        <p className="text-sm font-semibold text-[#170B2E] mt-6 mb-3">Recent Login Sessions</p>
        <div className="divide-y divide-[#E7DFF5] rounded-xl border border-[#E7DFF5]">
          <SessionRow
            icon={Laptop}
            device="Chrome · macOS"
            location={countryByCode(user?.country)?.name ?? '—'}
            time="Current session"
            active
          />
          <SessionRow
            icon={Phone}
            device="Google App · Android"
            location="New Delhi, India"
            time="2 days ago"
          />
        </div>

        <div className="flex flex-wrap gap-3 mt-6">
          <Button variant="secondary">
            <LogOut size={15} /> Sign Out of All Devices
          </Button>
        </div>
      </section>
    </div>
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
      <fieldset disabled={saving} className="flex flex-col gap-6 min-w-0">
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

        <div className="flex items-center gap-3">
          <Button type="submit" loading={saving}>
            {saving ? 'Saving...' : saved ? <><Check size={15} /> Saved</> : 'Save changes'}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] font-mono uppercase tracking-widest text-[#3D3650] border-b border-[#E7DFF5] pb-2">
        {title}
      </p>
      {children}
    </div>
  );
}

function SettingRow({
  icon: Icon,
  title,
  desc,
  right,
}: {
  icon: any;
  title: string;
  desc: string;
  right: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'rgba(127,64,232,0.1)', border: '1px solid rgba(127,64,232,0.2)' }}
        >
          <Icon size={16} style={{ color: '#7F40E8' }} />
        </div>
        <div>
          <p className="text-sm font-medium text-[#170B2E]">{title}</p>
          <p className="text-xs text-[#3D3650] mt-0.5">{desc}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

function SessionRow({
  icon: Icon,
  device,
  location,
  time,
  active,
}: {
  icon: any;
  device: string;
  location: string;
  time: string;
  active?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: active ? 'rgba(16,185,129,0.1)' : 'rgba(127,64,232,0.1)', border: `1px solid ${active ? 'rgba(16,185,129,0.2)' : 'rgba(127,64,232,0.2)'}` }}
        >
          <Icon size={16} style={{ color: active ? '#34D399' : '#7F40E8' }} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-[#170B2E]">{device}</p>
            {active && <Badge variant="success">Active</Badge>}
          </div>
          <p className="text-xs text-[#3D3650] mt-0.5">{location} · {time}</p>
        </div>
      </div>
    </div>
  );
}
