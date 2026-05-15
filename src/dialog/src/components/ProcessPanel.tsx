import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { useStore } from '../state/store';
import type { CurvePoint } from '../types';
import type { StreamingEngine } from '../audio/streaming/engine';
import { densifyLogValuesWithBreakpoints } from './EnvelopeEditor/interpolation';

const W = 760;
const H = 180;
const PAD = 8;
const HANDLE_RADIUS_PX = 5;
const FILTER_MIN_HZ = 20;
const FILTER_MAX_HZ = 25000;
const FILTER_MIN_DB = -60;
const FILTER_MAX_DB = 20;
const ANALYZER_MIN_DB = -90;
const ANALYZER_MAX_DB = 20;

interface ProcessPanelProps {
  engineRef: RefObject<StreamingEngine | null>;
}

export function ProcessPanel({ engineRef }: ProcessPanelProps) {
  const p = useStore((s) => s.processParams);
  const set = useStore((s) => s.setProcessParams);
  const setArbitraryFilterEnabled = useStore((s) => s.setArbitraryFilterEnabled);

  const octaveKeys = [
    ['-2', 'octaveMinus2', 'Mix in spectrum shifted two octaves down.'],
    ['-1', 'octaveMinus1', 'Mix in spectrum shifted one octave down.'],
    ['0', 'octave0', 'Mix in the original unshifted spectrum.'],
    ['+1', 'octavePlus1', 'Mix in spectrum shifted one octave up.'],
    ['+1.5', 'octavePlus15', 'Mix in the third-harmonic spectrum.'],
    ['+2', 'octavePlus2', 'Mix in spectrum shifted two octaves up.'],
  ] as const;

  return (
    <div className="process-panel">
      <div className="process-grid">
        <fieldset className="process-box harmonics-box">
          <label className="check-row" title="Keep only energy near harmonics of a chosen fundamental frequency.">
            <input
              title="Enable harmonic spectrum filtering."
              type="checkbox"
              checked={p.harmonicsEnabled}
              onChange={(e) => set({ harmonicsEnabled: e.target.checked })}
            />
            <span>Harmonics</span>
          </label>
          <NumberRow label="F.Freq(Hz)" value={p.harmonicsFrequencyHz} min={1} max={20000}
            tooltip="Fundamental frequency used to place the harmonic bands."
            onChange={(v) => set({ harmonicsFrequencyHz: v })} />
          <NumberRow label="BW(cents)" value={p.harmonicsBandwidthCents} min={0.1} max={200}
            tooltip="Width of each harmonic band in cents."
            onChange={(v) => set({ harmonicsBandwidthCents: v })} />
          <label className="check-row compact" title="Use smooth gaussian harmonic bands instead of hard on/off bands.">
            <input
              title="Use smooth gaussian harmonic bands instead of hard on/off bands."
              type="checkbox"
              checked={p.harmonicsGauss}
              onChange={(e) => set({ harmonicsGauss: e.target.checked })}
            />
            <span>Gauss</span>
          </label>
          <NumberRow label="no.hrm." value={p.harmonicsCount} min={1} max={100} step={1}
            tooltip="Number of harmonic bands to preserve."
            onChange={(v) => set({ harmonicsCount: Math.round(v) })} />
        </fieldset>

        <div className="shift-stack">
          <fieldset className="process-box shift-box">
            <label className="check-row" title="Shift the spectrum by musical cents.">
              <input
                title="Enable pitch shifting."
                type="checkbox"
                checked={p.pitchShiftEnabled}
                onChange={(e) => set({ pitchShiftEnabled: e.target.checked })}
              />
              <span>Pitch Shift</span>
            </label>
            <StepperNumberRow label="cents" value={p.pitchShiftCents} min={-3600} max={3600} step={1} coarseStep={100}
              tooltip="Pitch shift amount in cents. 1200 cents equals one octave."
              onChange={(v) => set({ pitchShiftCents: Math.round(v) })} />
          </fieldset>

          <fieldset className="process-box shift-box">
            <label className="check-row" title="Shift the spectrum by a fixed frequency offset in Hz.">
              <input
                title="Enable frequency shifting."
                type="checkbox"
                checked={p.frequencyShiftEnabled}
                onChange={(e) => set({ frequencyShiftEnabled: e.target.checked })}
              />
              <span>Freq Shift</span>
            </label>
            <StepperNumberRow label="Hz" value={p.frequencyShiftHz} min={-10000} max={10000} step={1} coarseStep={100}
              tooltip="Frequency shift amount in Hz. Unlike pitch shift, this moves every bin by the same Hz offset."
              onChange={(v) => set({ frequencyShiftHz: Math.round(v) })} />
          </fieldset>
        </div>

        <fieldset className="process-box octave-box">
          <label className="check-row" title="Blend octave-shifted copies of the spectrum.">
            <input
              title="Enable octave mixer."
              type="checkbox"
              checked={p.octaveEnabled}
              onChange={(e) => set({ octaveEnabled: e.target.checked })}
            />
            <span>Octave Mixer</span>
          </label>
          <div className="octave-sliders">
            {octaveKeys.map(([label, key, tooltip]) => (
              <label key={key} className="octave-slider" title={tooltip}>
                <span>{label}</span>
                <input
                  title={tooltip}
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={Math.sqrt(p[key])}
                  onChange={(e) => {
                    const x = parseFloat(e.target.value);
                    set({ [key]: x * x });
                  }}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="process-box filter-box">
          <label className="check-row" title="Keep or remove a frequency band after stretching.">
            <input
              title="Enable band filter."
              type="checkbox"
              checked={p.filterEnabled}
              onChange={(e) => set({ filterEnabled: e.target.checked })}
            />
            <span>Filter</span>
          </label>
          <NumberRow label="Freq1(Hz)" value={p.filterLowHz} min={0} max={25000}
            tooltip="First filter cutoff frequency. The two cutoff values are sorted internally."
            onChange={(v) => set({ filterLowHz: v })} />
          <NumberRow label="Freq2(Hz)" value={p.filterHighHz} min={0} max={25000}
            tooltip="Second filter cutoff frequency. The band between Freq1 and Freq2 is affected."
            onChange={(v) => set({ filterHighHz: v })} />
          <label className="check-row compact" title="Invert the filter so the selected band is removed instead of kept.">
            <input
              title="Use band-stop mode instead of band-pass mode."
              type="checkbox"
              checked={p.filterStop}
              onChange={(e) => set({ filterStop: e.target.checked })}
            />
            <span>BandStop</span>
          </label>
          <SliderRow label="DHF" value={p.filterHighDamp} min={0} max={1}
            tooltip="Damp high frequencies progressively across the spectrum."
            onChange={(v) => set({ filterHighDamp: v })} />
        </fieldset>

        <fieldset className="process-box tonal-box">
          <label className="check-row" title="Emphasize tonal partials or noisy broadband content.">
            <input
              title="Enable tonal/noise separation."
              type="checkbox"
              checked={p.tonalNoiseEnabled}
              onChange={(e) => set({ tonalNoiseEnabled: e.target.checked })}
            />
            <span>Tonal/Noise</span>
          </label>
          <SliderRow label="noise <> tonal" value={p.tonalNoisePreserve} min={-1} max={1}
            tooltip="Choose which component to preserve: negative favors noise; positive favors tonal partials."
            onChange={(v) => set({ tonalNoisePreserve: v })} />
          <SliderRow label="Bandwidth" value={p.tonalNoiseBandwidth} min={0.75} max={1}
            tooltip="Smoothing bandwidth used to estimate the noisy spectral floor."
            onChange={(v) => set({ tonalNoiseBandwidth: v })} />
        </fieldset>

        <div className="utility-stack">
          <fieldset className="process-box small-box">
            <label className="check-row" title="Normalize spectral energy using the original compressor curve.">
              <input
                title="Enable spectral compressor."
                type="checkbox"
                checked={p.compressorEnabled}
                onChange={(e) => set({ compressorEnabled: e.target.checked })}
              />
              <span>Compress</span>
            </label>
            <SliderRow label="Power" value={p.compressorPower} min={0} max={1}
              tooltip="Compression strength. Higher values raise quiet spectra and restrain loud spectra more."
              onChange={(v) => set({ compressorPower: v })} />
          </fieldset>

          <fieldset className="process-box spread-box">
            <label className="check-row" title="Widen harmonic peaks by smoothing the log-frequency spectrum.">
              <input
                title="Enable frequency spread."
                type="checkbox"
                checked={p.spreadEnabled}
                onChange={(e) => set({ spreadEnabled: e.target.checked })}
              />
              <span>Spread</span>
            </label>
            <SliderRow label="Bandwidth" value={p.spreadBandwidth} min={0} max={1}
              tooltip="Amount of log-frequency spreading applied to spectral peaks."
              onChange={(v) => set({ spreadBandwidth: v })} />
          </fieldset>
        </div>
      </div>

      <fieldset className="process-box arbitrary-box">
        <label className="check-row" title="Apply a drawn EQ curve to the stretched spectrum. X is log frequency; Y is gain in dB.">
          <input
            title="Enable arbitrary filter curve."
            type="checkbox"
            checked={p.arbitraryFilter.enabled}
            onChange={(e) => setArbitraryFilterEnabled(e.target.checked)}
          />
          <span>ArbitraryFilter</span>
        </label>
        <ArbitraryFilterEditor engineRef={engineRef} />
      </fieldset>
    </div>
  );
}

function NumberRow(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  tooltip: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="number-row" title={props.tooltip}>
      <span>{props.label}</span>
      <input
        title={props.tooltip}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step ?? 0.1}
        value={formatInputValue(props.value)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) props.onChange(v);
        }}
      />
    </label>
  );
}

function StepperNumberRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  coarseStep: number;
  tooltip: string;
  onChange: (value: number) => void;
}) {
  const setClamped = (value: number) => {
    props.onChange(Math.max(props.min, Math.min(props.max, value)));
  };

  return (
    <div className="stepper-number-row" title={props.tooltip}>
      <span>{props.label}</span>
      <input
        title={props.tooltip}
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={formatInputValue(props.value)}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) setClamped(v);
        }}
      />
      <div className="stepper-buttons">
        <button type="button" title={`Decrease by ${props.coarseStep} ${props.label}`} onClick={() => setClamped(props.value - props.coarseStep)}>-{props.coarseStep}</button>
        <button type="button" title={`Decrease by ${props.step} ${props.label}`} onClick={() => setClamped(props.value - props.step)}>-{props.step}</button>
        <button type="button" title={`Increase by ${props.step} ${props.label}`} onClick={() => setClamped(props.value + props.step)}>+{props.step}</button>
        <button type="button" title={`Increase by ${props.coarseStep} ${props.label}`} onClick={() => setClamped(props.value + props.coarseStep)}>+{props.coarseStep}</button>
      </div>
    </div>
  );
}

function SliderRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  tooltip: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider-row process-slider-row" title={props.tooltip}>
      <span>{props.label}</span>
      <input
        title={props.tooltip}
        type="range"
        min={props.min}
        max={props.max}
        step={0.001}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
      <span className="mono-readout">{props.value.toFixed(2)}</span>
    </label>
  );
}

function ArbitraryFilterEditor({ engineRef }: { engineRef: RefObject<StreamingEngine | null> }) {
  const filter = useStore((s) => s.processParams.arbitraryFilter);
  const setPoints = useStore((s) => s.setArbitraryFilterPoints);
  const selectPoint = useStore((s) => s.selectArbitraryFilterPoint);
  const clear = useStore((s) => s.clearArbitraryFilter);
  const svgRef = useRef<SVGSVGElement>(null);
  const spectrumPathRef = useRef<SVGPathElement>(null);
  const peakPathRef = useRef<SVGPathElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: W, height: H });
  const curve = useMemo(() => densifyLogValuesWithBreakpoints(filter, 256), [filter]);
  const engineState = useStore((s) => s.engineState);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engineState !== 'ready' && engineState !== 'playing') return;
    const ctx = engine.audioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.6;
    try {
      engine.outputNode().connect(analyser);
    } catch {
      return;
    }
    const bins = analyser.frequencyBinCount;
    const data = new Float32Array(bins);
    const sampleRate = ctx.sampleRate;
    const logMin = Math.log(FILTER_MIN_HZ);
    const logMax = Math.log(FILTER_MAX_HZ);
    const dbRange = ANALYZER_MAX_DB - ANALYZER_MIN_DB;
    const NUM_BARS = 56;
    const plotW = W - 2 * PAD;
    const plotH = H - 2 * PAD;
    const slotW = plotW / NUM_BARS;
    const gap = Math.max(0.4, slotW * 0.18);
    const barW = slotW - gap;
    const baseY = H - PAD;
    // Precompute band edge bin indices (log-spaced).
    const bandLo = new Int32Array(NUM_BARS);
    const bandHi = new Int32Array(NUM_BARS);
    for (let b = 0; b < NUM_BARS; b++) {
      const t0 = b / NUM_BARS;
      const t1 = (b + 1) / NUM_BARS;
      const f0 = Math.exp(logMin + t0 * (logMax - logMin));
      const f1 = Math.exp(logMin + t1 * (logMax - logMin));
      const k0 = Math.floor((f0 * analyser.fftSize) / sampleRate);
      const k1 = Math.ceil((f1 * analyser.fftSize) / sampleRate);
      bandLo[b] = Math.max(0, Math.min(bins - 1, k0));
      bandHi[b] = Math.max(bandLo[b], Math.min(bins - 1, k1));
    }
    const peakDb = new Float32Array(NUM_BARS);
    peakDb.fill(ANALYZER_MIN_DB);
    const holdUntil = new Float64Array(NUM_BARS);
    const HOLD_MS = 800;
    const DECAY_DB_PER_SEC = 24;
    const PEAK_TICK_H = 2; // SVG units
    let raf = 0;
    let lastT = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      analyser.getFloatFrequencyData(data);
      const path = spectrumPathRef.current;
      const peakPath = peakPathRef.current;
      let d = '';
      let pd = '';
      for (let b = 0; b < NUM_BARS; b++) {
        let dbMax = -Infinity;
        for (let k = bandLo[b]; k <= bandHi[b]; k++) {
          const v = data[k];
          if (v > dbMax) dbMax = v;
        }
        if (!Number.isFinite(dbMax)) dbMax = ANALYZER_MIN_DB;
        // Peak-hold with hysteresis: instant attack, hold timer, then decay.
        if (dbMax > peakDb[b]) {
          peakDb[b] = dbMax;
          holdUntil[b] = now + HOLD_MS;
        } else if (now > holdUntil[b]) {
          peakDb[b] -= DECAY_DB_PER_SEC * dt;
          if (peakDb[b] < ANALYZER_MIN_DB) peakDb[b] = ANALYZER_MIN_DB;
        }
        const clamped = Math.max(ANALYZER_MIN_DB, Math.min(ANALYZER_MAX_DB, dbMax));
        const yNorm = (ANALYZER_MAX_DB - clamped) / dbRange;
        const top = PAD + yNorm * plotH;
        const x = PAD + b * slotW + gap * 0.5;
        if (top < baseY) {
          d += `M${x.toFixed(2)},${top.toFixed(2)}h${barW.toFixed(2)}V${baseY.toFixed(2)}h${(-barW).toFixed(2)}Z`;
        }
        // Peak tick.
        const pkClamped = Math.max(ANALYZER_MIN_DB, Math.min(ANALYZER_MAX_DB, peakDb[b]));
        const pkNorm = (ANALYZER_MAX_DB - pkClamped) / dbRange;
        const pkY = PAD + pkNorm * plotH;
        if (pkY < baseY) {
          pd += `M${x.toFixed(2)},${pkY.toFixed(2)}h${barW.toFixed(2)}v${PEAK_TICK_H}h${(-barW).toFixed(2)}Z`;
        }
      }
      if (path) path.setAttribute('d', d);
      if (peakPath) peakPath.setAttribute('d', pd);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      try { engine.outputNode().disconnect(analyser); } catch { /* ignore */ }
    };
  }, [engineRef, engineState]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const updateSize = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setCanvasSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(svg);
    return () => resizeObserver.disconnect();
  }, []);

  const xToScreen = (x: number) => PAD + x * (W - 2 * PAD);
  const yToScreen = (value: number) => {
    const lo = Math.log(filter.valueMin);
    const hi = Math.log(filter.valueMax);
    const v = Math.max(filter.valueMin, Math.min(filter.valueMax, value));
    const t = (Math.log(v) - lo) / (hi - lo);
    return PAD + (1 - t) * (H - 2 * PAD);
  };
  const screenToX = (x: number) =>
    Math.max(0, Math.min(1, (x - PAD) / (W - 2 * PAD)));
  const screenToValue = (y: number) => {
    const t = 1 - (y - PAD) / (H - 2 * PAD);
    const lo = Math.log(filter.valueMin);
    const hi = Math.log(filter.valueMax);
    return Math.exp(lo + Math.max(0, Math.min(1, t)) * (hi - lo));
  };
  const eventCoords = (e: ReactPointerEvent<SVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  };
  const pathD = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i < curve.positions.length; i++) {
      pts.push(`${i === 0 ? 'M' : 'L'}${xToScreen(curve.positions[i]).toFixed(2)},${yToScreen(curve.values[i]).toFixed(2)}`);
    }
    return pts.join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve, filter.valueMin, filter.valueMax]);
  const grid = Array.from({ length: 9 }, (_, i) => (i + 1) / 10);
  const handleRx = HANDLE_RADIUS_PX * (W / canvasSize.width);
  const handleRy = HANDLE_RADIUS_PX * (H / canvasSize.height);

  const onCanvasPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if ((e.target as Element).getAttribute('data-point-idx') != null) return;
    const { x, y } = eventCoords(e);
    const point: CurvePoint = {
      position: screenToX(x),
      value: screenToValue(y),
      enabled: true,
    };
    const points = [...filter.points, point].sort((a, b) => a.position - b.position);
    setPoints(points);
    selectPoint(points.findIndex((p) => p === point));
  };
  const onPointPointerDown = (idx: number) => (e: ReactPointerEvent<SVGEllipseElement>) => {
    e.stopPropagation();
    if (e.button === 2) {
      const isEndpoint = idx === 0 || idx === filter.points.length - 1;
      if (filter.points.length <= 2 && isEndpoint) return;
      setPoints(filter.points.filter((_, i) => i !== idx));
      selectPoint(null);
      return;
    }
    if (e.button !== 0) return;
    selectPoint(idx);
    setDragIdx(idx);
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (dragIdx == null) return;
    const { x, y } = eventCoords(e);
    const isEndpoint = dragIdx === 0 || dragIdx === filter.points.length - 1;
    const next = filter.points.map((p, i) =>
      i === dragIdx
        ? { ...p, position: isEndpoint ? p.position : screenToX(x), value: screenToValue(y) }
        : p,
    );
    setPoints(next);
  };

  return (
    <div className="free-filter-wrap">
      <div className="free-filter-controls">
        <button
          className="clear-btn"
          onClick={clear}
          title="Reset the arbitrary filter to a flat 0 dB curve."
        >
          Flat
        </button>
      </div>
      <div className="free-filter-plot">
        <div className="graph-with-y-axis free-filter-graph">
          <div className="axis-y-label">Gain (dB)</div>
          <div className="filter-y-scale">
            <span>{formatDb(FILTER_MAX_DB)}</span>
            <span>{formatDb(FILTER_MIN_DB)}</span>
          </div>
          <div className="graph-main">
            <svg
              ref={svgRef}
              className={'free-filter-canvas' + (filter.enabled ? '' : ' disabled')}
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => setDragIdx(null)}
              onContextMenu={(e) => e.preventDefault()}
            >
              <title>Draw the arbitrary filter curve. X is log frequency from 20 Hz to 25 kHz; Y is gain from -60 dB to +20 dB.</title>
              <rect x={0} y={0} width={W} height={H} fill="#ededed" stroke="#777" vectorEffect="non-scaling-stroke" />
              {grid.map((g) => (
                <line key={'v' + g} x1={xToScreen(g)} y1={PAD} x2={xToScreen(g)} y2={H - PAD} stroke="#e2e2e2" vectorEffect="non-scaling-stroke" />
              ))}
              {grid.map((g) => (
                <line key={'h' + g} x1={PAD} y1={PAD + g * (H - 2 * PAD)} x2={W - PAD} y2={PAD + g * (H - 2 * PAD)} stroke="#e2e2e2" vectorEffect="non-scaling-stroke" />
              ))}
              <path ref={spectrumPathRef} d="" fill="#dcdcdc" stroke="none" pointerEvents="none" />
              <path ref={peakPathRef} d="" fill="#bcbcbc" stroke="none" pointerEvents="none" />
              <path d={pathD} fill="none" stroke="#000" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              {filter.points.map((point, i) => (
                <ellipse
                  key={i}
                  data-point-idx={i}
                  cx={xToScreen(point.position)}
                  cy={yToScreen(point.value)}
                  rx={handleRx}
                  ry={handleRy}
                  fill={filter.selectedIndex === i ? '#dd2020' : '#000'}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={onPointPointerDown(i)}
                >
                  <title>{`Filter breakpoint: ${formatFrequency(pointFrequency(point.position))}, ${formatGain(point.value)}`}</title>
                </ellipse>
              ))}
            </svg>
          </div>
        </div>
        <div className="filter-x-scale">
          <span>{formatFrequency(FILTER_MIN_HZ)}</span>
          <span>{formatFrequency(FILTER_MAX_HZ)}</span>
        </div>
        <div className="axis-x-label">Frequency (Hz, log)</div>
      </div>
    </div>
  );
}

function formatInputValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : Number(value.toFixed(3)).toString();
}

function formatFrequency(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(0)}k` : hz.toString();
}

function formatDb(db: number): string {
  return `${db > 0 ? '+' : ''}${db} dB`;
}

function pointFrequency(position: number): number {
  return Math.exp(
    Math.log(FILTER_MIN_HZ) + position * (Math.log(FILTER_MAX_HZ) - Math.log(FILTER_MIN_HZ)),
  );
}

function formatGain(value: number): string {
  return formatDb(Math.round(20 * Math.log10(Math.max(value, 1e-8))));
}
