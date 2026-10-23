<script lang="ts">
  /**
   * DualView captions for a `createTranslation()` result: original +
   * translated per phrase, highlighted while its translated audio plays,
   * amber "May not be accurate — check" marker with plain reasons, "Ask to
   * repeat" and (when enabled) "Replay original". Style via `pc-tr-*` classes.
   *
   * ```svelte
   * <TranslationCaptions translation={tr} layout="both" />
   * ```
   */
  import {
    describeGuardReasons,
    fontStackForScript,
    isRtlLanguage,
    lineHeightForScript,
    loadScriptFont,
    scriptForLanguage,
  } from '@purplecallio/sdk';
  import type { PurpleCallioTranslation } from './createTranslation.js';

  export let translation: PurpleCallioTranslation;
  export let layout: 'translated' | 'both' | 'original' = 'both';
  export let maxPhrases = 0;
  export let loadFonts = true;

  const phrasesStore = translation.phrases;
  const stateStore = translation.state;

  $: shown = maxPhrases ? $phrasesStore.slice(-maxPhrases) : $phrasesStore;
  $: if (loadFonts) for (const p of shown) {
    loadScriptFont(scriptForLanguage(p.sourceLanguage));
    loadScriptFont(scriptForLanguage(p.targetLanguage));
  }

  function textStyle(lang: string): string {
    const s = scriptForLanguage(lang);
    return `margin:0;font-family:${fontStackForScript(s).replace(/"/g, "'")};line-height:${lineHeightForScript(s)}`;
  }
  function dir(lang: string): 'rtl' | 'auto' {
    return isRtlLanguage(lang) ? 'rtl' : 'auto';
  }
</script>

<ol class="pc-tr-dualview" role="log" aria-live="polite" aria-label="Live translation captions" style="list-style:none;margin:0;padding:0">
  {#each shown as p (p.phraseId)}
    <li class="pc-tr-phrase" class:pc-tr-playing={p.playing} class:pc-tr-flagged={p.flagged} data-phrase-id={p.phraseId} aria-current={p.playing ? 'true' : undefined}>
      {#if layout !== 'translated' || !p.translated}
        <p class="pc-tr-original" lang={p.sourceLanguage} dir={dir(p.sourceLanguage)} style={textStyle(p.sourceLanguage)}>{p.original}</p>
      {/if}
      {#if layout !== 'original' && p.translated}
        <p class="pc-tr-translated" lang={p.targetLanguage} dir={dir(p.targetLanguage)} style={textStyle(p.targetLanguage)}>{p.translated}</p>
      {/if}
      {#if p.flagged}
        <div class="pc-tr-flag" role="note">
          <strong>May not be accurate — check</strong>
          <ul>
            {#each describeGuardReasons(p.guard?.reasons) as reason}
              <li>{reason}</li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if !p.mine && p.final}
        <div class="pc-tr-actions">
          <button type="button" on:click={() => translation.requestRepeat(p.phraseId)}>{p.repeatRequestedAt ? 'Asked to repeat' : 'Ask to repeat'}</button>
          {#if $stateStore.replayEnabled}
            <button type="button" on:click={() => translation.replay(p.phraseId)}>Replay original</button>
          {/if}
        </div>
      {/if}
    </li>
  {/each}
</ol>
