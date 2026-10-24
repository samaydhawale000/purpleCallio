const LANG = '[a-z]{2,3}(?:-[A-Z]{2})?';
const PAIR = new RegExp(`^(${LANG})-(${LANG})$`);

/** "hi-en" / "en-IN-hi" → languages (regions are upper-case, so unambiguous); null if malformed. */
export function parsePairLoose(
  pair?: string,
): { source: string; target: string } | null {
  if (!pair) return null;
  const m = PAIR.exec(pair);
  return m ? { source: m[1], target: m[2] } : null;
}
