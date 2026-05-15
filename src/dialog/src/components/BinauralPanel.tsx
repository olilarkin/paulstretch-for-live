import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../state/store';
import type { BinauralStereoMode, CurvePoint } from '../types';
import { densifyLogValuesWithBreakpoints } from './EnvelopeEditor/interpolation';

const MODES: BinauralStereoMode[] = ['LeftRight', 'RightLeft', 'Symmetric'];
const W = 760;
const H = 260;
const PAD = 8;
const HANDLE_RADIUS_PX = 5;

export function BinauralPanel() {
  const params = useStore((s) => s.binauralParams);
  const set = useStore((s) => s.setBinauralParams);
  const setFlatFrequency = useStore((s) => s.setFlatBinauralFrequency);

  return (
    <div className="binaural-panel">
      <fieldset className="process-box binaural-box">
        <label className="check-row" title="Apply a Hilbert frequency shift to the stretched stereo output to create binaural beating.">
          <input
            title="Enable binaural beats."
            type="checkbox"
            checked={params.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          <span>Binaural beats</span>
        </label>
        <label className="slider-row wide" title="Set a fixed binaural beat rate in Hz by resetting the curve to a flat value.">
          <span>Fixed Rate</span>
          <input
            title="Set a fixed binaural beat rate in Hz by resetting the curve to a flat value."
            type="range"
            min={0.1}
            max={50}
            step={0.1}
            value={params.beatFrequencyHz}
            onChange={(e) => setFlatFrequency(parseFloat(e.target.value))}
          />
          <input
            className="compact-number"
            title="Enter an exact fixed binaural beat rate in Hz by resetting the curve to a flat value."
            type="number"
            min={0.1}
            max={50}
            step={0.1}
            value={params.beatFrequencyHz}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) setFlatFrequency(v);
            }}
          />
        </label>
        <label className="slider-row wide" title="Blend left and right toward mono before frequency shifting.">
          <span>Pow</span>
          <input
            title="Blend left and right toward mono before frequency shifting."
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={params.mono}
            onChange={(e) => set({ mono: parseFloat(e.target.value) })}
          />
          <span className="mono-readout">{params.mono.toFixed(2)}</span>
        </label>
        <label className="number-row" title="Choose which side is shifted up/down, or use symmetric cross-channel output.">
          <span>Stereo Mode</span>
          <select
            title="Choose which side is shifted up/down, or use symmetric cross-channel output."
            value={params.stereoMode}
            onChange={(e) => set({ stereoMode: e.target.value as BinauralStereoMode })}
          >
            {MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>
        <BinauralFrequencyEditor />
      </fieldset>
    </div>
  );
}

function BinauralFrequencyEditor() {
  const envelope = useStore((s) => s.binauralParams.frequencyEnvelope);
  const setPoints = useStore((s) => s.setBinauralFrequencyPoints);
  const selectPoint = useStore((s) => s.selectBinauralFrequencyPoint);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: W, height: H });
  const curve = useMemo(() => densifyLogValuesWithBreakpoints(envelope, 256), [envelope]);

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
    const lo = Math.log(envelope.valueMin);
    const hi = Math.log(envelope.valueMax);
    const v = Math.max(envelope.valueMin, Math.min(envelope.valueMax, value));
    const t = (Math.log(v) - lo) / (hi - lo);
    return PAD + (1 - t) * (H - 2 * PAD);
  };
  const screenToX = (x: number) =>
    Math.max(0, Math.min(1, (x - PAD) / (W - 2 * PAD)));
  const screenToValue = (y: number) => {
    const t = 1 - (y - PAD) / (H - 2 * PAD);
    const lo = Math.log(envelope.valueMin);
    const hi = Math.log(envelope.valueMax);
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
  }, [curve, envelope.valueMin, envelope.valueMax]);
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
    const points = [...envelope.points, point].sort((a, b) => a.position - b.position);
    setPoints(points);
    selectPoint(points.findIndex((p) => p === point));
  };
  const onPointPointerDown = (idx: number) => (e: ReactPointerEvent<SVGEllipseElement>) => {
    e.stopPropagation();
    if (e.button === 2) {
      const isEndpoint = idx === 0 || idx === envelope.points.length - 1;
      if (envelope.points.length <= 2 && isEndpoint) return;
      setPoints(envelope.points.filter((_, i) => i !== idx));
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
    const isEndpoint = dragIdx === 0 || dragIdx === envelope.points.length - 1;
    setPoints(envelope.points.map((p, i) =>
      i === dragIdx
        ? { ...p, position: isEndpoint ? p.position : screenToX(x), value: screenToValue(y) }
        : p,
    ));
  };

  return (
    <div className="graph-with-y-axis binaural-graph">
      <div className="axis-y-label">Rate (Hz)</div>
      <div className="graph-main">
        <svg
          ref={svgRef}
          className="binaural-canvas"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => setDragIdx(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <title>Draw the binaural beat frequency over input time. X is normalized position; Y is beat frequency from 0.1 Hz to 50 Hz.</title>
          <rect x={0} y={0} width={W} height={H} fill="#ffffff" stroke="#777" vectorEffect="non-scaling-stroke" />
          {grid.map((g) => (
            <line key={'v' + g} x1={xToScreen(g)} y1={PAD} x2={xToScreen(g)} y2={H - PAD} stroke="#e2e2e2" vectorEffect="non-scaling-stroke" />
          ))}
          {grid.map((g) => (
            <line key={'h' + g} x1={PAD} y1={PAD + g * (H - 2 * PAD)} x2={W - PAD} y2={PAD + g * (H - 2 * PAD)} stroke="#e2e2e2" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={pathD} fill="none" stroke="#000" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {envelope.points.map((point, i) => (
            <ellipse
              key={i}
              data-point-idx={i}
              cx={xToScreen(point.position)}
              cy={yToScreen(point.value)}
              rx={handleRx}
              ry={handleRy}
              fill={envelope.selectedIndex === i ? '#dd2020' : '#000'}
              vectorEffect="non-scaling-stroke"
              onPointerDown={onPointPointerDown(i)}
            >
              <title>{`Binaural frequency point: position ${point.position.toFixed(3)}, ${point.value.toFixed(2)} Hz`}</title>
            </ellipse>
          ))}
        </svg>
        <div className="axis-x-label">Input position</div>
      </div>
    </div>
  );
}
