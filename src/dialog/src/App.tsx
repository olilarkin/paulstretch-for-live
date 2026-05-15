import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from './state/store';
import { TitleBar } from './components/TitleBar';
import { FileInfoBar } from './components/FileInfoBar';
import { Tabs } from './components/Tabs';
import { ParametersPanel } from './components/ParametersPanel';
import { ProcessPanel } from './components/ProcessPanel';
import { BinauralPanel } from './components/BinauralPanel';
import { WriteToFilePanel } from './components/WriteToFilePanel';
import { TransportBar } from './components/TransportBar';
import { ApplyBar } from './components/ApplyBar';
import { StreamingEngine } from './audio/streaming/engine';
import { syncEngineFromStore } from './audio/streaming/sync';
import {
  audioContextMatches,
  getAudioContext,
  primeAudioContextOnFirstGesture,
  replaceAudioContext,
  resumeAudioContext,
} from './audio/playback';
import { loadAudioFile, sniffWavSampleRate } from './audio/loadFile';
import { getInjectedData, loadInjectedAudio } from './audio/loadInjected';

// Module-level singleton — survives React StrictMode's double-mount.
let activeEngine: StreamingEngine | null = null;
let enginePromise: Promise<StreamingEngine> | null = null;

async function destroyActiveEngine(): Promise<void> {
  if (activeEngine) {
    activeEngine.destroy();
  } else if (enginePromise) {
    try {
      const e = await enginePromise;
      e.destroy();
    } catch {
      // Ignore boot failures; the replacement path will report its own error.
    }
  }
  activeEngine = null;
  enginePromise = null;
}

function createEngine(sampleRate?: number): Promise<StreamingEngine> {
  const ctx = getAudioContext(sampleRate);
  enginePromise = StreamingEngine.create(ctx)
    .then((e) => {
      activeEngine = e;
      return e;
    })
    .catch((err) => {
      activeEngine = null;
      enginePromise = null;
      throw err;
    });
  return enginePromise;
}

async function getEngine(sampleRate?: number): Promise<StreamingEngine> {
  if (activeEngine) {
    if (sampleRate && !audioContextMatches(sampleRate)) {
      await destroyActiveEngine();
      await replaceAudioContext(sampleRate);
      return createEngine(sampleRate);
    }
    return activeEngine;
  }

  if (enginePromise) {
    const e = await enginePromise;
    if (sampleRate && Math.abs(e.audioContext().sampleRate - sampleRate) > 1) {
      await destroyActiveEngine();
      await replaceAudioContext(sampleRate);
      return createEngine(sampleRate);
    }
    return e;
  }

  if (sampleRate && !audioContextMatches(sampleRate)) {
    await replaceAudioContext(sampleRate);
  }
  if (!enginePromise) {
    enginePromise = createEngine(sampleRate);
  }
  return enginePromise;
}

// Resolved once at module load — placeholders are static so the value doesn't
// change mid-session.
const INJECTED = getInjectedData();
const HOST_MODE = INJECTED !== null;

export function App() {
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const processParams = useStore((s) => s.processParams);
  const binauralParams = useStore((s) => s.binauralParams);
  const envelope = useStore((s) => s.envelope);
  const activeTab = useStore((s) => s.activeTab);
  const setSource = useStore((s) => s.setSource);
  const setEngineState = useStore((s) => s.setEngineState);
  const setPlayhead = useStore((s) => s.setPlayhead);

  const engineRef = useRef<StreamingEngine | null>(null);
  const unsubscribeRef = useRef<Array<() => void>>([]);
  const [dragActive, setDragActive] = useState(false);

  const detachEngine = useCallback(() => {
    engineRef.current = null;
    while (unsubscribeRef.current.length > 0) unsubscribeRef.current.pop()?.();
  }, []);

  const attachEngine = useCallback((e: StreamingEngine) => {
    detachEngine();
    engineRef.current = e;
    unsubscribeRef.current.push(e.onReady((info) => {
      console.log('[paulstretch-wasm]', info.backend, info.simdArch, 'simd-width', info.simdSize);
      setEngineState('ready');
      syncEngineFromStore(e);
    }));
    unsubscribeRef.current.push(e.onError((msg) => {
      console.error('[engine error]', msg);
      setEngineState('error', msg);
    }));
    unsubscribeRef.current.push(e.onPosition((cursor, total /*, running */) => {
      setPlayhead(cursor, total);
    }));
    unsubscribeRef.current.push(e.onEnded(() => {
      setEngineState('ready');
    }));
  }, [detachEngine, setEngineState, setPlayhead]);

  // Boot the engine once on first mount, and in host mode load the injected
  // audio immediately so playback is ready as soon as the user hits Play.
  useEffect(() => {
    let cancelled = false;
    setEngineState('loading');
    const bootSampleRate = INJECTED?.sampleRate;
    const t0 = performance.now();
    const step = (label: string) =>
      console.log(`[boot +${Math.round(performance.now() - t0)}ms] ${label}`);
    // Each step that takes >10s gets a warning so we can spot where the boot
    // stalls without needing devtools. The timer is reset every time a step
    // completes; if it fires, we know exactly which await never resolved.
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const arm = (label: string) => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        console.warn(`[boot watchdog] still waiting on: ${label} (>10s)`);
      }, 10_000);
    };
    const disarm = () => {
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    };
    step(`begin (hostMode=${HOST_MODE}, sampleRate=${bootSampleRate ?? '<default>'}, `
      + `audioBytes=${INJECTED?.audioBase64.length ?? 0}b base64)`);
    (async () => {
      try {
        arm('getEngine (WASM + AudioWorklet init)');
        const e = await getEngine(bootSampleRate);
        disarm();
        step('getEngine resolved');
        if (cancelled) return;
        attachEngine(e);
        if (INJECTED) {
          // Don't await resume — Chromium's autoplay policy keeps it pending
          // until a user gesture, which on Windows WebView2 means it hangs
          // the entire boot (on macOS WebKit the modal-open gesture is
          // implicit). We kick it off so it resolves on the next click, then
          // proceed: decodeAudioData works fine on a suspended context.
          void resumeAudioContext(e.audioContext()).then(
            () => step(`audioContext resumed (state=${e.audioContext().state})`),
            (err) => console.warn('[boot] deferred resume rejected:', err),
          );
          primeAudioContextOnFirstGesture(e.audioContext());
          step(`audioContext initial state=${e.audioContext().state}, `
            + `sampleRate=${e.audioContext().sampleRate} (resume deferred to first user gesture)`);
          arm('loadInjectedAudio (decodeAudioData)');
          const src = await loadInjectedAudio(INJECTED, e.audioContext());
          disarm();
          step(`decodeAudioData done: channels=${src.channels.length} `
            + `frames=${src.channels[0]?.length ?? 0} sr=${src.sampleRate} `
            + `durationSec=${src.durationSec.toFixed(3)}`);
          if (!cancelled) setSource(src);
        }
      } catch (err) {
        disarm();
        console.error('[engine boot] failed:', err instanceof Error
          ? `${err.name}: ${err.message}\n${err.stack ?? ''}`
          : String(err));
        setEngineState('error', err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      disarm();
      detachEngine();
    };
  }, [attachEngine, detachEngine, setEngineState, setSource]);

  // Push param changes to the engine.
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setParams(params);
  }, [params]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setProcessParams(processParams);
  }, [processParams]);

  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setBinauralParams(binauralParams);
  }, [binauralParams]);

  // Push envelope changes to the engine.
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setEnvelope(envelope);
  }, [envelope]);

  // Push source to engine when it changes.
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !source) return;
    e.loadSource(source);
  }, [source]);

  const loadFileIntoEngine = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const sampleRate = sniffWavSampleRate(arrayBuffer) ?? undefined;
      setEngineState('loading');
      const e = await getEngine(sampleRate);
      attachEngine(e);
      await resumeAudioContext(e.audioContext());
      const src = await loadAudioFile(file, e.audioContext(), arrayBuffer);
      setSource(src);
    } catch (err) {
      console.error('decode failed', err);
      alert('Failed to decode audio file: ' + (err instanceof Error ? err.message : String(err)));
    }
  }, [attachEngine, setEngineState, setSource]);

  const onDragOver = (ev: React.DragEvent) => {
    if (HOST_MODE) return;
    ev.preventDefault();
    setDragActive(true);
  };
  const onDragLeave = (ev: React.DragEvent) => {
    if (HOST_MODE) return;
    ev.preventDefault();
    setDragActive(false);
  };
  const onDrop = async (ev: React.DragEvent) => {
    if (HOST_MODE) return;
    ev.preventDefault();
    setDragActive(false);
    await loadFileIntoEngine(ev.dataTransfer.files?.[0]);
  };

  return (
    <div
      className={'app' + (dragActive ? ' drag-active' : '')}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <TitleBar onFile={loadFileIntoEngine} showFile={!HOST_MODE} />
      <FileInfoBar hostMode={HOST_MODE} />
      <Tabs hostMode={HOST_MODE} />
      <div className="panel">
        {activeTab === 'Parameters' && <ParametersPanel />}
        {activeTab === 'Process' && <ProcessPanel engineRef={engineRef} />}
        {activeTab === 'Binaural beats' && <BinauralPanel />}
        {activeTab === 'Write to file' && !HOST_MODE && <WriteToFilePanel />}
      </div>
      <TransportBar engineRef={engineRef} />
      {HOST_MODE && <ApplyBar />}
    </div>
  );
}
