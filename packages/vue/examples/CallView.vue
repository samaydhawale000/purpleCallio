<!--
  A realistic, self-contained example of wiring up a one-to-one call with
  `@purplecallio/vue`. This is documentation, not a build target — it isn't
  part of the package's own compiled output (see vite.config.ts's `entry`,
  which only builds src/index.ts), and isn't imported by the library's tests.
  Copy it into your app and adapt it.

  Flow: fetch a participant token from YOUR OWN backend -> configure/join the
  call -> render local + remote video -> toggle camera/mic -> leave + cleanup.

  Note on ordering: `usePurpleCallio()` must be called synchronously inside
  `setup()` (it uses `getCurrentInstance()` to register its unmount safety
  net — see the README/composable doc comment), so the token has to already
  be available by the time this component's `setup()` runs. Here that means
  a prop passed down from a parent/route loader that already awaited the
  token fetch, rather than `await`-ing it inside this component itself.
-->
<script setup lang="ts">
import { ref } from 'vue';
import { usePurpleCallio, PurpleCallioVideo } from '@purplecallio/vue';

const props = defineProps<{
  /** Whatever your backend uses to identify this call. */
  callId: string;
  /**
   * A short-lived participant token, already fetched by a parent
   * component/route loader from YOUR OWN backend (which itself calls
   * `@purplecallio/sdk`'s server-side `PurpleCallioClient`, using your API
   * key, to mint it). Never fetched directly from PurpleCallio's API here,
   * and never a PurpleCallio API key — see the README's "Security" section.
   */
  token: string;
}>();

const joining = ref(false);
const error = ref<string | null>(null);

const {
  connectionState,
  participants,
  media,
  remoteStream,
  localStream,
  join,
  leave,
  camera,
  microphone,
} = usePurpleCallio({
  token: props.token,
  callId: props.callId,
  // Your PurpleCallio host: Socket.IO origin, and the REST API under /api.
  signalUrl: 'https://<your-purplecallio-host>',
  apiUrl: 'https://<your-purplecallio-host>/api',
});

async function handleJoin() {
  joining.value = true;
  error.value = null;
  try {
    await join();
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to join the call.';
  } finally {
    joining.value = false;
  }
}

async function handleLeave() {
  await leave();
}
// No manual teardown needed beyond this: usePurpleCallio() already registers
// an onUnmounted() safety net that calls leave() if this component unmounts
// (e.g. the user navigates away) while still connected.
</script>

<template>
  <div class="call-view">
    <p class="status">
      Status: {{ connectionState }}
      <span v-if="error" class="error"> — {{ error }}</span>
    </p>

    <div class="videos">
      <PurpleCallioVideo :stream="localStream" :muted="true" class="video video--local" />
      <PurpleCallioVideo :stream="remoteStream" :muted="false" class="video video--remote" />
    </div>

    <p class="participants">{{ participants.length }} participant(s) connected</p>

    <div class="controls">
      <button
        v-if="connectionState === 'idle' || connectionState === 'disconnected'"
        :disabled="joining"
        @click="handleJoin"
      >
        {{ joining ? 'Joining…' : 'Join call' }}
      </button>

      <template v-else>
        <button @click="camera.toggle()">
          {{ media.camera ? 'Turn camera off' : 'Turn camera on' }}
        </button>
        <button @click="microphone.toggle()">
          {{ media.microphone ? 'Mute microphone' : 'Unmute microphone' }}
        </button>
        <button @click="handleLeave">Leave call</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.videos {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}
.video {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #0d1425;
  border-radius: 8px;
  object-fit: cover;
}
.error {
  color: #c0392b;
}
</style>
