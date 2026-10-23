import React, { useEffect } from 'react';

import {
  fontStackForScript,
  isRtlLanguage,
  lineHeightForScript,
  loadScriptFont,
  scriptForLanguage,
} from '@purplecallio/sdk';

/** CSS variables every translation component reads (override on any ancestor). */
export const TRANSLATION_THEME_DEFAULTS = {
  '--pc-tr-bg': 'rgba(15, 23, 42, 0.78)',
  '--pc-tr-fg': '#F8FAFC',
  '--pc-tr-muted': '#CBD5E1',
  '--pc-tr-surface': 'rgba(30, 41, 59, 0.9)',
  '--pc-tr-border': 'rgba(148, 163, 184, 0.35)',
  '--pc-tr-accent': '#8B5CF6',
  '--pc-tr-highlight': 'rgba(139, 92, 246, 0.28)',
  '--pc-tr-warn': '#F59E0B',
  '--pc-tr-warn-bg': 'rgba(245, 158, 11, 0.16)',
  '--pc-tr-radius': '12px',
  '--pc-tr-font-size': '15px',
} as const;

export const v = (name: keyof typeof TRANSLATION_THEME_DEFAULTS) =>
  `var(${name}, ${TRANSLATION_THEME_DEFAULTS[name]})`;

/** Loads Noto Sans <Script> fonts for the given languages, once per script. */
export function useScriptFonts(languages: (string | null | undefined)[], enabled = true): void {
  const key = [...new Set(languages.filter(Boolean).map((l) => scriptForLanguage(l)))].sort().join(',');
  useEffect(() => {
    if (!enabled || !key) return;
    for (const script of key.split(',')) loadScriptFont(script);
  }, [key, enabled]);
}

export function scriptStyle(language: string | null | undefined): React.CSSProperties {
  const script = scriptForLanguage(language);
  return { fontFamily: fontStackForScript(script), lineHeight: lineHeightForScript(script) };
}

export interface ScriptTextProps extends React.HTMLAttributes<HTMLElement> {
  language?: string | null;
  as?: 'span' | 'p' | 'div';
  children?: React.ReactNode;
}

/** Text in any script: right `lang`, `dir` (rtl for ar/ur…, else auto), font stack and line height. */
export function ScriptText({ language, as = 'span', style, children, ...rest }: ScriptTextProps) {
  const lang = language && language !== 'auto' ? language : undefined;
  return React.createElement(
    as,
    {
      lang,
      dir: isRtlLanguage(language) ? 'rtl' : 'auto',
      ...rest,
      style: { ...scriptStyle(language), unicodeBidi: 'plaintext', ...style },
    },
    children,
  );
}

export function cx(...names: (string | false | null | undefined)[]): string | undefined {
  const s = names.filter(Boolean).join(' ');
  return s || undefined;
}
