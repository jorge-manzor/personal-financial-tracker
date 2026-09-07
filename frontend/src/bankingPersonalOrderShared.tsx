/** Estilos y componentes compartidos entre Provisiones y Ahorro por objetivo (antes una sola página «Orden personal»). */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconDotsHorizontal, IconPencil, IconTrash } from "./bankingTxIcons";
import type { BankingAccountRow } from "./types";

export const cardClass =
  "rounded-2xl border border-[#E8E1D4] bg-white p-5 shadow-sm shadow-[#2B2620]/[0.04] banking-dark:border-[#1e242e] banking-dark:bg-[#12161d] banking-dark:shadow-none";
export const labelClass =
  "block text-[10px] font-semibold uppercase tracking-wide text-[#8A8072] banking-dark:text-[#8b949e]";
export const inputClass =
  "mt-1 w-full rounded-lg border border-[#DCD3C2] bg-white px-3 py-2 text-sm text-[#2B2620] outline-none ring-[#8FBFA6]/0 transition focus:border-[#8FBFA6] focus:ring-2 focus:ring-[#8FBFA6]/35 banking-dark:border-[#30363d] banking-dark:bg-[#0d1117] banking-dark:text-[#F3F1EC] banking-dark:focus:border-[#8FBFA6] banking-dark:focus:ring-[#8FBFA6]/35";
export const btnPrimary =
  "rounded-lg bg-[#8FBFA6] px-4 py-2 text-sm font-semibold text-[#1F2E25] shadow-sm hover:bg-[#7FB097] disabled:opacity-50";
export const btnSecondary =
  "rounded-lg border border-[#DCD3C2] bg-white px-4 py-2 text-sm font-medium text-[#2B2620] shadow-sm hover:bg-[#F5F1E8] banking-dark:border-[#30363d] banking-dark:bg-[#161b22] banking-dark:text-[#F3F1EC] banking-dark:hover:border-[#3a414c] banking-dark:hover:bg-[#1c2129]";

export const modalBackdropClass =
  "fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px] banking-dark:bg-black/55";
export const modalPanelClass =
  "relative z-[1] w-full max-w-lg rounded-2xl border border-[#E8E1D4] bg-white p-5 shadow-xl banking-dark:border-[#30363d] banking-dark:bg-[#161b22] banking-dark:shadow-black/40";

/** Botón «⋯» que abre `RowActionsMenu` — mismo tamaño/hover que el resto de acciones de fila. */
export const rowMenuTriggerClass =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-[#8A8072] transition hover:border-[#DCD3C2] hover:bg-[#F5F1E8] hover:text-[#2B2620] banking-dark:text-[#8b949e] banking-dark:hover:border-[#30363d] banking-dark:hover:bg-[#161b22] banking-dark:hover:text-[#F3F1EC]";

/** Selector de cuenta modernizado: mismo `inputClass` que el resto del formulario + flecha propia. */
export function AccountSelect({
  value,
  onChange,
  accounts,
  placeholder,
}: {
  value: number | "";
  onChange: (v: number | "") => void;
  accounts: BankingAccountRow[];
  placeholder: string;
}) {
  return (
    <div className="relative mt-1">
      <select
        className={`${inputClass} mt-0 appearance-none pr-9`}
        value={value === "" ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      >
        <option value="">{placeholder}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9A9284] banking-dark:text-[#6b7280]"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.24 4.496a.75.75 0 01-1.08 0l-4.24-4.497a.75.75 0 01.02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}

/**
 * Menú «⋯» con Editar/Borrar, montado en un portal — misma lógica y look que
 * `BankingTxRowActionsMenu` (Movimientos bancarios): botón de icono + popover flotante,
 * se cierra con click afuera, Escape, scroll o resize.
 */
export function RowActionsMenu({
  editLabel = "Editar",
  removeLabel = "Borrar",
  ariaLabel,
  onEdit,
  onRemove,
}: {
  editLabel?: string;
  removeLabel?: string;
  ariaLabel: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleDown(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function handleReflow() {
      setOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleReflow, true);
    window.addEventListener("resize", handleReflow);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleReflow, true);
      window.removeEventListener("resize", handleReflow);
    };
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const menuWidth = 152;
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - menuWidth, window.innerWidth - menuWidth - 8)) });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={rowMenuTriggerClass}
      >
        <IconDotsHorizontal />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={ariaLabel}
              className="fixed z-[90] w-[9.5rem] overflow-hidden rounded-xl border border-[#E8E1D4] bg-white py-1 shadow-xl shadow-[#2B2620]/10 banking-dark:border-[#30363d] banking-dark:bg-[#161b22] banking-dark:shadow-black/40"
              style={{ top: pos.top, left: pos.left }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#2B2620] transition hover:bg-[#F5F1E8] banking-dark:text-[#F3F1EC] banking-dark:hover:bg-[#1c2129]"
              >
                <IconPencil className="h-4 w-4 text-[#9A9284] banking-dark:text-[#6b7280]" />
                {editLabel}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onRemove();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[#A65568] transition hover:bg-[#FDF2F5] banking-dark:text-[#cc8e9e] banking-dark:hover:bg-[#2a1216]/70"
              >
                <IconTrash className="h-4 w-4" />
                {removeLabel}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
