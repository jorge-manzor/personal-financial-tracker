/** Tablas auxiliares TC / compartidos / provisiones (extraídas de BankingTransactionsPage). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatBankingClpSigned, formatClpDots } from "./format";
import { BankingAuxRoundCheckbox } from "./BankingAuxRoundCheckbox";
import type { BankingTransactionRow } from "./types";
import {
  BANKING_AUX_SECTION_HEADING_CLASS,
  BANKING_MAIN_TX_CARD_CLASS,
  BANKING_MAIN_TX_ROW_CLASS,
  BANKING_SELECTION_SUMMARY_TICKET_IDLE_CLASS,
  BANKING_SELECTION_TICKET_ACCENT_CLASS,
  bankingAuxIndigoBulkBtnClass,
  bankingAuxIndigoPillBtnClass,
  bankingToolbarGhostBtnClass,
  tcUnpaidNetContributionClp,
  type BankingTxColumnKey,
} from "./bankingTxShared";
import { BankingTxRowActionsMenu, hexToRgba } from "./bankingTxMainTable";
import { IconCheck, IconUndo } from "./bankingTxIcons";

/** Chip «Todos»: checkbox de seleccionar-todo + etiqueta, en su propia píldora — cabecera de cada ticket de selección. */
function AuxSelectAllChip({
  allSelected,
  someSelected,
  onToggle,
  title,
  ariaLabel,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onToggle: () => void;
  title?: string;
  ariaLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#E8E1D4] bg-white py-1 pl-1.5 pr-2.5 shadow-sm banking-dark:border-[#1e242e] banking-dark:bg-[#12161d]">
      <BankingAuxRoundCheckbox
        checked={allSelected}
        indeterminate={someSelected && !allSelected}
        onChange={onToggle}
        color="sage"
        title={title}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        onClick={onToggle}
        className="text-[11px] font-semibold text-[#8A8072] transition hover:text-[#2B2620] banking-dark:text-[#8b949e] banking-dark:hover:text-[#F3F1EC]"
      >
        Todos
      </button>
    </div>
  );
}

/** Avatar circular con la inicial de la categoría — mismo lenguaje visual en las tres tablas auxiliares. */
function AuxRowAvatar({ row }: { row: BankingTransactionRow }) {
  const initial = (row.category_name || "?").trim().charAt(0).toUpperCase();
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold"
      style={{ backgroundColor: hexToRgba(row.category_color, 0.14), color: row.category_color }}
      aria-hidden
    >
      {initial}
    </div>
  );
}

/** Título + fecha/producto — mismo lenguaje visual en las tres tablas auxiliares. */
function AuxRowTitleBlock({ row, showProducto }: { row: BankingTransactionRow; showProducto: boolean }) {
  const title = row.description?.trim() || row.category_name;
  return (
    <div className="min-w-0 flex-1">
      <p className="line-clamp-2 break-words text-[13px] font-semibold leading-snug text-[#2B2620] [overflow-wrap:anywhere] banking-dark:text-[#F3F1EC]">
        {title}
      </p>
      <p className="mt-0.5 truncate text-[11.5px] text-[#9A9284] banking-dark:text-[#6b7280]">
        {row.fecha.slice(0, 10)}
        {showProducto ? ` · ${row.account_name}` : ""}
      </p>
    </div>
  );
}

/** Categoría/subcategoría — mismo lenguaje visual en las tres tablas auxiliares. */
function AuxRowCategoryBlock({ row }: { row: BankingTransactionRow }) {
  return (
    <div className="hidden w-40 min-w-0 shrink-0 text-right sm:block">
      <p className="line-clamp-2 break-words text-[12px] font-medium leading-snug text-[#4A453C] [overflow-wrap:anywhere] banking-dark:text-[#c9d1d9]">
        {row.category_name}
      </p>
      <p className="line-clamp-2 break-words text-[11px] leading-snug text-[#9A9284] [overflow-wrap:anywhere] banking-dark:text-[#6b7280]">
        {row.subcategory_name}
      </p>
    </div>
  );
}

/** Monto con signo — mismo lenguaje visual en las tres tablas auxiliares. */
function AuxRowAmount({ row }: { row: BankingTransactionRow }) {
  const income = row.amount >= 0;
  const signClass = income
    ? "text-emerald-600 banking-dark:text-emerald-400"
    : "text-[#2B2620] banking-dark:text-[#F3F1EC]";
  const amountText = `${income ? "+" : "-"}${formatBankingClpSigned(row.amount)}`;
  return (
    <div className="w-24 shrink-0 text-right">
      <span className={`text-[13px] font-bold tabular-nums ${signClass}`}>{amountText}</span>
    </div>
  );
}

/** Tabla de cargos TC pendientes de pagar (mismas columnas visibles que la tabla principal + Pagado). */
export function BankingCcPendingChargesTable({
  accountId,
  accountHeading,
  rows,
  orderedVisibleBankingTxColumns,
  markingPaidId,
  onMarkPaid,
  openEdit,
  removeRow,
}: {
  accountId: number;
  accountHeading: string;
  rows: BankingTransactionRow[];
  orderedVisibleBankingTxColumns: BankingTxColumnKey[];
  markingPaidId: number | null;
  onMarkPaid: (row: BankingTransactionRow) => void | Promise<void>;
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
  const someSelected = rowIds.some((id) => selectedIds.has(id));

  useEffect(() => {
    const valid = new Set(rowIds);
    setSelectedIds((prev) => {
      const next = new Set<number>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
      }
      return next;
    });
  }, [rowIds]);

  const selectedSumClp = useMemo(() => {
    let s = 0;
    for (const row of rows) {
      if (!selectedIds.has(row.id)) continue;
      s += tcUnpaidNetContributionClp(row);
    }
    return s;
  }, [rows, selectedIds]);

  const toggleRow = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (rowIds.length > 0 && rowIds.every((id) => prev.has(id))) return new Set();
      return new Set(rowIds);
    });
  }, [rowIds]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const visibleCols = useMemo(() => new Set(orderedVisibleBankingTxColumns), [orderedVisibleBankingTxColumns]);

  return (
    <section className="mb-6 space-y-2" aria-labelledby={`cc-pending-heading-${accountId}`}>
      <h3 id={`cc-pending-heading-${accountId}`} className={BANKING_AUX_SECTION_HEADING_CLASS}>
        {accountHeading} · Movimientos por pagar
      </h3>
      <div
        className={`flex flex-wrap items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-xs leading-snug ${
          selectedIds.size > 0 ? BANKING_SELECTION_TICKET_ACCENT_CLASS : BANKING_SELECTION_SUMMARY_TICKET_IDLE_CLASS
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <AuxSelectAllChip
            allSelected={allSelected}
            someSelected={someSelected}
            onToggle={toggleSelectAll}
            title={allSelected ? "Desmarcar todos" : "Seleccionar todos en esta tarjeta"}
            ariaLabel="Seleccionar todos los cargos pendientes de esta tarjeta"
          />
          <p className="min-w-0 flex-1">
            {selectedIds.size > 0 ? (
              <>
                <span className="text-[#8A8072] banking-dark:text-[#8b949e]">
                  Suma seleccionada (cuadrar con pago al banco):{" "}
                </span>
                <strong className="tabular-nums text-[#3F6B52] banking-dark:text-[#8FBFA6]">{formatClpDots(selectedSumClp)}</strong>
                <span className="text-[#8A8072] banking-dark:text-[#8b949e]">
                  {" "}
                  · {selectedIds.size} movimiento(s)
                </span>
              </>
            ) : (
              <span className="text-[#9A9284] banking-dark:text-[#6b7280]">
                Marca movimientos para ver la suma neta (devoluciones restan) y alinearla con lo que liquidarás desde la cuenta corriente asociada.
              </span>
            )}
          </p>
        </div>
        {selectedIds.size > 0 ? (
          <button
            type="button"
            onClick={clearSelection}
            className={bankingToolbarGhostBtnClass}
          >
            Limpiar selección
          </button>
        ) : null}
      </div>
      <div className={BANKING_MAIN_TX_CARD_CLASS}>
        {rows.map((row) => (
          <BankingCcPendingChargeRow
            key={row.id}
            row={row}
            visibleCols={visibleCols}
            checked={selectedIds.has(row.id)}
            markingPaid={markingPaidId === row.id}
            onToggle={() => toggleRow(row.id)}
            onMarkPaid={onMarkPaid}
            openEdit={openEdit}
            removeRow={removeRow}
          />
        ))}
      </div>
    </section>
  );
}

/** Fila (estilo card, no tabla) de un cargo TC pendiente: checkbox + resumen + acción «Marcar Pagado» + editar/borrar. */
function BankingCcPendingChargeRow({
  row,
  visibleCols,
  checked,
  markingPaid,
  onToggle,
  onMarkPaid,
  openEdit,
  removeRow,
}: {
  row: BankingTransactionRow;
  visibleCols: Set<BankingTxColumnKey>;
  checked: boolean;
  markingPaid: boolean;
  onToggle: () => void;
  onMarkPaid: (row: BankingTransactionRow) => void | Promise<void>;
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const showProducto = visibleCols.has("producto");
  const showCategoria = visibleCols.has("categoria") || visibleCols.has("subcategoria");

  return (
    <div className={BANKING_MAIN_TX_ROW_CLASS}>
      <BankingAuxRoundCheckbox
        checked={checked}
        onChange={onToggle}
        color="sage"
        aria-label={`Seleccionar cargo ${row.description ?? row.id}`}
      />
      <AuxRowAvatar row={row} />
      <AuxRowTitleBlock row={row} showProducto={showProducto} />
      {showCategoria ? <AuxRowCategoryBlock row={row} /> : null}
      <AuxRowAmount row={row} />
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={markingPaid}
          onClick={() => void onMarkPaid(row)}
          className={bankingAuxIndigoPillBtnClass}
        >
          {markingPaid ? "…" : (
            <>
              <IconCheck className="h-3 w-3" />
              Pagado
            </>
          )}
        </button>
        <BankingTxRowActionsMenu row={row} openEdit={openEdit} removeRow={removeRow} />
      </div>
    </div>
  );
}

/** Pendientes compartidos: mismo estilo de card-list que la tabla TC + selección y liquidación grupal (cross-cuenta). */
export function BankingSharedPendingChargesTable({
  accountId,
  accountHeading,
  rows,
  orderedVisibleBankingTxColumns,
  markingSettledId,
  bulkSettling,
  selectedIds,
  onToggleRow,
  onToggleSelectAll,
  onBulkSettle,
  onMarkSettled,
  openEdit,
  removeRow,
}: {
  accountId: number;
  accountHeading: string;
  rows: BankingTransactionRow[];
  orderedVisibleBankingTxColumns: BankingTxColumnKey[];
  markingSettledId: number | null;
  bulkSettling: boolean;
  selectedIds: Set<number>;
  onToggleRow: (id: number) => void;
  onToggleSelectAll: () => void;
  onBulkSettle: () => void | Promise<void>;
  onMarkSettled: (row: BankingTransactionRow) => void | Promise<void>;
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
  const someSelected = rowIds.some((id) => selectedIds.has(id));
  const selectedInSection = useMemo(() => rowIds.filter((id) => selectedIds.has(id)).length, [rowIds, selectedIds]);
  const visibleCols = useMemo(() => new Set(orderedVisibleBankingTxColumns), [orderedVisibleBankingTxColumns]);

  return (
    <section className="mb-6 space-y-2" aria-labelledby={`shared-pending-heading-${accountId}`}>
      <h3 id={`shared-pending-heading-${accountId}`} className={BANKING_AUX_SECTION_HEADING_CLASS}>
        {/* El backend agrupa todo lo compartido sin liquidar en un único bucket sintético
            (account_name ya es una frase descriptiva, no el nombre de una cuenta real). */}
        {accountHeading}
      </h3>
      <div
        className={`flex flex-wrap items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-xs leading-snug ${
          someSelected ? BANKING_SELECTION_TICKET_ACCENT_CLASS : BANKING_SELECTION_SUMMARY_TICKET_IDLE_CLASS
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <AuxSelectAllChip
            allSelected={allSelected}
            someSelected={someSelected}
            onToggle={onToggleSelectAll}
            title={allSelected ? "Desmarcar todos" : "Seleccionar todos en esta tabla"}
            ariaLabel="Seleccionar todos los movimientos pendientes"
          />
          <p className="min-w-0 flex-1">
            {someSelected ? (
              <span className="text-[#8A8072] banking-dark:text-[#8b949e]">
                {selectedInSection} movimiento(s) seleccionado(s)
              </span>
            ) : (
              <span className="text-[#9A9284] banking-dark:text-[#6b7280]">
                Marca movimientos para liquidarlos en lote con «Marcar como pagados».
              </span>
            )}
          </p>
        </div>
        {someSelected ? (
          <button
            type="button"
            disabled={bulkSettling || selectedInSection === 0}
            onClick={() => void onBulkSettle()}
            className={bankingAuxIndigoBulkBtnClass}
          >
            <IconCheck className="h-3.5 w-3.5" />
            {bulkSettling ? "Marcando…" : `Marcar como pagados (${selectedInSection})`}
          </button>
        ) : null}
      </div>
      <div className={BANKING_MAIN_TX_CARD_CLASS}>
        {rows.map((row) => (
          <BankingSharedPendingRow
            key={row.id}
            row={row}
            visibleCols={visibleCols}
            checked={selectedIds.has(row.id)}
            markingSettled={markingSettledId === row.id}
            onToggle={() => onToggleRow(row.id)}
            onMarkSettled={onMarkSettled}
            openEdit={openEdit}
            removeRow={removeRow}
          />
        ))}
      </div>
    </section>
  );
}

/** Fila (estilo card) de un movimiento compartido pendiente de liquidar. */
function BankingSharedPendingRow({
  row,
  visibleCols,
  checked,
  markingSettled,
  onToggle,
  onMarkSettled,
  openEdit,
  removeRow,
}: {
  row: BankingTransactionRow;
  visibleCols: Set<BankingTxColumnKey>;
  checked: boolean;
  markingSettled: boolean;
  onToggle: () => void;
  onMarkSettled: (row: BankingTransactionRow) => void | Promise<void>;
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const showProducto = visibleCols.has("producto");
  const showCategoria = visibleCols.has("categoria") || visibleCols.has("subcategoria");

  return (
    <div className={BANKING_MAIN_TX_ROW_CLASS}>
      <BankingAuxRoundCheckbox
        checked={checked}
        onChange={onToggle}
        color="sage"
        aria-label={`Seleccionar movimiento ${row.description ?? row.id}`}
      />
      <AuxRowAvatar row={row} />
      <AuxRowTitleBlock row={row} showProducto={showProducto} />
      {showCategoria ? <AuxRowCategoryBlock row={row} /> : null}
      <AuxRowAmount row={row} />
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={markingSettled}
          onClick={() => void onMarkSettled(row)}
          className={bankingAuxIndigoPillBtnClass}
        >
          {markingSettled ? "…" : (
            <>
              <IconCheck className="h-3 w-3" />
              Pagado
            </>
          )}
        </button>
        <BankingTxRowActionsMenu row={row} openEdit={openEdit} removeRow={removeRow} />
      </div>
    </div>
  );
}

/** Provisiones pendientes de reversar: mismo estilo de card-list que TC/Compartidos + reversa individual o en lote. */
export function BankingProvisionPendingTable({
  accountId,
  accountHeading,
  rows,
  orderedVisibleBankingTxColumns,
  bulkReversing,
  reversingId,
  selectedIds,
  onToggleRow,
  onToggleSelectAll,
  onBulkReverse,
  onReverseOne,
  openEdit,
  removeRow,
}: {
  accountId: number;
  accountHeading: string;
  rows: BankingTransactionRow[];
  orderedVisibleBankingTxColumns: BankingTxColumnKey[];
  bulkReversing: boolean;
  reversingId: number | null;
  selectedIds: Set<number>;
  onToggleRow: (id: number) => void;
  onToggleSelectAll: () => void;
  onBulkReverse: () => void | Promise<void>;
  onReverseOne: (row: BankingTransactionRow) => void | Promise<void>;
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
  const someSelected = rowIds.some((id) => selectedIds.has(id));
  const selectedInSection = useMemo(() => rowIds.filter((id) => selectedIds.has(id)).length, [rowIds, selectedIds]);
  const visibleCols = useMemo(() => new Set(orderedVisibleBankingTxColumns), [orderedVisibleBankingTxColumns]);

  return (
    <section className="mb-6 space-y-2" aria-labelledby={`provision-pending-heading-${accountId}`}>
      <h3 id={`provision-pending-heading-${accountId}`} className={BANKING_AUX_SECTION_HEADING_CLASS}>
        {accountHeading} · Provisiones por reversar
      </h3>
      <div
        className={`flex flex-wrap items-center justify-between gap-2.5 rounded-xl px-2.5 py-2 text-xs leading-snug ${
          someSelected ? BANKING_SELECTION_TICKET_ACCENT_CLASS : BANKING_SELECTION_SUMMARY_TICKET_IDLE_CLASS
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <AuxSelectAllChip
            allSelected={allSelected}
            someSelected={someSelected}
            onToggle={onToggleSelectAll}
            title={allSelected ? "Desmarcar todos" : "Seleccionar todas"}
            ariaLabel="Seleccionar todas las provisiones pendientes en esta cuenta"
          />
          <p className="min-w-0 flex-1">
            {someSelected ? (
              <span className="text-[#8A8072] banking-dark:text-[#8b949e]">
                {selectedInSection} provisión(es) seleccionada(s)
              </span>
            ) : (
              <span className="text-[#9A9284] banking-dark:text-[#6b7280]">
                Marca provisiones para crear sus reversas contables en lote.
              </span>
            )}
          </p>
        </div>
        {someSelected ? (
          <button
            type="button"
            disabled={bulkReversing || selectedInSection === 0}
            onClick={() => void onBulkReverse()}
            className={bankingAuxIndigoBulkBtnClass}
          >
            <IconUndo className="h-3.5 w-3.5" />
            {bulkReversing ? "Creando reversas…" : `Crear reversas (${selectedInSection})`}
          </button>
        ) : null}
      </div>
      <div className={BANKING_MAIN_TX_CARD_CLASS}>
        {rows.map((row) => (
          <BankingProvisionPendingRow
            key={row.id}
            row={row}
            visibleCols={visibleCols}
            checked={selectedIds.has(row.id)}
            reversing={reversingId === row.id}
            onToggle={() => onToggleRow(row.id)}
            onReverseOne={onReverseOne}
            openEdit={openEdit}
            removeRow={removeRow}
          />
        ))}
      </div>
    </section>
  );
}

/** Fila (estilo card) de una provisión pendiente de reversar. */
function BankingProvisionPendingRow({
  row,
  visibleCols,
  checked,
  reversing,
  onToggle,
  onReverseOne,
  openEdit,
  removeRow,
}: {
  row: BankingTransactionRow;
  visibleCols: Set<BankingTxColumnKey>;
  checked: boolean;
  reversing: boolean;
  onToggle: () => void;
  onReverseOne: (row: BankingTransactionRow) => void | Promise<void>;
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const showProducto = visibleCols.has("producto");
  const showCategoria = visibleCols.has("categoria") || visibleCols.has("subcategoria");

  return (
    <div className={BANKING_MAIN_TX_ROW_CLASS}>
      <BankingAuxRoundCheckbox
        checked={checked}
        onChange={onToggle}
        color="sage"
        aria-label={`Seleccionar provisión ${row.description ?? row.id}`}
      />
      <AuxRowAvatar row={row} />
      <AuxRowTitleBlock row={row} showProducto={showProducto} />
      {showCategoria ? <AuxRowCategoryBlock row={row} /> : null}
      <AuxRowAmount row={row} />
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={reversing}
          onClick={() => void onReverseOne(row)}
          className={bankingAuxIndigoPillBtnClass}
        >
          {reversing ? "…" : (
            <>
              <IconUndo className="h-3 w-3" />
              Reversar
            </>
          )}
        </button>
        <BankingTxRowActionsMenu row={row} openEdit={openEdit} removeRow={removeRow} />
      </div>
    </div>
  );
}
