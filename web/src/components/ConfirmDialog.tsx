import { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A single reusable confirmation dialog for "big"/hard-to-reverse admin
 * actions (closing a matchday, closing a season). Built on the native
 * <dialog> element for free focus-trapping and Esc-to-cancel; styled as a
 * centered modal on wide viewports and a bottom sheet on narrow ones.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        // Backdrop click: the ::backdrop pseudo-element isn't a real DOM
        // node, so a click landing on it still targets <dialog> itself —
        // this is the standard way to distinguish "clicked outside".
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <h2 className="confirm-dialog-title">{title}</h2>
      <p className="confirm-dialog-message">{message}</p>
      <div className="confirm-dialog-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'button-danger' : 'button-primary'}
          onClick={onConfirm}
          disabled={busy}
          autoFocus
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
