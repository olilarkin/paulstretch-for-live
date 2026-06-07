// TypeScript types for the Emscripten-generated paulstretch module.
// The .js entry point is an MODULARIZE=1 / EXPORT_ES6=1 factory: call it (with
// optional locateFile) to get a Promise<PaulstretchModule>.

export enum Window {
  Rectangular = 0,
  Hamming = 1,
  Hann = 2,
  Blackman = 3,
  BlackmanHarris = 4,
}

export enum BinauralStereoMode {
  LeftRight = 0,
  RightLeft = 1,
  Symmetric = 2,
}

export interface ProcessOptions {
  pitchShiftEnabled?: boolean;
  pitchShiftCents?: number;
  octaveEnabled?: boolean;
  octaveMinus2?: number;
  octaveMinus1?: number;
  octave0?: number;
  octavePlus1?: number;
  octavePlus15?: number;
  octavePlus2?: number;
  frequencyShiftEnabled?: boolean;
  frequencyShiftHz?: number;
  compressorEnabled?: boolean;
  compressorPower?: number;
  filterEnabled?: boolean;
  filterLowHz?: number;
  filterHighHz?: number;
  filterHighDamp?: number;
  filterStop?: boolean;
  harmonicsEnabled?: boolean;
  harmonicsFrequencyHz?: number;
  harmonicsBandwidthCents?: number;
  harmonicsCount?: number;
  harmonicsGauss?: boolean;
  spreadEnabled?: boolean;
  spreadBandwidth?: number;
  tonalNoiseEnabled?: boolean;
  tonalNoisePreserve?: number;
  tonalNoiseBandwidth?: number;
  arbitraryFilterEnabled?: boolean;
}

export interface BinauralBeatsOptions {
  enabled?: boolean;
  stereoMode?: BinauralStereoMode;
  mono?: number;
  beatFrequencyHz?: number;
}

/** Returned by `renderStereo`. */
export interface StereoBuffer {
  left: Float32Array;
  right: Float32Array;
}

export interface OfflineRenderer {
  /** Upper bound on output frame count for the given input length. */
  estimateOutputFrames(inputFrames: number): number;

  renderMono(input: Float32Array): Float32Array;
  renderStereo(left: Float32Array, right: Float32Array): StereoBuffer;

  /**
   * Chunked offline render — use this instead of `renderMono` for very long
   * outputs (large stretch factors). The whole result of `renderMono` must live
   * in WASM linear memory twice over (the C++ buffer plus the returned copy),
   * so an hour-plus render can exceed the heap cap and abort. `renderMonoChunked`
   * instead invokes `onChunk` with each ~`bufsize` slice; copy/accumulate it on
   * the JS heap (or stream it to disk / an encoder) as it arrives. Peak WASM
   * memory stays bounded regardless of output length. The Float32Array passed to
   * `onChunk` is a fresh JS-heap copy you may keep. Returns the total frame count.
   */
  renderMonoChunked(input: Float32Array, onChunk: (chunk: Float32Array) => void): number;
  renderStereoChunked(
    left: Float32Array,
    right: Float32Array,
    onChunk: (left: Float32Array, right: Float32Array) => void,
  ): number;

  /**
   * Set a time-varying stretch multiplier. Positions are normalized 0..1
   * over the input duration; values are multipliers on the constructor's
   * `stretch` argument. Breakpoints are sorted internally.
   */
  setStretchEnvelope(positions: Float32Array, values: Float32Array): void;
  clearStretchEnvelope(): void;
  setProcessOptions(options: ProcessOptions): void;
  setArbitraryFilter(positions: Float32Array, values: Float32Array): void;
  clearArbitraryFilter(): void;

  /**
   * Free the underlying C++ object. Failure to call this leaks WASM heap
   * memory — embind objects are not garbage-collected.
   */
  delete(): void;
}

export interface OfflineRendererConstructor {
  new (): OfflineRenderer;
  new (
    stretch: number,
    fftSize: number,
    sampleRate: number,
    window: Window,
    onsetDetectionSensitivity: number,
  ): OfflineRenderer;
}

/**
 * Result of one `StreamingStretcher.step()` call: an output chunk of
 * `bufsize()` frames and the onset detection value.
 */
export interface StreamingStep {
  output: Float32Array;
  onset: number;
}

/**
 * Block-based, push/pull stretching primitive for realtime use (e.g. from a
 * Web Worker driving an AudioWorklet via a ring buffer). The protocol is:
 *
 *   1. Construct with the desired RenderOptions arguments.
 *   2. Call `nextInputSize()` to learn how many input frames `step()` wants.
 *      The first call returns `maxInputChunk()` (initial fill); subsequent
 *      calls return either `0` or `bufsize()`.
 *   3. Gather that many input frames (zero-pad if your source ran out).
 *   4. Call `step(input, positionPct)` where `positionPct` is 0..100 for the
 *      input cursor (used to evaluate the stretch envelope). Receive
 *      `{ output, onset }` where output is a Float32Array of `bufsize()`
 *      frames.
 *   5. Advance your input cursor by `skipAfterStep()` frames after `step()`
 *      (in addition to the frames already consumed).
 */
export interface StreamingStretcher {
  /** Frames the next `step()` call expects: `maxInputChunk()` on first call, then `0` or `bufsize()`. */
  nextInputSize(): number;

  /** Output chunk size. Each `step()` returns this many frames. */
  bufsize(): number;

  /** Largest single input chunk (`3 * bufsize()`); used for the initial fill. */
  maxInputChunk(): number;

  /** Frames to skip in the caller's input cursor after `step()` (in addition to consumed frames). */
  skipAfterStep(): number;

  /**
   * Advance one step.
   * - `input`: Float32Array of `nextInputSize()` frames, or null/undefined if no input is needed.
   * - `positionPct`: input cursor as percent 0..100; used to evaluate the stretch envelope.
   */
  step(input: Float32Array | null | undefined, positionPct: number): StreamingStep;

  /**
   * Advance one step without feeding the returned onset back into this
   * stretcher. Multichannel hosts can call this on every channel, take the
   * maximum onset, then call `applyOnset(maxOnset)` on every channel so their
   * input protocol stays aligned.
   */
  stepWithoutOnsetFeedback(input: Float32Array | null | undefined, positionPct: number): StreamingStep;
  applyOnset(onset: number): void;

  setStretchEnvelope(positions: Float32Array, values: Float32Array): void;
  clearStretchEnvelope(): void;
  setProcessOptions(options: ProcessOptions): void;
  setArbitraryFilter(positions: Float32Array, values: Float32Array): void;
  clearArbitraryFilter(): void;

  /** Hot-swap the base stretch factor without resetting DSP state. */
  setStretchFactor(stretch: number): void;

  setOnsetDetectionSensitivity(s: number): void;

  /** Reset internal DSP state (seek/loop). Configuration and envelope are preserved. */
  reset(): void;

  /** Free the underlying C++ object. Failure to call this leaks WASM heap memory. */
  delete(): void;
}

export interface StreamingStretcherConstructor {
  new (
    stretch: number,
    fftSize: number,
    sampleRate: number,
    window: Window,
    onsetDetectionSensitivity: number,
  ): StreamingStretcher;
}

export interface BinauralBeatsResult {
  left: Float32Array;
  right: Float32Array;
}

export interface BinauralBeatsProcessor {
  setOptions(options: BinauralBeatsOptions): void;
  setFrequencyEnvelope(positions: Float32Array, values: Float32Array): void;
  clearFrequencyEnvelope(): void;
  process(left: Float32Array, right: Float32Array, positionPct: number): BinauralBeatsResult;
  reset(): void;
  delete(): void;
}

export interface BinauralBeatsProcessorConstructor {
  new (sampleRate: number): BinauralBeatsProcessor;
}

export interface PaulstretchModule {
  OfflineRenderer: OfflineRendererConstructor;
  StreamingStretcher: StreamingStretcherConstructor;
  BinauralBeatsProcessor: BinauralBeatsProcessorConstructor;
  Window: typeof Window;
  BinauralStereoMode: typeof BinauralStereoMode;
  fftBackendName(): string;
  fftSimdArch(): string;
  fftSimdSize(): number;
}

export interface ModuleFactoryOptions {
  /**
   * Override where the runtime looks for paulstretch.wasm. Useful when the
   * .wasm is served from a different path than the .js, or when bundling
   * for the browser.
   */
  locateFile?: (path: string, scriptDirectory: string) => string;

  /** Emscripten-standard hooks. */
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}

declare const PaulstretchModuleFactory: (
  options?: ModuleFactoryOptions,
) => Promise<PaulstretchModule>;

export default PaulstretchModuleFactory;
