import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../../state/store';
import { EnvelopeSidebar } from './EnvelopeSidebar';
import { densifyLogValuesWithBreakpoints } from './interpolation';

const W = 720;
const H = 240;
const PAD = 8;
const HANDLE_RADIUS_PX = 5;

export function EnvelopeEditor() {
  const envelope = useStore((s) => s.envelope);
  const setEnvelopePoints = useStore((s) => s.setEnvelopePoints);
  const selectEnvelopePoint = useStore((s) => s.selectEnvelopePoint);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: W, height: H });

  // Densified curve for visualisation (same logic that's sent to the renderer).
  const curve = useMemo(() => densifyLogValuesWithBreakpoints(envelope, 128), [envelope]);

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

  // Coordinate transforms.
  const xToScreen = (x: number) => PAD + x * (W - 2 * PAD);
  const yToScreen = (v: number) => {
    // Log-ish mapping between valueMin and valueMax for nicer scaling.
    const lo = Math.log(envelope.valueMin);
    const hi = Math.log(envelope.valueMax);
    const clamped = Math.max(envelope.valueMin, Math.min(envelope.valueMax, v));
    const t = (Math.log(clamped) - lo) / (hi - lo);
    return PAD + (1 - t) * (H - 2 * PAD);
  };
  const screenToX = (sx: number) =>
    Math.max(0, Math.min(1, (sx - PAD) / (W - 2 * PAD)));
  const screenToV = (sy: number) => {
    const t = 1 - (sy - PAD) / (H - 2 * PAD);
    const lo = Math.log(envelope.valueMin);
    const hi = Math.log(envelope.valueMax);
    return Math.exp(lo + Math.max(0, Math.min(1, t)) * (hi - lo));
  };

  const eventCoords = (e: ReactPointerEvent<SVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    return { x, y };
  };

  const onCanvasPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    if ((e.target as Element).getAttribute('data-point-idx') != null) return; // handled below
    const { x, y } = eventCoords(e);
    const newPoint = {
      position: screenToX(x),
      value: screenToV(y),
      enabled: true,
    };
    const points = [...envelope.points, newPoint].sort((a, b) => a.position - b.position);
    setEnvelopePoints(points);
    const newIdx = points.findIndex((p) => p === newPoint);
    selectEnvelopePoint(newIdx >= 0 ? newIdx : null);
  };

  const onPointPointerDown = (idx: number) => (e: ReactPointerEvent<SVGEllipseElement>) => {
    e.stopPropagation();
    if (e.button === 2) {
      // right-click: delete (but never delete the two endpoints when only 2 left)
      const isEndpoint = idx === 0 || idx === envelope.points.length - 1;
      if (envelope.points.length <= 2 && isEndpoint) return;
      const points = envelope.points.filter((_, i) => i !== idx);
      setEnvelopePoints(points);
      selectEnvelopePoint(null);
      return;
    }
    if (e.button !== 0) return;
    selectEnvelopePoint(idx);
    setDragIdx(idx);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (dragIdx == null) return;
    const { x, y } = eventCoords(e);
    const isEndpoint = dragIdx === 0 || dragIdx === envelope.points.length - 1;
    const newPos = isEndpoint
      ? envelope.points[dragIdx].position
      : screenToX(x);
    const newVal = screenToV(y);
    const points = envelope.points.map((p, i) =>
      i === dragIdx ? { ...p, position: newPos, value: newVal } : p,
    );
    setEnvelopePoints(points);
    // Re-find selected index after sorting in setter.
    selectEnvelopePoint(
      points
        .slice()
        .sort((a, b) => a.position - b.position)
        .findIndex((p) => p.position === newPos && p.value === newVal),
    );
  };

  const onPointerUp = () => {
    setDragIdx(null);
  };

  const onContextMenu = (e: React.MouseEvent) => e.preventDefault();

  // Build SVG path for the curve.
  const pathD = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i < curve.positions.length; i++) {
      const x = xToScreen(curve.positions[i]);
      const y = yToScreen(curve.values[i]);
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    return pts.join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curve, envelope.valueMin, envelope.valueMax]);

  // Grid lines
  const gridV: number[] = [];
  for (let i = 1; i < 10; i++) gridV.push(i / 10);

  const disabled = !envelope.enabled;
  const handleRx = HANDLE_RADIUS_PX * (W / canvasSize.width);
  const handleRy = HANDLE_RADIUS_PX * (H / canvasSize.height);

  return (
    <div className="envelope-wrap">
      <div className="envelope-container">
        <EnvelopeSidebar />
        <div className="graph-with-y-axis envelope-graph">
          <div className="axis-y-label">Multiplier</div>
          <div className="graph-main">
            <svg
            ref={svgRef}
            className={'envelope-canvas' + (disabled ? ' disabled' : '')}
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onContextMenu={onContextMenu}
          >
            <title>Draw the stretch multiplier over input time. Effective stretch = Stretch slider value times this graph value.</title>
            {/* Background */}
            <rect x={0} y={0} width={W} height={H} fill="#ffffff" stroke="#777" vectorEffect="non-scaling-stroke" />
            {/* Grid */}
            {gridV.map((g) => (
              <line key={'v' + g} x1={xToScreen(g)} y1={PAD} x2={xToScreen(g)} y2={H - PAD} stroke="#e2e2e2" vectorEffect="non-scaling-stroke" />
            ))}
            {gridV.map((g) => (
              <line key={'h' + g} x1={PAD} y1={PAD + g * (H - 2 * PAD)} x2={W - PAD} y2={PAD + g * (H - 2 * PAD)} stroke="#e2e2e2" vectorEffect="non-scaling-stroke" />
            ))}
            {/* Curve */}
            <path d={pathD} fill="none" stroke="#000" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            {/* Points */}
            {envelope.points.map((p, i) => {
              const isSelected = envelope.selectedIndex === i;
              return (
                <ellipse
                  key={i}
                  data-point-idx={i}
                  cx={xToScreen(p.position)}
                  cy={yToScreen(p.value)}
                  rx={handleRx}
                  ry={handleRy}
                  fill={isSelected ? '#dd2020' : '#000'}
                  stroke={isSelected ? '#a00' : 'none'}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={onPointPointerDown(i)}
                  style={{ cursor: 'pointer' }}
                >
                  <title>{`Stretch multiplier point: position ${p.position.toFixed(3)}, value ${p.value.toFixed(4)}x of the Stretch slider`}</title>
                </ellipse>
              );
            })}
          </svg>
          </div>
        </div>
      </div>
      <div className="axis-x-label envelope-x-axis">Input position</div>
    </div>
  );
}
