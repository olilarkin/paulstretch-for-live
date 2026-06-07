import type { BinauralStereoMode, WindowType } from '../../types';

interface RenderProcessOptions {
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
}

export interface RenderJob {
  jobId: number;
  sampleRate: number;
  channels: Float32Array[]; // 1 (mono) or 2 (stereo)
  stretch: number;
  fftSize: number;
  windowType: WindowType;
  onsetSensitivity: number;
  processOptions: RenderProcessOptions;
  arbitraryFilter: {
    enabled: boolean;
    positions: Float32Array;
    values: Float32Array;
  };
  stretchEnvelope: {
    positions: Float32Array;
    values: Float32Array;
  } | null;
  binaural: {
    enabled: boolean;
    stereoMode: BinauralStereoMode;
    mono: number;
    beatFrequencyHz: number;
    frequencyEnvelope: {
      positions: Float32Array;
      values: Float32Array;
    };
  };
}

export type RenderMainToWorker =
  | { type: 'init' }
  | ({ type: 'render' } & RenderJob);

export type RenderWorkerToMain =
  | { type: 'ready' }
  | { type: 'progress'; jobId: number; fraction: number }
  | {
      type: 'rendered';
      jobId: number;
      channels: Float32Array[];
      sampleRate: number;
    }
  | { type: 'error'; jobId?: number; message: string };
