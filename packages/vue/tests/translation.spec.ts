import { describe, expect, it, vi, beforeEach } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import { FakeTranslationClient, phrase } from './fake-translation-client';

vi.mock('@purplecallio/sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mod = await import('./fake-translation-client');
  return { ...actual, TranslationClient: mod.FakeTranslationClient };
});

import { TranslationCaptions, useTranslation, type UseTranslationReturn } from '../src/index';

beforeEach(() => {
  FakeTranslationClient.instances.length = 0;
});

function mountWith(options: Parameters<typeof useTranslation>[0]) {
  let tr!: UseTranslationReturn;
  const Host = defineComponent({
    setup() {
      tr = useTranslation(options);
      return () => h(TranslationCaptions, { translation: tr, loadFonts: false });
    },
  });
  return { wrapper: mount(Host), get tr() { return tr; } };
}

describe('useTranslation (vue)', () => {
  it('mirrors state/phrases and disables an owned client on unmount', async () => {
    const m = mountWith({ serverUrl: 'https://api.example.com', token: 'bj_session_t' });
    const c = FakeTranslationClient.instances[0];
    expect(c.config).toMatchObject({ serverUrl: 'https://api.example.com', token: 'bj_session_t' });
    c.emit('state', { ...c.state, status: 'ready', replayEnabled: true });
    c.emit('phrases', [phrase({ flagged: true, guard: { status: 'uncertain', reasons: ['term_mismatch:date'] } })]);
    await nextTick();
    expect(m.tr.state.value.status).toBe('ready');
    const html = m.wrapper.html();
    expect(html).toContain('My name');
    expect(html).toContain('माझं नाव');
    expect(html).toContain('May not be accurate — check');
    expect(html).toContain('A date may have changed');
    await m.wrapper.find('button').trigger('click');
    expect(c.requestRepeat).toHaveBeenCalledWith('receiver-1');
    const replay = m.wrapper.findAll('button').find((b) => b.text() === 'Replay original')!;
    await replay.trigger('click');
    expect(c.replay).toHaveBeenCalledWith('receiver-1', undefined);
    m.wrapper.unmount();
    expect(c.disable).toHaveBeenCalled();
    expect(c.listenerCount()).toBe(0);
  });

  it('does not disable a client it was given', () => {
    const c = new FakeTranslationClient();
    const m = mountWith({ client: c as any });
    m.wrapper.unmount();
    expect(c.disable).not.toHaveBeenCalled();
  });
});
