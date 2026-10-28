import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import {
  TranslationClient,
  TranslationClientConfig,
  TranslationMode,
  TranslationOptions,
  TranslationPhrase,
  TranslationReady,
  TranslationRepeatRequest,
  TranslationState,
} from '@purplecallio/sdk';

export interface PurpleCallioTranslationConfig extends Partial<TranslationClientConfig> {
  /** Use an existing client (e.g. `meeting.translation`); otherwise built from `serverUrl` + `token`. */
  client?: TranslationClient;
}

/**
 * Live Translate as RxJS observables around the SDK's `TranslationClient`.
 * `configure()` once per call, then `enable()` from a user gesture.
 */
@Injectable({ providedIn: 'root' })
export class PurpleCallioTranslationService implements OnDestroy {
  private client: TranslationClient | null = null;
  private owned = false;
  private offs: Array<() => void> = [];

  private readonly stateSubject = new BehaviorSubject<TranslationState | null>(null);
  private readonly phrasesSubject = new BehaviorSubject<TranslationPhrase[]>([]);
  private readonly repeatSubject = new BehaviorSubject<TranslationRepeatRequest[]>([]);

  readonly state$: Observable<TranslationState | null> = this.stateSubject.asObservable();
  readonly phrases$: Observable<TranslationPhrase[]> = this.phrasesSubject.asObservable();
  readonly repeatRequests$: Observable<TranslationRepeatRequest[]> = this.repeatSubject.asObservable();

  get state(): TranslationState | null {
    return this.stateSubject.value;
  }

  get phrases(): TranslationPhrase[] {
    return this.phrasesSubject.value;
  }

  configure(config: PurpleCallioTranslationConfig): void {
    this.reset();
    if (config.client) {
      this.client = config.client;
      this.owned = false;
    } else {
      if (!config.serverUrl || !config.token) throw new Error('PurpleCallio: serverUrl and token are required');
      const { client: _c, ...rest } = config;
      this.client = new TranslationClient(rest as TranslationClientConfig);
      this.owned = true;
    }
    const c = this.client;
    this.stateSubject.next(c.getState());
    this.phrasesSubject.next(c.phrases);
    this.offs = [
      c.on('state', (s) => this.stateSubject.next(s)),
      c.on('phrases', (list) => this.phrasesSubject.next(list)),
      c.on('repeat.requested', (r) =>
        this.repeatSubject.next([...this.repeatSubject.value.filter((x) => x.phraseId !== r.phraseId), r]),
      ),
    ];
  }

  /** Resolves with `ready`, or `null` on failure (see `state.error`). */
  enable(options?: TranslationOptions): Promise<TranslationReady | null> {
    return this.require().enable(options).catch(() => null);
  }

  /**
   * Turns translation off. With `meeting.translation` that is for the whole
   * call; `{ share: false }` leaves only this participant (e.g. on hang-up).
   */
  disable(options?: { share?: boolean }): void {
    this.client?.disable(options);
  }

  /** "Join translation": retries audio the browser blocked (`state.audioBlocked`). Call from a click. */
  resumeAudio(): Promise<boolean> {
    return this.require().resumeAudio();
  }

  setMode(mode: TranslationMode): void {
    this.require().setMode(mode);
  }

  setLanguages(languages: { speak?: string; hear?: string }): void {
    this.require().setLanguages(languages);
  }

  setOriginalVolume(volume: number): void {
    this.require().setOriginalVolume(volume);
  }

  replay(phraseId: string, options?: { rate?: number }): boolean {
    return this.require().replay(phraseId, options);
  }

  requestRepeat(phraseId: string): boolean {
    return this.require().requestRepeat(phraseId);
  }

  ngOnDestroy(): void {
    this.reset();
  }

  private reset(): void {
    this.offs.forEach((off) => off());
    this.offs = [];
    if (this.owned) this.client?.disable();
    this.client = null;
    this.owned = false;
    this.stateSubject.next(null);
    this.phrasesSubject.next([]);
    this.repeatSubject.next([]);
  }

  private require(): TranslationClient {
    if (!this.client) throw new Error('PurpleCallio: call configure() on PurpleCallioTranslationService first');
    return this.client;
  }
}
