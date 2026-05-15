import { describe, expect, it } from 'vitest';
import { syncEngineFromStore } from './sync';
import { useStore } from '../../state/store';
import type { AudioSource, BinauralParams, Envelope, Params, ProcessParams } from '../../types';

class FakeEngine {
  params: Params | null = null;
  processParams: ProcessParams | null = null;
  binauralParams: BinauralParams | null = null;
  envelope: Envelope | null = null;
  source: AudioSource | null = null;

  setParams(params: Params): void {
    this.params = params;
  }

  setProcessParams(processParams: ProcessParams): void {
    this.processParams = processParams;
  }

  setBinauralParams(binauralParams: BinauralParams): void {
    this.binauralParams = binauralParams;
  }

  setEnvelope(envelope: Envelope): void {
    this.envelope = envelope;
  }

  loadSource(source: AudioSource): void {
    this.source = source;
  }
}

describe('syncEngineFromStore', () => {
  it('replays the latest source, params, and envelope after async engine boot', () => {
    const previous = useStore.getState();
    const source: AudioSource = {
      name: 'boot-race.wav',
      sampleRate: 48000,
      durationSec: 1,
      channels: [new Float32Array(48000)],
    };
    const params: Params = {
      stretchSlider: 0.7,
      mode: 'HyperStretch',
      windowSlider: 0.4,
      windowType: 'Blackman',
      onsetSensitivity: 0.2,
    };
    const envelope: Envelope = {
      enabled: true,
      points: [
        { position: 0, value: 1, enabled: true },
        { position: 1, value: 2, enabled: true },
      ],
      interp: 'Linear',
      valueMin: 0.1,
      valueMax: 50,
      smoothing: 0,
      selectedIndex: null,
    };

    try {
      useStore.setState({ source, params, envelope });

      const engine = new FakeEngine();
      syncEngineFromStore(engine);

      expect(engine.params).toEqual(params);
      expect(engine.processParams).toBe(useStore.getState().processParams);
      expect(engine.binauralParams).toBe(useStore.getState().binauralParams);
      expect(engine.envelope).toEqual(envelope);
      expect(engine.source).toBe(source);
    } finally {
      useStore.setState(previous, true);
    }
  });
});
