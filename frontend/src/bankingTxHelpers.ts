/** Utilidades puras de la UI de movimientos banking (extraídas de BankingTransactionsPage). */

import type { BankingTransactionRow } from "./types";

/** Plantilla seed: Transferencia → Entre cuentas propias */
export const BANKING_TEMPLATE_CAT_TRANSFERENCIA = 19;
export const BANKING_TEMPLATE_SUB_ENTRE_CUENTAS_PROPIAS = 1901;
/** Plantilla seed: categoría Provisiones (reversa solo para estos movimientos). */
export const BANKING_TEMPLATE_CAT_PROVISIONES = 21;

/** Movimientos por página (coincide con GET /banking/transactions `page_size`). */
export const BANKING_TX_PAGE_SIZE = 50;

/** Alto estimado por fila en la tabla principal (virtualizada). */
export const BANKING_TX_VIRTUAL_ROW_ESTIMATE_PX = 52;

/** Bloquea editar filas con peer salvo el pago TC reflejado en cuenta corriente. */
export function bankingTxRowEditDisabled(row: BankingTransactionRow): boolean {
  if (row.is_provision_reversal === true) return true;
  if (row.peer_transaction_id == null) return false;
  return row.cc_payment_mirror !== true;
}

export function bankingTxRowEditTitle(row: BankingTransactionRow): string {
  if (row.is_provision_reversal === true) return "Las reversas de provisión solo se pueden eliminar";
  if (row.peer_transaction_id != null && row.cc_payment_mirror !== true) {
    return "Las transferencias entre cuentas propias no se pueden editar aquí";
  }
  if (row.cc_payment_mirror === true) {
    return "Editar: puedes ajustar el monto pagado desde cuenta corriente (p. ej. menos por devoluciones)";
  }
  return "Editar movimiento";
}

export function normalizeBankingPickerSearch(raw: string): string {
  const s = raw.trim().toLowerCase();
  try {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    return s;
  }
}

/** Búsqueda tipo contains; vacío muestra todas. Sin mayúsculas ni tildes. */
export function bankingPickerSearchMatches(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  return normalizeBankingPickerSearch(haystack).includes(normalizeBankingPickerSearch(needle));
}

/** `YYYY-MM-DD` en fecha local del usuario. */
export function isoDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Desde el día 1 de hace dos meses hasta hoy. */
export function bankingTxRangeForLastTwoMonths(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - 2, 1);
  return { from: isoDateLocal(from), to: isoDateLocal(to) };
}

export function normalizeBankingTxCustomRange(from: string, to: string): { from: string; to: string } {
  let df = from;
  let dt = to;
  if (df && dt && df > dt) [df, dt] = [dt, df];
  return { from: df, to: dt };
}

/** Fechas efectivas para la petición (si falta alguna, se usa «últimos 2 meses»). */
export function resolveBankingTxMovementDateRange(from: string, to: string): { from: string; to: string } {
  const n = normalizeBankingTxCustomRange(from, to);
  if (!n.from.trim() || !n.to.trim()) return bankingTxRangeForLastTwoMonths();
  return n;
}

/** Asteriscos tras `$` cuando el monto está oculto — mismo largo en todas las tarjetas. */
const BANKING_BALANCE_MASK_STAR_COUNT = 4;

/** Monto tapado: texto fijo; el formateo previo se ignora a propósito. */
export function maskBankingBalanceText(_formatted?: string): string {
  void _formatted;
  return `$${"*".repeat(BANKING_BALANCE_MASK_STAR_COUNT)}`;
}
