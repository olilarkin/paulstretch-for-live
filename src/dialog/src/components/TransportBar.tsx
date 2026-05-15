import { useEffect, useState, type RefObject } from 'react';
import { useStore } from '../state/store';
import { sliderToStretch } from '../state/mappings';
import type { StreamingEngine } from '../audio/streaming/engine';

interface Props {
  engineRef: RefObject<StreamingEngine | null>;
}

export function TransportBar({ engineRef }: Props) {
  const engineState = useStore((s) => s.engineState);
  const engineError = useStore((s) => s.engineError);
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const cursor = useStore((s) => s.playheadCursor);
  const total = useStore((s) => s.playheadTotal);
  const [playing, setPlaying] = useState(false);

  const frac = total > 0 ? cursor / total : 0;
  const stretch = sliderToStretch(params.mode, params.stretchSlider);
  const inputSec = source ? source.durationSec : 0;
  // Input cursor in seconds.
  const inputCurSec = source && total > 0 ? (cursor / total) * inputSec : 0;
  // Estimated total output duration (input × stretch).
  const outputTotalSec = inputSec * stretch;
  const outputCurSec = frac * outputTotalSec;

  const ready = engineState === 'ready' || engineState === 'playing';
  const canPlay = ready && !!source && !playing;
  const canPause = playing;
  const canStop = !!source;

  const handlePlay = async () => {
    const e = engineRef.current;
    if (!e) return;
    await e.play();
    setPlaying(true);
  };
  const handlePause = () => {
    engineRef.current?.pause();
    setPlaying(false);
  };
  const handleStop = () => {
    engineRef.current?.stop();
    setPlaying(false);
  };
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = parseFloat(e.target.value);
    engineRef.current?.seek(f);
  };

  // Spacebar toggles play/pause, unless typing in a form control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      }
      if (!source) return;
      e.preventDefault();
      if (playing) {
        handlePause();
      } else if (ready) {
        void handlePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, ready, source]);

  return (
    <div className="transport">
      <div className="transport-buttons">
        <button onClick={handlePlay} disabled={!canPlay} title="Play (Space)">▶</button>
        <button onClick={handlePause} disabled={!canPause} title="Pause (Space)">❚❚</button>
        <button onClick={handleStop} disabled={!canStop} title="Stop" className="stop-btn" aria-label="Stop">
          <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" fill="currentColor" /></svg>
        </button>
      </div>
      <div className="position-readout">{(frac * 100).toFixed(2)}</div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.0001}
        value={frac}
        onChange={handleSeek}
        className="position-slider"
        disabled={!source}
      />
      <div className="time-readout">
        in: {fmt(inputCurSec)} / {fmt(inputSec)} · out: {fmt(outputCurSec)} / {fmt(outputTotalSec)}
      </div>
      <div className="status">
        <span className={'status-dot ' + (engineState === 'playing' ? 'done' : engineState)}></span>
        {engineState === 'loading' && 'loading wasm…'}
        {engineState === 'ready' && (playing ? 'playing' : 'ready')}
        {engineState === 'unloaded' && 'idle'}
        {engineState === 'error' && (engineError ?? 'error')}
      </div>
    </div>
  );
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '--:--';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
