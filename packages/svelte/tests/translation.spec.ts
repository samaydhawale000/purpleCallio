import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import { FakeTranslationClient, phrase } from './fake-translation-client';

vi.mock('@purplecallio/sdk', async () => {
  const mod = await import('./fake-translation-client');
  return { TranslationClient: mod.FakeTranslationClient };
});

import { createTranslation } from '../src/lib/createTranslation';

beforeEach(() => {
  FakeTranslationClient.instances.length = 0;
});

describe('createTranslation', () => {
  it('exposes state/phrases/repeat stores and delegates actions', async () => {
    const tr = createTranslation({ serverUrl: 'https://api.example.com', token: 'bj_session_t', originalVolume: 0.3 });
    const c = FakeTranslationClient.instances[0];
    expect(c.config).toMatchObject({ token: 'bj_session_t', originalVolume: 0.3 });
    c.emit('state', { status: 'ready', mode: 'voice' });
    c.emit('phrases', [phrase()]);
    c.emit('repeat.requested', { phraseId: 'caller-1', original: 'hi', prompt: 'Please repeat' });
    expect(get(tr.state).status).toBe('ready');
    expect(get(tr.phrases)).toHaveLength(1);
    expect(get(tr.repeatRequests)[0].phraseId).toBe('caller-1');
    await tr.enable({ mode: 'captions' });
    expect(c.enable).toHaveBeenCalledWith({ mode: 'captions' });
    tr.setMode('voice');
    tr.replay('receiver-1', { rate: 0.85 });
    tr.requestRepeat('receiver-1');
    expect(c.setMode).toHaveBeenCalledWith('voice');
    expect(c.replay).toHaveBeenCalledWith('receiver-1', { rate: 0.85 });
    expect(c.requestRepeat).toHaveBeenCalledWith('receiver-1');
    tr.destroy();
    expect(c.disable).toHaveBeenCalledTimes(1);
    expect(c.listenerCount()).toBe(0);
  });

  it('leaves a provided client running on destroy', () => {
    const c = new FakeTranslationClient();
    createTranslation({ client: c as any }).destroy();
    expect(c.disable).not.toHaveBeenCalled();
  });
});
