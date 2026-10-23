import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import { fetchTranslationLanguages, type TranslationLanguage } from '@purplecallio/sdk';

import { cx, ScriptText, useScriptFonts, v } from './script';

const cache = new Map<string, Promise<TranslationLanguage[]>>();

/** `GET {apiUrl}/translation/languages`, cached per `apiUrl` (failures are not cached). */
export function loadTranslationLanguages(apiUrl: string): Promise<TranslationLanguage[]> {
  let p = cache.get(apiUrl);
  if (!p) {
    p = fetchTranslationLanguages(apiUrl).then((r) => r.languages);
    p.catch(() => cache.delete(apiUrl));
    cache.set(apiUrl, p);
  }
  return p;
}

/** Fetches languages unless they are given. */
export function useTranslationLanguages(apiUrl?: string, given?: TranslationLanguage[]) {
  const [state, setState] = useState<{ languages: TranslationLanguage[]; loading: boolean; error: Error | null }>({
    languages: given ?? [],
    loading: !given && Boolean(apiUrl),
    error: null,
  });
  useEffect(() => {
    if (given) {
      setState({ languages: given, loading: false, error: null });
      return;
    }
    if (!apiUrl) return;
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    loadTranslationLanguages(apiUrl).then(
      (languages) => live && setState({ languages, loading: false, error: null }),
      (error) => live && setState({ languages: [], loading: false, error }),
    );
    return () => {
      live = false;
    };
  }, [apiUrl, given]);
  return state;
}

export interface LanguagePickerClassNames {
  root?: string;
  label?: string;
  trigger?: string;
  search?: string;
  list?: string;
  option?: string;
  badge?: string;
}

export interface LanguagePickerProps {
  /** Selected language code. */
  value: string;
  onChange: (code: string) => void;
  /** Visible label, e.g. "My language" / "I want to hear". */
  label: string;
  /** REST base used for `GET /translation/languages` when `languages` is not given. */
  apiUrl?: string;
  languages?: TranslationLanguage[];
  /** Grey out languages that can't do this (e.g. `voice` for "I want to hear" in voice mode). */
  require?: 'voice' | 'captions';
  /** Offer "Detect automatically" (speak side only). */
  allowAuto?: boolean;
  disabled?: boolean;
  /** Load Noto Sans fonts for the native names. Default true. */
  loadFonts?: boolean;
  className?: string;
  classNames?: LanguagePickerClassNames;
  style?: React.CSSProperties;
}

const AUTO: TranslationLanguage = { code: 'auto', name: 'Detect automatically', nativeName: 'Auto', script: 'Latn', rtl: false, voice: true, captions: true };

/** Searchable language list showing native names (हिन्दी, தமிழ், मराठी) with voice/captions badges. */
export function LanguagePicker({
  value,
  onChange,
  label,
  apiUrl,
  languages: given,
  require,
  allowAuto = false,
  disabled = false,
  loadFonts = true,
  className,
  classNames = {},
  style,
}: LanguagePickerProps) {
  const { languages, loading, error } = useTranslationLanguages(apiUrl, given);
  const all = useMemo(() => (allowAuto ? [AUTO, ...languages] : languages), [allowAuto, languages]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  const listId = `${id}-list`;
  const searchRef = useRef<HTMLInputElement>(null);

  useScriptFonts(open ? all.map((l) => l.code) : [value], loadFonts);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((l) => [l.code, l.name, l.nativeName].some((s) => s?.toLowerCase().includes(q)));
  }, [all, query]);

  const selected = all.find((l) => l.code === value) ?? (value ? { ...AUTO, code: value, name: value, nativeName: value } : null);
  const usable = (l: TranslationLanguage) => !require || l[require] !== false;

  useEffect(() => {
    if (open) {
      setActive(Math.max(0, filtered.findIndex((l) => l.code === value)));
      searchRef.current?.focus();
    } else setQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (l: TranslationLanguage | undefined) => {
    if (!l || !usable(l)) return;
    onChange(l.code);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const badge = (text: string) => (
    <span className={cx('pc-tr-badge', classNames.badge)} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999, border: `1px solid ${v('--pc-tr-border')}`, color: v('--pc-tr-muted') }}>
      {text}
    </span>
  );

  return (
    <div className={cx('pc-tr-language-picker', className, classNames.root)} style={{ position: 'relative', color: v('--pc-tr-fg'), ...style }}>
      <span id={`${id}-label`} className={classNames.label} style={{ display: 'block', fontSize: 12, color: v('--pc-tr-muted'), marginBottom: 4 }}>
        {label}
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => setOpen((o) => !o)}
        className={classNames.trigger}
        style={{ width: '100%', textAlign: 'start', padding: '6px 10px', borderRadius: 8, border: `1px solid ${v('--pc-tr-border')}`, background: v('--pc-tr-surface'), color: 'inherit', cursor: disabled ? 'default' : 'pointer', font: 'inherit' }}
      >
        <span id={`${id}-value`}>
          {selected ? (
            <>
              <ScriptText language={selected.code}>{selected.nativeName}</ScriptText>
              {selected.nativeName !== selected.name && <span style={{ color: v('--pc-tr-muted') }}> · {selected.name}</span>}
            </>
          ) : loading ? (
            'Loading languages…'
          ) : (
            'Choose a language'
          )}
        </span>
      </button>
      {open && (
        <div style={{ position: 'absolute', zIndex: 20, insetInlineStart: 0, insetInlineEnd: 0, marginTop: 4, padding: 6, borderRadius: 10, background: v('--pc-tr-surface'), border: `1px solid ${v('--pc-tr-border')}`, boxShadow: '0 8px 24px rgba(0,0,0,0.3)' }}>
          <input
            ref={searchRef}
            role="combobox"
            aria-label={`Search ${label}`}
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={filtered[active] ? `${id}-opt-${filtered[active].code}` : undefined}
            aria-autocomplete="list"
            value={query}
            placeholder="Search languages"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            className={classNames.search}
            style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, border: `1px solid ${v('--pc-tr-border')}`, background: 'transparent', color: 'inherit', font: 'inherit', marginBottom: 6 }}
          />
          <ul id={listId} role="listbox" aria-label={label} className={classNames.list} style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 240, overflowY: 'auto' }}>
            {error && <li style={{ fontSize: 12, color: v('--pc-tr-warn') }}>Could not load languages.</li>}
            {!error && filtered.length === 0 && <li style={{ fontSize: 12, color: v('--pc-tr-muted') }}>No matching language.</li>}
            {filtered.map((l, i) => {
              const ok = usable(l);
              return (
                <li
                  key={l.code}
                  id={`${id}-opt-${l.code}`}
                  role="option"
                  aria-selected={l.code === value}
                  aria-disabled={!ok || undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(l)}
                  onMouseEnter={() => setActive(i)}
                  className={cx('pc-tr-language-option', classNames.option)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.45, background: i === active ? v('--pc-tr-highlight') : 'transparent' }}
                >
                  <ScriptText language={l.code} dir={l.rtl ? 'rtl' : 'auto'} style={{ flex: 1 }}>
                    {l.nativeName}
                  </ScriptText>
                  {l.nativeName !== l.name && <span style={{ fontSize: 12, color: v('--pc-tr-muted') }}>{l.name}</span>}
                  {l.code !== 'auto' && l.voice && badge('Voice')}
                  {l.code !== 'auto' && l.captions && badge('Captions')}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
