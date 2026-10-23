import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';

import {
  TranslationPhrase,
  describeGuardReasons,
  fontStackForScript,
  isRtlLanguage,
  lineHeightForScript,
  loadScriptFont,
  scriptForLanguage,
} from '@purplecallio/sdk';

import { PurpleCallioTranslationService } from './purplecallio-translation.service';

/**
 * DualView captions: original + translated per phrase, highlighted while
 * its translated audio plays, amber "May not be accurate — check" marker
 * with plain reasons, "Ask to repeat" and (when enabled) "Replay original".
 *
 * ```html
 * <purplecallio-captions [phrases]="(tr.phrases$ | async) ?? []" [replayEnabled]="(tr.state$ | async)?.replayEnabled ?? false"></purplecallio-captions>
 * ```
 */
@Component({
  selector: 'purplecallio-captions',
  standalone: true,
  imports: [NgFor, NgIf],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="pc-tr-dualview" role="log" aria-live="polite" aria-label="Live translation captions" style="list-style:none;margin:0;padding:0">
      <li *ngFor="let p of shown(); trackBy: trackById" class="pc-tr-phrase" [class.pc-tr-playing]="p.playing" [class.pc-tr-flagged]="p.flagged" [attr.data-phrase-id]="p.phraseId" [attr.aria-current]="p.playing ? 'true' : null">
        <p *ngIf="layout !== 'translated' || !p.translated" class="pc-tr-original" [attr.lang]="p.sourceLanguage" [attr.dir]="dir(p.sourceLanguage)" [style.font-family]="font(p.sourceLanguage)" [style.line-height]="lineHeight(p.sourceLanguage)">{{ p.original }}</p>
        <p *ngIf="layout !== 'original' && p.translated" class="pc-tr-translated" [attr.lang]="p.targetLanguage" [attr.dir]="dir(p.targetLanguage)" [style.font-family]="font(p.targetLanguage)" [style.line-height]="lineHeight(p.targetLanguage)">{{ p.translated }}</p>
        <div *ngIf="p.flagged" class="pc-tr-flag" role="note">
          <strong>May not be accurate — check</strong>
          <ul><li *ngFor="let r of reasons(p)">{{ r }}</li></ul>
        </div>
        <div *ngIf="!p.mine && p.final" class="pc-tr-actions">
          <button type="button" (click)="repeat(p)">{{ p.repeatRequestedAt ? 'Asked to repeat' : 'Ask to repeat' }}</button>
          <button *ngIf="replayEnabled" type="button" (click)="replay(p)">Replay original</button>
        </div>
      </li>
    </ol>
  `,
})
export class PurpleCallioCaptionsComponent {
  @Input() phrases: TranslationPhrase[] = [];
  @Input() replayEnabled = false;
  @Input() layout: 'translated' | 'both' | 'original' = 'both';
  @Input() maxPhrases = 0;
  @Input() loadFonts = true;

  constructor(private readonly translation: PurpleCallioTranslationService) {}

  shown(): TranslationPhrase[] {
    const list = this.maxPhrases ? this.phrases.slice(-this.maxPhrases) : this.phrases;
    if (this.loadFonts) {
      for (const p of list) {
        loadScriptFont(scriptForLanguage(p.sourceLanguage));
        loadScriptFont(scriptForLanguage(p.targetLanguage));
      }
    }
    return list;
  }

  trackById(_: number, p: TranslationPhrase): string {
    return p.phraseId;
  }

  reasons(p: TranslationPhrase): string[] {
    return describeGuardReasons(p.guard?.reasons);
  }

  dir(lang: string): 'rtl' | 'auto' {
    return isRtlLanguage(lang) ? 'rtl' : 'auto';
  }

  font(lang: string): string {
    return fontStackForScript(scriptForLanguage(lang));
  }

  lineHeight(lang: string): number {
    return lineHeightForScript(scriptForLanguage(lang));
  }

  repeat(p: TranslationPhrase): void {
    this.translation.requestRepeat(p.phraseId);
  }

  replay(p: TranslationPhrase): void {
    this.translation.replay(p.phraseId);
  }
}
