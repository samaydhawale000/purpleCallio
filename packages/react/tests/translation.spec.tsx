import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeTranslationClient, phrase } from './fake-translation-client';

vi.mock('@purplecallio/sdk', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mod = await import('./fake-translation-client');
  return { ...actual, TranslationClient: mod.FakeTranslationClient };
});

import {
  DualViewCaptions,
  LanguagePicker,
  TranslatedChatView,
  TranslationControls,
  TranslationProvider,
  useTranslation,
} from '../src/index';

const LANGS = [
  { code: 'en', name: 'English', nativeName: 'English', script: 'Latn', rtl: false, voice: true, captions: true },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', script: 'Deva', rtl: false, voice: true, captions: true },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', script: 'Taml', rtl: false, voice: true, captions: true },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', script: 'Deva', rtl: false, voice: true, captions: true },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', script: 'Arab', rtl: true, voice: false, captions: true },
];

function latest() {
  return FakeTranslationClient.instances[FakeTranslationClient.instances.length - 1];
}

function Harness({ children }: { children?: React.ReactNode }) {
  return (
    <TranslationProvider serverUrl="https://api.example.com" token="bj_session_t">
      {children}
    </TranslationProvider>
  );
}

beforeEach(() => {
  FakeTranslationClient.instances.length = 0;
  document.head.querySelectorAll('link[data-purplecallio-font]').forEach((l) => l.remove());
});

describe('useTranslation', () => {
  it('builds a client from serverUrl + token, mirrors state and disables on unmount', async () => {
    const hook = renderHook(() => useTranslation({ serverUrl: 'https://api.example.com', token: 'bj_session_t', originalVolume: 0.1 }));
    const c = latest();
    expect(c.config).toMatchObject({ serverUrl: 'https://api.example.com', token: 'bj_session_t', originalVolume: 0.1 });
    await act(async () => {
      await hook.result.current.enable({ speak: 'en', hear: 'hi', mode: 'voice' });
    });
    expect(c.enable).toHaveBeenCalledWith({ speak: 'en', hear: 'hi', mode: 'voice' });
    expect(hook.result.current.enabled).toBe(true);
    act(() => c.setPhrases([phrase()]));
    expect(hook.result.current.phrases).toHaveLength(1);
    act(() => c.emit('repeat.requested', { phraseId: 'caller-2', original: 'x', prompt: 'Please repeat' }));
    expect(hook.result.current.repeatRequests).toHaveLength(1);
    hook.unmount();
    expect(c.disable).toHaveBeenCalled();
  });

  it('wraps a given client without owning it', () => {
    const c = new FakeTranslationClient();
    const hook = renderHook(() => useTranslation({ client: c as any }));
    expect(hook.result.current.client).toBe(c);
    hook.unmount();
    expect(c.disable).not.toHaveBeenCalled();
  });
});

describe('<TranslationControls />', () => {
  it('switches modes, sets the original volume and shows CostGuard + headphones tip', async () => {
    render(<Harness><TranslationControls /></Harness>);
    const c = latest();
    fireEvent.click(screen.getByRole('radio', { name: /translation voice/i }));
    expect(c.enable).toHaveBeenCalledWith({ mode: 'voice' });
    await waitFor(() => expect((screen.getByRole('radio', { name: /translation voice/i })).getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByText(/use headphones/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /translation captions/i }));
    expect(c.setMode).toHaveBeenCalledWith('captions');

    fireEvent.change(screen.getByLabelText('Original voice volume while translation plays'), { target: { value: '40' } });
    expect(c.setOriginalVolume).toHaveBeenCalledWith(0.4);
    fireEvent.click(screen.getByRole('button', { name: /mute original voice/i }));
    expect(c.setOriginalVolume).toHaveBeenLastCalledWith(0);

    act(() => c.setState({ limit: { kind: 'stepped_down', scope: 'call', message: 'Switched to captions to stay within the limit', remainingSeconds: 90 } }));
    expect(screen.getByRole('alert').textContent).toMatch(/Switched to captions.*2 min left/);
    fireEvent.click(screen.getByRole('button', { name: /dismiss translation limit/i }));
    expect(screen.queryByText(/Switched to captions/)).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /translation off/i }));
    expect(c.disable).toHaveBeenCalled();
  });
});

describe('<LanguagePicker />', () => {
  it('shows native names, searches, badges voice/captions and handles RTL', () => {
    const onChange = vi.fn();
    render(<LanguagePicker label="I want to hear" value="hi" onChange={onChange} languages={LANGS} require="voice" />);
    expect(screen.getByText('हिन्दी')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /i want to hear/i }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(5);
    expect(screen.getByText('தமிழ்')).toBeTruthy();
    const urdu = screen.getByText('اردو');
    expect(urdu.getAttribute('dir')).toBe('rtl');
    expect((screen.getByRole('option', { name: /اردو/ })).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getAllByText('Voice').length).toBe(4);

    const search = screen.getByRole('combobox', { name: /search i want to hear/i });
    fireEvent.change(search, { target: { value: 'mara' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('mr');
    // Devanagari font was loaded once, lazily.
    expect(document.head.querySelectorAll('link[data-purplecallio-font="Deva"]')).toHaveLength(1);
  });

  it('fetches /translation/languages when no list is given', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ languages: LANGS }) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LanguagePicker label="My language" value="ta" onChange={() => {}} apiUrl="https://api.example.com/api" loadFonts={false} />);
    await waitFor(() => expect(screen.getByText('தமிழ்')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/translation/languages', undefined);
    expect(document.head.querySelector('link[data-purplecallio-font]')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('<DualViewCaptions />', () => {
  it('renders original + translated, highlights the playing phrase and switches layout', () => {
    render(<Harness><DualViewCaptions /></Harness>);
    const c = latest();
    act(() => c.setPhrases([phrase({ playing: true }), phrase({ phraseId: 'caller-1', speaker: 'caller', mine: true, original: 'Hello', translated: 'नमस्कार', sourceLanguage: 'en', targetLanguage: 'mr', startedAt: 2 })]));
    expect((screen.getByRole('log')).getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('My name is Rahul')).toBeTruthy();
    expect(screen.getByText('माझं नाव राहुल आहे').getAttribute('lang')).toBe('mr');
    const items = screen.getAllByRole('listitem');
    expect((items[0]).getAttribute('aria-current')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Translated' }));
    expect(screen.queryByText('माझं नाव राहुल आहे')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Original' }));
    expect(screen.queryByText('My name is Rahul')).toBeNull();
    expect(screen.getByText('माझं नाव राहुल आहे')).toBeTruthy();
  });

  it('marks flagged phrases with plain reasons, never a percentage, and asks to repeat', () => {
    render(<Harness><DualViewCaptions /></Harness>);
    const c = latest();
    act(() => c.setPhrases([phrase({ flagged: true, guard: { status: 'uncertain', reasons: ['term_mismatch:amount', 'low_asr_confidence'] } })]));
    expect(screen.getByText('May not be accurate — check')).toBeTruthy();
    expect(screen.getByText('An amount may have changed')).toBeTruthy();
    expect(screen.getByRole('note').textContent).not.toMatch(/%/);
    fireEvent.click(screen.getByRole('button', { name: /ask to repeat/i }));
    expect(c.requestRepeat).toHaveBeenCalledWith('receiver-1');
    expect(screen.getByRole('button', { name: /ask to repeat/i }).textContent).toBe('Asked to repeat');
  });

  it('shows "Replay original" only when replay is enabled', () => {
    render(<Harness><DualViewCaptions slowReplay /></Harness>);
    const c = latest();
    act(() => c.setPhrases([phrase()]));
    expect(screen.queryByRole('button', { name: /replay original/i })).toBeNull();
    act(() => c.setState({ replayEnabled: true }));
    fireEvent.click(screen.getByRole('button', { name: /replay original/i }));
    expect(c.replay).toHaveBeenCalledWith('receiver-1', { rate: 0.85 });
  });

  it('uses rtl for Urdu', () => {
    render(<Harness><DualViewCaptions /></Harness>);
    act(() => latest().setPhrases([phrase({ sourceLanguage: 'ur', original: 'میرا نام' })]));
    expect(screen.getByText('میرا نام').getAttribute('dir')).toBe('rtl');
  });
});

describe('<TranslatedChatView />', () => {
  it('splits phrases into bubbles and reveals the original on tap with replay', () => {
    render(<Harness><TranslatedChatView /></Harness>);
    const c = latest();
    act(() => {
      c.setState({ replayEnabled: true });
      c.setPhrases([phrase(), phrase({ phraseId: 'caller-1', speaker: 'caller', mine: true, original: 'Hello', translated: 'नमस्कार' })]);
    });
    expect(screen.getAllByRole('log')).toHaveLength(2);
    const bubble = screen.getByRole('button', { name: /My name is Rahul/ });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(bubble);
    expect(screen.getByRole('tooltip').textContent).toContain('माझं नाव राहुल आहे');
    fireEvent.click(screen.getByRole('button', { name: 'Replay original' }));
    expect(c.replay).toHaveBeenCalledWith('receiver-1', undefined);
  });
});
