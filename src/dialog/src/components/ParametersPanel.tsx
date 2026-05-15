import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  fftResolution,
  formatDuration,
  formatFftSize,
  formatStretchFactor,
  sliderToStreamingFftSize,
  sliderToStretch,
} from '../state/mappings';
import type { StretchMode, WindowType } from '../types';
import { EnvelopeEditor } from './EnvelopeEditor/EnvelopeEditor';

const MODES: StretchMode[] = ['Stretch', 'HyperStretch', 'Shorten'];
const WINDOWS: WindowType[] = ['Rectangular', 'Hamming', 'Hann', 'Blackman', 'BlackmanHarris'];

export function ParametersPanel() {
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const setStretchSlider = useStore((s) => s.setStretchSlider);
  const setMode = useStore((s) => s.setMode);
  const setWindowSlider = useStore((s) => s.setWindowSlider);
  const setWindowType = useStore((s) => s.setWindowType);
  const setOnsetSensitivity = useStore((s) => s.setOnsetSensitivity);

  const sr = source?.sampleRate ?? 44100;
  const dur = source?.durationSec ?? 0;
  const stretch = sliderToStretch(params.mode, params.stretchSlider);
  const fftSize = sliderToStreamingFftSize(params.windowSlider);
  const res = fftResolution(fftSize, sr);

  const commitStretch = (raw: string) => {
    const num = parseFloat(raw);
    if (!isFinite(num) || num <= 0) return;
    setStretchSlider(inverseStretch(params.mode, num));
  };

  return (
    <div className="parameters-panel">
      <div className="param-row">
        <span
          className="label"
          title="Base time-stretch amount. If the Stretch Multiplier graph is enabled, its values multiply this amount."
        >
          Stretch: <StretchValueEditor
            stretch={stretch}
            onCommit={commitStretch}
          /> ({formatDuration(dur * stretch)})
        </span>
        <input
          title="Base time-stretch amount. If the Stretch Multiplier graph is enabled, its values multiply this amount."
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={params.stretchSlider}
          onChange={(e) => setStretchSlider(parseFloat(e.target.value))}
          className="slider grow"
        />
        <span className="inline-control">
          <label title="Choose the stretch scale: normal stretch, extreme stretch, or shortening.">Mode:</label>
          <select
            title="Choose the stretch scale: normal stretch, extreme stretch, or shortening."
            value={params.mode}
            onChange={(e) => setMode(e.target.value as StretchMode)}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </span>
      </div>
      <hr />
      <div className="param-row">
        <span
          className="label"
          title="FFT window size. Larger windows improve frequency resolution but smear time detail."
        >
          Window size (samples): {formatFftSize(fftSize)}
        </span>
        <input
          title="FFT window size. Larger windows improve frequency resolution but smear time detail."
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={params.windowSlider}
          onChange={(e) => setWindowSlider(parseFloat(e.target.value))}
          className="slider grow"
        />
        <span className="inline-control">
          <label title="Window shape used before spectrum analysis. It changes leakage and transient softness.">Type:</label>
          <select
            title="Window shape used before spectrum analysis. It changes leakage and transient softness."
            value={params.windowType}
            onChange={(e) => setWindowType(e.target.value as WindowType)}
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="param-row sub">
        <span className="label small">
          Resolution: {res.seconds.toFixed(4)} seconds ({res.hz.toFixed(4)} Hz)
        </span>
      </div>
      <div className="param-row">
        <span
          className="label"
          title="Detect strong attacks and advance input faster around them to reduce transient smearing."
        >
          Onset sensitivity:
        </span>
        <input
          title="Detect strong attacks and advance input faster around them to reduce transient smearing."
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={params.onsetSensitivity}
          onChange={(e) => setOnsetSensitivity(parseFloat(e.target.value))}
          className="slider onset"
        />
        <span className="value-readout">{params.onsetSensitivity.toFixed(2)}</span>
        <span className="envelope-title">Stretch Multiplier</span>
      </div>
      <EnvelopeEditor />
    </div>
  );
}

// Click the readout to type an exact stretch multiplier. We can't use
// window.prompt() — Live's WebView ignores it on at least one platform —
// and Cmd/Ctrl+V is intercepted by the host, so this is intentionally a
// plain `<input>` whose value the user types manually. Enter commits,
// Escape cancels, blur commits. Auto-selects on focus so typing replaces.
function StretchValueEditor({
  stretch,
  onCommit,
}: {
  stretch: number;
  onCommit: (raw: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Set on entering edit mode from the readout's measured width so the
  // input box exactly fills the space the readout vacated — no layout
  // shift on either side of the toggle.
  const [inputWidth, setInputWidth] = useState(40);
  const inputRef = useRef<HTMLInputElement>(null);
  const readoutRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className="stretch-input"
        style={{ width: `${inputWidth}px` }}
        defaultValue={draft}
        title="Type an exact stretch multiplier and press Enter."
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onCommit(e.currentTarget.value);
            setEditing(false);
          } else if (e.key === 'Escape') {
            setEditing(false);
          }
        }}
        onBlur={(e) => {
          onCommit(e.currentTarget.value);
          setEditing(false);
        }}
        // Stop the dialog's global spacebar handler from hijacking input.
        onKeyUp={(e) => { if (e.key === ' ') e.stopPropagation(); }}
      />
    );
  }

  return (
    <button
      ref={readoutRef}
      type="button"
      className="stretch-readout"
      title="Click to enter an exact stretch multiplier."
      onClick={() => {
        const w = readoutRef.current?.getBoundingClientRect().width ?? 40;
        // Subtract the input's own 2×(1px border + 2px padding) so the
        // *outer* size matches the readout's outer size exactly.
        setInputWidth(Math.max(28, Math.round(w) - 6));
        setDraft(stretch.toString());
        setEditing(true);
      }}
    >
      {formatStretchFactor(stretch)}
    </button>
  );
}

function inverseStretch(mode: StretchMode, stretch: number): number {
  // Inverse of the sliderToStretch formulas.
  switch (mode) {
    case 'Stretch': {
      // stretch = pow(10, x^1.2 * 4)  =>  x = (log10(stretch)/4)^(1/1.2)
      const t = Math.log10(stretch) / 4;
      return Math.max(0, Math.min(1, Math.pow(Math.max(0, t), 1 / 1.2)));
    }
    case 'HyperStretch': {
      const t = Math.log10(stretch) / 18;
      return Math.max(0, Math.min(1, Math.pow(Math.max(0, t), 1 / 1.5)));
    }
    case 'Shorten': {
      // stretch = 1 / pow(10, x * 2)  =>  x = -log10(stretch) / 2
      return Math.max(0, Math.min(1, -Math.log10(stretch) / 2));
    }
  }
}
