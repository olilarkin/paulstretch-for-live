import { useStore } from '../../state/store';
import type { AudioSource, BinauralParams, Envelope, Params, ProcessParams } from '../../types';

export interface StoreSyncedEngine {
  setParams(params: Params): void;
  setProcessParams(processParams: ProcessParams): void;
  setBinauralParams(binauralParams: BinauralParams): void;
  setEnvelope(envelope: Envelope): void;
  loadSource(source: AudioSource): void;
}

export function syncEngineFromStore(engine: StoreSyncedEngine): void {
  const { params, processParams, binauralParams, envelope, source } = useStore.getState();
  engine.setParams(params);
  engine.setProcessParams(processParams);
  engine.setBinauralParams(binauralParams);
  engine.setEnvelope(envelope);
  if (source) engine.loadSource(source);
}
