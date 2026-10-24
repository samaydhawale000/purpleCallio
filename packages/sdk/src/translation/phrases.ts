import type { Caption, GuardReason, TranslationPhrase, TranslationRole } from './types';

/**
 * DualView history keyed by `phraseId`. Captions for the same phrase merge
 * (text grows, timing fields are kept once known, `final` never reverts),
 * and MeaningGuard flags may land before or after the final caption.
 */
export class PhraseStore {
  private readonly byId = new Map<string, TranslationPhrase>();
  private order: string[] = [];
  /** Flags that arrived before their caption. */
  private readonly earlyFlags = new Map<string, GuardReason[]>();
  role: TranslationRole | null = null;

  constructor(private readonly max = 500) {}

  get(phraseId: string): TranslationPhrase | undefined {
    return this.byId.get(phraseId);
  }

  list(): TranslationPhrase[] {
    return this.order.map((id) => this.byId.get(id)!).filter(Boolean);
  }

  setRole(role: TranslationRole | null): void {
    this.role = role;
    for (const [id, p] of this.byId) this.byId.set(id, { ...p, mine: role !== null && p.speaker === role });
  }

  applyCaption(caption: Caption): TranslationPhrase | null {
    if (!caption || typeof caption.phraseId !== 'string' || !caption.phraseId) return null;
    const prev = this.byId.get(caption.phraseId);
    const next: TranslationPhrase = {
      ...(prev ?? { flagged: false, playing: false, mine: false }),
      ...stripUndefined(caption),
      original: caption.original ?? prev?.original ?? '',
      translated: caption.translated || prev?.translated || '',
      final: Boolean(prev?.final || caption.final),
      startedAt: caption.startedAt ?? prev?.startedAt ?? Date.now(),
      endedAt: caption.endedAt ?? prev?.endedAt,
      translatedAudioAt: caption.translatedAudioAt ?? prev?.translatedAudioAt,
      lexiconApplied: caption.lexiconApplied ?? prev?.lexiconApplied,
      mine: this.role !== null && caption.speaker === this.role,
    } as TranslationPhrase;

    // Guard: a caption's own guard counts, but never clears an earlier flag.
    const early = this.earlyFlags.get(caption.phraseId);
    this.earlyFlags.delete(caption.phraseId);
    const reasons = mergeReasons(prev?.guard?.reasons, caption.guard?.reasons, early);
    const uncertain =
      prev?.guard?.status === 'uncertain' || caption.guard?.status === 'uncertain' || Boolean(early?.length);
    if (caption.guard || prev?.guard || early) {
      next.guard = { status: uncertain ? 'uncertain' : 'ok', reasons };
    }
    next.flagged = uncertain;

    this.byId.set(caption.phraseId, next);
    if (!prev) this.insert(next);
    return next;
  }

  applyFlag(phraseId: string, reasons: GuardReason[]): TranslationPhrase | null {
    const prev = this.byId.get(phraseId);
    if (!prev) {
      this.earlyFlags.set(phraseId, mergeReasons(this.earlyFlags.get(phraseId), reasons));
      return null;
    }
    const next: TranslationPhrase = {
      ...prev,
      flagged: true,
      guard: { status: 'uncertain', reasons: mergeReasons(prev.guard?.reasons, reasons) },
    };
    this.byId.set(phraseId, next);
    return next;
  }

  patch(phraseId: string, patch: Partial<TranslationPhrase>): TranslationPhrase | null {
    const prev = this.byId.get(phraseId);
    if (!prev) return null;
    const next = { ...prev, ...patch };
    this.byId.set(phraseId, next);
    return next;
  }

  clear(): void {
    this.byId.clear();
    this.order = [];
    this.earlyFlags.clear();
  }

  /** Keeps `order` sorted by `startedAt`, stable for ties. */
  private insert(p: TranslationPhrase): void {
    let i = this.order.length;
    while (i > 0 && (this.byId.get(this.order[i - 1])?.startedAt ?? 0) > p.startedAt) i--;
    this.order.splice(i, 0, p.phraseId);
    while (this.order.length > this.max) {
      const drop = this.order.shift()!;
      this.byId.delete(drop);
    }
  }
}

function mergeReasons(...lists: (readonly GuardReason[] | undefined)[]): GuardReason[] {
  const out: GuardReason[] = [];
  for (const list of lists) for (const r of list ?? []) if (!out.includes(r)) out.push(r);
  return out;
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) (out as any)[k] = v;
  return out;
}
