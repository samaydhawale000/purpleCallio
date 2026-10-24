import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeTranslationClient, phrase } from './fake-translation-client';

vi.mock('@purplecallio/sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mod = await import('./fake-translation-client');
  return { ...actual, TranslationClient: mod.FakeTranslationClient };
});

import { PurpleCallioTranslationService } from '../src/lib/purplecallio-translation.service';
import { PurpleCallioCaptionsComponent } from '../src/lib/purplecallio-captions.component';

function values<T>(obs: { subscribe: (fn: (v: T) => void) => void }): T[] {
  const out: T[] = [];
  obs.subscribe((v) => out.push(v));
  return out;
}

beforeEach(() => {
  FakeTranslationClient.instances.length = 0;
});

describe('PurpleCallioTranslationService', () => {
  it('throws before configure()', () => {
    expect(() => new PurpleCallioTranslationService().setMode('voice')).toThrow(/configure\(\)/);
  });

  it('streams state/phrases and delegates actions', async () => {
    const svc = new PurpleCallioTranslationService();
    const phrases = values(svc.phrases$);
    svc.configure({ serverUrl: 'https://api.example.com', token: 'bj_session_t' });
    const c = FakeTranslationClient.instances[0];
    c.emit('state', { status: 'ready', mode: 'voice', replayEnabled: true });
    c.emit('phrases', [phrase()]);
    expect(svc.state?.status).toBe('ready');
    expect(phrases.at(-1)).toHaveLength(1);
    await svc.enable({ speak: 'en', hear: 'mr' });
    expect(c.enable).toHaveBeenCalledWith({ speak: 'en', hear: 'mr' });
    svc.setOriginalVolume(0.1);
    expect(c.setOriginalVolume).toHaveBeenCalledWith(0.1);
    svc.ngOnDestroy();
    expect(c.disable).toHaveBeenCalled();
    expect(c.listenerCount()).toBe(0);
  });
});

describe('PurpleCallioCaptionsComponent', () => {
  it('humanises guard reasons, picks rtl for Urdu and routes actions to the service', () => {
    const svc = new PurpleCallioTranslationService();
    svc.configure({ serverUrl: 'https://api.example.com', token: 't' });
    const c = FakeTranslationClient.instances[0];
    const cmp = new PurpleCallioCaptionsComponent(svc);
    cmp.loadFonts = false;
    cmp.maxPhrases = 1;
    const p = phrase({ flagged: true, guard: { status: 'uncertain', reasons: ['term_mismatch:phone'] } }) as any;
    cmp.phrases = [phrase({ phraseId: 'old' }) as any, p];
    expect(cmp.shown()).toEqual([p]);
    expect(cmp.reasons(p)).toEqual(['A phone number may have changed']);
    expect(cmp.dir('ur')).toBe('rtl');
    expect(cmp.dir('hi')).toBe('auto');
    expect(cmp.font('ta')).toContain('Noto Sans Tamil');
    cmp.repeat(p);
    cmp.replay(p);
    expect(c.requestRepeat).toHaveBeenCalledWith('receiver-1');
    expect(c.replay).toHaveBeenCalledWith('receiver-1', undefined);
  });
});
