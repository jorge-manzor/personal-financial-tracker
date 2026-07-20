/** Tabla principal virtualizada de movimientos banking. */

import { memo, useLayoutEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { formatBankingClpSigned } from "./format";
import {
  BANKING_TX_VIRTUAL_ROW_ESTIMATE_PX,
  bankingTxRowEditDisabled,
  bankingTxRowEditTitle,
} from "./bankingTxHelpers";
import type { BankingTransactionRow } from "./types";
import { BANKING_MAIN_TX_TR_CLASS, type BankingTxColumnKey } from "./bankingTxShared";
import { BankingTxSiNoDashBadge } from "./bankingTxFilters";
import { IconPencil, IconTrash } from "./bankingTxIcons";

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
        ? "text-teal-600 banking-dark:text-teal-400"
        : "text-rose-600 banking-dark:text-rose-400";
      const text = `${income ? "+" : "-"}${formatBankingClpSigned(row.amount)}`;
      const rowJustify = montoAlign === "center" ? "justify-center" : "justify-end";
      return (
        <td className={`align-middle whitespace-nowrap px-2 py-3 sm:px-2.5 ${montoAlign === "center" ? "text-center" : ""}`}>
          <div className={`flex w-full ${rowJustify}`}>
            <span className={`text-[12px] font-semibold tabular-nums ${signClass}`}>{text}</span>
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
            className={`inline-flex max-w-full justify-center rounded-md px-1.5 py-0.5 text-[12px] font-medium ${
              row.is_shared
                ? "bg-violet-100 text-violet-900 ring-1 ring-violet-200 banking-dark:bg-violet-950/55 banking-dark:text-violet-200 banking-dark:ring-violet-800/55"
                : "bg-teal-100 text-teal-900 ring-1 ring-teal-200 banking-dark:bg-teal-950/50 banking-dark:text-teal-200/95 banking-dark:ring-teal-800/55"
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

export const txIconBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-500 transition hover:border-slate-400 hover:bg-slate-100 hover:text-slate-800 banking-dark:text-zinc-500 banking-dark:hover:border-zinc-600 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-200";
export const txIconBtnDanger = `${txIconBtn} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 banking-dark:hover:border-rose-900/55 banking-dark:hover:bg-rose-950/45 banking-dark:hover:text-rose-300`;

/** Cuerpo virtualizado de la tabla principal (pocas filas en DOM; scroll en `scrollRef`). */
export function BankingVirtualizedMainTxTableBody({
  scrollRef,
  rows,
  orderedVisibleBankingTxColumns,
  openEdit,
  removeRow,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  rows: BankingTransactionRow[];
  orderedVisibleBankingTxColumns: BankingTxColumnKey[];
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const colCount = orderedVisibleBankingTxColumns.length + 1;
  const rowIdsKey = useMemo(() => rows.map((r) => r.id).join(","), [rows]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => BANKING_TX_VIRTUAL_ROW_ESTIMATE_PX,
    /** Menos filas extra en DOM = menos trabajo en GPUs modestas. */
    overscan: 8,
    getItemKey: (index) => rows[index]?.id ?? index,
    /**
     * Por defecto el virtualizer usa `flushSync` en actualizaciones síncronas al hacer scroll;
     * en Windows / GPU integrada eso bloquea el hilo principal cada frame y se nota como scroll entrecortado.
     */
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
  const padTop = vItems.length > 0 ? vItems[0].start : 0;
  const padBottom = vItems.length > 0 ? Math.max(0, totalSize - vItems[vItems.length - 1].end) : 0;

  return (
    <tbody>
      {padTop > 0 ? (
        <tr aria-hidden className="pointer-events-none border-0">
          <td colSpan={colCount} className="border-0 p-0" style={{ height: padTop }} />
        </tr>
      ) : null}
      {vItems.map((vi) => {
        const row = rows[vi.index];
        const income = row.amount >= 0;
        const sharedSettledLabel = row.is_shared ? (row.shared_expense_settled ? "Sí" : "No") : "—";
        const ccPaidLabel =
          row.credit_card_charge_paid === null || row.credit_card_charge_paid === undefined
            ? "—"
            : row.credit_card_charge_paid
              ? "Sí"
              : "No";
        return (
          <tr
            key={row.id}
            className={BANKING_MAIN_TX_TR_CLASS}
            style={{ height: vi.size }}
            data-index={vi.index}
          >
            {orderedVisibleBankingTxColumns.map((colKey) => (
              <BankingTxTd
                key={colKey}
                colKey={colKey}
                row={row}
                income={income}
                sharedSettledLabel={sharedSettledLabel}
                ccPaidLabel={ccPaidLabel}
              />
            ))}
            <td className="align-middle px-1.5 py-3 sm:px-2">
              <div className="flex items-center justify-center gap-0.5">
                <button
                  type="button"
                  disabled={bankingTxRowEditDisabled(row)}
                  title={bankingTxRowEditTitle(row)}
                  aria-label="Editar movimiento"
                  onClick={() => openEdit(row)}
                  className={`${txIconBtn} disabled:pointer-events-none disabled:opacity-30`}
                >
                  <IconPencil />
                </button>
                <button
                  type="button"
                  title="Eliminar movimiento"
                  aria-label="Eliminar movimiento"
                  onClick={() => void removeRow(row)}
                  className={txIconBtnDanger}
                >
                  <IconTrash />
                </button>
              </div>
            </td>
          </tr>
        );
      })}
      {padBottom > 0 ? (
        <tr aria-hidden className="pointer-events-none border-0">
          <td colSpan={colCount} className="border-0 p-0" style={{ height: padBottom }} />
        </tr>
      ) : null}
    </tbody>
  );
}

