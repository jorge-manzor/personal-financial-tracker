/** Tablas auxiliares TC / compartidos / provisiones (extraídas de BankingTransactionsPage). */

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatClpDots } from "./format";
import {
  bankingTxRowEditDisabled,
  bankingTxRowEditTitle,
} from "./bankingTxHelpers";
import { BankingAuxRoundCheckbox } from "./BankingAuxRoundCheckbox";
import type { BankingTransactionRow } from "./types";
import {
  BANKING_AUX_SECTION_HEADING_CLASS,
  BANKING_AUX_TX_CARD_CLASS,
  BANKING_AUX_TX_TH_TEXT_CLASS,
  BANKING_AUX_TX_THEAD_CLASS,
  BANKING_AUX_TX_TR_CLASS,
  BANKING_SELECTION_SUMMARY_TICKET_ACTIVE_CLASS,
  BANKING_SELECTION_SUMMARY_TICKET_IDLE_CLASS,
  BANKING_TX_COL_WIDTH,
  BANKING_TX_COLUMN_LABELS,
  bankingAuxActionBtnClass,
  bankingAuxBulkBtnClass,
  bankingToolbarGhostBtnClass,
  sharedPendingPerPersonClp,
  tcUnpaidNetContributionClp,
  txIconBtnAux,
  txIconBtnAuxDanger,
  type BankingTxColumnKey,
} from "./bankingTxShared";
import { BankingTxTd } from "./bankingTxMainTable";
import { IconPencil, IconTrash } from "./bankingTxIcons";

/** Tabla de cargos TC pendientes de pagar (mismas columnas visibles que la tabla principal + Pagado). */
export function BankingCcPendingChargesTable({
  accountId,
  accountHeading,
  rows,
  orderedVisibleBankingTxColumns,
  tableMinWidthPx,
  markingPaidId,
  onMarkPaid,
  openEdit,
  removeRow,
}: {
  accountId: number;
  accountHeading: string;
  rows: BankingTransactionRow[];
  orderedVisibleBankingTxColumns: BankingTxColumnKey[];
  tableMinWidthPx: number;
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

  return (
    <section className="mb-6 space-y-2" aria-labelledby={`cc-pending-heading-${accountId}`}>
      <h3 id={`cc-pending-heading-${accountId}`} className={BANKING_AUX_SECTION_HEADING_CLASS}>
        Pendientes sin marcar pagado · {accountHeading}
      </h3>
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs leading-snug ${
          selectedIds.size > 0 ? BANKING_SELECTION_SUMMARY_TICKET_ACTIVE_CLASS : BANKING_SELECTION_SUMMARY_TICKET_IDLE_CLASS
        }`}
      >
        <p className="min-w-0 flex-1">
          {selectedIds.size > 0 ? (
            <>
              <span className="text-teal-800/90 banking-dark:text-amber-200/80">
                Suma seleccionada (cuadrar con pago al banco):{" "}
              </span>
              <strong className="tabular-nums text-teal-950 banking-dark:text-amber-50">{formatClpDots(selectedSumClp)}</strong>
              <span className="text-teal-700/88 banking-dark:text-amber-300/85">
                {" "}
                · {selectedIds.size} movimiento(s)
              </span>
            </>
          ) : (
            <span className="text-slate-400 banking-dark:text-zinc-500">
              Marca movimientos para ver la suma neta (devoluciones restan) y alinearla con lo que liquidarás desde la cuenta corriente asociada.
            </span>
          )}
        </p>
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
      <div className={BANKING_AUX_TX_CARD_CLASS}>
        <table className="w-full table-fixed border-collapse text-[12px]" style={{ minWidth: tableMinWidthPx }}>
          <colgroup>
            <col style={{ width: "2.75rem" }} />
            {orderedVisibleBankingTxColumns.map((colKey) => (
              <col key={colKey} style={{ width: BANKING_TX_COL_WIDTH[colKey] }} />
            ))}
            <col style={{ width: "5.25rem" }} />
            <col style={{ width: "5rem" }} />
          </colgroup>
          <thead className={BANKING_AUX_TX_THEAD_CLASS}>
            <tr>
              <th scope="col" className="px-1 py-2.5 text-center sm:px-1.5">
                <BankingAuxRoundCheckbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onChange={toggleSelectAll}
                  title={allSelected ? "Desmarcar todos" : "Seleccionar todos en esta tarjeta"}
                  aria-label="Seleccionar todos los cargos pendientes de esta tarjeta"
                />
              </th>
              {orderedVisibleBankingTxColumns.map((colKey) => (
                <th
                  key={colKey}
                  scope="col"
                  className={`px-2 py-2.5 text-center sm:px-2.5 ${BANKING_AUX_TX_TH_TEXT_CLASS}`}
                >
                  {BANKING_TX_COLUMN_LABELS[colKey]}
                </th>
              ))}
              <th
                scope="col"
                className={`px-1.5 py-2.5 text-center sm:px-2 ${BANKING_AUX_TX_TH_TEXT_CLASS}`}
              >
                Pagado
              </th>
              <th className={`px-1.5 py-2.5 text-center sm:px-2 ${BANKING_AUX_TX_TH_TEXT_CLASS}`} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const income = row.amount >= 0;
              const sharedSettledLabel = row.is_shared
                ? row.shared_expense_settled
                  ? "Sí"
                  : "No"
                : "—";
              const ccPaidLabel =
                row.credit_card_charge_paid === null || row.credit_card_charge_paid === undefined
                  ? "—"
                  : row.credit_card_charge_paid
                    ? "Sí"
                    : "No";
              const checked = selectedIds.has(row.id);
              return (
                <tr key={row.id} className={BANKING_AUX_TX_TR_CLASS}>
                  <td className="align-middle px-1 py-3 text-center sm:px-1.5">
                    <BankingAuxRoundCheckbox
                      checked={checked}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`Seleccionar cargo ${row.description ?? row.id}`}
                    />
                  </td>
                  {orderedVisibleBankingTxColumns.map((colKey) => (
                    <BankingTxTd
                      key={colKey}
                      colKey={colKey}
                      row={row}
                      income={income}
                      sharedSettledLabel={sharedSettledLabel}
                      ccPaidLabel={ccPaidLabel}
                      montoAlign="center"
                    />
                  ))}
                  <td className="align-middle px-1.5 py-3 text-center sm:px-2">
                    <button
                      type="button"
                      disabled={markingPaidId === row.id}
                      onClick={() => void onMarkPaid(row)}
                      className={bankingAuxActionBtnClass}
                    >
                      {markingPaidId === row.id ? "…" : "Marcar Pagado"}
                    </button>
                  </td>
                  <td className="align-middle px-1.5 py-3 sm:px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        type="button"
                        disabled={bankingTxRowEditDisabled(row)}
                        title={bankingTxRowEditTitle(row)}
                        aria-label="Editar movimiento"
                        onClick={() => openEdit(row)}
                        className={`${txIconBtnAux} disabled:pointer-events-none disabled:opacity-30`}
                      >
                        <IconPencil />
                      </button>
                      <button
                        type="button"
                        title="Eliminar movimiento"
                        aria-label="Eliminar movimiento"
                        onClick={() => void removeRow(row)}
                        className={txIconBtnAuxDanger}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Pendientes compartidos: mismas columnas auxiliares que TC + selección y liquidación grupal. */
export function BankingSharedPendingChargesTable({
  accountId,
  accountHeading,
  rows,
  orderedVisibleBankingTxColumns,
  tableMinWidthPx,
  markingSettledId,
  bulkSettling,
  selectedIds,
  onToggleRow,
  onToggleSelectAll,
  onBulkSettle,
  onMarkSettled,
  onClearSectionSelection,
  openEdit,
  removeRow,
}: {
  accountId: number;
  accountHeading: string;
  rows: BankingTransactionRow[];
  orderedVisibleBankingTxColumns: BankingTxColumnKey[];
  tableMinWidthPx: number;
  markingSettledId: number | null;
  bulkSettling: boolean;
  selectedIds: Set<number>;
  onToggleRow: (id: number) => void;
  onToggleSelectAll: () => void;
  onBulkSettle: () => void | Promise<void>;
  onMarkSettled: (row: BankingTransactionRow) => void | Promise<void>;
  onClearSectionSelection: () => void;
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
  const someSelected = rowIds.some((id) => selectedIds.has(id));

  const selectedInSection = useMemo(() => rowIds.filter((id) => selectedIds.has(id)).length, [rowIds, selectedIds]);

  const selectedTotals = useMemo(() => {
    let totalAbs = 0;
    let sumPerPerson = 0;
    for (const row of rows) {
      if (!selectedIds.has(row.id)) continue;
      totalAbs += Math.abs(row.amount);
      sumPerPerson += sharedPendingPerPersonClp(row);
    }
    return { totalAbs, sumPerPerson };
  }, [rows, selectedIds]);

  return (
    <section className="mb-6 space-y-2" aria-labelledby={`shared-pending-heading-${accountId}`}>
      <h3 id={`shared-pending-heading-${accountId}`} className={BANKING_AUX_SECTION_HEADING_CLASS}>
        Compartidos pendientes · {accountHeading}
      </h3>
      {selectedInSection > 0 ? (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs leading-snug ${BANKING_SELECTION_SUMMARY_TICKET_ACTIVE_CLASS}`}
        >
          <p className="min-w-0 flex-1 text-teal-950 banking-dark:text-amber-50">
            <span className="text-teal-800/90 banking-dark:text-amber-200/80">Total gasto seleccionado (esta cuenta): </span>
            <strong className="tabular-nums text-teal-950 banking-dark:text-amber-50">{formatClpDots(selectedTotals.totalAbs)}</strong>
            <span className="text-teal-800/88 banking-dark:text-amber-200/78">
              {" "}
              · Suma de pago por persona (cuota de cada movimiento):{" "}
            </span>
            <strong className="tabular-nums text-teal-950 banking-dark:text-amber-50">{formatClpDots(selectedTotals.sumPerPerson)}</strong>
            <span className="text-teal-700/88 banking-dark:text-amber-300/85"> · {selectedInSection} movimiento(s)</span>
          </p>
          <button type="button" onClick={onClearSectionSelection} className={bankingToolbarGhostBtnClass}>
            Limpiar selección
          </button>
        </div>
      ) : null}
      {someSelected ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={bulkSettling || selectedInSection === 0}
            onClick={() => void onBulkSettle()}
            className={bankingAuxBulkBtnClass}
          >
            {bulkSettling ? "Marcando…" : `Marcar como pagados (${selectedInSection})`}
          </button>
        </div>
      ) : null}
      <div className={BANKING_AUX_TX_CARD_CLASS}>
        <table className="w-full table-fixed border-collapse text-[12px]" style={{ minWidth: tableMinWidthPx }}>
          <colgroup>
            <col style={{ width: "2.75rem" }} />
            {orderedVisibleBankingTxColumns.map((colKey) => (
              <col key={colKey} style={{ width: BANKING_TX_COL_WIDTH[colKey] }} />
            ))}
            <col style={{ width: "5.25rem" }} />
            <col style={{ width: "5rem" }} />
          </colgroup>
          <thead className={BANKING_AUX_TX_THEAD_CLASS}>
            <tr>
              <th scope="col" className="px-1 py-2.5 text-center sm:px-1.5">
                <BankingAuxRoundCheckbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onChange={onToggleSelectAll}
                  title={allSelected ? "Desmarcar todos" : "Seleccionar todos en esta tabla"}
                  aria-label="Seleccionar todos los movimientos pendientes"
                />
              </th>
              {orderedVisibleBankingTxColumns.map((colKey) => (
                <th
                  key={colKey}
                  scope="col"
                  className={`px-2 py-2.5 text-center sm:px-2.5 ${BANKING_AUX_TX_TH_TEXT_CLASS}`}
                >
                  {BANKING_TX_COLUMN_LABELS[colKey]}
                </th>
              ))}
              <th scope="col" className={`px-1.5 py-2.5 text-center sm:px-2 ${BANKING_AUX_TX_TH_TEXT_CLASS}`}>
                Liquidado
              </th>
              <th className={`px-1.5 py-2.5 text-center sm:px-2 ${BANKING_AUX_TX_TH_TEXT_CLASS}`} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const income = row.amount >= 0;
              const sharedSettledLabel = row.is_shared
                ? row.shared_expense_settled
                  ? "Sí"
                  : "No"
                : "—";
              const ccPaidLabel =
                row.credit_card_charge_paid === null || row.credit_card_charge_paid === undefined
                  ? "—"
                  : row.credit_card_charge_paid
                    ? "Sí"
                    : "No";
              const checked = selectedIds.has(row.id);
              return (
                <tr key={row.id} className={BANKING_AUX_TX_TR_CLASS}>
                  <td className="align-middle px-1 py-3 text-center sm:px-1.5">
                    <BankingAuxRoundCheckbox
                      checked={checked}
                      onChange={() => onToggleRow(row.id)}
                      aria-label={`Seleccionar movimiento ${row.description ?? row.id}`}
                    />
                  </td>
                  {orderedVisibleBankingTxColumns.map((colKey) => (
                    <BankingTxTd
                      key={colKey}
                      colKey={colKey}
                      row={row}
                      income={income}
                      sharedSettledLabel={sharedSettledLabel}
                      ccPaidLabel={ccPaidLabel}
                      montoAlign="center"
                    />
                  ))}
                  <td className="align-middle px-1.5 py-3 text-center sm:px-2">
                    <button
                      type="button"
                      disabled={markingSettledId === row.id}
                      onClick={() => void onMarkSettled(row)}
                      className={bankingAuxActionBtnClass}
                    >
                      {markingSettledId === row.id ? "…" : "Marcar Pagado"}
                    </button>
                  </td>
                  <td className="align-middle px-1.5 py-3 sm:px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        type="button"
                        disabled={bankingTxRowEditDisabled(row)}
                        title={bankingTxRowEditTitle(row)}
                        aria-label="Editar movimiento"
                        onClick={() => openEdit(row)}
                        className={`${txIconBtnAux} disabled:pointer-events-none disabled:opacity-30`}
                      >
                        <IconPencil />
                      </button>
                      <button
                        type="button"
                        title="Eliminar movimiento"
                        aria-label="Eliminar movimiento"
                        onClick={() => void removeRow(row)}
                        className={txIconBtnAuxDanger}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}


export function BankingProvisionPendingTable({
  accountId,
  accountHeading,
  rows,
  orderedVisibleBankingTxColumns,
  tableMinWidthPx,
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
  tableMinWidthPx: number;
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

  return (
    <section className="mb-6 space-y-2" aria-labelledby={`provision-pending-heading-${accountId}`}>
      <h3 id={`provision-pending-heading-${accountId}`} className={BANKING_AUX_SECTION_HEADING_CLASS}>
        Provisiones pendientes de reversar · {accountHeading}
      </h3>
      {someSelected ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={bulkReversing || selectedInSection === 0}
            onClick={() => void onBulkReverse()}
            className={bankingAuxBulkBtnClass}
          >
            {bulkReversing ? "Creando reversas…" : `Crear reversas (${selectedInSection})`}
          </button>
        </div>
      ) : null}
      <div className={BANKING_AUX_TX_CARD_CLASS}>
        <table className="w-full table-fixed border-collapse text-[12px]" style={{ minWidth: tableMinWidthPx }}>
          <colgroup>
            <col style={{ width: "2.75rem" }} />
            {orderedVisibleBankingTxColumns.map((colKey) => (
              <col key={colKey} style={{ width: BANKING_TX_COL_WIDTH[colKey] }} />
            ))}
            <col style={{ width: "6rem" }} />
            <col style={{ width: "5rem" }} />
          </colgroup>
          <thead className={BANKING_AUX_TX_THEAD_CLASS}>
            <tr>
              <th scope="col" className="px-1 py-2.5 text-center sm:px-1.5">
                <BankingAuxRoundCheckbox
                  checked={allSelected}
                  indeterminate={someSelected && !allSelected}
                  onChange={onToggleSelectAll}
                  title={allSelected ? "Desmarcar todos" : "Seleccionar todos"}
                  aria-label="Seleccionar todas las provisiones pendientes en esta cuenta"
                />
              </th>
              {orderedVisibleBankingTxColumns.map((colKey) => (
                <th
                  key={colKey}
                  scope="col"
                  className={`px-2 py-2.5 text-center sm:px-2.5 ${BANKING_AUX_TX_TH_TEXT_CLASS}`}
                >
                  {BANKING_TX_COLUMN_LABELS[colKey]}
                </th>
              ))}
              <th scope="col" className={`px-1.5 py-2.5 text-center sm:px-2 ${BANKING_AUX_TX_TH_TEXT_CLASS}`}>
                Reversa
              </th>
              <th className={`px-1.5 py-2.5 text-center sm:px-2 ${BANKING_AUX_TX_TH_TEXT_CLASS}`} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const income = row.amount >= 0;
              const sharedSettledLabel = row.is_shared ? (row.shared_expense_settled ? "Sí" : "No") : "—";
              const ccPaidLabel =
                row.credit_card_charge_paid === null || row.credit_card_charge_paid === undefined
                  ? "—"
                  : row.credit_card_charge_paid
                    ? "Sí"
                    : "No";
              const checked = selectedIds.has(row.id);
              return (
                <tr key={row.id} className={BANKING_AUX_TX_TR_CLASS}>
                  <td className="align-middle px-1 py-3 text-center sm:px-1.5">
                    <BankingAuxRoundCheckbox
                      checked={checked}
                      onChange={() => onToggleRow(row.id)}
                      aria-label={`Seleccionar provisión ${row.description ?? row.id}`}
                    />
                  </td>
                  {orderedVisibleBankingTxColumns.map((colKey) => (
                    <BankingTxTd
                      key={colKey}
                      colKey={colKey}
                      row={row}
                      income={income}
                      sharedSettledLabel={sharedSettledLabel}
                      ccPaidLabel={ccPaidLabel}
                      montoAlign="center"
                    />
                  ))}
                  <td className="align-middle px-1.5 py-3 text-center sm:px-2">
                    <button
                      type="button"
                      disabled={reversingId === row.id}
                      onClick={() => void onReverseOne(row)}
                      className={bankingAuxActionBtnClass}
                    >
                      {reversingId === row.id ? "…" : "Reversar"}
                    </button>
                  </td>
                  <td className="align-middle px-1.5 py-3 sm:px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        type="button"
                        disabled={bankingTxRowEditDisabled(row)}
                        title={bankingTxRowEditTitle(row)}
                        aria-label="Editar movimiento"
                        onClick={() => openEdit(row)}
                        className={`${txIconBtnAux} disabled:pointer-events-none disabled:opacity-30`}
                      >
                        <IconPencil />
                      </button>
                      <button
                        type="button"
                        title="Eliminar movimiento"
                        aria-label="Eliminar movimiento"
                        onClick={() => void removeRow(row)}
                        className={txIconBtnAuxDanger}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

