interface ProgressDialogProps {
  title: string;
  phaseLabel: string;
  /** 0..1 for a determinate bar, or null for the indeterminate (Saving) phase. */
  fraction: number | null;
  canCancel: boolean;
  onCancel: () => void;
}

// Centered progress overlay shown while an Apply render runs. The backdrop does
// NOT cancel (a stray click shouldn't throw away a long render) — cancellation
// is only via the explicit Cancel button.
export function ProgressDialog({
  title,
  phaseLabel,
  fraction,
  canCancel,
  onCancel,
}: ProgressDialogProps) {
  const determinate = fraction !== null;
  const pct = determinate ? Math.round(fraction * 100) : null;
  return (
    <div className="modal-backdrop">
      <div className="modal progress-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {determinate ? (
          <progress className="progress-bar" value={fraction} max={1} />
        ) : (
          <div className="progress-bar indeterminate" />
        )}
        <div className="progress-meta">
          <span>{phaseLabel}</span>
          {pct !== null && <span>{pct}%</span>}
        </div>
        <div className="modal-actions">
          <button className="menu-button" onClick={onCancel} disabled={!canCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
