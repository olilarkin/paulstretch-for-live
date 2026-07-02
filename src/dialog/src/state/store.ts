import { create } from 'zustand';
import type {
  ActiveTab,
  AudioSource,
  BinauralParams,
  CurvePoint,
  Envelope,
  EnvelopePoint,
  InterpType,
  Params,
  ProcessParams,
  StretchMode,
  WindowType,
} from '../types';

export type EngineState = 'unloaded' | 'loading' | 'ready' | 'playing' | 'error';

interface StoreState {
  activeTab: ActiveTab;
  source: AudioSource | null;
  params: Params;
  processParams: ProcessParams;
  binauralParams: BinauralParams;
  envelope: Envelope;
  engineState: EngineState;
  engineError: string | null;
  // Playback position reported by the streaming engine (in input frames).
  playheadCursor: number;
  playheadTotal: number;

  setSource: (s: AudioSource | null) => void;
  setActiveTab: (tab: ActiveTab) => void;
  setEngineState: (s: EngineState, error?: string | null) => void;
  setPlayhead: (cursor: number, total: number) => void;

  setStretchSlider: (x: number) => void;
  setMode: (m: StretchMode) => void;
  setWindowSlider: (x: number) => void;
  setWindowType: (w: WindowType) => void;
  setOnsetSensitivity: (x: number) => void;
  setProcessParams: (patch: Partial<Omit<ProcessParams, 'arbitraryFilter'>>) => void;
  setArbitraryFilterEnabled: (e: boolean) => void;
  setArbitraryFilterPoints: (pts: CurvePoint[]) => void;
  setArbitraryFilterInterp: (i: InterpType) => void;
  setArbitraryFilterSmoothing: (s: number) => void;
  selectArbitraryFilterPoint: (i: number | null) => void;
  clearArbitraryFilter: () => void;
  setBinauralParams: (patch: Partial<BinauralParams>) => void;
  setBinauralFrequencyPoints: (pts: CurvePoint[]) => void;
  selectBinauralFrequencyPoint: (i: number | null) => void;
  setFlatBinauralFrequency: (hz: number) => void;

  setEnvelopeEnabled: (e: boolean) => void;
  setEnvelopePoints: (pts: EnvelopePoint[]) => void;
  setEnvelopeInterp: (i: InterpType) => void;
  setEnvelopeValueRange: (min: number, max: number) => void;
  setEnvelopeSmoothing: (s: number) => void;
  selectEnvelopePoint: (i: number | null) => void;
  clearEnvelope: () => void;
}

const defaultEnvelope: Envelope = {
  enabled: false,
  points: [
    { position: 0, value: 1, enabled: true },
    { position: 1, value: 1, enabled: true },
  ],
  interp: 'Cosine',
  valueMin: 0.1,
  valueMax: 50,
  smoothing: 0,
  selectedIndex: null,
};

const defaultParams: Params = {
  // The original FLTK app defaults to 0.5 (≈55×), but that's a jarring first
  // result. Default to a gentler 10×: x = (log10(10)/4)^(1/1.2) ≈ 0.315 in the
  // Stretch-mode mapping (see sliderToStretch). Users can still push far higher.
  stretchSlider: 0.315,
  mode: 'Stretch',
  windowSlider: 0.47,
  windowType: 'Hann',
  onsetSensitivity: 0,
};

const defaultProcessParams: ProcessParams = {
  pitchShiftEnabled: false,
  pitchShiftCents: 0,

  octaveEnabled: false,
  octaveMinus2: 0,
  octaveMinus1: 0,
  octave0: 1,
  octavePlus1: 0,
  octavePlus15: 0,
  octavePlus2: 0,

  frequencyShiftEnabled: false,
  frequencyShiftHz: 0,

  compressorEnabled: false,
  compressorPower: 0,

  filterEnabled: false,
  filterLowHz: 0,
  filterHighHz: 22000,
  filterHighDamp: 0,
  filterStop: false,

  harmonicsEnabled: false,
  harmonicsFrequencyHz: 440,
  harmonicsBandwidthCents: 25,
  harmonicsCount: 10,
  harmonicsGauss: false,

  spreadEnabled: false,
  spreadBandwidth: 0.3,

  tonalNoiseEnabled: false,
  tonalNoisePreserve: 0.5,
  tonalNoiseBandwidth: 0.9,

  arbitraryFilter: {
    enabled: false,
    points: [
      { position: 0, value: 1, enabled: true },
      { position: 1, value: 1, enabled: true },
    ],
    interp: 'Linear',
    valueMin: 0.001,
    valueMax: 10,
    smoothing: 0,
    selectedIndex: null,
  },
};

const defaultBinauralParams: BinauralParams = {
  enabled: false,
  stereoMode: 'LeftRight',
  mono: 0.5,
  beatFrequencyHz: 8,
  frequencyEnvelope: {
    enabled: true,
    points: [
      { position: 0, value: 8, enabled: true },
      { position: 1, value: 8, enabled: true },
    ],
    interp: 'Linear',
    valueMin: 0.1,
    valueMax: 50,
    smoothing: 0,
    selectedIndex: null,
  },
};

export const useStore = create<StoreState>((set) => ({
  activeTab: 'Parameters',
  source: null,
  params: defaultParams,
  processParams: defaultProcessParams,
  binauralParams: defaultBinauralParams,
  envelope: defaultEnvelope,
  engineState: 'unloaded',
  engineError: null,
  playheadCursor: 0,
  playheadTotal: 0,

  setSource: (s) => set({ source: s }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setEngineState: (s, error = null) => set({ engineState: s, engineError: error }),
  setPlayhead: (cursor, total) => set({ playheadCursor: cursor, playheadTotal: total }),

  setStretchSlider: (x) => set((st) => ({ params: { ...st.params, stretchSlider: x } })),
  setMode: (m) => set((st) => ({ params: { ...st.params, mode: m } })),
  setWindowSlider: (x) => set((st) => ({ params: { ...st.params, windowSlider: x } })),
  setWindowType: (w) => set((st) => ({ params: { ...st.params, windowType: w } })),
  setOnsetSensitivity: (x) => set((st) => ({ params: { ...st.params, onsetSensitivity: x } })),

  setProcessParams: (patch) =>
    set((st) => ({ processParams: { ...st.processParams, ...patch } })),
  setArbitraryFilterEnabled: (e) =>
    set((st) => ({
      processParams: {
        ...st.processParams,
        arbitraryFilter: { ...st.processParams.arbitraryFilter, enabled: e },
      },
    })),
  setArbitraryFilterPoints: (pts) =>
    set((st) => ({
      processParams: {
        ...st.processParams,
        arbitraryFilter: {
          ...st.processParams.arbitraryFilter,
          points: [...pts].sort((a, b) => a.position - b.position),
        },
      },
    })),
  setArbitraryFilterInterp: (i) =>
    set((st) => ({
      processParams: {
        ...st.processParams,
        arbitraryFilter: { ...st.processParams.arbitraryFilter, interp: i },
      },
    })),
  setArbitraryFilterSmoothing: (s) =>
    set((st) => ({
      processParams: {
        ...st.processParams,
        arbitraryFilter: { ...st.processParams.arbitraryFilter, smoothing: s },
      },
    })),
  selectArbitraryFilterPoint: (i) =>
    set((st) => ({
      processParams: {
        ...st.processParams,
        arbitraryFilter: { ...st.processParams.arbitraryFilter, selectedIndex: i },
      },
    })),
  clearArbitraryFilter: () =>
    set((st) => ({
      processParams: {
        ...st.processParams,
        arbitraryFilter: {
          ...st.processParams.arbitraryFilter,
          points: [
            { position: 0, value: 1, enabled: true },
            { position: 1, value: 1, enabled: true },
          ],
          selectedIndex: null,
        },
      },
    })),
  setBinauralParams: (patch) =>
    set((st) => ({ binauralParams: { ...st.binauralParams, ...patch } })),
  setBinauralFrequencyPoints: (pts) =>
    set((st) => ({
      binauralParams: {
        ...st.binauralParams,
        frequencyEnvelope: {
          ...st.binauralParams.frequencyEnvelope,
          points: [...pts].sort((a, b) => a.position - b.position),
        },
      },
    })),
  selectBinauralFrequencyPoint: (i) =>
    set((st) => ({
      binauralParams: {
        ...st.binauralParams,
        frequencyEnvelope: { ...st.binauralParams.frequencyEnvelope, selectedIndex: i },
      },
    })),
  setFlatBinauralFrequency: (hz) =>
    set((st) => ({
      binauralParams: {
        ...st.binauralParams,
        beatFrequencyHz: hz,
        frequencyEnvelope: {
          ...st.binauralParams.frequencyEnvelope,
          points: [
            { position: 0, value: hz, enabled: true },
            { position: 1, value: hz, enabled: true },
          ],
          selectedIndex: null,
        },
      },
    })),

  setEnvelopeEnabled: (e) => set((st) => ({ envelope: { ...st.envelope, enabled: e } })),
  setEnvelopePoints: (pts) =>
    set((st) => ({
      envelope: { ...st.envelope, points: [...pts].sort((a, b) => a.position - b.position) },
    })),
  setEnvelopeInterp: (i) => set((st) => ({ envelope: { ...st.envelope, interp: i } })),
  setEnvelopeValueRange: (min, max) =>
    set((st) => ({ envelope: { ...st.envelope, valueMin: min, valueMax: max } })),
  setEnvelopeSmoothing: (s) => set((st) => ({ envelope: { ...st.envelope, smoothing: s } })),
  selectEnvelopePoint: (i) => set((st) => ({ envelope: { ...st.envelope, selectedIndex: i } })),
  clearEnvelope: () =>
    set((st) => ({
      envelope: {
        ...st.envelope,
        points: [
          { position: 0, value: 1, enabled: true },
          { position: 1, value: 1, enabled: true },
        ],
        selectedIndex: null,
      },
    })),
}));
