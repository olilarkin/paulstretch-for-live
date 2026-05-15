import { useStore } from '../../state/store';
import type { InterpType } from '../../types';

export function EnvelopeSidebar() {
  const envelope = useStore((s) => s.envelope);
  const setEnvelopeEnabled = useStore((s) => s.setEnvelopeEnabled);
  const setEnvelopePoints = useStore((s) => s.setEnvelopePoints);
  const setEnvelopeInterp = useStore((s) => s.setEnvelopeInterp);
  const setEnvelopeValueRange = useStore((s) => s.setEnvelopeValueRange);
  const setEnvelopeSmoothing = useStore((s) => s.setEnvelopeSmoothing);
  const clearEnvelope = useStore((s) => s.clearEnvelope);

  const idx = envelope.selectedIndex;
  const selected = idx != null ? envelope.points[idx] : null;

  const updateSelectedPosition = (val: number) => {
    if (idx == null) return;
    const isEndpoint = idx === 0 || idx === envelope.points.length - 1;
    if (isEndpoint) return;
    const next = envelope.points.map((p, i) => (i === idx ? { ...p, position: Math.max(0, Math.min(1, val)) } : p));
    setEnvelopePoints(next);
  };

  const updateSelectedValue = (val: number) => {
    if (idx == null) return;
    const next = envelope.points.map((p, i) => (i === idx ? { ...p, value: val } : p));
    setEnvelopePoints(next);
  };

  return (
    <div className="envelope-sidebar">
      <button
        className={'enable-btn' + (envelope.enabled ? ' on' : '')}
        onClick={() => setEnvelopeEnabled(!envelope.enabled)}
        title="Enable a time-varying multiplier for the Stretch slider."
        aria-pressed={envelope.enabled}
      >
        <span className="enable-led" aria-hidden="true" />
        <span className="enable-label">
          <span aria-hidden="true" className="ghost">Enabled</span>
          <span>{envelope.enabled ? 'Enabled' : 'Enable'}</span>
        </span>
      </button>
      <label title="Normalized input-time position for the selected stretch multiplier point.">
        Position
        <input
          title="Normalized input-time position for the selected stretch multiplier point."
          type="number"
          step={0.001}
          min={0}
          max={1}
          value={selected ? selected.position.toFixed(3) : ''}
          disabled={!selected}
          onChange={(e) => updateSelectedPosition(parseFloat(e.target.value))}
        />
      </label>
      <label title="Multiplier applied to the Stretch slider at the selected point. 1 leaves it unchanged, 0.5 halves it, 2 doubles it.">
        Value
        <input
          title="Multiplier applied to the Stretch slider at the selected point. 1 leaves it unchanged, 0.5 halves it, 2 doubles it."
          type="number"
          step={0.01}
          value={selected ? selected.value.toFixed(4) : ''}
          disabled={!selected}
          onChange={(e) => updateSelectedValue(parseFloat(e.target.value))}
        />
      </label>
      <label title="Lowest value shown in the stretch multiplier graph.">
        Val.Min
        <input
          title="Lowest value shown in the stretch multiplier graph."
          type="number"
          step={0.01}
          value={envelope.valueMin}
          onChange={(e) => setEnvelopeValueRange(parseFloat(e.target.value), envelope.valueMax)}
        />
      </label>
      <label title="Highest value shown in the stretch multiplier graph.">
        Val.Max
        <input
          title="Highest value shown in the stretch multiplier graph."
          type="number"
          step={1}
          value={envelope.valueMax}
          onChange={(e) => setEnvelopeValueRange(envelope.valueMin, parseFloat(e.target.value))}
        />
      </label>
      <label className="sm-row" title="Smooth the stretch multiplier curve between points.">
        Sm
        <input
          title="Smooth the stretch multiplier curve between points."
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={envelope.smoothing}
          onChange={(e) => setEnvelopeSmoothing(parseFloat(e.target.value))}
        />
      </label>
      <label title="Choose linear or cosine interpolation between stretch multiplier points.">
        Interpolate
        <select
          title="Choose linear or cosine interpolation between stretch multiplier points."
          value={envelope.interp}
          onChange={(e) => setEnvelopeInterp(e.target.value as InterpType)}
        >
          <option value="Linear">Linear</option>
          <option value="Cosine">Cosine</option>
        </select>
      </label>
      <button className="clear-btn" onClick={clearEnvelope} title="Reset the stretch multiplier envelope to a flat 1x curve, leaving the Stretch slider unchanged.">
        clear
      </button>
    </div>
  );
}
