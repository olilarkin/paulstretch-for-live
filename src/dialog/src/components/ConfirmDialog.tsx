import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// A small confirmation modal, reusing the .modal styling from the About dialog.
// Clicking the backdrop is treated as cancel.
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="modal-body">{body}</div>
        <div className="modal-actions">
          <button className="menu-button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="menu-button primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
