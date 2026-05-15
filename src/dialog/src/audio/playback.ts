let ctx: AudioContext | null = null;

function createAudioContext(sampleRate?: number): AudioContext {
  if (sampleRate && Number.isFinite(sampleRate) && sampleRate > 0) {
    try {
      return new AudioContext({ sampleRate });
    } catch {
      // Some browsers may reject uncommon rates. Fall back to the device rate;
      // decodeAudioData will then resample consistently to this context.
    }
  }
  return new AudioContext();
}

export function getAudioContext(sampleRate?: number): AudioContext {
  if (!ctx) ctx = createAudioContext(sampleRate);
  return ctx;
}

export function audioContextMatches(sampleRate: number, toleranceHz = 1): boolean {
  return !!ctx && Math.abs(ctx.sampleRate - sampleRate) <= toleranceHz;
}

export async function replaceAudioContext(sampleRate?: number): Promise<AudioContext> {
  const old = ctx;
  ctx = createAudioContext(sampleRate);
  if (old && old.state !== 'closed') {
    try { await old.close(); } catch { /* ignore */ }
  }
  return ctx;
}

export async function resumeAudioContext(context: AudioContext = getAudioContext()): Promise<void> {
  const c = context;
  if (c.state === 'suspended') await c.resume();
}

// On Chromium (Windows WebView2), `AudioContext.resume()` only resolves after
// a user gesture. Boot can't await it without hanging. Instead we proactively
// resume on the first interaction anywhere in the document so by the time
// the user hits Play, the context is already running.
let primed = false;
export function primeAudioContextOnFirstGesture(context: AudioContext = getAudioContext()): void {
  if (primed) return;
  primed = true;
  const handler = () => {
    void context.resume().catch(() => { /* ignore — Play handler will retry */ });
    window.removeEventListener('pointerdown', handler, true);
    window.removeEventListener('keydown', handler, true);
  };
  window.addEventListener('pointerdown', handler, true);
  window.addEventListener('keydown', handler, true);
}
