import { useStore } from '../state/store';
import { formatDuration } from '../state/mappings';

interface Props {
  hostMode: boolean;
}

export function FileInfoBar({ hostMode }: Props) {
  const source = useStore((s) => s.source);
  const engineState = useStore((s) => s.engineState);
  const engineError = useStore((s) => s.engineError);
  if (!source) {
    // Surface engine errors inline — otherwise a failed boot looks the same
    // as "still loading", which is exactly the bug we keep hitting on Windows.
    if (engineState === 'error') {
      return (
        <div className="file-info empty" style={{ color: '#c33' }}>
          engine error: {engineError ?? 'unknown'}
        </div>
      );
    }
    return (
      <div className="file-info empty">
        {hostMode
          ? `loading clip audio… (engine: ${engineState})`
          : <>no file loaded — use <strong>File</strong> menu, or drag &amp; drop audio</>}
      </div>
    );
  }
  return (
    <div className="file-info">
      {source.name} ( samplerate={source.sampleRate}; duration={formatDuration(source.durationSec)} )
    </div>
  );
}
