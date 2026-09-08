/**
 * Menú «⋯» genérico (icono + popover flotante en un portal). Unifica `RowActionsMenu`
 * (`frontend/src/bankingPersonalOrderShared.tsx`) y `BankingTxRowActionsMenu`
 * (`frontend/src/bankingTxMainTable.tsx`) — ambos eran el mismo botón/menú con una lista fija de
 * dos acciones (Editar/Borrar); aquí se generalizó a una lista de `items` con callbacks, para
 * cubrir ambos casos (y cualquier menú de acciones de fila futuro) con un solo componente.
 */
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconDotsHorizontal } from "./icons";

export interface IconMenuButtonItem {
  label: string;
  onClick: () => void;
  /** Estilo de acción destructiva (rojo) — usado por ítems tipo "Borrar". */
  destructive?: boolean;
  disabled?: boolean;
  /** `title` del `<button>` del ítem — útil para explicar por qué está deshabilitado. */
  title?: string;
  icon?: ReactNode;
}

export const iconMenuButtonTriggerClass =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-[#8A8072] transition hover:border-[#DCD3C2] hover:bg-[#F5F1E8] hover:text-[#2B2620] banking-dark:text-[#8b949e] banking-dark:hover:border-[#30363d] banking-dark:hover:bg-[#161b22] banking-dark:hover:text-[#F3F1EC]";

/** Botón «⋯» que abre un menú flotante con `items`, montado en un portal (no queda recortado por overflow/scroll virtualizado). */
export function IconMenuButton({ items, ariaLabel }: { items: IconMenuButtonItem[]; ariaLabel: string }) {
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
        className={iconMenuButtonTriggerClass}
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
              {items.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  title={item.title}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    item.destructive
                      ? "text-[#A65568] hover:bg-[#FDF2F5] banking-dark:text-[#cc8e9e] banking-dark:hover:bg-[#2a1216]/70"
                      : "text-[#2B2620] hover:bg-[#F5F1E8] banking-dark:text-[#F3F1EC] banking-dark:hover:bg-[#1c2129]"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
