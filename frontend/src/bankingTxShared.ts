/** Tipos, constantes y helpers puros de movimientos banking (extraídos de BankingTransactionsPage). */

import type { UniqueIdentifier } from "@dnd-kit/core";
import type { MouseEvent as ReactMouseEvent } from "react";
import type {
  BankingAccountRow,
  BankingProductType,
  BankingSharedUnsettledGroup,
  BankingCreditCardUnpaidGroup,
  BankingTransactionRow,
} from "./types";

export type BankingMovementTabScope = "all" | "credit_card" | "shared" | "provisiones";

/** Cache SWR: misma semántica que los params de lista en servidor (`df`/`dt` = rango efectivo enviado al API). */
export function bankingTabCacheKey(
  scope: BankingMovementTabScope,
  filterAccountIds: number[],
  effectiveDateFrom: string,
  effectiveDateTo: string,
  filters: BankingTxFilterSnapshot,
): string {
  return JSON.stringify({
    s: scope,
    a: [...filterAccountIds].sort((x, y) => x - y),
    df: effectiveDateFrom,
    dt: effectiveDateTo,
    fd: filters.filterDateFrom,
    ft: filters.filterDateTo,
    q: filters.filterDescription.trim().toLowerCase(),
    mn: filters.filterAmountMin.trim(),
    mx: filters.filterAmountMax.trim(),
    c: [...filters.filterCategoryIds].sort((x, y) => x - y),
    sc: [...filters.filterSubcategoryIds].sort((x, y) => x - y),
    sh: [...filters.filterSharedScopes].sort(),
    liq: [...filters.filterLiquidadoValues].sort(),
    tc: [...filters.filterTcPaidValues].sort(),
    am: [...filters.filterAccountingMonthYms].sort(),
  });
}

export type BankingTabTxCacheEntry = {
  items: BankingTransactionRow[];
  total: number;
  page: number;
  sharedUnsettledGroups: BankingSharedUnsettledGroup[];
  provisionPendingGroups: BankingCreditCardUnpaidGroup[];
};

/** Evita crecimiento indefinido del Map al combinar filtros/pestañas/fechas. */
export const BANKING_TAB_CACHE_MAX_ENTRIES = 24;

export function bankingTabCachePut(map: Map<string, BankingTabTxCacheEntry>, key: string, entry: BankingTabTxCacheEntry) {
  if (map.has(key)) map.delete(key);
  map.set(key, entry);
  while (map.size > BANKING_TAB_CACHE_MAX_ENTRIES) {
    const oldest = map.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException ? e.name === "AbortError" : e instanceof Error && e.name === "AbortError";
}

export function scheduleIdlePrefetch(cb: () => void, timeoutMs = 900): number {
  if (typeof requestIdleCallback !== "undefined") {
    return requestIdleCallback(cb, { timeout: timeoutMs }) as unknown as number;
  }
  return window.setTimeout(cb, 380);
}

export function cancelIdlePrefetch(id: number): void {
  if (typeof cancelIdleCallback !== "undefined") cancelIdleCallback(id as never);
  else clearTimeout(id);
}

export const BANKING_BALANCE_CARD_ORDER_STORAGE_KEY = "banking_balance_card_order_v1";
export const BANKING_BALANCE_SCOPE_STORAGE_KEY = "banking_balance_scope_v1";

export type BankingBalanceScope = "ledger" | "through_current_accounting_month";

export function loadBankingBalanceScope(): BankingBalanceScope {
  try {
    const raw = localStorage.getItem(BANKING_BALANCE_SCOPE_STORAGE_KEY);
    if (raw === "through_current_accounting_month") return "through_current_accounting_month";
    return "ledger";
  } catch {
    return "ledger";
  }
}

export function saveBankingBalanceScope(s: BankingBalanceScope) {
  try {
    localStorage.setItem(BANKING_BALANCE_SCOPE_STORAGE_KEY, s);
  } catch {
    /* ignore */
  }
}

export function bankingBalanceScopeQueryParam(s: BankingBalanceScope): string {
  return s === "through_current_accounting_month" ? "?balance_scope=through_current_accounting_month" : "";
}

export function bankingNonCreditAccounts(accounts: BankingAccountRow[]): BankingAccountRow[] {
  return accounts.filter((a) => (a.enabled ?? true) && a.product_type !== "tarjeta_credito");
}

/** Configuración: cuenta líquida incluida en la tarjeta «Saldo real» del resumen. */
export function bankingAccountIncludedInTotalBalance(a: BankingAccountRow): boolean {
  return (a.include_in_total_balance ?? true) !== false;
}

export function bankingAccountAtBank(a: BankingAccountRow): number {
  const p = a.provision_net_sum ?? 0;
  return a.balance_at_bank !== undefined ? a.balance_at_bank : a.balance - p;
}

/** Neto pendiente TC: sum(-amount); cargos negativos suman, devoluciones positivas restan. Alineado al backend. */
export function sumUnpaidTcDebtFromItems(items: BankingTransactionRow[]): number {
  let s = 0;
  for (const tx of items) {
    s += -tx.amount;
  }
  return s;
}

/**
 * Reparte cargos TC no pagados por cuenta corriente asociada (`linked_checking_account_id`).
 * Solo esas TC descuentan el «saldo real» de la cuenta líquida enlazada.
 */
export function creditCardUnpaidAllocatedByChecking(
  accounts: BankingAccountRow[],
  groups: BankingCreditCardUnpaidGroup[],
): { byCheckingId: Map<number, number>; totalLinkedUnpaidClp: number } {
  const byId = new Map(accounts.map((x) => [x.id, x]));
  const byCheckingId = new Map<number, number>();
  for (const g of groups) {
    const tc = byId.get(g.account_id);
    if (!tc || tc.product_type !== "tarjeta_credito") continue;
    const lid = tc.linked_checking_account_id;
    if (lid == null) continue;
    const debt = sumUnpaidTcDebtFromItems(g.items);
    byCheckingId.set(lid, (byCheckingId.get(lid) ?? 0) + debt);
  }
  let totalLinkedUnpaidClp = 0;
  for (const v of byCheckingId.values()) totalLinkedUnpaidClp += v;
  return { byCheckingId, totalLinkedUnpaidClp };
}

/** Conserva el orden guardado; añade cuentas nuevas al final (por nombre). */
export function mergeBalanceCardOrder(prev: number[], rows: BankingAccountRow[]): number[] {
  const idSet = new Set(rows.map((r) => r.id));
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of prev) {
    if (idSet.has(id) && !seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  const newcomers = rows
    .filter((r) => !seen.has(r.id))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  for (const r of newcomers) out.push(r.id);
  return out;
}

export function loadBalanceCardOrder(): number[] {
  try {
    const raw = localStorage.getItem(BANKING_BALANCE_CARD_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is number => typeof x === "number" && Number.isInteger(x));
  } catch {
    return [];
  }
}

export function saveBalanceCardOrder(ids: number[]): void {
  try {
    localStorage.setItem(BANKING_BALANCE_CARD_ORDER_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export const BANKING_PRODUCT_BADGE_LABEL: Record<BankingProductType, string> = {
  cuenta_corriente: "Cuenta corriente",
  cuenta_vista: "Cuenta vista",
  cuenta_prepago: "Cuenta prepago",
  tarjeta_credito: "Tarjeta de crédito",
};

export function bankingProductBadgeLabel(t: BankingProductType | null): string {
  if (t != null) return BANKING_PRODUCT_BADGE_LABEL[t];
  return "Cuenta";
}

export const BANKING_BALANCE_PRIVACY_STRICT_KEY = "banking_tx_balance_strict_privacy_v1";

export function readStoredBalanceStrictPrivacy(): boolean {
  try {
    return localStorage.getItem(BANKING_BALANCE_PRIVACY_STRICT_KEY) === "1";
  } catch {
    return false;
  }
}

/** Monto tapado: ver `maskBankingBalanceText` en bankingTxHelpers. */

export const BANKING_TX_TABLE_PREFS_STORAGE_KEY = "banking_tx_table_prefs_v2";

/** Opciones multi-selección «Tipo de movimiento». Vacío = todas. */
export type BankingTxSharedScopeOption = "personal" | "shared_any";

/** Opciones multi-selección «Compartido liquidado». Vacío = todas. */
export type BankingTxLiquidadoOption = "yes" | "no" | "na";

/** Opciones multi-selección «Cargo TC». Vacío = todas. */
export type BankingTxTcPaidOption = "paid" | "unpaid" | "na";

export function toggleNumInSortedList(prev: number[], id: number): number[] {
  const i = prev.indexOf(id);
  if (i >= 0) return prev.filter((x) => x !== id);
  return [...prev, id].sort((a, b) => a - b);
}

export function toggleEnumInList<T extends string>(prev: T[], v: T): T[] {
  return prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v];
}

export type BankingTxColumnKey =
  | "fecha"
  | "descripcion"
  | "producto"
  | "monto"
  | "categoria"
  | "subcategoria"
  | "tipo_movimiento"
  | "compartido_liquidado"
  | "cargo_tc";

export const BANKING_TX_COLUMN_LABELS: Record<BankingTxColumnKey, string> = {
  fecha: "Fecha",
  descripcion: "Descripción",
  producto: "Producto",
  monto: "Monto",
  categoria: "Categoría",
  subcategoria: "Subcategoría",
  tipo_movimiento: "Tipo de movimiento",
  compartido_liquidado: "Compartido liquidado",
  cargo_tc: "Cargo TC pagado",
};

export const BANKING_TX_COLUMN_KEYS = Object.keys(BANKING_TX_COLUMN_LABELS) as BankingTxColumnKey[];

/** Filtros popover — inputs sobre fondo claro (fintech pastel). */
export const bankingMainTxFilterInputClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 [color-scheme:light] banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:placeholder:text-zinc-500 banking-dark:focus:border-amber-700/55 banking-dark:focus:ring-amber-500/15";

/** Modal nuevo/editar movimiento y toolbars secundarios — controles sobre blanco. */
export const bankingModalControlClass =
  "mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/25 [color-scheme:light] banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:focus:border-amber-700/55 banking-dark:focus:ring-amber-500/15";
/** Etiquetas de campo en modal nuevo/editar movimiento — contraste legible en oscuro. */
export const bankingModalFieldLabelClass =
  "text-xs font-medium text-slate-600 banking-dark:text-zinc-300";
export const bankingModalHelperTextClass =
  "text-[12px] leading-snug text-slate-500 banking-dark:text-zinc-500";
/** Fechas en barra de período — alineado con `dateInputClass` del modal (sin mt / w-full). */
export const bankingToolbarDateInputClass =
  "rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 [color-scheme:light] banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:focus:border-amber-700/55 banking-dark:focus:ring-amber-500/15";
export const bankingModalCategoryTriggerClass =
  "flex w-full items-center justify-between gap-2 overflow-hidden rounded-xl border border-slate-300 bg-white py-2 pl-3 pr-3 text-left text-sm outline-none shadow-sm transition hover:border-indigo-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/25 disabled:cursor-not-allowed disabled:opacity-40 [color-scheme:light] banking-dark:border-amber-900/45 banking-dark:bg-zinc-800 banking-dark:text-zinc-100 banking-dark:shadow-[inset_0_1px_0_0_rgba(254,243,199,0.06)] banking-dark:hover:border-amber-700/55 banking-dark:hover:bg-zinc-700/90 banking-dark:focus:border-amber-500/55 banking-dark:focus:ring-amber-500/25";
/** Campo buscar en desplegables categoría / subcategoría (modal movimiento). */
export const bankingPickerSearchInputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/25 [color-scheme:light] banking-dark:border-amber-800/45 banking-dark:bg-zinc-950 banking-dark:text-zinc-100 banking-dark:placeholder:text-zinc-500 banking-dark:focus:border-amber-500/55 banking-dark:focus:ring-amber-500/20";
/** Lista del panel (el padre debe llevar `.banking-theme` para scrollbar claro en portales). */
export const bankingPickerListScrollClass =
  "tx-scroll max-h-[min(55vh,22rem)] min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-py-1 [-webkit-overflow-scrolling:touch]";
export const bankingToolbarGhostBtnClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-300 banking-dark:hover:border-zinc-500 banking-dark:hover:bg-zinc-800";
export const bankingToolbarGhostBtnMdClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-300 banking-dark:hover:border-zinc-500 banking-dark:hover:bg-zinc-800";
export const bankingAuxActionBtnClass =
  "rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-40 banking-dark:border-amber-600/45 banking-dark:bg-amber-600 banking-dark:text-zinc-950 banking-dark:shadow-[0_1px_2px_rgba(0,0,0,0.28)] banking-dark:hover:border-amber-500/55 banking-dark:hover:bg-amber-500";
export const bankingAuxBulkBtnClass =
  "rounded-xl border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 banking-dark:border-amber-600/45 banking-dark:bg-amber-600 banking-dark:text-zinc-950 banking-dark:shadow-[0_1px_2px_rgba(0,0,0,0.28)] banking-dark:hover:border-amber-500/55 banking-dark:hover:bg-amber-500";

/** Track de un toggle `role="switch"` estilo iOS: pastilla grande sin borde, sin marco fino de "checkbox viejo". */
export function bankingSwitchTrackClass(on: boolean): string {
  return `relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 banking-dark:focus-visible:ring-amber-500/40 banking-dark:focus-visible:ring-offset-zinc-950 ${
    on ? "bg-indigo-600 banking-dark:bg-amber-600" : "bg-slate-200 banking-dark:bg-zinc-700"
  }`;
}
/** Thumb del toggle: círculo blanco con sombra que se desliza según el estado `on`. */
export function bankingSwitchThumbClass(on: boolean): string {
  return `pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-1 ring-slate-900/5 transition-transform banking-dark:ring-white/10 ${
    on ? "translate-x-[22px]" : "translate-x-0.5"
  }`;
}

/** Tabla principal — estilo fintech: bordes suaves, esquinas más redondeadas, sombra leve. */
export const BANKING_MAIN_TX_CARD_CLASS =
  "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm banking-dark:border-zinc-800 banking-dark:bg-zinc-950 banking-dark:shadow-none";
/** Igual que BANKING_MAIN_TX_CARD_CLASS pero sin `overflow-hidden`: para cápsulas que alojan popovers (fechas, filtros) que no deben recortarse. */
export const BANKING_FILTER_CAPSULE_CLASS =
  "rounded-2xl border border-slate-200 bg-white shadow-sm banking-dark:border-zinc-800 banking-dark:bg-zinc-950 banking-dark:shadow-none";
export const BANKING_MAIN_TX_THEAD_CLASS =
  "border-b border-slate-100 bg-slate-50/60 banking-dark:border-zinc-800 banking-dark:bg-zinc-950";
/** Separador por fila (`border-b`): la tabla virtualizada usa `<tr>` de padding sin esta clase — no usar `divide-y` en `<tbody>`. */
export const BANKING_MAIN_TX_TR_CLASS =
  "border-b border-slate-100 bg-white text-slate-800 transition-colors hover:bg-slate-50 banking-dark:border-zinc-800/90 banking-dark:bg-zinc-950 banking-dark:text-zinc-200 banking-dark:hover:bg-zinc-900/85";
/** Fila de la lista de movimientos (div, no tabla) — mismo lenguaje visual que BANKING_MAIN_TX_TR_CLASS. */
export const BANKING_MAIN_TX_ROW_CLASS =
  "flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-2.5 transition-colors hover:bg-slate-50 banking-dark:border-zinc-800/90 banking-dark:bg-zinc-950 banking-dark:hover:bg-zinc-900/85";
export const BANKING_MAIN_TX_FOOTER_CLASS =
  "flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white px-4 py-3 banking-dark:border-zinc-800 banking-dark:bg-zinc-950 banking-dark:text-zinc-400";

/** Pendientes TC / compartido / provisiones — mismo contenedor visual que la tabla principal. */
export const BANKING_AUX_TX_CARD_CLASS =
  "banking-table-scroll overflow-x-auto rounded-2xl border border-slate-200 bg-white pb-2 shadow-sm banking-dark:border-zinc-800 banking-dark:bg-zinc-950 banking-dark:shadow-none";
export const BANKING_AUX_TX_THEAD_CLASS =
  "border-b border-slate-100 bg-slate-50/60 banking-dark:border-zinc-800 banking-dark:bg-zinc-950";
export const BANKING_AUX_TX_TR_CLASS =
  "border-b border-slate-100 bg-white text-slate-800 transition-colors hover:bg-slate-50 banking-dark:border-zinc-800/90 banking-dark:bg-zinc-950 banking-dark:text-zinc-200 banking-dark:hover:bg-zinc-900/85";
export const BANKING_AUX_TX_TH_TEXT_CLASS =
  "text-[12px] font-semibold uppercase tracking-wide text-slate-600 banking-dark:text-zinc-300";
export const BANKING_AUX_SECTION_HEADING_CLASS =
  "text-sm font-semibold text-slate-700 banking-dark:text-zinc-200";

/** Banda tipo “ticket” cuando hay selección de movimientos: menta/teal en claro, ámbar en oscuro. */
export const BANKING_SELECTION_SUMMARY_TICKET_ACTIVE_CLASS =
  "border border-teal-300/90 bg-gradient-to-r from-teal-50 via-emerald-50/95 to-teal-50/85 ring-1 ring-teal-200/85 shadow-sm banking-dark:border-amber-900/50 banking-dark:bg-gradient-to-r banking-dark:from-amber-950/48 banking-dark:via-amber-950/28 banking-dark:to-zinc-950 banking-dark:ring-amber-950/38 banking-dark:shadow-[0_0_34px_-12px_rgba(245,158,11,0.22)]";
export const BANKING_SELECTION_SUMMARY_TICKET_IDLE_CLASS =
  "border border-slate-300 bg-slate-50 text-slate-600 shadow-sm banking-dark:border-zinc-700 banking-dark:bg-zinc-900/75 banking-dark:text-zinc-300 banking-dark:shadow-black/25";
/**
 * Ticket de selección moderno: card plana con acento índigo a la izquierda (mismo lenguaje de
 * BankingNonCreditTotalBalanceCard), en vez del verde/ámbar "chillón" de la versión anterior.
 */
export const BANKING_SELECTION_TICKET_ACCENT_CLASS =
  "border border-slate-200 border-l-[3px] border-l-indigo-700 bg-white shadow-sm banking-dark:border-zinc-700 banking-dark:border-l-indigo-500 banking-dark:bg-zinc-900";
/** Píldora índigo compacta: acciones por fila (Pagado, Reversar). */
export const bankingAuxIndigoPillBtnClass =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-indigo-800 bg-indigo-800 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:border-indigo-700 hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-50 banking-dark:border-indigo-600/70 banking-dark:bg-indigo-700/90 banking-dark:shadow-[0_1px_2px_rgba(0,0,0,0.35)] banking-dark:hover:border-indigo-500 banking-dark:hover:bg-indigo-600";
/** Píldora índigo grande: acciones en lote (Marcar como pagados, Crear reversas). */
export const bankingAuxIndigoBulkBtnClass =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-indigo-800 bg-indigo-800 px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:border-indigo-700 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 banking-dark:border-indigo-600/70 banking-dark:bg-indigo-700/90 banking-dark:shadow-[0_1px_2px_rgba(0,0,0,0.35)] banking-dark:hover:border-indigo-500 banking-dark:hover:bg-indigo-600";

/** Contenedor sección «Movimientos» (pestañas + contenido) — sin caja propia; solo la tabla de abajo lleva borde. */
export const BANKING_MOVEMENTS_SECTION_CLASS = "space-y-3 md:space-y-4";
/** Pestañas tipo píldora flotante (segmented control), separada del contenido — estilo fintech. */
export const BANKING_MOVEMENTS_TAB_BAR_CLASS =
  "inline-flex flex-wrap gap-1 rounded-full border border-slate-200 bg-white p-1.5 shadow-sm banking-dark:border-zinc-800 banking-dark:bg-zinc-900";
export const BANKING_MOVEMENTS_TAB_BTN_BASE =
  "relative min-h-[2.25rem] rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition outline-none focus-visible:z-[2] focus-visible:ring-2 focus-visible:ring-indigo-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white md:px-4 banking-dark:focus-visible:ring-amber-500/35 banking-dark:focus-visible:ring-offset-zinc-950";
export const BANKING_MOVEMENTS_TAB_BTN_ACTIVE = `${BANKING_MOVEMENTS_TAB_BTN_BASE} bg-slate-900 text-white banking-dark:bg-amber-500 banking-dark:text-zinc-950`;
export const BANKING_MOVEMENTS_TAB_BTN_IDLE = `${BANKING_MOVEMENTS_TAB_BTN_BASE} bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900 banking-dark:bg-zinc-900 banking-dark:text-zinc-400 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-200`;

/** Botones ícono filas auxiliares. */
export const txIconBtnAux =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-500 transition hover:border-slate-400 hover:bg-slate-100 hover:text-slate-800 banking-dark:text-zinc-500 banking-dark:hover:border-zinc-600 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-200";
export const txIconBtnAuxDanger = `${txIconBtnAux} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 banking-dark:hover:border-rose-900/60 banking-dark:hover:bg-rose-950/50 banking-dark:hover:text-rose-300`;

/** Siempre visibles; no se pueden ocultar (sí se pueden reordenar). */
export const BANKING_TX_REQUIRED_COLUMNS: readonly BankingTxColumnKey[] = ["fecha", "monto"];

export function isBankingTxColumnRequired(key: BankingTxColumnKey): boolean {
  return BANKING_TX_REQUIRED_COLUMNS.includes(key);
}

/** Ancho por columna para `<col>` / layout fijo (misma lógica que antes). */
export const BANKING_TX_COL_WIDTH: Record<BankingTxColumnKey, string> = {
  fecha: "5.5rem",
  descripcion: "15%",
  producto: "13%",
  monto: "6.25rem",
  categoria: "14%",
  subcategoria: "14%",
  tipo_movimiento: "8.25rem",
  compartido_liquidado: "7.25rem",
  cargo_tc: "6.5rem",
};

/** Tabla «cargos pendientes por TC»: no muestra estas columnas. */
export const BANKING_CC_PENDING_EXCLUDED_COLUMNS = new Set<BankingTxColumnKey>([
  "tipo_movimiento",
  "compartido_liquidado",
  "cargo_tc",
]);

export const DEFAULT_BANKING_TX_COLUMN_ORDER: BankingTxColumnKey[] = [...BANKING_TX_COLUMN_KEYS];

export const DEFAULT_BANKING_TX_COLUMN_VISIBILITY: Record<BankingTxColumnKey, boolean> = Object.fromEntries(
  BANKING_TX_COLUMN_KEYS.map((k) => [k, true]),
) as Record<BankingTxColumnKey, boolean>;

export function normalizeBankingTxVisibility(vis: Record<BankingTxColumnKey, boolean>): Record<BankingTxColumnKey, boolean> {
  const out = { ...DEFAULT_BANKING_TX_COLUMN_VISIBILITY };
  for (const key of BANKING_TX_COLUMN_KEYS) {
    if (typeof vis[key] === "boolean") out[key] = vis[key];
  }
  for (const req of BANKING_TX_REQUIRED_COLUMNS) {
    out[req] = true;
  }
  return out;
}

export function normalizeBankingTxColumnOrder(order: unknown): BankingTxColumnKey[] {
  if (!Array.isArray(order)) return [...DEFAULT_BANKING_TX_COLUMN_ORDER];
  const seen = new Set<BankingTxColumnKey>();
  const out: BankingTxColumnKey[] = [];
  for (const item of order) {
    if (typeof item !== "string") continue;
    const k = item as BankingTxColumnKey;
    if (BANKING_TX_COLUMN_KEYS.includes(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  for (const k of BANKING_TX_COLUMN_KEYS) {
    if (!seen.has(k)) out.push(k);
  }
  return out;
}

/** legacy: solo mapa plano booleano `{ fecha: true, ... }` */
export function visibilityFromLegacyFlat(parsed: Record<string, unknown>): Record<BankingTxColumnKey, boolean> {
  const base = { ...DEFAULT_BANKING_TX_COLUMN_VISIBILITY };
  for (const key of BANKING_TX_COLUMN_KEYS) {
    if (typeof parsed[key] === "boolean") base[key] = parsed[key];
  }
  return normalizeBankingTxVisibility(base);
}

export function readBankingTxPrefsRaw(): string | null {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem(BANKING_TX_TABLE_PREFS_STORAGE_KEY) ??
    localStorage.getItem("banking_tx_column_visibility_v1")
  );
}

export function parseBankingTxTablePreferences(raw: string | null): {
  order: BankingTxColumnKey[];
  visibility: Record<BankingTxColumnKey, boolean>;
} {
  const defaults = (): {
    order: BankingTxColumnKey[];
    visibility: Record<BankingTxColumnKey, boolean>;
  } => ({
    order: [...DEFAULT_BANKING_TX_COLUMN_ORDER],
    visibility: { ...DEFAULT_BANKING_TX_COLUMN_VISIBILITY },
  });
  if (!raw) return defaults();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === "object") {
      if (parsed.v === 2) {
        return {
          order: normalizeBankingTxColumnOrder(parsed.order),
          visibility: normalizeBankingTxVisibility({
            ...DEFAULT_BANKING_TX_COLUMN_VISIBILITY,
            ...(parsed.visibility && typeof parsed.visibility === "object"
              ? (parsed.visibility as Record<BankingTxColumnKey, boolean>)
              : {}),
          }),
        };
      }
      return {
        order: [...DEFAULT_BANKING_TX_COLUMN_ORDER],
        visibility: visibilityFromLegacyFlat(parsed),
      };
    }
  } catch {
    /* ignore */
  }
  return defaults();
}

export function bankingTxSortableColumnId(key: BankingTxColumnKey): UniqueIdentifier {
  return `banking-tx-col-${key}`;
}

export type BankingTxFilterSnapshot = {
  filterDateFrom: string;
  filterDateTo: string;
  filterDescription: string;
  filterAccountIds: number[];
  filterAmountMin: string;
  filterAmountMax: string;
  filterCategoryIds: number[];
  filterSubcategoryIds: number[];
  filterSharedScopes: BankingTxSharedScopeOption[];
  filterLiquidadoValues: BankingTxLiquidadoOption[];
  filterTcPaidValues: BankingTxTcPaidOption[];
  filterAccountingMonthYms: string[];
};

export function bankingTxColumnFilterActive(colKey: BankingTxColumnKey, f: BankingTxFilterSnapshot): boolean {
  switch (colKey) {
    case "fecha":
      return !!(f.filterDateFrom || f.filterDateTo);
    case "descripcion":
      return !!f.filterDescription.trim();
    case "producto":
      return f.filterAccountIds.length > 0;
    case "monto":
      return !!(f.filterAmountMin.trim() || f.filterAmountMax.trim());
    case "categoria":
      return f.filterCategoryIds.length > 0;
    case "subcategoria":
      return f.filterSubcategoryIds.length > 0;
    case "tipo_movimiento":
      return f.filterSharedScopes.length > 0;
    case "compartido_liquidado":
      return f.filterLiquidadoValues.length > 0;
    case "cargo_tc":
      return f.filterTcPaidValues.length > 0;
    default:
      return false;
  }
}

export function bankingTxThBaseClass(colKey: BankingTxColumnKey): string {
  switch (colKey) {
    case "fecha":
      return "";
    case "descripcion":
      return "min-w-0";
    case "producto":
      return "min-w-0";
    case "monto":
      return "whitespace-nowrap";
    case "categoria":
      return "min-w-0";
    case "subcategoria":
      return "min-w-0";
    case "tipo_movimiento":
      return "min-w-0 whitespace-normal leading-tight";
    case "compartido_liquidado":
      return "min-w-0 whitespace-normal leading-tight";
    case "cargo_tc":
      return "min-w-0 whitespace-normal leading-tight";
    default:
      return "";
  }
}

/** Neto que aporta al pendiente TC: `-amount` (cargo negativo aumenta lo adeudado; devolución positiva lo reduce). */
export function tcUnpaidNetContributionClp(row: BankingTransactionRow): number {
  return -row.amount;
}

/** Cuota por persona con signo (egreso negativo, devolución positiva); alinea con el total de la tarjeta. */
export function sharedPendingPerPersonClp(row: BankingTransactionRow): number {
  const ap = row.amount_per_person;
  if (ap != null && !Number.isNaN(Number(ap))) {
    return Number(ap);
  }
  const n = row.split_participants != null && row.split_participants >= 1 ? row.split_participants : 1;
  return row.amount / n;
}

export const dateInputClass =
  "mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 [color-scheme:light] banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:focus:border-amber-700/55 banking-dark:focus:ring-amber-500/15";

export function pickDate(e: ReactMouseEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  el.showPicker?.();
}

export function monthInputFromRow(row: BankingTransactionRow): string {
  const am = row.accounting_month;
  if (am) return am.slice(0, 7);
  return row.fecha.slice(0, 7);
}

export function firstDayIsoFromMonthInput(ym: string): string {
  return `${ym}-01`;
}

/** `ym` = YYYY-MM → "Abr 2026" (mes abreviado en español). */
export const ACCOUNTING_MONTH_ABBR_ES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

export function parseAccountingYm(ym: string): { y: number; m: number } {
  const parts = ym.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!y || !m || m < 1 || m > 12) {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }
  return { y, m };
}

export function buildYm(y: number, m: number): string {
  return `${y}-${String(Math.min(12, Math.max(1, m))).padStart(2, "0")}`;
}

/** Lista de años alrededor del año central (p. ej. selector solo año). */
export function accountingYearRange(centerY: number): number[] {
  const out: number[] = [];
  for (let i = centerY - 15; i <= centerY + 15; i++) {
    if (i >= 1970 && i <= 2100) out.push(i);
  }
  return out;
}

