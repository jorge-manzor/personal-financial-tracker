import { createPortal } from "react-dom";

export type BankingConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Modal de confirmación ligero (reemplazo de `window.confirm`). */
export function BankingConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  busy = false,
  onConfirm,
  onCancel,
}: BankingConfirmDialogProps) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center bg-slate-900/45 p-4 banking-dark:bg-black/60"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="banking-confirm-title"
        aria-describedby="banking-confirm-desc"
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl banking-dark:border-zinc-600 banking-dark:bg-zinc-900"
      >
        <h2 id="banking-confirm-title" className="text-base font-semibold text-slate-900 banking-dark:text-zinc-50">
          {title}
        </h2>
        <p id="banking-confirm-desc" className="mt-2 text-sm leading-relaxed text-slate-600 banking-dark:text-zinc-300">
          {message}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-800 banking-dark:text-zinc-200 banking-dark:hover:bg-zinc-700"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="rounded-lg border border-rose-600 bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50 banking-dark:border-rose-500 banking-dark:bg-rose-600 banking-dark:hover:bg-rose-500"
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
