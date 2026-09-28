'use client';

import { useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { api } from '../../lib/api';
import { toAuthUser, type AuthUser } from '../../store/auth.store';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  USAGE_RANGES,
  USE_CASES,
  buildE164,
  countryByCode,
  flagEmoji,
  splitE164,
} from '../../lib/onboarding';

/**
 * Shared profile fields, validation and save logic — used by the onboarding
 * steps on /login and by the profile section of /dashboard/settings, so both
 * edit exactly the same data through PATCH /auth/profile.
 */

export type ProfileField = 'name' | 'phone' | 'country' | 'companyName' | 'jobTitle' | 'companyWebsite';
type FieldErrors = Partial<Record<ProfileField, string>>;

const WEBSITE_RE = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d+)?(\/\S*)?$/i;

export function useProfileForm(user: AuthUser) {
  const existingPhone = splitE164(user.phone, user.country);

  const [name, setName] = useState(user.name ?? '');
  const [country, setCountry] = useState(countryByCode(user.country)?.code ?? '');
  const [phoneCountry, setPhoneCountry] = useState(
    existingPhone?.country ?? countryByCode(user.country)?.code ?? DEFAULT_COUNTRY,
  );
  const [national, setNational] = useState(existingPhone?.national ?? '');
  const [phoneTouched, setPhoneTouched] = useState(!!existingPhone);
  const [companyName, setCompanyName] = useState(user.companyName ?? '');
  const [jobTitle, setJobTitle] = useState(user.jobTitle ?? '');
  const [companyWebsite, setCompanyWebsite] = useState(user.companyWebsite ?? '');
  const [expectedUsageRange, setExpectedUsageRange] = useState(user.expectedUsageRange ?? '');
  const [primaryUseCase, setPrimaryUseCase] = useState(user.primaryUseCase ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});

  const dial = countryByCode(phoneCountry)?.dial ?? '91';

  const clearError = (field: ProfileField) =>
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

  const changeCountry = (code: string) => {
    setCountry(code);
    clearError('country');
    // Follow the selected country for the calling code until the user has
    // chosen or typed a phone number themselves.
    if (!phoneTouched && code) setPhoneCountry(code);
  };

  const errorFor = (field: ProfileField): string | undefined => {
    switch (field) {
      case 'name':
        if (!name.trim()) return 'Full name is required.';
        if (name.trim().length > 100) return 'Keep your name under 100 characters.';
        return;
      case 'phone':
        return buildE164(dial, national).error;
      case 'country':
        return countryByCode(country) ? undefined : 'Select your country.';
      case 'companyName':
        if (!companyName.trim()) return 'Company / organization is required.';
        if (companyName.trim().length > 150) return 'Keep this under 150 characters.';
        return;
      case 'jobTitle':
        if (!jobTitle.trim()) return 'Job title / role is required.';
        if (jobTitle.trim().length > 100) return 'Keep this under 100 characters.';
        return;
      case 'companyWebsite': {
        const site = companyWebsite.trim();
        return site && (!WEBSITE_RE.test(site) || site.length > 255)
          ? 'Enter a valid website URL, e.g. https://example.com.'
          : undefined;
      }
    }
  };

  /** Validates the given fields, shows their errors, and returns true if all pass. */
  const validate = (fields: ProfileField[]) => {
    const next: FieldErrors = {};
    for (const f of fields) {
      const err = errorFor(f);
      if (err) next[f] = err;
    }
    setErrors((prev) => {
      const merged = { ...prev };
      for (const f of fields) merged[f] = next[f];
      return merged;
    });
    return Object.keys(next).length === 0;
  };

  /** Saves the whole profile. Throws a user-facing message on failure. */
  const save = async (): Promise<AuthUser> => {
    try {
      const res = await api.patch('/auth/profile', {
        name: name.trim(),
        phone: buildE164(dial, national).phone,
        companyName: companyName.trim(),
        jobTitle: jobTitle.trim(),
        country,
        companyWebsite: companyWebsite.trim() || null,
        expectedUsageRange: expectedUsageRange || null,
        primaryUseCase: primaryUseCase || null,
      });
      return toAuthUser(res.data.user);
    } catch (err: any) {
      const message = err?.response?.data?.message;
      const detail = Array.isArray(message) ? message[0] : message;
      throw new Error(
        err?.response?.status === 400 && detail
          ? detail
          : "We couldn't save your profile. Please try again.",
      );
    }
  };

  return {
    user,
    values: { name, country, phoneCountry, national, companyName, jobTitle, companyWebsite, expectedUsageRange, primaryUseCase },
    dial,
    hasPhoneOnFile: !!existingPhone,
    errors,
    validate,
    save,
    set: {
      name: (v: string) => { setName(v); clearError('name'); },
      country: changeCountry,
      phoneCountry: (v: string) => { setPhoneCountry(v); setPhoneTouched(true); clearError('phone'); },
      national: (v: string) => { setNational(v); setPhoneTouched(true); clearError('phone'); },
      companyName: (v: string) => { setCompanyName(v); clearError('companyName'); },
      jobTitle: (v: string) => { setJobTitle(v); clearError('jobTitle'); },
      companyWebsite: (v: string) => { setCompanyWebsite(v); clearError('companyWebsite'); },
      expectedUsageRange: setExpectedUsageRange,
      primaryUseCase: setPrimaryUseCase,
    },
  };
}

export type ProfileForm = ReturnType<typeof useProfileForm>;

export const SECTION_FIELDS: Record<'about' | 'company' | 'usage', ProfileField[]> = {
  about: ['name', 'country', 'phone'],
  company: ['companyName', 'jobTitle', 'companyWebsite'],
  usage: [],
};

// ── Presentational pieces ───────────────────────────────────────────────

const inputClass = (invalid?: boolean) =>
  `w-full px-3 py-2.5 rounded-lg text-sm text-[#170B2E] placeholder:text-[#6B6478] bg-white border outline-none transition-all disabled:bg-[#F8F4FD] disabled:text-[#3D3650] ${
    invalid
      ? 'border-red-500/50 focus:border-red-500/70'
      : 'border-[#D6C4EE] focus:border-[#7F40E8]/60 focus:shadow-[0_0_0_3px_rgba(127,64,232,0.1)]'
  }`;

function FieldRow({
  id,
  label,
  required,
  optional,
  helper,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  helper?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[#3D3650]">
        {label}
        {required && <span className="text-[#7F40E8]"> *</span>}
        {optional && <span className="ml-1 text-xs font-normal text-[#3D3650]">Optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-600">{error}</p>
      ) : (
        helper && <p className="text-xs text-[#3D3650]">{helper}</p>
      )}
    </div>
  );
}

function Select({
  id,
  value,
  onChange,
  invalid,
  children,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        className={`${inputClass(invalid)} appearance-none pr-9 ${value ? '' : 'text-[#3D3650]'}`}
      >
        {children}
      </select>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#3D3650]" />
    </div>
  );
}

function PhoneInput({ form }: { form: ProfileForm }) {
  const { values, dial, errors, set } = form;
  return (
    <FieldRow
      id="pc-phone"
      label="Phone number"
      required
      helper="We'll use this for account and billing-related communication."
      error={errors.phone}
    >
      <div className="flex gap-2">
        <div className="relative shrink-0">
          <div aria-hidden className={`${inputClass(!!errors.phone)} flex items-center gap-1.5 pr-8 whitespace-nowrap`}>
            <span>{flagEmoji(values.phoneCountry)}</span>
            <span>+{dial}</span>
          </div>
          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#3D3650]" />
          <select
            aria-label="Country calling code"
            value={values.phoneCountry}
            onChange={(e) => set.phoneCountry(e.target.value)}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} (+{c.dial})
              </option>
            ))}
          </select>
        </div>
        <input
          id="pc-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder="98765 43210"
          className={inputClass(!!errors.phone)}
          value={values.national}
          onChange={(e) => set.national(e.target.value)}
          aria-invalid={!!errors.phone || undefined}
        />
      </div>
    </FieldRow>
  );
}

/** A phone already on file, shown as confirmed with an option to change it. */
function PhoneOnFile({ form, onChange }: { form: ProfileForm; onChange: () => void }) {
  const { values, dial } = form;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-[#3D3650]">Phone number</p>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-[#E7DFF5] bg-[#F8F4FD] px-3 py-2.5">
        <span className="flex items-center gap-2 text-sm text-[#170B2E]" data-testid="phone-on-file">
          <Check size={14} className="text-emerald-600" />
          {flagEmoji(values.phoneCountry)} +{dial} {values.national}
        </span>
        <button type="button" onClick={onChange} className="text-xs font-medium text-[#7F40E8] hover:text-[#6425C4]">
          Change
        </button>
      </div>
    </div>
  );
}

export function AboutFields({
  form,
  phoneEditing = true,
  onEditPhone,
}: {
  form: ProfileForm;
  phoneEditing?: boolean;
  onEditPhone?: () => void;
}) {
  const { user, values, errors, set } = form;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldRow id="pc-name" label="Full name" required error={errors.name}>
          <input
            id="pc-name"
            className={inputClass(!!errors.name)}
            value={values.name}
            onChange={(e) => set.name(e.target.value)}
            autoComplete="name"
            maxLength={100}
            aria-invalid={!!errors.name || undefined}
          />
        </FieldRow>
        <FieldRow id="pc-email" label="Work email" helper="Managed by your Google account.">
          <input id="pc-email" className={inputClass()} value={user.email ?? ''} readOnly disabled />
        </FieldRow>
      </div>

      <FieldRow id="pc-country" label="Country" required error={errors.country}>
        <Select id="pc-country" value={values.country} onChange={set.country} invalid={!!errors.country}>
          <option value="">Select country</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </Select>
      </FieldRow>

      {phoneEditing ? (
        <PhoneInput form={form} />
      ) : (
        <PhoneOnFile form={form} onChange={() => onEditPhone?.()} />
      )}
    </div>
  );
}

export function CompanyFields({ form }: { form: ProfileForm }) {
  const { values, errors, set } = form;
  return (
    <div className="flex flex-col gap-4">
      <FieldRow
        id="pc-company"
        label="Company / Organization"
        required
        helper="Used to personalize your workspace and account."
        error={errors.companyName}
      >
        <input
          id="pc-company"
          className={inputClass(!!errors.companyName)}
          value={values.companyName}
          onChange={(e) => set.companyName(e.target.value)}
          autoComplete="organization"
          maxLength={150}
          aria-invalid={!!errors.companyName || undefined}
        />
      </FieldRow>

      <FieldRow id="pc-job" label="Job title / Role" required error={errors.jobTitle}>
        <input
          id="pc-job"
          className={inputClass(!!errors.jobTitle)}
          value={values.jobTitle}
          onChange={(e) => set.jobTitle(e.target.value)}
          autoComplete="organization-title"
          placeholder="e.g. Engineering Lead"
          maxLength={100}
          aria-invalid={!!errors.jobTitle || undefined}
        />
      </FieldRow>

      <FieldRow id="pc-website" label="Company website" optional error={errors.companyWebsite}>
        <input
          id="pc-website"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://"
          className={inputClass(!!errors.companyWebsite)}
          value={values.companyWebsite}
          onChange={(e) => set.companyWebsite(e.target.value)}
          maxLength={255}
          aria-invalid={!!errors.companyWebsite || undefined}
        />
      </FieldRow>
    </div>
  );
}

export function UsageFields({ form }: { form: ProfileForm }) {
  const { values, set } = form;
  return (
    <div className="flex flex-col gap-4">
      <FieldRow
        id="pc-usage"
        label="Expected monthly usage"
        optional
        helper="This helps us understand how we can support your workload."
      >
        <Select id="pc-usage" value={values.expectedUsageRange} onChange={set.expectedUsageRange}>
          <option value="">Select usage range</option>
          {USAGE_RANGES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </Select>
      </FieldRow>

      <FieldRow id="pc-usecase" label="Primary use case" optional>
        <Select id="pc-usecase" value={values.primaryUseCase} onChange={set.primaryUseCase}>
          <option value="">Select use case</option>
          {USE_CASES.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </Select>
      </FieldRow>
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="text-sm text-red-600 px-4 py-3 rounded-lg border border-red-300"
      style={{ background: 'rgba(239,68,68,0.06)' }}
    >
      {message}
    </div>
  );
}
