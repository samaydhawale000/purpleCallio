'use client';

import { useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import type { AuthUser } from '../../store/auth.store';
import {
  AboutFields,
  CompanyFields,
  FormError,
  SECTION_FIELDS,
  UsageFields,
  useProfileForm,
  type ProfileField,
} from './profileForm';

const STEPS = [
  { key: 'about', label: 'About you' },
  { key: 'company', label: 'Company' },
  { key: 'usage', label: 'Usage' },
] as const;

function StepIndicator({ current }: { current: number }) {
  const items = [{ label: 'Sign in' }, ...STEPS];
  const active = current + 1; // "Sign in" is always done
  return (
    <ol className="flex items-center justify-center gap-1.5 sm:gap-2 text-xs mb-5" aria-label="Progress">
      {items.map((item, i) => {
        const done = i < active;
        const isCurrent = i === active;
        return (
          <li key={item.label} className="flex items-center gap-1.5 sm:gap-2">
            {i > 0 && <span aria-hidden className={`w-4 sm:w-6 h-px ${done || isCurrent ? 'bg-[#C4AEE8]' : 'bg-[#E7DFF5]'}`} />}
            <span
              className={`flex items-center gap-1.5 ${isCurrent ? 'font-medium text-[#170B2E]' : 'text-[#3D3650]'}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                  done ? 'bg-emerald-500/10 text-emerald-600' : isCurrent ? 'text-white' : 'border border-[#E7DFF5] text-[#3D3650]'
                }`}
                style={isCurrent ? { background: '#7F40E8' } : undefined}
              >
                {done ? <Check size={12} strokeWidth={2.5} /> : i}
              </span>
              <span className={isCurrent ? '' : 'hidden sm:inline'}>{item.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Shown on /login (and /signup) right after Google sign-in when the backend
 * reports onboardingRequired, split into three short steps. Values Google or
 * a previous session already provided are pre-filled; a phone already on
 * file is shown as confirmed rather than asked for again. Nothing is saved
 * until the last step.
 */
export function ProfileCompletionForm({
  user,
  onCompleted,
}: {
  user: AuthUser;
  onCompleted: (user: AuthUser) => void;
}) {
  const form = useProfileForm(user);
  const [step, setStep] = useState(0);
  const [editingPhone, setEditingPhone] = useState(!form.hasPhoneOnFile);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isLast = step === STEPS.length - 1;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!isLast) {
      if (form.validate(SECTION_FIELDS[STEPS[step].key])) setStep(step + 1);
      return;
    }

    // Re-check every step before saving; jump back to the first one with an error.
    for (let i = 0; i < STEPS.length; i++) {
      const fields: ProfileField[] = SECTION_FIELDS[STEPS[i].key];
      if (!form.validate(fields)) {
        if (fields.includes('phone')) setEditingPhone(true);
        setStep(i);
        return;
      }
    }

    setSubmitError('');
    setSubmitting(true);
    try {
      onCompleted(await form.save());
    } catch (err: any) {
      setSubmitError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div>
      <StepIndicator current={step} />
      <div className="text-center mb-6">
        <h2 className="text-lg font-bold text-[#170B2E]">Complete your profile</h2>
        <p className="text-sm text-[#3D3650] mt-1">
          Just a few details to help us set up your PurpleCallio account.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate aria-busy={submitting}>
        <fieldset disabled={submitting} className="flex flex-col gap-4 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-mono uppercase tracking-widest text-[#3D3650]">
              {STEPS[step].label}
            </p>
            <p className="text-[11px] text-[#3D3650]">Step {step + 1} of {STEPS.length}</p>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={STEPS[step].key}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {step === 0 && (
                <AboutFields form={form} phoneEditing={editingPhone} onEditPhone={() => setEditingPhone(true)} />
              )}
              {step === 1 && <CompanyFields form={form} />}
              {step === 2 && <UsageFields form={form} />}
            </motion.div>
          </AnimatePresence>

          <FormError message={submitError} />

          <div className="flex gap-3 mt-1">
            {step > 0 && (
              <Button type="button" variant="secondary" size="lg" onClick={() => setStep(step - 1)}>
                <ArrowLeft size={16} /> Back
              </Button>
            )}
            <Button type="submit" size="lg" loading={submitting} className="flex-1">
              {submitting ? 'Saving...' : isLast ? (
                <>Continue <ArrowRight size={16} /></>
              ) : (
                <>Next <ArrowRight size={16} /></>
              )}
            </Button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
