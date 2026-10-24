/**
 * Mic capture AudioWorklet, inlined as source so it loads from a Blob URL and
 * works with any bundler. It only batches raw float samples (~20 ms at the
 * context rate) and posts them to the main thread, where the tested
 * resampler and PCM16 code run.
 */
export const CAPTURE_PROCESSOR_NAME = 'purplecallio-ai-capture';

const CAPTURE_WORKLET_SOURCE = `
class PurpleCallioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.max(128, Math.round(sampleRate / 50));
    this.buf = new Float32Array(this.size);
    this.length = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const n = Math.min(channel.length - offset, this.size - this.length);
      this.buf.set(channel.subarray(offset, offset + n), this.length);
      this.length += n;
      offset += n;
      if (this.length === this.size) {
        const chunk = this.buf;
        this.port.postMessage(chunk, [chunk.buffer]);
        this.buf = new Float32Array(this.size);
        this.length = 0;
      }
    }
    return true;
  }
}
registerProcessor('${CAPTURE_PROCESSOR_NAME}', PurpleCallioCaptureProcessor);
`;

/** Registers the capture processor on `ctx`; the Blob URL is revoked after. */
export async function loadCaptureWorklet(ctx: AudioContext): Promise<void> {
  const url = URL.createObjectURL(
    new Blob([CAPTURE_WORKLET_SOURCE], { type: 'application/javascript' }),
  );
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
