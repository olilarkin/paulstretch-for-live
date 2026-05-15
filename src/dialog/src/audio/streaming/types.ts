import type { BinauralParams, Params, ProcessParams, WindowType } from '../../types';
import type { RingHandles } from './ring-buffer';

// ── Worker config (subset of Params, already-resolved) ─────────────────────

export interface StretcherConfig {
  stretch: number;       // resolved multiplier (mode mapping already applied)
  fftSize: number;
  windowType: WindowType;
  onsetSensitivity: number;
}

// Stored on the worker; pulled out so the worker doesn't need to know the
// slider→stretch math.
export interface ResolvedParams extends StretcherConfig {
  // Kept for future telemetry / UI mirroring; not required for the wasm side.
  raw: Params;
}

export interface ProcessConfig {
  options: Omit<ProcessParams, 'arbitraryFilter'> & {
    arbitraryFilterEnabled: boolean;
  };
  arbitraryFilter: {
    enabled: boolean;
    positions: Float32Array;
    values: Float32Array;
  };
}

export interface BinauralConfig {
  options: Omit<BinauralParams, 'frequencyEnvelope'>;
  frequencyEnvelope: {
    positions: Float32Array;
    values: Float32Array;
  };
}

// ── Source descriptor ──────────────────────────────────────────────────────

export interface SourcePayload {
  channels: Float32Array[];   // mono or stereo, at AudioContext sample rate
  sampleRate: number;          // === audioContext.sampleRate
  totalFrames: number;         // == channels[0].length
}

// ── Main → Worker messages ─────────────────────────────────────────────────

export type MainToWorker =
  | { type: 'init'; channelCount: number; sampleRate: number; ring: RingHandles }
  | { type: 'source'; source: SourcePayload }
  | { type: 'params'; config: StretcherConfig }
  | { type: 'process'; config: ProcessConfig }
  | { type: 'binaural'; config: BinauralConfig }
  | {
      type: 'envelope';
      enabled: boolean;
      positions: Float32Array; // already densified by the host
      values: Float32Array;
    }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; positionFrac: number }
  | { type: 'loop'; enabled: boolean }
  | { type: 'shutdown' };

// ── Worker → Main messages ─────────────────────────────────────────────────

export type WorkerToMain =
  | { type: 'ready'; backend: string; simdArch: string; simdSize: number }
  | { type: 'position'; cursor: number; totalFrames: number; running: boolean }
  | { type: 'ended' }
  | { type: 'error'; message: string };

// ── Worklet ↔ Main control (no audio bulk; that goes through the SAB ring) ─

// Main → Worklet: shares the ring handles + bootstrap. Worklet has no
// outbound channel besides node.port back to main; it doesn't talk to the
// worker (audio flows lock-free through the shared ring instead).
export type MainToWorklet =
  | { type: '__ring'; ring: RingHandles };

export type WorkletToMain =
  | { type: 'underrun'; framesMissed: number };
