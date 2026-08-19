/** Tabla principal virtualizada de movimientos banking. */

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatBankingClpSigned } from "./format";
import {
  BANKING_TX_LIST_ROW_ESTIMATE_PX,
  bankingTxRowEditDisabled,
  bankingTxRowEditTitle,
} from "./bankingTxHelpers";
import type { BankingTransactionRow } from "./types";
import { BANKING_MAIN_TX_ROW_CLASS, type BankingTxColumnKey } from "./bankingTxShared";
import { BankingTxSiNoDashBadge } from "./bankingTxFilters";
import { IconDotsHorizontal, IconPencil, IconTrash } from "./bankingTxIcons";

export const BankingTxTd = memo(function BankingTxTd({
  colKey,
  row,
  income,
  sharedSettledLabel,
  ccPaidLabel,
  /** Por defecto el monto va alineado a la derecha (tabla principal); tablas auxiliares TC/compartido usan `center`. */
  montoAlign = "end",
}: {
  colKey: BankingTxColumnKey;
  row: BankingTransactionRow;
  income: boolean;
  sharedSettledLabel: string;
  ccPaidLabel: string;
  montoAlign?: "end" | "center";
}) {
  switch (colKey) {
    case "fecha":
      return (
        <td className="align-middle whitespace-nowrap px-2 py-3 text-center text-[12px] text-slate-700 banking-dark:text-zinc-200 sm:px-2.5">
          {row.fecha.slice(0, 10)}
        </td>
      );
    case "descripcion":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-left text-[12px] leading-snug text-slate-600 banking-dark:text-zinc-300 sm:px-2.5">
          <span className="line-clamp-3 break-words [overflow-wrap:anywhere]">
            {row.description?.trim() || "—"}
          </span>
        </td>
      );
    case "producto":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-center text-[12px] text-slate-700 banking-dark:text-zinc-200 sm:px-2.5">
          <span className="line-clamp-3 break-words [overflow-wrap:anywhere]">{row.account_name}</span>
        </td>
      );
    case "monto": {
      /** Positivos en verde, cargos/descuentos en rojo (signo viene en el texto). */
      const signClass = income
        ? "text-emerald-600 banking-dark:text-emerald-400"
        : "text-slate-900 banking-dark:text-zinc-100";
      const text = `${income ? "+" : "-"}${formatBankingClpSigned(row.amount)}`;
      const rowJustify = montoAlign === "center" ? "justify-center" : "justify-end";
      return (
        <td className={`align-middle whitespace-nowrap px-2 py-3 sm:px-2.5 ${montoAlign === "center" ? "text-center" : ""}`}>
          <div className={`flex w-full ${rowJustify}`}>
            <span className={`text-[13px] font-bold tabular-nums ${signClass}`}>{text}</span>
          </div>
        </td>
      );
    }
    case "categoria":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-center text-[11.5px] text-slate-700 banking-dark:text-zinc-200 sm:px-2.5">
          <span className="line-clamp-2 break-words font-medium leading-snug [overflow-wrap:anywhere]">
            {row.category_name}
          </span>
        </td>
      );
    case "subcategoria":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-center text-[11.5px] text-slate-700 banking-dark:text-zinc-200 sm:px-2.5">
          <span className="line-clamp-3 break-words font-medium leading-snug [overflow-wrap:anywhere]">
            {row.subcategory_name}
          </span>
        </td>
      );
    case "tipo_movimiento":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-center text-[12px] sm:px-2.5">
          <span
            className={`inline-flex max-w-full justify-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
              row.is_shared
                ? "bg-violet-50 text-violet-600 banking-dark:bg-violet-500/15 banking-dark:text-violet-300"
                : "bg-indigo-50 text-indigo-600 banking-dark:bg-indigo-500/15 banking-dark:text-indigo-300"
            }`}
          >
            {row.is_shared ? "Compartido" : "Personal"}
          </span>
        </td>
      );
    case "compartido_liquidado":
      return (
        <td className="align-middle whitespace-nowrap px-2 py-3 text-center text-[12px] sm:px-2.5">
          <BankingTxSiNoDashBadge text={sharedSettledLabel} />
        </td>
      );
    case "cargo_tc":
      return (
        <td className="align-middle whitespace-nowrap px-2 py-3 text-center text-[12px] sm:px-2.5">
          <BankingTxSiNoDashBadge text={ccPaidLabel} />
        </td>
      );
  }
});

/**
 * Píldora Pagado / No pagado / — para «Cargo TC» y «Compartido liquidado» — texto explícito, sin abreviar a Sí/No.
 * Mismo tamaño/mayúsculas que la píldora Personal/Compartido para que las columnas luzcan parejas.
 */
export function BankingTxPaidStatusBadge({ text }: { text: string }) {
  if (text === "Pagado") {
    return (
      <span className="inline-flex justify-center whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 banking-dark:bg-emerald-500/15 banking-dark:text-emerald-300">
        Pagado
      </span>
    );
  }
  if (text === "No pagado") {
    return (
      <span className="inline-flex justify-center whitespace-nowrap rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600 banking-dark:bg-rose-500/15 banking-dark:text-rose-300">
        No pagado
      </span>
    );
  }
  return (
    <span className="inline-flex justify-center whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 banking-dark:bg-zinc-800 banking-dark:text-zinc-500">
      —
    </span>
  );
}

export const txIconBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-500 transition hover:border-slate-400 hover:bg-slate-100 hover:text-slate-800 banking-dark:text-zinc-500 banking-dark:hover:border-zinc-600 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-200";
export const txIconBtnDanger = `${txIconBtn} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 banking-dark:hover:border-rose-900/55 banking-dark:hover:bg-rose-950/45 banking-dark:hover:text-rose-300`;

/** `#rrggbb` (o `#rgb`) → `rgba(...)`; color de respaldo si el valor no es un hex válido. */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return `rgba(100, 116, 139, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Menú «⋯» con Editar/Borrar, montado en un portal para no quedar recortado por el scroll virtualizado. */
export function BankingTxRowActionsMenu({
  row,
  openEdit,
  removeRow,
}: {
  row: BankingTransactionRow;
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
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

  const editDisabled = bankingTxRowEditDisabled(row);

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Más acciones"
        className={txIconBtn}
      >
        <IconDotsHorizontal />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={`Acciones: ${row.description?.trim() || row.category_name}`}
              className="fixed z-[90] w-[9.5rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-300/30 banking-dark:border-zinc-700 banking-dark:bg-zinc-900 banking-dark:shadow-black/40"
              style={{ top: pos.top, left: pos.left }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={editDisabled}
                title={bankingTxRowEditTitle(row)}
                onClick={() => {
                  setOpen(false);
                  openEdit(row);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 banking-dark:text-zinc-200 banking-dark:hover:bg-zinc-800"
              >
                <IconPencil className="h-4 w-4 text-slate-400 banking-dark:text-zinc-500" />
                Editar
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  void removeRow(row);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-rose-600 transition hover:bg-rose-50 banking-dark:text-rose-300 banking-dark:hover:bg-rose-950/40"
              >
                <IconTrash className="h-4 w-4" />
                Borrar
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Fila de la lista de movimientos: ícono de categoría, descripción, categoría/subcategoría, badges, monto y acciones. */
export const BankingTxListRow = memo(function BankingTxListRow({
  row,
  visibleCols,
  openEdit,
  removeRow,
}: {
  row: BankingTransactionRow;
  visibleCols: Set<BankingTxColumnKey>;
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const income = row.amount >= 0;
  const signClass = income
    ? "text-emerald-600 banking-dark:text-emerald-400"
    : "text-slate-900 banking-dark:text-zinc-100";
  const amountText = `${income ? "+" : "-"}${formatBankingClpSigned(row.amount)}`;
  const title = row.description?.trim() || row.category_name;
  const showProducto = visibleCols.has("producto");
  const showCategoria = visibleCols.has("categoria") || visibleCols.has("subcategoria");
  const showTipo = visibleCols.has("tipo_movimiento");
  const showLiquidado = visibleCols.has("compartido_liquidado");
  const showTcPaid = visibleCols.has("cargo_tc");
  const sharedSettledLabel = row.is_shared ? (row.shared_expense_settled ? "Pagado" : "No pagado") : "—";
  const ccPaidLabel =
    row.credit_card_charge_paid === null || row.credit_card_charge_paid === undefined
      ? "—"
      : row.credit_card_charge_paid
        ? "Pagado"
        : "No pagado";
  const initial = (row.category_name || "?").trim().charAt(0).toUpperCase();

  return (
    <div className={BANKING_MAIN_TX_ROW_CLASS}>
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold"
        style={{ backgroundColor: hexToRgba(row.category_color, 0.14), color: row.category_color }}
        aria-hidden
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 break-words text-[13px] font-semibold leading-snug text-slate-800 [overflow-wrap:anywhere] banking-dark:text-zinc-100">
          {title}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-slate-400 banking-dark:text-zinc-500">
          {row.fecha.slice(0, 10)}
          {showProducto ? ` · ${row.account_name}` : ""}
        </p>
      </div>
      {showCategoria ? (
        <div className="hidden w-40 min-w-0 shrink-0 text-right sm:block">
          <p className="line-clamp-2 break-words text-[12px] font-medium leading-snug text-slate-600 [overflow-wrap:anywhere] banking-dark:text-zinc-300">
            {row.category_name}
          </p>
          <p className="line-clamp-2 break-words text-[11px] leading-snug text-slate-400 [overflow-wrap:anywhere] banking-dark:text-zinc-500">
            {row.subcategory_name}
          </p>
        </div>
      ) : null}
      {showTipo ? (
        <div className="hidden w-24 shrink-0 justify-center md:flex">
          <span
            className={`inline-flex justify-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              row.is_shared
                ? "bg-violet-50 text-violet-600 banking-dark:bg-violet-500/15 banking-dark:text-violet-300"
                : "bg-indigo-50 text-indigo-600 banking-dark:bg-indigo-500/15 banking-dark:text-indigo-300"
            }`}
          >
            {row.is_shared ? "Compartido" : "Personal"}
          </span>
        </div>
      ) : null}
      {showLiquidado ? (
        <div className="hidden w-24 shrink-0 justify-center md:flex" title="Gasto compartido liquidado">
          <BankingTxPaidStatusBadge text={sharedSettledLabel} />
        </div>
      ) : null}
      {showTcPaid ? (
        <div className="hidden w-24 shrink-0 justify-center md:flex" title="Cargo de tarjeta de crédito pagado">
          <BankingTxPaidStatusBadge text={ccPaidLabel} />
        </div>
      ) : null}
      <div className="w-28 shrink-0 text-right">
        <span className={`text-[13px] font-bold tabular-nums ${signClass}`}>{amountText}</span>
      </div>
      <div className="flex w-9 shrink-0 items-center justify-end">
        <BankingTxRowActionsMenu row={row} openEdit={openEdit} removeRow={removeRow} />
      </div>
    </div>
  );
});

/** Lista virtualizada de movimientos (reemplaza la tabla densa por filas tipo tarjeta). */
export function BankingVirtualizedMainTxList({
  scrollRef,
  rows,
  visibleCols,
  openEdit,
  removeRow,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rows: BankingTransactionRow[];
  visibleCols: Set<BankingTxColumnKey>;
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const rowIdsKey = useMemo(() => rows.map((r) => r.id).join(","), [rows]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => BANKING_TX_LIST_ROW_ESTIMATE_PX,
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
    useFlushSync: false,
  });
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    virtualizer.scrollToOffset(0);
    const rafId = requestAnimationFrame(() => virtualizer.measure());
    return () => cancelAnimationFrame(rafId);
  }, [rowIdsKey, scrollRef, virtualizer]);
  const vItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div role="list" aria-label="Movimientos" style={{ position: "relative", height: totalSize }}>
      {vItems.map((vi) => {
        const row = rows[vi.index];
        return (
          <div
            key={row.id}
            ref={virtualizer.measureElement}
            role="listitem"
            data-index={vi.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${vi.start}px)`,
            }}
          >
            <BankingTxListRow row={row} visibleCols={visibleCols} openEdit={openEdit} removeRow={removeRow} />
          </div>
        );
      })}
    </div>
  );
}

