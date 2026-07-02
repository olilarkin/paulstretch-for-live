// Maps low-level WASM failures to messages a user can act on. Emscripten's
// abort() throws a WebAssembly.RuntimeError whose message is the raw
// "Aborted(). Build with -sASSERTIONS for more info." — which is what surfaced
// in issue #2 (OOM on very long output) and issue #6 (SIMD module fails to
// compile). Neither should ever reach the UI verbatim.

const OOM_PATTERNS = [
  'aborted',
  'out of memory',
  'oom',
  'cannot enlarge memory',
  'memory access out of bounds',
  'array buffer allocation failed',
  'maximum call stack',
];

const COMPILE_PATTERNS = ['compileerror', "doesn't parse", 'wasm module', 'function local'];

/**
 * Turn an arbitrary render/streaming error into a user-facing message. OOM/abort
 * becomes a "too large" hint; a compile failure (e.g. a WebView that can't load
 * the engine at all) becomes a load-error hint; anything else passes through.
 */
export function describeWasmError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lc = raw.toLowerCase();

  if (OOM_PATTERNS.some((p) => lc.includes(p))) {
    return 'Ran out of memory — the output is too large to render. Try a smaller stretch factor or a shorter selection.';
  }
  // A RuntimeError with an empty "Aborted()" message can slip past the text
  // match; treat a RuntimeError with no useful text as OOM too.
  if (err instanceof WebAssembly.RuntimeError && lc.trim() === '') {
    return 'Ran out of memory — the output is too large to render. Try a smaller stretch factor or a shorter selection.';
  }
  if (err instanceof WebAssembly.CompileError || COMPILE_PATTERNS.some((p) => lc.includes(p))) {
    return 'Could not load the audio engine (WebAssembly failed to compile). Please report this with your OS and Ableton Live version.';
  }
  return raw;
}
