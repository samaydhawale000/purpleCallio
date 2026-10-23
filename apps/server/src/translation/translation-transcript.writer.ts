import { Injectable, Logger } from '@nestjs/common';

import { redactTranscript } from '../ai/ai-transcript.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 86_400_000;

export interface StoredPhrase {
  phraseId: string;
  speaker: 'caller' | 'receiver';
  sourceLanguage: string;
  targetLanguage: string;
  original: string;
  translated: string;
  startedAt: number;
  endedAt?: number;
  translatedAudioAt?: number;
  guardStatus?: 'ok' | 'uncertain';
  guardReasons?: string[];
}

/**
 * Post-Call Suite transcript sink (PROTOCOL.md §7): final phrases go to
 * TranslationPhrase, redacted with the AI transcript rules, expiring after
 * the project's retention. Writes are chained per call; never throws.
 */
@Injectable()
export class TranslationTranscriptWriter {
  private readonly logger = new Logger(TranslationTranscriptWriter.name);
  private readonly chains = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaService) {}

  write(callId: string, phrase: StoredPhrase, retentionDays: number): Promise<void> {
    const original = redactTranscript(phrase.original.trim());
    const translated = redactTranscript(phrase.translated.trim());
    if (!original && !translated) return this.flush(callId);
    const expiresAt = new Date(Date.now() + Math.max(1, retentionDays) * DAY_MS);
    const data = {
      callId,
      phraseId: phrase.phraseId,
      speaker: phrase.speaker,
      sourceLanguage: phrase.sourceLanguage,
      targetLanguage: phrase.targetLanguage,
      original,
      translated,
      startedAt: new Date(phrase.startedAt),
      endedAt: phrase.endedAt ? new Date(phrase.endedAt) : null,
      translatedAudioAt: phrase.translatedAudioAt ? new Date(phrase.translatedAudioAt) : null,
      guardStatus: phrase.guardStatus ?? 'ok',
      guardReasons: phrase.guardReasons ?? [],
      expiresAt,
    };
    const next = (this.chains.get(callId) ?? Promise.resolve()).then(() =>
      this.prisma.translationPhrase
        .upsert({
          where: { callId_phraseId: { callId, phraseId: phrase.phraseId } },
          create: data,
          update: {
            original,
            translated,
            translatedAudioAt: data.translatedAudioAt,
            guardStatus: data.guardStatus,
            guardReasons: data.guardReasons,
          },
        })
        .then(
          () => undefined,
          (err: unknown) => {
            this.logger.error(
              `event=translation_phrase_write_failed callId=${callId} error=${(err as Error)?.name ?? 'unknown'}`,
            );
          },
        ),
    );
    this.chains.set(callId, next);
    void next.then(() => {
      if (this.chains.get(callId) === next) this.chains.delete(callId);
    });
    return next;
  }

  /** Resolves once every queued write of the call has settled. */
  flush(callId: string): Promise<void> {
    return this.chains.get(callId) ?? Promise.resolve();
  }
}
