import type {
  AudioSource,
  BinauralParams,
  Envelope,
  Params,
  ProcessParams,
} from '../../types';
import { sliderToStreamingFftSize, sliderToStretch } from '../../state/mappings';
import { densifyLogValuesWithBreakpoints } from '../../components/EnvelopeEditor/interpolation';
import { ringCreate, type RingHandles } from './ring-buffer';
// Vite's `?worker&url` resolves to a URL that points at a JS-transformed,
// separately-bundled file for the worklet. AudioWorklet.addModule then
// loads it as a module. Same URL in dev and prod.
import workletUrl from './stream-worklet.ts?worker&url';
import type { MainToWorker, StretcherConfig, WorkerToMain } from './types';

type PositionListener = (cursor: number, totalFrames: number, running: boolean) => void;
type ErrorListener = (message: string) => void;
type EndedListener = () => void;
type ReadyListener = (info: { backend: string; simdArch: string; simdSize: number }) => void;

// Ring sizing: 2 seconds of audio at 48 kHz × 2 channels ≈ 768 KB. Big enough
// to mask any worker stall up to ~1 second; small enough not to feel laggy
// when the user moves a slider (worker's hot setters land within the next
// 100 ms; the audible delay is at most the ring's pre-buffered duration).
const RING_CAPACITY_FRAMES = 96000;
const RING_CHANNELS = 2;

// 10ms is below the perceptual threshold for "instant" but enough to avoid
// a click when the gain step lands mid-cycle. The ring keeps draining
// underneath, but the user hears silence.
const MUTE_RAMP_SEC = 0.010;

export class StreamingEngine {
  private readonly ctx: AudioContext;
  private readonly worker: Worker;
  private readonly node: AudioWorkletNode;
  // Output gain sits between the worklet and the destination so we can mute
  // instantly on pause/stop without waiting for the SAB ring to drain.
  private readonly gain: GainNode;
  private ready = false;
  private readyInfo: { backend: string; simdArch: string; simdSize: number } | null = null;
  private playing = false;

  private positionListeners = new Set<PositionListener>();
  private errorListeners = new Set<ErrorListener>();
  private endedListeners = new Set<EndedListener>();
  private readyListeners = new Set<ReadyListener>();

  private constructor(ctx: AudioContext, worker: Worker, node: AudioWorkletNode) {
    this.ctx = ctx;
    this.worker = worker;
    this.node = node;
    this.gain = ctx.createGain();
    this.gain.gain.value = 1;
    // node→gain→destination — the `create()` static used to connect node
    // directly to destination; we re-route it here.
    try { node.disconnect(); } catch { /* not yet connected */ }
    node.connect(this.gain);
    this.gain.connect(ctx.destination);

    this.worker.onmessage = (e: MessageEvent<WorkerToMain>) => {
      const m = e.data;
      if (m.type === 'ready') {
        this.ready = true;
        this.readyInfo = { backend: m.backend, simdArch: m.simdArch, simdSize: m.simdSize };
        for (const l of this.readyListeners) l(this.readyInfo);
      } else if (m.type === 'position') {
        for (const l of this.positionListeners) l(m.cursor, m.totalFrames, m.running);
      } else if (m.type === 'ended') {
        this.playing = false;
        for (const l of this.endedListeners) l();
      } else if (m.type === 'error') {
        for (const l of this.errorListeners) l(m.message);
      }
    };
    this.worker.onerror = (e) => {
      for (const l of this.errorListeners) l(e.message || 'Worker error');
    };
  }

  static async create(ctx: AudioContext): Promise<StreamingEngine> {
    if (!globalThis.crossOriginIsolated) {
      throw new Error(
        'StreamingEngine requires cross-origin isolation (SharedArrayBuffer). ' +
          'Serve the page with Cross-Origin-Opener-Policy: same-origin and ' +
          'Cross-Origin-Embedder-Policy: require-corp.',
      );
    }

    await ctx.audioWorklet.addModule(workletUrl);

    const node = new AudioWorkletNode(ctx, 'paulstretch-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [RING_CHANNELS],
    });
    // The constructor wires node → gain → destination so we can mute
    // independently of the SAB drain. Don't connect directly here.

    const worker = new Worker(
      new URL('./stream-worker.ts', import.meta.url),
      { type: 'module' },
    );

    // Single SAB ring shared between worker (producer) and worklet
    // (consumer). The handles are plain transferable-as-clone — the SAB
    // pair lives in shared memory.
    const { handles } = ringCreate(RING_CHANNELS, RING_CAPACITY_FRAMES);

    // Worker side
    worker.postMessage({
      type: 'init',
      channelCount: RING_CHANNELS,
      sampleRate: ctx.sampleRate,
      ring: handles,
    } satisfies MainToWorker);
    // Worklet side — share the same SABs.
    node.port.postMessage({ type: '__ring', ring: handles satisfies RingHandles });

    return new StreamingEngine(ctx, worker, node);
  }

  private send(msg: MainToWorker, transfer?: Transferable[]): void {
    this.worker.postMessage(msg, transfer ?? []);
  }

  onReady(cb: ReadyListener): () => void {
    this.readyListeners.add(cb);
    if (this.readyInfo) cb(this.readyInfo);
    return () => this.readyListeners.delete(cb);
  }
  onPosition(cb: PositionListener): () => void {
    this.positionListeners.add(cb);
    return () => this.positionListeners.delete(cb);
  }
  onError(cb: ErrorListener): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }
  onEnded(cb: EndedListener): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  isReady(): boolean { return this.ready; }
  isPlaying(): boolean { return this.playing; }
  audioContext(): AudioContext { return this.ctx; }
  // Returns the post-mute tap point — what the user actually hears. The
  // spectrum analyser hooks into this so the visual matches the audible
  // signal when paused/stopped.
  outputNode(): AudioNode { return this.gain; }

  private rampGainTo(target: number, durationSec: number = MUTE_RAMP_SEC): void {
    const param = this.gain.gain;
    const now = this.ctx.currentTime;
    // Cancel any in-flight ramp and pin to the actual current value before
    // scheduling the new one. Without this, a rapid pause→play→pause sees
    // the new ramp start from a stale automation value.
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + durationSec);
  }

  loadSource(source: AudioSource): void {
    const channels = source.channels.map((c) => new Float32Array(c));
    this.send(
      {
        type: 'source',
        source: {
          channels,
          sampleRate: source.sampleRate,
          totalFrames: channels[0].length,
        },
      },
      channels.map((c) => c.buffer),
    );
  }

  setParams(params: Params): void {
    const config: StretcherConfig = {
      stretch: sliderToStretch(params.mode, params.stretchSlider),
      fftSize: sliderToStreamingFftSize(params.windowSlider),
      windowType: params.windowType,
      onsetSensitivity: params.onsetSensitivity,
    };
    this.send({ type: 'params', config });
  }

  setProcessParams(processParams: ProcessParams): void {
    const { arbitraryFilter, ...options } = processParams;
    const curve = arbitraryFilter.enabled
      ? densifyLogValuesWithBreakpoints(arbitraryFilter, 512)
      : {
          positions: new Float32Array(0),
          values: new Float32Array(0),
        };

    this.send(
      {
        type: 'process',
        config: {
          options: {
            ...options,
            arbitraryFilterEnabled: arbitraryFilter.enabled,
          },
          arbitraryFilter: {
            enabled: arbitraryFilter.enabled,
            positions: curve.positions,
            values: curve.values,
          },
        },
      },
      [curve.positions.buffer, curve.values.buffer],
    );
  }

  setBinauralParams(binauralParams: BinauralParams): void {
    const { frequencyEnvelope, ...options } = binauralParams;
    const curve = densifyLogValuesWithBreakpoints(frequencyEnvelope, 256);
    this.send(
      {
        type: 'binaural',
        config: {
          options,
          frequencyEnvelope: {
            positions: curve.positions,
            values: curve.values,
          },
        },
      },
      [curve.positions.buffer, curve.values.buffer],
    );
  }

  setEnvelope(envelope: Envelope): void {
    if (envelope.enabled) {
      const { positions, values } = densifyLogValuesWithBreakpoints(envelope, 256);
      this.send(
        { type: 'envelope', enabled: true, positions, values },
        [positions.buffer, values.buffer],
      );
    } else {
      this.send({
        type: 'envelope',
        enabled: false,
        positions: new Float32Array(0),
        values: new Float32Array(0),
      });
    }
  }

  async play(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.rampGainTo(1);
    this.send({ type: 'play' });
    this.playing = true;
  }

  pause(): void {
    // Ramp gain BEFORE telling the worker — the audible response should be
    // immediate, not gated on the worker thread reading the message.
    this.rampGainTo(0);
    this.send({ type: 'pause' });
    this.playing = false;
  }

  stop(): void {
    this.rampGainTo(0);
    this.send({ type: 'stop' });
    this.playing = false;
  }

  seek(frac: number): void {
    this.send({ type: 'seek', positionFrac: frac });
  }

  setLoop(enabled: boolean): void {
    this.send({ type: 'loop', enabled });
  }

  destroy(): void {
    this.send({ type: 'shutdown' });
    try { this.node.disconnect(); } catch { /* ignore */ }
    try { this.gain.disconnect(); } catch { /* ignore */ }
    try { this.worker.terminate(); } catch { /* ignore */ }
  }
}
