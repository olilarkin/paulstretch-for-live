// Minimal type stubs for the Emscripten-compiled paulstretch WASM module.
// Mirrors the API surface used by paulstretch's streaming and render
// workers — not a complete binding to the underlying C++ classes.

export type WindowEnumValue = number;
export type BinauralStereoModeEnumValue = number;

export interface WindowEnum {
  readonly Rectangular: WindowEnumValue;
  readonly Hamming: WindowEnumValue;
  readonly Hann: WindowEnumValue;
  readonly Blackman: WindowEnumValue;
  readonly BlackmanHarris: WindowEnumValue;
}

export interface BinauralStereoModeEnum {
  readonly LeftRight: BinauralStereoModeEnumValue;
  readonly RightLeft: BinauralStereoModeEnumValue;
  readonly Symmetric: BinauralStereoModeEnumValue;
}

export interface ProcessOptions {
  pitchShiftEnabled: boolean;
  pitchShiftCents: number;

  octaveEnabled: boolean;
  octaveMinus2: number;
  octaveMinus1: number;
  octave0: number;
  octavePlus1: number;
  octavePlus15: number;
  octavePlus2: number;

  frequencyShiftEnabled: boolean;
  frequencyShiftHz: number;

  compressorEnabled: boolean;
  compressorPower: number;

  filterEnabled: boolean;
  filterLowHz: number;
  filterHighHz: number;
  filterHighDamp: number;
  filterStop: boolean;

  harmonicsEnabled: boolean;
  harmonicsFrequencyHz: number;
  harmonicsBandwidthCents: number;
  harmonicsCount: number;
  harmonicsGauss: boolean;

  spreadEnabled: boolean;
  spreadBandwidth: number;

  tonalNoiseEnabled: boolean;
  tonalNoisePreserve: number;
  tonalNoiseBandwidth: number;

  arbitraryFilterEnabled: boolean;
}

export interface BinauralOptions {
  enabled: boolean;
  stereoMode: BinauralStereoModeEnumValue;
  mono: number;
  beatFrequencyHz: number;
}

export interface StereoChunk {
  left: Float32Array;
  right: Float32Array;
}

export interface StreamingStretcher {
  setStretchFactor(factor: number): void;
  setOnsetDetectionSensitivity(sensitivity: number): void;
  setStretchEnvelope(positions: Float32Array, values: Float32Array): void;
  clearStretchEnvelope(): void;
  setProcessOptions(options: ProcessOptions): void;
  setArbitraryFilter(positions: Float32Array, values: Float32Array): void;
  clearArbitraryFilter(): void;
  maxInputChunk(): number;
  nextInputSize(): number;
  stepWithoutOnsetFeedback(
    input: Float32Array | null,
    positionPct: number,
  ): { output: Float32Array; onset: number };
  applyOnset(maxOnset: number): void;
  skipAfterStep(): number;
  reset(): void;
  delete(): void;
}

export interface StreamingStretcherCtor {
  new (
    stretch: number,
    fftSize: number,
    sampleRate: number,
    windowType: WindowEnumValue,
    onsetSensitivity: number,
  ): StreamingStretcher;
}

export interface OfflineRenderer {
  setStretchEnvelope(positions: Float32Array, values: Float32Array): void;
  setProcessOptions(options: ProcessOptions): void;
  setArbitraryFilter(positions: Float32Array, values: Float32Array): void;
  renderMono(input: Float32Array): Float32Array;
  renderStereo(left: Float32Array, right: Float32Array): StereoChunk;
  delete(): void;
}

export interface OfflineRendererCtor {
  new (
    stretch: number,
    fftSize: number,
    sampleRate: number,
    windowType: WindowEnumValue,
    onsetSensitivity: number,
  ): OfflineRenderer;
}

export interface BinauralBeatsProcessor {
  setOptions(options: BinauralOptions): void;
  setFrequencyEnvelope(positions: Float32Array, values: Float32Array): void;
  clearFrequencyEnvelope(): void;
  process(left: Float32Array, right: Float32Array, positionPct: number): StereoChunk;
  reset(): void;
  delete(): void;
}

export interface BinauralBeatsProcessorCtor {
  new (sampleRate: number): BinauralBeatsProcessor;
}

export interface PaulstretchModule {
  Window: WindowEnum;
  BinauralStereoMode: BinauralStereoModeEnum;
  StreamingStretcher: StreamingStretcherCtor;
  OfflineRenderer: OfflineRendererCtor;
  BinauralBeatsProcessor: BinauralBeatsProcessorCtor;
  fftBackendName(): string;
  fftSimdArch(): string;
  fftSimdSize(): number;
}

export interface ModuleInitOptions {
  locateFile?: (path: string, prefix: string) => string;
  wasmBinary?: ArrayBuffer | Uint8Array;
}

declare const PaulstretchModuleFactory: (options?: ModuleInitOptions) => Promise<PaulstretchModule>;
export default PaulstretchModuleFactory;
