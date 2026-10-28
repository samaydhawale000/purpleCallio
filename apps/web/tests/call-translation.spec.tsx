import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
   CaptionsOverlay,
   TranslationPanel,
   translationDefaultsFromDetails,
   useCallTranslation,
   type CallTranslation,
} from "../app/call/translation";

const theme = {
   isDark: true,
   primary: "#7C3AED",
   textPrimary: "#fff",
   textSecondary: "#ccc",
   borderColor: "#333",
   surfaceBg: "#111",
   shellBg: "#000",
};

function phrase(over: Record<string, unknown> = {}) {
   return {
      phraseId: "receiver-1",
      speaker: "receiver",
      sourceLanguage: "mr",
      targetLanguage: "en",
      original: "माझं नाव राहुल आहे",
      translated: "My name is Rahul",
      final: true,
      startedAt: 1,
      flagged: false,
      playing: false,
      mine: false,
      ...over,
   } as any;
}

function fakeTranslation(over: Partial<CallTranslation> = {}): CallTranslation {
   return {
      state: {
         status: "ready", mode: "voice", role: "caller", you: { speak: "en", hear: "en" }, peer: null,
         replayEnabled: false, guard: null, limits: null, trial: false, speaking: false,
         playingPhraseId: null, originalVolume: 0.2, audioBlocked: false, limit: null, error: null,
      },
      phrases: [],
      repeatRequests: [],
      enabled: true,
      prefs: { speak: "en", hear: "hi", mode: "voice", originalVolume: 0.2 },
      setMode: vi.fn(),
      setLanguages: vi.fn(),
      setOriginalVolume: vi.fn(),
      replay: vi.fn(() => true),
      requestRepeat: vi.fn(() => true),
      dismissRepeatRequest: vi.fn(),
      disable: vi.fn(),
      followCall: vi.fn(),
      resumeAudio: vi.fn(),
      ...over,
   };
}

/** Minimal TranslationClient stand-in for the page hook. */
class FakeClient {
   static instances: FakeClient[] = [];
   state: any = { status: "idle", mode: "off", you: { speak: "", hear: "" } };
   phrases: any[] = [];
   listeners = new Map<string, Set<(p: any) => void>>();
   enable = vi.fn(async (o: any) => {
      this.set({ status: "ready", mode: o.mode, you: { speak: o.speak, hear: o.hear } });
      return {} as any;
   });
   disable = vi.fn((_o?: { share?: boolean }) => this.set({ status: "ended" }));
   followCall = vi.fn((mode: string) =>
      this.set(mode === "off" ? { status: "ended" } : { status: "ready", mode, you: this.languages }),
   );
   languages = { speak: "", hear: "" };
   setMode = vi.fn();
   setLanguages = vi.fn((l: { speak?: string; hear?: string }) => {
      this.languages = { ...this.languages, ...l } as any;
   });
   setOriginalVolume = vi.fn();
   replay = vi.fn(() => true);
   requestRepeat = vi.fn(() => true);
   constructor(public config: any) {
      FakeClient.instances.push(this);
   }
   getState() {
      return this.state;
   }
   on(e: string, fn: (p: any) => void) {
      if (!this.listeners.has(e)) this.listeners.set(e, new Set());
      this.listeners.get(e)!.add(fn);
      return () => this.listeners.get(e)?.delete(fn);
   }
   set(patch: any) {
      this.state = { ...this.state, ...patch };
      this.listeners.get("state")?.forEach((fn) => fn(this.state));
   }
}

beforeEach(() => {
   FakeClient.instances.length = 0;
   // Languages endpoint unavailable → the built-in fallback list is used.
   vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});

afterEach(() => {
   vi.unstubAllGlobals();
});

describe("translationDefaultsFromDetails", () => {
   it("reads translation.mode and this participant's language", () => {
      expect(
         translationDefaultsFromDetails({
            participantId: "u1", callerId: "u1", receiverId: "u2",
            translation: { mode: "voice", config: {} },
            participants: [{ id: "u1", role: "CALLER", language: "mr" }, { id: "u2", role: "RECEIVER", language: "en" }],
         }),
      ).toEqual({ mode: "voice", language: "mr", role: "caller" });
      expect(
         translationDefaultsFromDetails({ participantId: "u2", callerId: "u1", receiverId: "u2", callerLanguage: "en", receiverLanguage: "ta", translation: { mode: "CAPTIONS" } }),
      ).toEqual({ mode: "captions", language: "ta", role: "receiver" });
   });

   it("returns null for calls without translation info", () => {
      expect(translationDefaultsFromDetails({ participantId: "u1", callerId: "u1" })).toBeNull();
   });
});

describe("useCallTranslation", () => {
   const base = {
      token: "bj_session_t",
      serverUrl: "http://localhost:3005",
      getRemoteElements: () => [],
      getLocalStream: () => null,
      createClient: (c: any) => new FakeClient(c) as any,
   };

   it("stays idle (no connection) until the user turns it on", async () => {
      const { result } = renderHook(() => useCallTranslation({ ...base, active: true, defaults: null }));
      expect(FakeClient.instances).toHaveLength(0);
      expect(result.current.enabled).toBe(false);
      act(() => result.current.setLanguages({ speak: "en", hear: "hi" }));
      await act(async () => result.current.setMode("captions"));
      const c = FakeClient.instances[0];
      expect(c.config).toMatchObject({ token: "bj_session_t", serverUrl: "http://localhost:3005", originalVolume: 0 });
      expect(c.enable).toHaveBeenCalledWith({ speak: "en", hear: "hi", mode: "captions", originalVolume: 0 });
      expect(result.current.enabled).toBe(true);
      act(() => result.current.setMode("off"));
      expect(c.disable).toHaveBeenCalled();
   });

   it("follows the call's translation defaults once in-call, and leaves only this side when the call ends", async () => {
      const defaults = { mode: "voice" as const, language: "mr", role: "caller" as const };
      const hook = renderHook((p: { active: boolean }) => useCallTranslation({ ...base, active: p.active, defaults }), {
         initialProps: { active: false },
      });
      expect(FakeClient.instances).toHaveLength(0);
      await act(async () => hook.rerender({ active: true }));
      const c = FakeClient.instances[0];
      expect(c.setLanguages).toHaveBeenCalledWith({ speak: "mr", hear: "mr" });
      expect(c.followCall).toHaveBeenCalledWith("voice");
      expect(c.enable).not.toHaveBeenCalled();
      await act(async () => hook.rerender({ active: false }));
      expect(c.disable).toHaveBeenCalledWith({ share: false });
   });

   it("applies a switch announced before the call is up, and follows the other side turning it off", async () => {
      const hook = renderHook((p: { active: boolean }) => useCallTranslation({ ...base, active: p.active, defaults: null }), {
         initialProps: { active: false },
      });
      act(() => hook.result.current.followCall("captions"));
      expect(FakeClient.instances).toHaveLength(0);
      await act(async () => hook.rerender({ active: true }));
      const c = FakeClient.instances[0];
      expect(c.followCall).toHaveBeenCalledWith("captions");
      expect(hook.result.current.enabled).toBe(true);
      act(() => hook.result.current.followCall("off"));
      expect(c.followCall).toHaveBeenLastCalledWith("off");
      expect(hook.result.current.enabled).toBe(false);
   });

   it("shares the switch for the whole call with PATCH /calls/:id/translation", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      vi.stubGlobal("fetch", fetchMock);
      const defaults = { mode: "off" as const, language: "mr", role: "receiver" as const };
      const { result } = renderHook(() =>
         useCallTranslation({ ...base, active: true, defaults, callId: "c 1", apiUrl: "http://api.test/api/" }),
      );
      await act(async () => result.current.setMode("voice"));
      const c = FakeClient.instances[0];
      await c.config.shareSwitch({ mode: "voice", speak: "mr", hear: "mr", peerPresent: false });
      const [url, init] = fetchMock.mock.calls.at(-1) as any;
      expect(url).toBe("http://api.test/api/calls/c%201/translation");
      expect(init.method).toBe("PATCH");
      expect(init.headers.Authorization).toBe("Bearer bj_session_t");
      expect(JSON.parse(init.body)).toEqual({ mode: "voice", receiverLanguage: "mr" });

      fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ code: "TRANSLATION_INSUFFICIENT_CREDITS", message: "Add credits" }) } as any);
      await expect(c.config.shareSwitch({ mode: "voice", peerPresent: true })).rejects.toMatchObject({
         code: "TRANSLATION_INSUFFICIENT_CREDITS",
      });
   });
});

describe("TranslationPanel", () => {
   it("has language pickers with native names, mode switch, volume, replay indicator, limit and tip", async () => {
      const tr = fakeTranslation({
         state: { ...fakeTranslation().state!, replayEnabled: true, limit: { kind: "warning", scope: "call", message: "Translation is close to the call limit", remainingSeconds: 120 } },
      });
      render(<TranslationPanel translation={tr} apiUrl="http://api" theme={theme} splitView={false} onSplitViewChange={vi.fn()} onClose={vi.fn()} />);
      expect(screen.getByRole("dialog", { name: "Live Translate" })).toBeTruthy();
      expect(screen.getByText("हिन्दी")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /my language/i }));
      expect(screen.getByText("தமிழ்")).toBeTruthy();
      const urdu = screen.getByText("اردو");
      expect(urdu.getAttribute("dir")).toBe("rtl");
      const search = screen.getByRole("combobox", { name: /search my language/i });
      fireEvent.change(search, { target: { value: "marathi" } });
      fireEvent.keyDown(search, { key: "Enter" });
      expect(tr.setLanguages).toHaveBeenCalledWith({ speak: "mr" });

      fireEvent.click(screen.getByRole("radio", { name: /translation captions/i }));
      expect(tr.setMode).toHaveBeenCalledWith("captions");
      fireEvent.change(screen.getByLabelText("Original voice volume while it is translated"), { target: { value: "50" } });
      expect(tr.setOriginalVolume).toHaveBeenCalledWith(0.5);
      expect(screen.getByTestId("replay-enabled")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toContain("2 min left");
      expect(screen.getByText(/use headphones/i)).toBeTruthy();
   });

   it("uses server languages with voice/captions badges when available", async () => {
      vi.stubGlobal(
         "fetch",
         vi.fn(async () => ({
            ok: true,
            json: async () => ({ languages: [{ code: "sat", name: "Santali", nativeName: "ᱥᱟᱱᱛᱟᱲᱤ", script: "Olck", rtl: false, voice: false, captions: true }] }),
         })),
      );
      const tr = fakeTranslation({ prefs: { speak: "sat", hear: "sat", mode: "voice", originalVolume: 0.2 } });
      render(<TranslationPanel translation={tr} apiUrl="http://api-2" theme={theme} splitView={false} onSplitViewChange={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getAllByText("ᱥᱟᱱᱛᱟᱲᱤ").length).toBeGreaterThan(0));
      fireEvent.click(screen.getByRole("button", { name: /i want to hear/i }));
      // Voice mode: a captions-only language can't be the "hear" language.
      expect(screen.getByRole("option", { name: /Santali/ }).getAttribute("aria-disabled")).toBe("true");
      const option = screen.getByRole("option", { name: /Santali/ });
      expect(option.textContent).toContain("Captions");
      expect(option.textContent).not.toContain("Voice");
   });
});

describe("CaptionsOverlay", () => {
   it("renders nothing while translation is off and there are no phrases", () => {
      const { container } = render(<CaptionsOverlay translation={fakeTranslation({ enabled: false })} splitView={false} primary="#7C3AED" />);
      expect(container.innerHTML).toBe("");
   });

   it("shows DualView lines, highlights the voiced phrase, flags in plain words and asks to repeat", () => {
      const tr = fakeTranslation({
         phrases: [
            phrase({ playing: true, flagged: true, guard: { status: "uncertain", reasons: ["term_mismatch:amount"] } }),
            phrase({ phraseId: "caller-1", speaker: "caller", mine: true, original: "Hello", translated: "नमस्कार", sourceLanguage: "en", targetLanguage: "mr", startedAt: 2 }),
         ],
      });
      render(<CaptionsOverlay translation={tr} splitView={false} primary="#7C3AED" />);
      expect(screen.getByRole("log").getAttribute("aria-live")).toBe("polite");
      expect(screen.getByText("My name is Rahul")).toBeTruthy();
      expect(screen.getByText("माझं नाव राहुल आहे").getAttribute("lang")).toBe("mr");
      const voiced = screen.getAllByRole("listitem")[0];
      expect(voiced.getAttribute("aria-current")).toBe("true");
      const note = screen.getByRole("note");
      expect(note.textContent).toContain("May not be accurate — check");
      expect(note.textContent).toContain("An amount may have changed");
      expect(note.textContent).not.toMatch(/%/);
      expect(screen.queryByRole("button", { name: /replay original/i })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /ask to repeat/i }));
      expect(tr.requestRepeat).toHaveBeenCalledWith("receiver-1");
      expect(screen.getByRole("button", { name: /ask to repeat/i }).textContent).toBe("Asked to repeat");

      fireEvent.click(screen.getByRole("radio", { name: "Translated" }));
      expect(screen.queryByText("माझं नाव राहुल आहे")).toBeNull();
   });

   it("offers replay (normal and slower) only when enabled", () => {
      const tr = fakeTranslation({ phrases: [phrase()], state: { ...fakeTranslation().state!, replayEnabled: true } });
      render(<CaptionsOverlay translation={tr} splitView={false} primary="#7C3AED" />);
      fireEvent.click(screen.getByRole("button", { name: /^replay original:/i }));
      expect(tr.replay).toHaveBeenCalledWith("receiver-1");
      fireEvent.click(screen.getByRole("button", { name: /replay original slower/i }));
      expect(tr.replay).toHaveBeenLastCalledWith("receiver-1", 0.85);
   });

   it("shows repeat requests to the speaker and the split chat view with the original on tap", () => {
      const tr = fakeTranslation({
         phrases: [phrase()],
         repeatRequests: [{ phraseId: "caller-1", original: "five hundred", prompt: "Could you say that again?" }],
         state: { ...fakeTranslation().state!, replayEnabled: true },
      });
      render(<CaptionsOverlay translation={tr} splitView primary="#7C3AED" />);
      expect(screen.getByRole("alert").textContent).toContain("Could you say that again?");
      fireEvent.click(screen.getByRole("button", { name: /dismiss repeat request/i }));
      expect(tr.dismissRepeatRequest).toHaveBeenCalledWith("caller-1");

      fireEvent.click(screen.getByRole("button", { name: /My name is Rahul/ }));
      expect(screen.getByRole("tooltip").textContent).toContain("माझं नाव राहुल आहे");
      fireEvent.click(screen.getByRole("button", { name: "Replay original" }));
      expect(tr.replay).toHaveBeenCalledWith("receiver-1");
   });
});
