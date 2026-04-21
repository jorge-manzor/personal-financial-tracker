import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { apiFetch, fetchJson, patchJson, postJson } from "./api";
import { formatBankingClpSigned, formatClpDots } from "./format";
import type {
  BankingAccountRow,
  BankingCategoryRow,
  BankingCreditCardUnpaidGroup,
  BankingSharedUnsettledGroup,
  BankingDebtTotalsOut,
  BankingProductType,
  BankingTransactionRow,
} from "./types";

/** Plantilla seed: Transferencia → Entre cuentas propias */
const BANKING_TEMPLATE_CAT_TRANSFERENCIA = 19;
const BANKING_TEMPLATE_SUB_ENTRE_CUENTAS_PROPIAS = 1901;
/** Plantilla seed: categoría Provisiones (reversa solo para estos movimientos). */
const BANKING_TEMPLATE_CAT_PROVISIONES = 21;

/** Movimientos por página (coincide con GET /banking/transactions `page_size`). */
const BANKING_TX_PAGE_SIZE = 200;

const BANKING_BALANCE_CARD_ORDER_STORAGE_KEY = "banking_balance_card_order_v1";

function bankingNonCreditAccounts(accounts: BankingAccountRow[]): BankingAccountRow[] {
  return accounts.filter((a) => (a.enabled ?? true) && a.product_type !== "tarjeta_credito");
}

/** Conserva el orden guardado; añade cuentas nuevas al final (por nombre). */
function mergeBalanceCardOrder(prev: number[], rows: BankingAccountRow[]): number[] {
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

function loadBalanceCardOrder(): number[] {
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

function saveBalanceCardOrder(ids: number[]): void {
  try {
    localStorage.setItem(BANKING_BALANCE_CARD_ORDER_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function IconPencil({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
      />
    </svg>
  );
}

/** Flecha en U hacia la izquierda — metáfora clásica de «revertir / deshacer». */
function IconTrash({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
      />
    </svg>
  );
}

function IconCalendar({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

function IconColumns({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" d="M5 4v16M12 4v16M19 4v16" />
    </svg>
  );
}

const BANKING_PRODUCT_BADGE_LABEL: Record<BankingProductType, string> = {
  cuenta_corriente: "Cuenta corriente",
  cuenta_vista: "Cuenta vista",
  cuenta_prepago: "Cuenta prepago",
  tarjeta_credito: "Tarjeta de crédito",
};

function bankingProductBadgeLabel(t: BankingProductType | null): string {
  if (t != null) return BANKING_PRODUCT_BADGE_LABEL[t];
  return "Cuenta";
}

/** Tarjeta de saldo (estilo alineado con Fondos en inversiones). */
function BankingAccountBalanceCard({ account: a }: { account: BankingAccountRow }) {
  const inactive = Math.abs(a.balance) < 1e-9;
  const prov = a.provision_net_sum ?? 0;
  const atBank =
    a.balance_at_bank !== undefined ? a.balance_at_bank : a.balance - prov;

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col rounded-lg border bg-gradient-to-br from-sky-950/90 via-[#0a1520] to-[#0f1a26] p-3 shadow-md ring-1 ring-sky-500/20 ${
        inactive ? "border-sky-900/50 opacity-[0.92]" : "border-sky-700/35"
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sky-950/85 ring-1 ring-sky-400/25"
          aria-hidden
        >
          <svg className="h-4 w-4 text-sky-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 10h18M5 10V8a2 2 0 012-2h10a2 2 0 012 2v2M5 10v10h14V10M9 14h6"
            />
          </svg>
        </div>
        <span className="max-w-[55%] shrink-0 truncate rounded-full bg-sky-950/75 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-200/95">
          {bankingProductBadgeLabel(a.product_type)}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 min-h-[2rem] text-sm font-bold leading-snug text-white">{a.name}</p>

      <p
        className="mt-1.5 text-lg font-bold tabular-nums tracking-tight text-white"
        title="Saldo real (libro): saldo inicial + suma de movimientos (incluye efecto neto de provisiones)."
      >
        {formatClpDots(a.balance)}
      </p>
      <div className="mt-1 border-t border-sky-800/55 pt-1">
        <div className="grid grid-cols-2 gap-x-2 gap-y-0 leading-none">
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-wide text-sky-500/85">Saldo actual</p>
            <p
              className="mt-0.5 truncate text-[12px] font-semibold tabular-nums leading-tight text-[#e6edf3]"
              title="Efectivo en cuenta (libro menos neto de Provisiones)."
            >
              {formatClpDots(atBank)}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[9px] font-medium uppercase tracking-wide text-sky-500/85">Provisiones</p>
            <p
              className="mt-0.5 truncate text-[12px] font-semibold tabular-nums leading-tight text-[#f87171]"
              title="Monto neto en categoría Provisiones (reversas netean)."
            >
              {formatClpDots(Math.abs(prov))}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Resumen: suma de saldos (cuentas no TC); mismo tamaño/criterios que tarjetas por cuenta. */
function BankingNonCreditTotalBalanceCard({ accounts }: { accounts: BankingAccountRow[] }) {
  const totalReal = accounts.reduce((s, a) => s + a.balance, 0);
  const totalAtBank = accounts.reduce((s, a) => {
    const p = a.provision_net_sum ?? 0;
    const at = a.balance_at_bank !== undefined ? a.balance_at_bank : a.balance - p;
    return s + at;
  }, 0);
  const provisionSumDisplay = accounts.reduce((s, a) => s + Math.abs(a.provision_net_sum ?? 0), 0);
  const inactive = Math.abs(totalReal) < 1e-9;

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col rounded-lg border bg-gradient-to-br from-emerald-950/95 via-[#0c1914] to-[#141c18] p-3 shadow-md ring-1 ring-emerald-500/25 ${
        inactive ? "border-emerald-800/40 opacity-[0.92]" : "border-emerald-600/35"
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-950/90 ring-1 ring-emerald-500/35"
          aria-hidden
        >
          <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <span className="max-w-[58%] shrink-0 truncate rounded-full bg-emerald-950/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-200/95">
          Total
        </span>
      </div>

      <p className="mt-2 line-clamp-2 min-h-[2rem] text-sm font-bold leading-snug text-white">Saldo total</p>

      <p
        className="mt-1.5 text-lg font-bold tabular-nums tracking-tight text-emerald-50"
        title="Suma de saldos libro (saldo real) de cuentas no tarjeta de crédito."
      >
        {formatClpDots(totalReal)}
      </p>
      <div className="mt-1 border-t border-emerald-800/60 pt-1">
        <div className="grid grid-cols-2 gap-x-2 gap-y-0 leading-none">
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-wide text-emerald-500/90">Saldo actual</p>
            <p
              className="mt-0.5 truncate text-[12px] font-semibold tabular-nums leading-tight text-[#e6edf3]"
              title="Suma de saldos «en banco» por cuenta."
            >
              {formatClpDots(totalAtBank)}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="text-[9px] font-medium uppercase tracking-wide text-emerald-500/90">Provisiones</p>
            <p
              className="mt-0.5 truncate text-[12px] font-semibold tabular-nums leading-tight text-[#f87171]"
              title="Suma por cuenta del valor absoluto del neto en Provisiones."
            >
              {formatClpDots(provisionSumDisplay)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Cargos en tarjetas de crédito marcados como no pagados (suma de egresos pendientes). */
function BankingCreditCardUnpaidDebtCard({ amountClp }: { amountClp: number }) {
  const inactive = Math.abs(amountClp) < 1e-9;
  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col rounded-lg border bg-gradient-to-br from-zinc-900/95 via-[#1c1c1f] to-[#141416] p-3 shadow-md ring-1 ring-zinc-500/20 ${
        inactive ? "border-zinc-700/55 opacity-[0.92]" : "border-zinc-600/40"
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-950/90 ring-1 ring-zinc-600/35"
          aria-hidden
        >
          <svg className="h-4 w-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 10h20M6 14h4m8 0h4M8 18h8M6 6h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2z" />
          </svg>
        </div>
        <span className="ml-auto max-w-[calc(100%-2.75rem)] rounded-md bg-zinc-950/85 px-1.5 py-1 text-right text-[8px] font-bold uppercase leading-tight tracking-wide text-zinc-300/95">
          Tarjetas de crédito
        </span>
      </div>
      <p className="mt-2 line-clamp-2 min-h-[2rem] text-sm font-bold leading-snug text-white">Deuda TC</p>
      <p
        className="mt-1.5 text-lg font-bold tabular-nums tracking-tight text-zinc-100"
        title="Suma de cargos en cuentas tarjeta de crédito con «cargo TC pagado» = No."
      >
        {formatClpDots(amountClp)}
      </p>
    </div>
  );
}

/** Movimientos compartidos aún sin marcar como liquidados (suma de |monto|). */
function BankingSharedUnsettledDebtCard({ amountClp }: { amountClp: number }) {
  const inactive = Math.abs(amountClp) < 1e-9;
  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col rounded-lg border bg-gradient-to-br from-neutral-900/95 via-[#1a1a1d] to-[#121214] p-3 shadow-md ring-1 ring-neutral-500/18 ${
        inactive ? "border-neutral-700/55 opacity-[0.92]" : "border-neutral-600/38"
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-950/90 ring-1 ring-neutral-600/30"
          aria-hidden
        >
          <svg className="h-4 w-4 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
            />
          </svg>
        </div>
        <span className="max-w-[58%] shrink-0 truncate rounded-full bg-neutral-950/85 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-neutral-300/95">
          Compartido
        </span>
      </div>
      <p className="mt-2 line-clamp-2 min-h-[2rem] text-sm font-bold leading-snug text-white">Pago Compartido</p>
      <p
        className="mt-1.5 text-lg font-bold tabular-nums tracking-tight text-neutral-100"
        title="Suma de valores absolutos de movimientos compartidos con liquidación pendiente."
      >
        {formatClpDots(amountClp)}
      </p>
    </div>
  );
}

const BANKING_TX_TABLE_PREFS_STORAGE_KEY = "banking_tx_table_prefs_v2";

/** Columna «Tipo de movimiento»: personal vs compartido. */
type BankingTxSharedScopeFilter = "all" | "personal" | "shared_any";

/** Columna «Compartido liquidado». */
type BankingTxLiquidadoFilter = "all" | "yes" | "no" | "na";

/** Filtro cargo TC pagado. */
type BankingTxTcPaidFilter = "all" | "paid" | "unpaid" | "na";

type BankingTxColumnKey =
  | "fecha"
  | "descripcion"
  | "producto"
  | "monto"
  | "categoria"
  | "subcategoria"
  | "tipo_movimiento"
  | "compartido_liquidado"
  | "cargo_tc"
  | "mes_contable";

const BANKING_TX_COLUMN_LABELS: Record<BankingTxColumnKey, string> = {
  fecha: "Fecha",
  descripcion: "Descripción",
  producto: "Producto",
  monto: "Monto",
  categoria: "Categoría",
  subcategoria: "Subcategoría",
  tipo_movimiento: "Tipo de movimiento",
  compartido_liquidado: "Compartido liquidado",
  cargo_tc: "Cargo TC pagado",
  mes_contable: "Mes contable",
};

const BANKING_TX_COLUMN_KEYS = Object.keys(BANKING_TX_COLUMN_LABELS) as BankingTxColumnKey[];

/** Filtros del popover de la tabla principal: menos contraste «negro sobre carbón». */
const bankingMainTxFilterInputClass =
  "mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-2.5 py-2 text-sm text-white outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 [color-scheme:dark]";

/**
 * Tabla principal — paleta Slate (Tailwind): superficie única por fila, sin rayas alternas.
 * Referencia habitual en dark UI (contraste estable, menos fatiga visual).
 */
const BANKING_MAIN_TX_CARD_CLASS =
  "banking-table-scroll overflow-x-auto rounded-xl border border-slate-600 bg-slate-900 pb-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-black/25";
const BANKING_MAIN_TX_TOOLBAR_CLASS =
  "sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-900 px-3 py-2";
const BANKING_MAIN_TX_THEAD_CLASS = "border-b border-slate-700 bg-slate-950";
const BANKING_MAIN_TX_TBODY_CLASS = "divide-y divide-slate-700/90";
const BANKING_MAIN_TX_TR_CLASS = "bg-slate-800 text-slate-100 transition-colors hover:bg-slate-700";
const BANKING_MAIN_TX_FOOTER_CLASS =
  "flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 bg-slate-900 px-3 py-2.5";

/** Pendientes TC / compartidos: mismo sistema Slate, sin zebra. */
const BANKING_AUX_TX_CARD_CLASS =
  "banking-table-scroll overflow-x-auto rounded-xl border border-slate-600 bg-slate-900 pb-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-black/25";
const BANKING_AUX_TX_THEAD_CLASS = "border-b border-slate-700 bg-slate-950";
const BANKING_AUX_TX_TBODY_CLASS = "divide-y divide-slate-700/90";
const BANKING_AUX_TX_TR_CLASS = "bg-slate-800 text-slate-100 transition-colors hover:bg-slate-700";
const BANKING_AUX_TX_TH_TEXT_CLASS = "text-[12px] font-semibold uppercase tracking-wide text-slate-400";
const BANKING_AUX_SECTION_HEADING_CLASS = "text-sm font-semibold text-slate-100";

/** Contenedor pestañas «Movimientos». */
const BANKING_MOVEMENTS_SECTION_CLASS =
  "overflow-hidden rounded-xl border border-slate-600 bg-slate-900 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-black/25";
const BANKING_MOVEMENTS_TABLIST_CLASS =
  "flex flex-wrap gap-1 border-b border-slate-700 bg-slate-950 px-2 pt-2";

/** Botones ícono sobre filas Slate. */
const txIconBtnAux =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-slate-600 hover:bg-slate-700 hover:text-sky-400";
const txIconBtnAuxDanger = `${txIconBtnAux} hover:text-red-400`;

/** Casillas en tablas auxiliares. */
const BANKING_AUX_CHECKBOX_CLASS =
  "h-4 w-4 rounded border-slate-500 bg-slate-700 accent-emerald-600";

/** Siempre visibles; no se pueden ocultar (sí se pueden reordenar). */
const BANKING_TX_REQUIRED_COLUMNS: readonly BankingTxColumnKey[] = ["fecha", "monto"];

function isBankingTxColumnRequired(key: BankingTxColumnKey): boolean {
  return BANKING_TX_REQUIRED_COLUMNS.includes(key);
}

/** Ancho por columna para `<col>` / layout fijo (misma lógica que antes). */
const BANKING_TX_COL_WIDTH: Record<BankingTxColumnKey, string> = {
  fecha: "5.5rem",
  descripcion: "15%",
  producto: "13%",
  monto: "6.25rem",
  categoria: "14%",
  subcategoria: "14%",
  tipo_movimiento: "8.25rem",
  compartido_liquidado: "7.25rem",
  cargo_tc: "6.5rem",
  mes_contable: "6rem",
};

/** Tabla «cargos pendientes por TC»: no muestra estas columnas. */
const BANKING_CC_PENDING_EXCLUDED_COLUMNS = new Set<BankingTxColumnKey>([
  "tipo_movimiento",
  "compartido_liquidado",
  "mes_contable",
]);

const DEFAULT_BANKING_TX_COLUMN_ORDER: BankingTxColumnKey[] = [...BANKING_TX_COLUMN_KEYS];

const DEFAULT_BANKING_TX_COLUMN_VISIBILITY: Record<BankingTxColumnKey, boolean> = Object.fromEntries(
  BANKING_TX_COLUMN_KEYS.map((k) => [k, true]),
) as Record<BankingTxColumnKey, boolean>;

function normalizeBankingTxVisibility(vis: Record<BankingTxColumnKey, boolean>): Record<BankingTxColumnKey, boolean> {
  const out = { ...DEFAULT_BANKING_TX_COLUMN_VISIBILITY };
  for (const key of BANKING_TX_COLUMN_KEYS) {
    if (typeof vis[key] === "boolean") out[key] = vis[key];
  }
  for (const req of BANKING_TX_REQUIRED_COLUMNS) {
    out[req] = true;
  }
  return out;
}

function normalizeBankingTxColumnOrder(order: unknown): BankingTxColumnKey[] {
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
function visibilityFromLegacyFlat(parsed: Record<string, unknown>): Record<BankingTxColumnKey, boolean> {
  const base = { ...DEFAULT_BANKING_TX_COLUMN_VISIBILITY };
  for (const key of BANKING_TX_COLUMN_KEYS) {
    if (typeof parsed[key] === "boolean") base[key] = parsed[key];
  }
  return normalizeBankingTxVisibility(base);
}

function readBankingTxPrefsRaw(): string | null {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem(BANKING_TX_TABLE_PREFS_STORAGE_KEY) ??
    localStorage.getItem("banking_tx_column_visibility_v1")
  );
}

function parseBankingTxTablePreferences(raw: string | null): {
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

function bankingTxSortableColumnId(key: BankingTxColumnKey): UniqueIdentifier {
  return `banking-tx-col-${key}`;
}

/** Asa ⋮⋮ para reordenar columnas en el panel. */
function IconGripVertical({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 6a2 2 0 11-4 0 2 2 0 014 0zM8 12a2 2 0 11-4 0 2 2 0 014 0zM8 18a2 2 0 11-4 0 2 2 0 014 0zM20 6a2 2 0 11-4 0 2 2 0 014 0zM20 12a2 2 0 11-4 0 2 2 0 014 0zM20 18a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function SortableBankingBalanceCard({ account }: { account: BankingAccountRow }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
    transition: { duration: 200, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`h-full min-h-0 touch-none select-none ${isDragging ? "relative z-20 cursor-grabbing" : "cursor-grab"}`}
      {...attributes}
      {...listeners}
      title={`Arrastra para cambiar el orden · ${account.name}`}
    >
      <BankingAccountBalanceCard account={account} />
    </div>
  );
}

/** Mismo patrón visual que `BankingEnabledToggle` en ajustes bancarios (switch redondo verde / gris). */
function BankingTxColumnVisibilityToggle({
  on,
  disabled,
  onToggle,
  ariaLabel,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      className={`inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full border p-[3px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:ring-offset-2       focus-visible:ring-offset-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "justify-end border-emerald-700 bg-emerald-600/90" : "justify-start border-slate-600 bg-slate-800"
      }`}
    >
      <span className="pointer-events-none block h-3.5 w-3.5 shrink-0 rounded-full bg-white shadow" />
    </button>
  );
}

type BankingTxFilterSnapshot = {
  filterDateFrom: string;
  filterDateTo: string;
  filterDescription: string;
  filterAccountId: number | "";
  filterAmountMin: string;
  filterAmountMax: string;
  filterCategoryId: number | "";
  filterSubcategoryId: number | "";
  filterSharedScope: BankingTxSharedScopeFilter;
  filterLiquidado: BankingTxLiquidadoFilter;
  filterTcPaid: BankingTxTcPaidFilter;
  filterAccountingMonthYm: string;
};

function bankingTxColumnFilterActive(colKey: BankingTxColumnKey, f: BankingTxFilterSnapshot): boolean {
  switch (colKey) {
    case "fecha":
      return !!(f.filterDateFrom || f.filterDateTo);
    case "descripcion":
      return !!f.filterDescription.trim();
    case "producto":
      return f.filterAccountId !== "";
    case "monto":
      return !!(f.filterAmountMin.trim() || f.filterAmountMax.trim());
    case "categoria":
      return f.filterCategoryId !== "";
    case "subcategoria":
      return f.filterSubcategoryId !== "";
    case "tipo_movimiento":
      return f.filterSharedScope !== "all";
    case "compartido_liquidado":
      return f.filterLiquidado !== "all";
    case "cargo_tc":
      return f.filterTcPaid !== "all";
    case "mes_contable":
      return f.filterAccountingMonthYm.trim() !== "";
    default:
      return false;
  }
}

function bankingTxThBaseClass(colKey: BankingTxColumnKey): string {
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
    case "mes_contable":
      return "whitespace-nowrap";
    default:
      return "";
  }
}

type BankingTxFilterUICtxValue = {
  headerFilterOpen: BankingTxColumnKey | null;
  toggleHeaderFilter: (k: BankingTxColumnKey) => void;
  registerHeaderCellRef: (k: BankingTxColumnKey, el: HTMLTableCellElement | null) => void;
  isColumnFilterActive: (k: BankingTxColumnKey) => boolean;
  filterDateFrom: string;
  setFilterDateFrom: (v: string) => void;
  filterDateTo: string;
  setFilterDateTo: (v: string) => void;
  filterDescription: string;
  setFilterDescription: (v: string) => void;
  filterAccountId: number | "";
  setFilterAccountId: (v: number | "") => void;
  filterAmountMin: string;
  setFilterAmountMin: (v: string) => void;
  filterAmountMax: string;
  setFilterAmountMax: (v: string) => void;
  filterCategoryId: number | "";
  setFilterCategoryId: (v: number | "") => void;
  filterSubcategoryId: number | "";
  setFilterSubcategoryId: (v: number | "") => void;
  filterSharedScope: BankingTxSharedScopeFilter;
  setFilterSharedScope: (v: BankingTxSharedScopeFilter) => void;
  filterLiquidado: BankingTxLiquidadoFilter;
  setFilterLiquidado: (v: BankingTxLiquidadoFilter) => void;
  filterTcPaid: BankingTxTcPaidFilter;
  setFilterTcPaid: (v: BankingTxTcPaidFilter) => void;
  filterAccountingMonthYm: string;
  setFilterAccountingMonthYm: (v: string) => void;
  filterAccountsSorted: BankingAccountRow[];
  filterCategoriesSorted: BankingCategoryRow[];
  filterSubcategoryDropdownRows: { id: number; label: string; categoryId: number; categoryColor: string }[];
};

const BankingTxFilterUICtx = createContext<BankingTxFilterUICtxValue | null>(null);

function useBankingTxFilterUICtx(): BankingTxFilterUICtxValue {
  const v = useContext(BankingTxFilterUICtx);
  if (!v) throw new Error("BankingTx filter UI context missing");
  return v;
}

function BankingTxColumnHeader({ colKey }: { colKey: BankingTxColumnKey }) {
  const ctx = useBankingTxFilterUICtx();
  const label = BANKING_TX_COLUMN_LABELS[colKey];
  const active = ctx.isColumnFilterActive(colKey);
  const open = ctx.headerFilterOpen === colKey;
  const base = bankingTxThBaseClass(colKey);
  const titleSize =
    colKey === "categoria" || colKey === "subcategoria" ? "text-[11.5px]" : "text-[12px]";
  return (
    <th
      ref={(el) => ctx.registerHeaderCellRef(colKey, el)}
      className={`${base} align-bottom p-0`}
    >
      <button
        type="button"
        onClick={() => ctx.toggleHeaderFilter(colKey)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`w-full px-2 py-2.5 text-center transition sm:px-2.5 ${
          open ? "bg-slate-900 ring-1 ring-inset ring-sky-500/35" : "hover:bg-slate-900/90"
        }`}
      >
        <span className={`block ${titleSize} font-semibold uppercase tracking-wide text-slate-400`}>{label}</span>
        <span
          className={`mt-0.5 block text-[9px] font-medium normal-case tracking-normal ${
            active ? "text-emerald-400" : "text-[#8e9aab]"
          }`}
        >
          {active ? "Filtro activo" : "Filtrar"}
        </span>
      </button>
    </th>
  );
}

function BankingTxHeaderFilterFields({ colKey }: { colKey: BankingTxColumnKey }) {
  const ctx = useBankingTxFilterUICtx();
  const sel = bankingMainTxFilterInputClass;

  switch (colKey) {
    case "fecha":
      return (
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-[#8b949e]">Fecha desde</span>
            <input
              type="date"
              value={ctx.filterDateFrom}
              onChange={(e) => ctx.setFilterDateFrom(e.target.value)}
              className={`${sel} mt-1 cursor-pointer`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-[#8b949e]">Fecha hasta</span>
            <input
              type="date"
              value={ctx.filterDateTo}
              onChange={(e) => ctx.setFilterDateTo(e.target.value)}
              className={`${sel} mt-1 cursor-pointer`}
            />
          </label>
        </div>
      );
    case "descripcion":
      return (
        <label className="block">
          <span className="text-xs text-[#8b949e]">Contiene texto</span>
          <input
            type="search"
            value={ctx.filterDescription}
            onChange={(e) => ctx.setFilterDescription(e.target.value)}
            placeholder="Buscar en la descripción…"
            autoComplete="off"
            className={`${sel} mt-1`}
          />
        </label>
      );
    case "producto":
      return (
        <label className="block">
          <span className="text-xs text-[#8b949e]">Producto</span>
          <select
            value={ctx.filterAccountId === "" ? "" : String(ctx.filterAccountId)}
            onChange={(e) => ctx.setFilterAccountId(e.target.value ? Number(e.target.value) : "")}
            className={`${sel} mt-1`}
          >
            <option value="">Todos</option>
            {ctx.filterAccountsSorted.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      );
    case "monto":
      return (
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-[#8b949e]">Monto mínimo</span>
            <input
              inputMode="decimal"
              value={ctx.filterAmountMin}
              onChange={(e) => ctx.setFilterAmountMin(e.target.value)}
              placeholder="Ej. -50000"
              className={`${sel} mt-1`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-[#8b949e]">Monto máximo</span>
            <input
              inputMode="decimal"
              value={ctx.filterAmountMax}
              onChange={(e) => ctx.setFilterAmountMax(e.target.value)}
              placeholder="Ej. 250000"
              className={`${sel} mt-1`}
            />
          </label>
        </div>
      );
    case "categoria":
      return (
        <div className="space-y-2">
          <span className="text-xs text-[#8b949e]">Categoría</span>
          <div className="mt-1 max-h-[min(50vh,280px)] space-y-1 overflow-y-auto pr-0.5 tx-scroll">
            <button
              type="button"
              onClick={() => ctx.setFilterCategoryId("")}
              className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-slate-800/90 ${
                ctx.filterCategoryId === "" ? "border-sky-500/50 ring-1 ring-sky-500/35" : "border-slate-600"
              }`}
            >
              <span className="text-[#e6edf3]">Todas</span>
            </button>
            {ctx.filterCategoriesSorted.map((c) => {
              const picked = ctx.filterCategoryId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => ctx.setFilterCategoryId(c.id)}
                  className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-slate-800/80 ${
                    picked ? "border-sky-500/45 bg-slate-800 ring-1 ring-sky-500/35" : "border border-slate-700"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
          {ctx.filterCategoriesSorted.length === 0 ? (
            <p className="text-[12px] leading-snug text-[#8b949e]">No hay categorías en los movimientos cargados.</p>
          ) : null}
        </div>
      );
    case "subcategoria":
      return (
        <div className="space-y-2">
          <span className="text-xs text-[#8b949e]">Subcategoría</span>
          <div className="mt-1 max-h-[min(50vh,280px)] space-y-1 overflow-y-auto pr-0.5 tx-scroll">
            <button
              type="button"
              onClick={() => ctx.setFilterSubcategoryId("")}
              className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-slate-800/90 ${
                ctx.filterSubcategoryId === "" ? "border-sky-500/50 ring-1 ring-sky-500/35" : "border-slate-600"
              }`}
            >
              <span className="text-[#e6edf3]">Todas</span>
            </button>
            {ctx.filterSubcategoryDropdownRows.map((r) => {
              const picked = ctx.filterSubcategoryId === r.id;
              const shortLabel =
                ctx.filterCategoryId === "" ? r.label : (r.label.split(" › ").pop() ?? r.label);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => ctx.setFilterSubcategoryId(r.id)}
                  className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm font-medium text-slate-100 transition hover:bg-slate-800/80 ${
                    picked ? "border-sky-500/45 bg-slate-800 ring-1 ring-sky-500/35" : "border border-slate-700"
                  }`}
                >
                  {shortLabel}
                </button>
              );
            })}
          </div>
          {ctx.filterSubcategoryDropdownRows.length === 0 ? (
            <p className="text-[12px] leading-snug text-[#8b949e]">
              No hay subcategorías en los movimientos cargados
              {ctx.filterCategoryId !== "" ? " para esta categoría." : "."}
            </p>
          ) : null}
        </div>
      );
    case "tipo_movimiento":
      return (
        <label className="block">
          <span className="text-xs text-[#8b949e]">Tipo</span>
          <select
            value={ctx.filterSharedScope}
            onChange={(e) => ctx.setFilterSharedScope(e.target.value as BankingTxSharedScopeFilter)}
            className={`${sel} mt-1`}
          >
            <option value="all">Todos</option>
            <option value="personal">Solo personal</option>
            <option value="shared_any">Solo compartido</option>
          </select>
        </label>
      );
    case "compartido_liquidado":
      return (
        <label className="block">
          <span className="text-xs text-[#8b949e]">Valor en tabla</span>
          <select
            value={ctx.filterLiquidado}
            onChange={(e) => ctx.setFilterLiquidado(e.target.value as BankingTxLiquidadoFilter)}
            className={`${sel} mt-1`}
          >
            <option value="all">Todos</option>
            <option value="yes">Sí</option>
            <option value="no">No</option>
            <option value="na">—</option>
          </select>
        </label>
      );
    case "cargo_tc":
      return (
        <label className="block">
          <span className="text-xs text-[#8b949e]">Valor en tabla</span>
          <select
            value={ctx.filterTcPaid}
            onChange={(e) => ctx.setFilterTcPaid(e.target.value as BankingTxTcPaidFilter)}
            className={`${sel} mt-1`}
          >
            <option value="all">Todos</option>
            <option value="paid">Sí</option>
            <option value="unpaid">No</option>
            <option value="na">—</option>
          </select>
        </label>
      );
    case "mes_contable":
      return (
        <label className="block">
          <span className="text-xs text-[#8b949e]">Mes contable</span>
          <input
            type="month"
            value={ctx.filterAccountingMonthYm}
            onChange={(e) => ctx.setFilterAccountingMonthYm(e.target.value)}
            className={`${sel} mt-1 cursor-pointer`}
          />
        </label>
      );
    default:
      return null;
  }
}

/** Píldora Sí / No / — para columnas Compartido liquidado y Cargo TC. */
function BankingTxSiNoDashBadge({ text }: { text: string }) {
  if (text === "—") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-md bg-[#21262d]/90 px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-[#8b949e] ring-1 ring-[#30363d]">
        —
      </span>
    );
  }
  if (text === "Sí") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-md bg-emerald-500/18 px-1.5 py-0.5 text-[12px] font-semibold text-emerald-300 ring-1 ring-emerald-500/40">
        Sí
      </span>
    );
  }
  if (text === "No") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-md bg-rose-500/18 px-1.5 py-0.5 text-[12px] font-semibold text-rose-300 ring-1 ring-rose-500/40">
        No
      </span>
    );
  }
  return <span className="text-[12px] text-[#8b949e]">{text}</span>;
}

function BankingTxTd({
  colKey,
  row,
  income,
  sharedSettledLabel,
  ccPaidLabel,
  accountingLabel,
}: {
  colKey: BankingTxColumnKey;
  row: BankingTransactionRow;
  income: boolean;
  sharedSettledLabel: string;
  ccPaidLabel: string;
  accountingLabel: string;
}) {
  switch (colKey) {
    case "fecha":
      return (
        <td className="align-middle whitespace-nowrap px-2 py-3 text-center text-[12px] text-[#e6edf3] sm:px-2.5">
          {row.fecha.slice(0, 10)}
        </td>
      );
    case "descripcion":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-left text-[12px] leading-snug text-[#c9d1d9] sm:px-2.5">
          <span className="line-clamp-3 break-words [overflow-wrap:anywhere]">
            {row.description?.trim() || "—"}
          </span>
        </td>
      );
    case "producto":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-center text-[12px] text-[#e6edf3] sm:px-2.5">
          <span className="line-clamp-3 break-words [overflow-wrap:anywhere]">{row.account_name}</span>
        </td>
      );
    case "monto": {
      /** Colores como actividad de inversiones; tamaño más compacto que la lista principal. */
      const signClass = income ? "text-[#4ade80]" : "text-[#f87171]";
      const text = `${income ? "+" : "-"}${formatBankingClpSigned(row.amount)}`;
      return (
        <td className="align-middle whitespace-nowrap px-2 py-3 sm:px-2.5">
          <div className="flex w-full justify-end">
            <span className={`text-[12px] font-semibold tabular-nums ${signClass}`}>{text}</span>
          </div>
        </td>
      );
    }
    case "categoria":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-center text-[11.5px] text-slate-100 sm:px-2.5">
          <span className="line-clamp-2 break-words font-medium leading-snug [overflow-wrap:anywhere]">
            {row.category_name}
          </span>
        </td>
      );
    case "subcategoria":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-center text-[11.5px] text-slate-100 sm:px-2.5">
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
                ? "bg-violet-500/15 text-violet-200 ring-1 ring-violet-500/25"
                : "bg-emerald-500/10 text-emerald-200/95 ring-1 ring-emerald-500/20"
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
    case "mes_contable":
      return (
        <td className="align-middle whitespace-nowrap px-2 py-3 text-center text-[12px] text-[#8b949e] sm:px-2.5">
          {accountingLabel}
        </td>
      );
  }
}

function SortableBankingTxColumnPickerRow({
  columnKey,
  visible,
  requiredCol,
  onToggle,
}: {
  columnKey: BankingTxColumnKey;
  visible: boolean;
  requiredCol: boolean;
  onToggle: () => void;
}) {
  const id = bankingTxSortableColumnId(columnKey);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    transition: { duration: 220, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };
  const label = BANKING_TX_COLUMN_LABELS[columnKey];

  return (
    <li ref={setNodeRef} style={style} className="list-none">
      <div className="flex items-center gap-2 rounded-lg border border-transparent px-1 py-1.5 transition hover:border-slate-600 hover:bg-slate-800/90">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="inline-flex shrink-0 cursor-grab touch-manipulation rounded-md p-1 text-[#aeb8c8] hover:bg-[#5f7088] hover:text-[#f8fafc] active:cursor-grabbing"
          aria-label={`Arrastrar ${label}`}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1 text-sm leading-snug text-[#f1f5f9]">{label}</span>
        {requiredCol ? (
          <span className="shrink-0 rounded-md border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Fija
          </span>
        ) : null}
        <BankingTxColumnVisibilityToggle
          on={visible}
          disabled={requiredCol}
          onToggle={onToggle}
          ariaLabel={requiredCol ? `${label} siempre visible` : visible ? `Ocultar ${label}` : `Mostrar ${label}`}
        />
      </div>
    </li>
  );
}

const txIconBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition hover:border-slate-600 hover:bg-slate-700 hover:text-sky-400";
const txIconBtnDanger = `${txIconBtn} hover:text-red-400`;

/** Tabla de cargos TC pendientes de pagar (mismas columnas visibles que la tabla principal + Pagado). */
function BankingCcPendingChargesTable({
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
  return (
    <section className="mb-6 space-y-2" aria-labelledby={`cc-pending-heading-${accountId}`}>
      <h3 id={`cc-pending-heading-${accountId}`} className={BANKING_AUX_SECTION_HEADING_CLASS}>
        Cargos pendientes · {accountHeading}
      </h3>
      <div className={BANKING_AUX_TX_CARD_CLASS}>
        <table className="w-full table-fixed border-collapse text-[12px]" style={{ minWidth: tableMinWidthPx }}>
          <colgroup>
            {orderedVisibleBankingTxColumns.map((colKey) => (
              <col key={colKey} style={{ width: BANKING_TX_COL_WIDTH[colKey] }} />
            ))}
            <col style={{ width: "5.25rem" }} />
            <col style={{ width: "5rem" }} />
          </colgroup>
          <thead className={BANKING_AUX_TX_THEAD_CLASS}>
            <tr>
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
          <tbody className={BANKING_AUX_TX_TBODY_CLASS}>
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
              const accountingLabel = formatBankingAccountingMonth(row.accounting_month);
              return (
                <tr key={row.id} className={BANKING_AUX_TX_TR_CLASS}>
                  {orderedVisibleBankingTxColumns.map((colKey) => (
                    <BankingTxTd
                      key={colKey}
                      colKey={colKey}
                      row={row}
                      income={income}
                      sharedSettledLabel={sharedSettledLabel}
                      ccPaidLabel={ccPaidLabel}
                      accountingLabel={accountingLabel}
                    />
                  ))}
                  <td className="align-middle px-1.5 py-3 text-center sm:px-2">
                    <button
                      type="button"
                      disabled={markingPaidId === row.id}
                      onClick={() => void onMarkPaid(row)}
                      className="rounded-md border border-emerald-600/45 bg-emerald-950/50 px-2 py-1 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-900/55 disabled:cursor-wait disabled:opacity-40"
                    >
                      {markingPaidId === row.id ? "…" : "Pagado"}
                    </button>
                  </td>
                  <td className="align-middle px-1.5 py-3 sm:px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        type="button"
                        disabled={row.peer_transaction_id != null || row.is_provision_reversal === true}
                        title={
                          row.peer_transaction_id != null
                            ? "Las transferencias entre cuentas propias no se pueden editar aquí"
                            : row.is_provision_reversal === true
                              ? "Las reversas de provisión solo se pueden eliminar"
                              : "Editar movimiento"
                        }
                        onClick={() => openEdit(row)}
                        className={`${txIconBtnAux} disabled:pointer-events-none disabled:opacity-30`}
                      >
                        <IconPencil />
                      </button>
                      <button type="button" title="Eliminar movimiento" onClick={() => void removeRow(row)} className={txIconBtnAuxDanger}>
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
function BankingSharedPendingChargesTable({
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
  openEdit: (row: BankingTransactionRow) => void;
  removeRow: (row: BankingTransactionRow) => void;
}) {
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
  const someSelected = rowIds.some((id) => selectedIds.has(id));
  const headerCbRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = headerCbRef.current;
    if (el) el.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  const selectedInSection = useMemo(() => rowIds.filter((id) => selectedIds.has(id)).length, [rowIds, selectedIds]);

  return (
    <section className="mb-6 space-y-2" aria-labelledby={`shared-pending-heading-${accountId}`}>
      <h3 id={`shared-pending-heading-${accountId}`} className={BANKING_AUX_SECTION_HEADING_CLASS}>
        Compartidos pendientes · {accountHeading}
      </h3>
      {someSelected ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={bulkSettling || selectedInSection === 0}
            onClick={() => void onBulkSettle()}
            className="rounded-lg border border-emerald-600/55 bg-emerald-950/45 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-900/55 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {bulkSettling ? "Liquidando…" : `Liquidar seleccionados (${selectedInSection})`}
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
                <input
                  ref={headerCbRef}
                  type="checkbox"
                  className={BANKING_AUX_CHECKBOX_CLASS}
                  checked={allSelected}
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
          <tbody className={BANKING_AUX_TX_TBODY_CLASS}>
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
              const accountingLabel = formatBankingAccountingMonth(row.accounting_month);
              const checked = selectedIds.has(row.id);
              return (
                <tr key={row.id} className={BANKING_AUX_TX_TR_CLASS}>
                  <td className="align-middle px-1 py-3 text-center sm:px-1.5">
                    <input
                      type="checkbox"
                      className={BANKING_AUX_CHECKBOX_CLASS}
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
                      accountingLabel={accountingLabel}
                    />
                  ))}
                  <td className="align-middle px-1.5 py-3 text-center sm:px-2">
                    <button
                      type="button"
                      disabled={markingSettledId === row.id}
                      onClick={() => void onMarkSettled(row)}
                      className="rounded-md border border-emerald-600/45 bg-emerald-950/50 px-2 py-1 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-900/55 disabled:cursor-wait disabled:opacity-40"
                    >
                      {markingSettledId === row.id ? "…" : "Liquidado"}
                    </button>
                  </td>
                  <td className="align-middle px-1.5 py-3 sm:px-2">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        type="button"
                        disabled={row.peer_transaction_id != null || row.is_provision_reversal === true}
                        title={
                          row.peer_transaction_id != null
                            ? "Las transferencias entre cuentas propias no se pueden editar aquí"
                            : row.is_provision_reversal === true
                              ? "Las reversas de provisión solo se pueden eliminar"
                              : "Editar movimiento"
                        }
                        onClick={() => openEdit(row)}
                        className={`${txIconBtnAux} disabled:pointer-events-none disabled:opacity-30`}
                      >
                        <IconPencil />
                      </button>
                      <button type="button" title="Eliminar movimiento" onClick={() => void removeRow(row)} className={txIconBtnAuxDanger}>
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

const dateInputClass =
  "mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white outline-none focus:border-[#58a6ff] [color-scheme:dark]";

function pickDate(e: React.MouseEvent<HTMLInputElement>) {
  const el = e.currentTarget;
  el.showPicker?.();
}

function monthInputFromRow(row: BankingTransactionRow): string {
  const am = row.accounting_month;
  if (am) return am.slice(0, 7);
  return row.fecha.slice(0, 7);
}

function firstDayIsoFromMonthInput(ym: string): string {
  return `${ym}-01`;
}

/** `ym` = YYYY-MM → "Abr 2026" (mes abreviado en español). */
const ACCOUNTING_MONTH_ABBR_ES = [
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

function parseAccountingYm(ym: string): { y: number; m: number } {
  const parts = ym.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!y || !m || m < 1 || m > 12) {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }
  return { y, m };
}

function buildYm(y: number, m: number): string {
  return `${y}-${String(Math.min(12, Math.max(1, m))).padStart(2, "0")}`;
}

/** Primera fecha del mes contable (ISO) → "Abr 2026" para tabla. */
function formatBankingAccountingMonth(iso: string | null | undefined): string {
  if (!iso) return "—";
  const head = iso.slice(0, 10);
  const mo = Number(head.slice(5, 7));
  const y = Number(head.slice(0, 4));
  if (!y || !mo || mo < 1 || mo > 12) return "—";
  return `${ACCOUNTING_MONTH_ABBR_ES[mo - 1]} ${y}`;
}

/** Lista de años alrededor del año central (p. ej. selector solo año). */
function accountingYearRange(centerY: number): number[] {
  const out: number[] = [];
  for (let i = centerY - 15; i <= centerY + 15; i++) {
    if (i >= 1970 && i <= 2100) out.push(i);
  }
  return out;
}

/** Sí / No tipo píldora segmentada (sitio oscuro GitHub-like). */
function SiNoField({
  label,
  yesLabel = "Sí",
  noLabel = "No",
  value,
  onChange,
}: {
  label: string;
  yesLabel?: string;
  noLabel?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs text-[#8b949e]">{label}</span>
      <div className="flex gap-2 rounded-xl border border-[#30363d] bg-[#0d1117] p-1">
        <button
          type="button"
          aria-pressed={value === true}
          onClick={() => onChange(true)}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            value === true
              ? "border border-emerald-500/50 bg-emerald-950/55 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(74,222,128,0.25)]"
              : "border border-transparent text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
          }`}
        >
          {yesLabel}
        </button>
        <button
          type="button"
          aria-pressed={value === false}
          onClick={() => onChange(false)}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            value === false
              ? "border border-rose-500/45 bg-rose-950/45 text-rose-100 shadow-[inset_0_0_0_1px_rgba(251,113,133,0.2)]"
              : "border border-transparent text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
          }`}
        >
          {noLabel}
        </button>
      </div>
    </div>
  );
}

export function BankingTransactionsPage({ onToast }: { onToast: (msg: string | null) => void }) {
  const [accounts, setAccounts] = useState<BankingAccountRow[]>([]);
  const [bankingDebtTotals, setBankingDebtTotals] = useState<BankingDebtTotalsOut>({
    credit_card_unpaid_clp: 0,
    shared_unsettled_clp: 0,
  });
  const [categories, setCategories] = useState<BankingCategoryRow[]>([]);
  const [items, setItems] = useState<BankingTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BankingTransactionRow | null>(null);

  const [accountId, setAccountId] = useState<number | "">("");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [subcategoryId, setSubcategoryId] = useState<number | "">("");
  const [isShared, setIsShared] = useState(false);
  const [splitParticipants, setSplitParticipants] = useState("2");
  const [sharedExpenseSettled, setSharedExpenseSettled] = useState(false);
  const [creditCardChargePaid, setCreditCardChargePaid] = useState(false);
  const [accountingMonthYm, setAccountingMonthYm] = useState(() => new Date().toISOString().slice(0, 7));
  const [transferDestinationAccountId, setTransferDestinationAccountId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  /** Solo edición de categoría Provisiones: al guardar con Sí se crea la reversa tras actualizar. */
  const [provisionReversalOnSave, setProvisionReversalOnSave] = useState(false);
  const [bankingTxPage, setBankingTxPage] = useState(1);
  const [movementTab, setMovementTab] = useState<"all" | "credit_card" | "shared">("all");
  const [ccUnpaidGroups, setCcUnpaidGroups] = useState<BankingCreditCardUnpaidGroup[]>([]);
  const [sharedUnsettledGroups, setSharedUnsettledGroups] = useState<BankingSharedUnsettledGroup[]>([]);
  const [markingPaidId, setMarkingPaidId] = useState<number | null>(null);
  const [markingSharedSettledId, setMarkingSharedSettledId] = useState<number | null>(null);
  const [bulkSettlingShared, setBulkSettlingShared] = useState(false);
  const [selectedSharedIds, setSelectedSharedIds] = useState<Set<number>>(() => new Set());
  const [bankingTxTotal, setBankingTxTotal] = useState(0);
  const [columnOrder, setColumnOrder] = useState<BankingTxColumnKey[]>(() =>
    parseBankingTxTablePreferences(readBankingTxPrefsRaw()).order,
  );
  const [columnVisibility, setColumnVisibility] = useState<Record<BankingTxColumnKey, boolean>>(() =>
    parseBankingTxTablePreferences(readBankingTxPrefsRaw()).visibility,
  );
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const columnPickerWrapRef = useRef<HTMLDivElement>(null);

  const columnDndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterDescription, setFilterDescription] = useState("");
  const [filterAccountId, setFilterAccountId] = useState<number | "">("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [filterCategoryId, setFilterCategoryId] = useState<number | "">("");
  const [filterSubcategoryId, setFilterSubcategoryId] = useState<number | "">("");
  const [filterSharedScope, setFilterSharedScope] = useState<BankingTxSharedScopeFilter>("all");
  const [filterLiquidado, setFilterLiquidado] = useState<BankingTxLiquidadoFilter>("all");
  const [filterTcPaid, setFilterTcPaid] = useState<BankingTxTcPaidFilter>("all");
  const [filterAccountingMonthYm, setFilterAccountingMonthYm] = useState("");
  const [headerFilterOpen, setHeaderFilterOpen] = useState<BankingTxColumnKey | null>(null);
  const [headerFilterPopoverPos, setHeaderFilterPopoverPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const headerFilterCellRefs = useRef<Partial<Record<BankingTxColumnKey, HTMLTableCellElement | null>>>({});
  const filterPopoverPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const payload = {
      v: 2 as const,
      order: columnOrder,
      visibility: normalizeBankingTxVisibility(columnVisibility),
    };
    localStorage.setItem(BANKING_TX_TABLE_PREFS_STORAGE_KEY, JSON.stringify(payload));
  }, [columnOrder, columnVisibility]);

  useEffect(() => {
    setFilterSubcategoryId((prev) => {
      if (prev === "" || filterCategoryId === "") return prev;
      const cat = categories.find((c) => c.id === filterCategoryId);
      if (!cat?.subcategories.some((s) => s.id === prev)) return "";
      return prev;
    });
  }, [filterCategoryId, categories]);

  useEffect(() => {
    const usedCat = new Set(items.map((r) => r.category_id));
    setFilterCategoryId((prev) => (prev !== "" && !usedCat.has(prev) ? "" : prev));
  }, [items]);

  useEffect(() => {
    const usedSub = new Set(items.map((r) => r.subcategory_id));
    setFilterSubcategoryId((prev) => (prev !== "" && !usedSub.has(prev) ? "" : prev));
  }, [items]);

  useEffect(() => {
    if (!columnPickerOpen) return;
    function handleDown(e: MouseEvent) {
      if (columnPickerWrapRef.current?.contains(e.target as Node)) return;
      setColumnPickerOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setColumnPickerOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [columnPickerOpen]);

  const registerHeaderCellRef = useCallback((k: BankingTxColumnKey, el: HTMLTableCellElement | null) => {
    headerFilterCellRefs.current[k] = el;
  }, []);

  const toggleHeaderFilter = useCallback((k: BankingTxColumnKey) => {
    setHeaderFilterOpen((prev) => (prev === k ? null : k));
  }, []);

  useLayoutEffect(() => {
    if (headerFilterOpen == null) {
      setHeaderFilterPopoverPos(null);
      return;
    }
    const col: BankingTxColumnKey = headerFilterOpen;
    function update() {
      const el = headerFilterCellRefs.current[col];
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(320, Math.max(260, window.innerWidth - 24));
      let left = r.left + r.width / 2 - width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const top = r.bottom + 6;
      setHeaderFilterPopoverPos({ top, left, width });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [headerFilterOpen]);

  useEffect(() => {
    if (headerFilterOpen == null) return;
    const col: BankingTxColumnKey = headerFilterOpen;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (filterPopoverPanelRef.current?.contains(t)) return;
      if (headerFilterCellRefs.current[col]?.contains(t)) return;
      setHeaderFilterOpen(null);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setHeaderFilterOpen(null);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [headerFilterOpen]);

  const filterSnapshot = useMemo(
    (): BankingTxFilterSnapshot => ({
      filterDateFrom,
      filterDateTo,
      filterDescription,
      filterAccountId,
      filterAmountMin,
      filterAmountMax,
      filterCategoryId,
      filterSubcategoryId,
      filterSharedScope,
      filterLiquidado,
      filterTcPaid,
      filterAccountingMonthYm,
    }),
    [
      filterDateFrom,
      filterDateTo,
      filterDescription,
      filterAccountId,
      filterAmountMin,
      filterAmountMax,
      filterCategoryId,
      filterSubcategoryId,
      filterSharedScope,
      filterLiquidado,
      filterTcPaid,
      filterAccountingMonthYm,
    ],
  );

  const isColumnFilterActive = useCallback(
    (k: BankingTxColumnKey) => bankingTxColumnFilterActive(k, filterSnapshot),
    [filterSnapshot],
  );

  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const scopeMenuRef = useRef<HTMLDivElement>(null);
  const scopeTriggerRef = useRef<HTMLButtonElement>(null);
  const scopePanelRef = useRef<HTMLDivElement>(null);
  const [scopePanelBox, setScopePanelBox] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateScopePanelBox = useCallback(() => {
    const el = scopeTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setScopePanelBox({ top: r.bottom + 8, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!scopeMenuOpen) {
      setScopePanelBox(null);
      return;
    }
    updateScopePanelBox();
    window.addEventListener("scroll", updateScopePanelBox, true);
    window.addEventListener("resize", updateScopePanelBox);
    return () => {
      window.removeEventListener("scroll", updateScopePanelBox, true);
      window.removeEventListener("resize", updateScopePanelBox);
    };
  }, [scopeMenuOpen, updateScopePanelBox]);

  useEffect(() => {
    if (!scopeMenuOpen) return;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (scopeMenuRef.current?.contains(t)) return;
      if (scopePanelRef.current?.contains(t)) return;
      setScopeMenuOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setScopeMenuOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [scopeMenuOpen]);

  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement>(null);
  const categoryPanelRef = useRef<HTMLDivElement>(null);
  const [categoryPanelBox, setCategoryPanelBox] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );

  const [accountingPickMode, setAccountingPickMode] = useState<null | "month" | "year">(null);
  const accountingMonthWrapRef = useRef<HTMLDivElement>(null);
  const accountingMonthTriggerRef = useRef<HTMLDivElement>(null);
  const accountingMonthPanelRef = useRef<HTMLDivElement>(null);
  const [accountingMonthPanelBox, setAccountingMonthPanelBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const updateAccountingMonthPanelBox = useCallback(() => {
    const el = accountingMonthTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAccountingMonthPanelBox({
      top: r.bottom + 8,
      left: r.left,
      width: Math.max(r.width, 260),
    });
  }, []);

  useLayoutEffect(() => {
    if (!accountingPickMode) {
      setAccountingMonthPanelBox(null);
      return;
    }
    updateAccountingMonthPanelBox();
    window.addEventListener("scroll", updateAccountingMonthPanelBox, true);
    window.addEventListener("resize", updateAccountingMonthPanelBox);
    return () => {
      window.removeEventListener("scroll", updateAccountingMonthPanelBox, true);
      window.removeEventListener("resize", updateAccountingMonthPanelBox);
    };
  }, [accountingPickMode, updateAccountingMonthPanelBox]);

  useEffect(() => {
    if (!accountingPickMode) return;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (accountingMonthWrapRef.current?.contains(t)) return;
      if (accountingMonthPanelRef.current?.contains(t)) return;
      setAccountingPickMode(null);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAccountingPickMode(null);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [accountingPickMode]);

  const updateCategoryPanelBox = useCallback(() => {
    const el = categoryTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCategoryPanelBox({ top: r.bottom + 8, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!categoryMenuOpen) {
      setCategoryPanelBox(null);
      return;
    }
    updateCategoryPanelBox();
    window.addEventListener("scroll", updateCategoryPanelBox, true);
    window.addEventListener("resize", updateCategoryPanelBox);
    return () => {
      window.removeEventListener("scroll", updateCategoryPanelBox, true);
      window.removeEventListener("resize", updateCategoryPanelBox);
    };
  }, [categoryMenuOpen, updateCategoryPanelBox]);

  useEffect(() => {
    if (!categoryMenuOpen) return;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (categoryMenuRef.current?.contains(t)) return;
      if (categoryPanelRef.current?.contains(t)) return;
      setCategoryMenuOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCategoryMenuOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [categoryMenuOpen]);

  const reloadBankingTransactions = useCallback(async (page: number) => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(BANKING_TX_PAGE_SIZE));
    if (filterAccountId !== "") params.set("account_id", String(filterAccountId));
    if (movementTab === "credit_card") params.set("scope", "credit_card");
    if (movementTab === "shared") params.set("scope", "shared");

    const [acc, cats, txList, debt] = await Promise.all([
      fetchJson<BankingAccountRow[]>("/banking/accounts"),
      fetchJson<BankingCategoryRow[]>("/banking/categories"),
      fetchJson<{
        items: BankingTransactionRow[];
        total: number;
        page: number;
        page_size: number;
      }>(`/banking/transactions?${params.toString()}`),
      fetchJson<BankingDebtTotalsOut>("/banking/debt-totals"),
    ]);
    let groups: BankingCreditCardUnpaidGroup[] = [];
    if (movementTab === "credit_card") {
      const ug = await fetchJson<{ groups: BankingCreditCardUnpaidGroup[] }>("/banking/credit-card/unpaid-grouped");
      groups = ug.groups;
    }
    let sharedGroups: BankingSharedUnsettledGroup[] = [];
    if (movementTab === "shared") {
      const ug = await fetchJson<{ groups: BankingSharedUnsettledGroup[] }>("/banking/shared/unsettled-grouped");
      sharedGroups = ug.groups;
    }
    setAccounts(acc);
    setBankingDebtTotals(debt);
    setCategories([...cats].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id));
    setItems(txList.items);
    setBankingTxTotal(txList.total);
    setBankingTxPage(txList.page);
    setCcUnpaidGroups(groups);
    setSharedUnsettledGroups(sharedGroups);
  }, [filterAccountId, movementTab]);

  useEffect(() => {
    if (movementTab !== "shared") setSelectedSharedIds(new Set());
  }, [movementTab]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void reloadBankingTransactions(1)
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadBankingTransactions]);

  const bankingTxTotalPages = useMemo(
    () => Math.max(1, Math.ceil(bankingTxTotal / BANKING_TX_PAGE_SIZE)),
    [bankingTxTotal],
  );

  const goBankingTxPage = useCallback(
    async (nextPage: number) => {
      if (nextPage < 1 || nextPage > bankingTxTotalPages) return;
      setLoading(true);
      try {
        await reloadBankingTransactions(nextPage);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [reloadBankingTransactions, bankingTxTotalPages],
  );

  const toggleBankingTxColumn = useCallback((key: BankingTxColumnKey) => {
    if (isBankingTxColumnRequired(key)) return;
    setColumnVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const resetBankingTxColumns = useCallback(() => {
    setColumnOrder([...DEFAULT_BANKING_TX_COLUMN_ORDER]);
    setColumnVisibility({ ...DEFAULT_BANKING_TX_COLUMN_VISIBILITY });
    setColumnPickerOpen(false);
  }, []);

  const handleBankingTxColumnDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((prev) => {
      const ids = prev.map((k) => bankingTxSortableColumnId(k));
      const oldIndex = ids.indexOf(active.id);
      const newIndex = ids.indexOf(over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  /** Para nuevos movimientos solo categorías/sub activas; al editar se incluye la opción actual aunque esté desactivada. Las categorías `internal_reserved` solo se muestran al editar un movimiento que ya las usa. */
  const categoryOptions = useMemo(() => {
    if (editing) {
      return categories.filter((c) => {
        if (c.internal_reserved) return c.id === editing.category_id;
        return (c.enabled ?? true) || c.id === editing.category_id;
      });
    }
    return categories.filter((c) => !c.internal_reserved && (c.enabled ?? true));
  }, [categories, editing]);

  const selectedCategory = useMemo(
    () => (categoryId === "" ? undefined : categoryOptions.find((c) => c.id === categoryId)),
    [categoryOptions, categoryId],
  );

  const accountOptions = useMemo(() => {
    if (editing) {
      return accounts.filter((a) => (a.enabled ?? true) || a.id === editing.account_id);
    }
    return accounts.filter((a) => a.enabled ?? true);
  }, [accounts, editing]);

  const hasVisibleAccount = useMemo(() => accounts.some((a) => a.enabled ?? true), [accounts]);

  const selectedAccount = useMemo(
    () => (accountId === "" ? undefined : accounts.find((a) => a.id === accountId)),
    [accounts, accountId],
  );
  const isCreditCardAccount = selectedAccount?.product_type === "tarjeta_credito";

  const isEditingProvision = useMemo(
    () =>
      Boolean(
        editing &&
          !editing.is_provision_reversal &&
          selectedCategory?.template_cat_id === BANKING_TEMPLATE_CAT_PROVISIONES,
      ),
    [editing, selectedCategory?.template_cat_id],
  );

  const amountPerPersonLabel = useMemo(() => {
    const amt = parseFloat(amount.replace(",", "."));
    const n = parseInt(splitParticipants, 10);
    if (!isShared || Number.isNaN(amt) || Number.isNaN(n) || n < 1) return "—";
    const per = Math.abs(amt) / n;
    return formatBankingClpSigned(per);
  }, [amount, splitParticipants, isShared]);

  const accountingYmParts = useMemo(() => parseAccountingYm(accountingMonthYm), [accountingMonthYm]);

  const subOptions = useMemo(() => {
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return [];
    const subs = [...cat.subcategories].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id,
    );
    if (editing) {
      return subs.filter((s) => (s.enabled ?? true) || s.id === editing.subcategory_id);
    }
    return subs.filter((s) => s.enabled ?? true);
  }, [categories, categoryId, editing]);

  const selectedSubcategoryRow = useMemo(() => {
    if (subcategoryId === "" || subOptions.length === 0) return undefined;
    return subOptions.find((s) => s.id === subcategoryId);
  }, [subOptions, subcategoryId]);

  const isOwnAccountsTransfer = useMemo(() => {
    const c = selectedCategory;
    const s = selectedSubcategoryRow;
    if (!c || !s) return false;
    const tc = c.template_cat_id ?? null;
    const ts = s.template_sub_id ?? null;
    if (tc === BANKING_TEMPLATE_CAT_TRANSFERENCIA && ts === BANKING_TEMPLATE_SUB_ENTRE_CUENTAS_PROPIAS) {
      return true;
    }
    return c.name.trim() === "Transferencia" && s.name.trim() === "Entre cuentas propias";
  }, [selectedCategory, selectedSubcategoryRow]);

  const transferDestinationOptions = useMemo(() => {
    return accounts.filter(
      (a) =>
        (a.enabled ?? true) &&
        a.product_type !== "tarjeta_credito" &&
        (accountId === "" || a.id !== accountId),
    );
  }, [accounts, accountId]);

  const orderedVisibleBankingTxColumns = useMemo(
    () => columnOrder.filter((k) => columnVisibility[k]),
    [columnOrder, columnVisibility],
  );

  const bankingCcPendingVisibleColumns = useMemo(
    () => orderedVisibleBankingTxColumns.filter((k) => !BANKING_CC_PENDING_EXCLUDED_COLUMNS.has(k)),
    [orderedVisibleBankingTxColumns],
  );

  const bankingTableMinWidthPx = useMemo(
    () => Math.max(440, orderedVisibleBankingTxColumns.length * 88 + 128),
    [orderedVisibleBankingTxColumns],
  );

  /** Ancho mínimo tabla pendientes TC (menos columnas + Pagado + acciones). */
  const pendingCcTableMinWidthPx = useMemo(
    () => Math.max(440, bankingCcPendingVisibleColumns.length * 88 + 128 + 84),
    [bankingCcPendingVisibleColumns],
  );

  /** + columna checkbox (pendientes compartidos). */
  const pendingSharedTableMinWidthPx = useMemo(
    () => Math.max(480, bankingCcPendingVisibleColumns.length * 88 + 128 + 84 + 44),
    [bankingCcPendingVisibleColumns],
  );

  const filterAccountsSorted = useMemo(() => {
    return [...accounts].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [accounts]);

  const [balanceCardOrderIds, setBalanceCardOrderIds] = useState<number[]>(loadBalanceCardOrder);

  /** Cuentas no TC con saldos; orden persistido en localStorage y reordenable por arrastre. */
  const bankingNonCreditBalances = useMemo(() => {
    const rows = bankingNonCreditAccounts(accounts);
    const mergedIds = mergeBalanceCardOrder(balanceCardOrderIds, rows);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return mergedIds.map((id) => byId.get(id)).filter((x): x is BankingAccountRow => x != null);
  }, [accounts, balanceCardOrderIds]);

  useEffect(() => {
    const rows = bankingNonCreditAccounts(accounts);
    setBalanceCardOrderIds((prev) => {
      const merged = mergeBalanceCardOrder(prev, rows);
      const same =
        merged.length === prev.length && merged.every((id, i) => id === prev[i]);
      return same ? prev : merged;
    });
  }, [accounts]);

  useEffect(() => {
    saveBalanceCardOrder(balanceCardOrderIds);
  }, [balanceCardOrderIds]);

  const handleBalanceCardDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const toNum = (id: UniqueIdentifier) =>
      typeof id === "number" ? id : typeof id === "string" ? Number.parseInt(id, 10) : NaN;
    const activeId = toNum(active.id);
    const overId = toNum(over.id);
    if (!Number.isFinite(activeId) || !Number.isFinite(overId)) return;
    setBalanceCardOrderIds((ids) => {
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return ids;
      return arrayMove(ids, oldIndex, newIndex);
    });
  }, []);

  const filterCategoriesSorted = useMemo(() => {
    const usedCatIds = new Set(items.map((r) => r.category_id));
    return [...categories]
      .filter((c) => usedCatIds.has(c.id))
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }, [categories, items]);

  const filterSubcategoryDropdownRows = useMemo(() => {
    const rows: { id: number; label: string; categoryId: number; categoryColor: string }[] = [];
    const usedSubIds = new Set(items.map((r) => r.subcategory_id));
    for (const c of categories) {
      for (const s of c.subcategories) {
        if (usedSubIds.has(s.id)) {
          rows.push({
            id: s.id,
            categoryId: c.id,
            categoryColor: c.color,
            label: `${c.name} › ${s.name}`,
          });
        }
      }
    }
    rows.sort((a, b) => a.label.localeCompare(b.label, "es"));
    if (filterCategoryId === "") return rows;
    return rows.filter((r) => r.categoryId === filterCategoryId);
  }, [categories, items, filterCategoryId]);

  const filteredBankingTxItems = useMemo(() => {
    const parseAmt = (s: string) => {
      const n = parseFloat(s.replace(",", ".").trim());
      return Number.isFinite(n) ? n : NaN;
    };
    const descQ = filterDescription.trim().toLowerCase();

    return items.filter((row) => {
      const fecha = row.fecha.slice(0, 10);
      if (filterDateFrom && fecha < filterDateFrom) return false;
      if (filterDateTo && fecha > filterDateTo) return false;

      if (descQ && !(row.description ?? "").toLowerCase().includes(descQ)) return false;

      if (filterAccountId !== "" && row.account_id !== filterAccountId) return false;

      if (filterCategoryId !== "" && row.category_id !== filterCategoryId) return false;
      if (filterSubcategoryId !== "" && row.subcategory_id !== filterSubcategoryId) return false;

      if (filterAmountMin.trim()) {
        const mn = parseAmt(filterAmountMin);
        if (!Number.isNaN(mn) && row.amount < mn) return false;
      }
      if (filterAmountMax.trim()) {
        const mx = parseAmt(filterAmountMax);
        if (!Number.isNaN(mx) && row.amount > mx) return false;
      }

      switch (filterSharedScope) {
        case "personal":
          if (row.is_shared) return false;
          break;
        case "shared_any":
          if (!row.is_shared) return false;
          break;
        default:
          break;
      }

      if (filterLiquidado !== "all") {
        if (filterLiquidado === "yes" && !(row.is_shared && row.shared_expense_settled)) return false;
        if (filterLiquidado === "no" && !(row.is_shared && !row.shared_expense_settled)) return false;
        if (filterLiquidado === "na" && row.is_shared) return false;
      }

      switch (filterTcPaid) {
        case "paid":
          if (row.credit_card_charge_paid !== true) return false;
          break;
        case "unpaid":
          if (row.credit_card_charge_paid !== false) return false;
          break;
        case "na":
          if (row.credit_card_charge_paid != null) return false;
          break;
        default:
          break;
      }

      if (filterAccountingMonthYm.trim()) {
        const rowYm = row.accounting_month ? row.accounting_month.slice(0, 7) : row.fecha.slice(0, 7);
        if (rowYm !== filterAccountingMonthYm) return false;
      }

      return true;
    });
  }, [
    items,
    filterDateFrom,
    filterDateTo,
    filterDescription,
    filterAccountId,
    filterAmountMin,
    filterAmountMax,
    filterCategoryId,
    filterSubcategoryId,
    filterSharedScope,
    filterLiquidado,
    filterTcPaid,
    filterAccountingMonthYm,
  ]);

  useEffect(() => {
    if (filteredBankingTxItems.length === 0) setHeaderFilterOpen(null);
  }, [filteredBankingTxItems.length]);

  const bankingTxFiltersActive = useMemo(() => {
    return (
      filterDateFrom !== "" ||
      filterDateTo !== "" ||
      filterDescription.trim() !== "" ||
      filterAccountId !== "" ||
      filterAmountMin.trim() !== "" ||
      filterAmountMax.trim() !== "" ||
      filterCategoryId !== "" ||
      filterSubcategoryId !== "" ||
      filterSharedScope !== "all" ||
      filterLiquidado !== "all" ||
      filterTcPaid !== "all" ||
      filterAccountingMonthYm !== ""
    );
  }, [
    filterDateFrom,
    filterDateTo,
    filterDescription,
    filterAccountId,
    filterAmountMin,
    filterAmountMax,
    filterCategoryId,
    filterSubcategoryId,
    filterSharedScope,
    filterLiquidado,
    filterTcPaid,
    filterAccountingMonthYm,
  ]);

  const bankingTxFilterUICtxValue = useMemo(
    (): BankingTxFilterUICtxValue => ({
      headerFilterOpen,
      toggleHeaderFilter,
      registerHeaderCellRef,
      isColumnFilterActive,
      filterDateFrom,
      setFilterDateFrom,
      filterDateTo,
      setFilterDateTo,
      filterDescription,
      setFilterDescription,
      filterAccountId,
      setFilterAccountId,
      filterAmountMin,
      setFilterAmountMin,
      filterAmountMax,
      setFilterAmountMax,
      filterCategoryId,
      setFilterCategoryId,
      filterSubcategoryId,
      setFilterSubcategoryId,
      filterSharedScope,
      setFilterSharedScope,
      filterLiquidado,
      setFilterLiquidado,
      filterTcPaid,
      setFilterTcPaid,
      filterAccountingMonthYm,
      setFilterAccountingMonthYm,
      filterAccountsSorted,
      filterCategoriesSorted,
      filterSubcategoryDropdownRows,
    }),
    [
      headerFilterOpen,
      toggleHeaderFilter,
      registerHeaderCellRef,
      isColumnFilterActive,
      filterDateFrom,
      filterDateTo,
      filterDescription,
      filterAccountId,
      filterAmountMin,
      filterAmountMax,
      filterCategoryId,
      filterSubcategoryId,
      filterSharedScope,
      filterLiquidado,
      filterTcPaid,
      filterAccountingMonthYm,
      filterAccountsSorted,
      filterCategoriesSorted,
      filterSubcategoryDropdownRows,
    ],
  );

  const clearBankingTxFilters = useCallback(() => {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterDescription("");
    setFilterAccountId("");
    setFilterAmountMin("");
    setFilterAmountMax("");
    setFilterCategoryId("");
    setFilterSubcategoryId("");
    setFilterSharedScope("all");
    setFilterLiquidado("all");
    setFilterTcPaid("all");
    setFilterAccountingMonthYm("");
    setHeaderFilterOpen(null);
  }, []);

  function openNew() {
    setEditing(null);
    const vis = accounts.filter((a) => a.enabled ?? true);
    setAccountId(vis[0]?.id ?? "");
    const today = new Date().toISOString().slice(0, 10);
    setFecha(today);
    setAccountingMonthYm(today.slice(0, 7));
    setAmount("");
    setDescription("");
    setIsShared(false);
    setSplitParticipants("2");
    setSharedExpenseSettled(false);
    setCreditCardChargePaid(false);
    const enabledCats = categories.filter((c) => !c.internal_reserved && (c.enabled ?? true));
    const firstCat = enabledCats[0];
    setCategoryId(firstCat?.id ?? "");
    const subs = [...(firstCat?.subcategories ?? [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id)
      .filter((s) => s.enabled ?? true);
    setSubcategoryId(subs[0]?.id ?? "");
    setTransferDestinationAccountId("");
    setScopeMenuOpen(false);
    setCategoryMenuOpen(false);
    setAccountingPickMode(null);
    setProvisionReversalOnSave(false);
    setModalOpen(true);
  }

  function openEdit(row: BankingTransactionRow) {
    setEditing(row);
    setAccountId(row.account_id);
    setFecha(row.fecha.slice(0, 10));
    setAccountingMonthYm(monthInputFromRow(row));
    setAmount(String(row.amount));
    setDescription(row.description ?? "");
    setCategoryId(row.category_id);
    setSubcategoryId(row.subcategory_id);
    setIsShared(row.is_shared ?? false);
    setSplitParticipants(String(row.split_participants ?? 2));
    setSharedExpenseSettled(row.shared_expense_settled ?? false);
    setCreditCardChargePaid(row.credit_card_charge_paid ?? false);
    setTransferDestinationAccountId("");
    setScopeMenuOpen(false);
    setCategoryMenuOpen(false);
    setAccountingPickMode(null);
    setProvisionReversalOnSave(false);
    setModalOpen(true);
  }

  useEffect(() => {
    if (!modalOpen || !editing) return;
    if (!isEditingProvision) {
      setProvisionReversalOnSave(false);
    }
  }, [modalOpen, editing, isEditingProvision]);

  useEffect(() => {
    if (!modalOpen || categoryId === "") return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;
    const subs = [...cat.subcategories]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id)
      .filter((s) =>
        editing ? (s.enabled ?? true) || s.id === editing.subcategory_id : s.enabled ?? true,
      );
    if (!subs.some((s) => s.id === subcategoryId)) {
      setSubcategoryId(subs[0]?.id ?? "");
    }
  }, [modalOpen, categoryId, categories, subcategoryId, editing]);

  useEffect(() => {
    if (!modalOpen || editing) return;
    const vis = accounts.filter((a) => a.enabled ?? true);
    if (accountId !== "" && !vis.some((a) => a.id === accountId)) {
      setAccountId(vis[0]?.id ?? "");
    }
  }, [modalOpen, editing, accounts, accountId]);

  async function saveModal() {
    if (accountId === "" || categoryId === "" || subcategoryId === "") {
      onToast("Completa cuenta, categoría y subcategoría");
      return;
    }
    if (!description.trim()) {
      onToast("La descripción es obligatoria");
      return;
    }
    const amt = parseFloat(amount.replace(",", "."));
    if (Number.isNaN(amt) || amt === 0) {
      onToast("El monto debe ser distinto de cero (positivo = ingreso, negativo = egreso)");
      return;
    }
    let participants = parseInt(splitParticipants, 10);
    if (isShared) {
      if (Number.isNaN(participants) || participants < 1) {
        onToast("Indica cuántas personas participan (mínimo 1)");
        return;
      }
    }
    const accountingIso = firstDayIsoFromMonthInput(accountingMonthYm);
    const ccPaid = isCreditCardAccount ? creditCardChargePaid : null;
    if (isOwnAccountsTransfer && !editing) {
      if (transferDestinationAccountId === "") {
        onToast("Selecciona la cuenta destino de la transferencia");
        return;
      }
      if (transferDestinationAccountId === accountId) {
        onToast("La cuenta destino no puede ser la misma que la cuenta de este movimiento");
        return;
      }
    }
    setSaving(true);
    try {
      if (editing) {
        await patchJson<BankingTransactionRow>(`/banking/transactions/${editing.id}`, {
          account_id: accountId,
          fecha,
          amount: amt,
          description: description.trim(),
          category_id: categoryId,
          subcategory_id: subcategoryId,
          is_shared: isShared,
          split_participants: isShared ? participants : undefined,
          shared_expense_settled: isShared ? sharedExpenseSettled : false,
          credit_card_charge_paid: ccPaid,
          accounting_month: accountingIso,
        });
        const catSaving = categories.find((c) => c.id === categoryId);
        const applyProvisionReversal =
          provisionReversalOnSave &&
          catSaving?.template_cat_id === BANKING_TEMPLATE_CAT_PROVISIONES;
        let reversalNote: string | null = null;
        if (applyProvisionReversal) {
          const r = await apiFetch(`/banking/transactions/${editing.id}/reverse-provision`, {
            method: "POST",
          });
          if (!r.ok) {
            let detail = "error desconocido";
            try {
              const j = (await r.json()) as { detail?: unknown };
              if (typeof j.detail === "string") detail = j.detail;
            } catch {
              /* ignore */
            }
            reversalNote = detail;
          }
        }
        if (reversalNote) {
          onToast(`Guardado. La reversa no se pudo crear: ${reversalNote}`);
        } else if (applyProvisionReversal) {
          onToast("Movimiento actualizado y reversa registrada ✅");
        } else {
          onToast("Movimiento actualizado ✅");
        }
      } else {
        await postJson<BankingTransactionRow>("/banking/transactions", {
          account_id: accountId,
          fecha,
          amount: amt,
          description: description.trim(),
          category_id: categoryId,
          subcategory_id: subcategoryId,
          is_shared: isShared,
          split_participants: isShared ? participants : undefined,
          shared_expense_settled: isShared ? sharedExpenseSettled : false,
          credit_card_charge_paid: ccPaid,
          accounting_month: accountingIso,
          ...(isOwnAccountsTransfer && transferDestinationAccountId !== ""
            ? { transfer_destination_account_id: transferDestinationAccountId as number }
            : {}),
        });
        onToast(
          isOwnAccountsTransfer ? "Transferencia registrada en origen y destino ✅" : "Movimiento registrado ✅",
        );
      }
      const wasEditing = editing != null;
      const pageAfterSave = wasEditing ? bankingTxPage : 1;
      setModalOpen(false);
      setEditing(null);
      setScopeMenuOpen(false);
      setCategoryMenuOpen(false);
      setAccountingPickMode(null);
      setProvisionReversalOnSave(false);
      await reloadBankingTransactions(pageAfterSave);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(row: BankingTransactionRow) {
    const msg = row.peer_transaction_id
      ? "¿Eliminar esta transferencia entre cuentas? Se eliminarán los dos movimientos enlazados y se ajustarán los saldos."
      : "¿Eliminar este movimiento? El saldo de la cuenta se ajustará.";
    if (!confirm(msg)) return;
    try {
      const r = await apiFetch(`/banking/transactions/${row.id}`, { method: "DELETE" });
      if (!r.ok) {
        onToast("No se pudo eliminar");
        return;
      }
      onToast("Movimiento eliminado");
      await reloadBankingTransactions(bankingTxPage);
    } catch {
      onToast("No se pudo eliminar");
    }
  }

  async function handleMarkCcChargePaid(row: BankingTransactionRow) {
    try {
      setMarkingPaidId(row.id);
      await patchJson<BankingTransactionRow>(`/banking/transactions/${row.id}`, {
        credit_card_charge_paid: true,
      });
      onToast("Cargo marcado como pagado; se registró el egreso en la cuenta corriente asociada.");
      await reloadBankingTransactions(bankingTxPage);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo marcar como pagado");
    } finally {
      setMarkingPaidId(null);
    }
  }

  function toggleSharedRow(id: number) {
    setSelectedSharedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSharedSelectAll(rows: BankingTransactionRow[]) {
    const ids = rows.map((r) => r.id);
    setSelectedSharedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((i) => prev.has(i));
      const next = new Set(prev);
      if (allSelected) for (const i of ids) next.delete(i);
      else for (const i of ids) next.add(i);
      return next;
    });
  }

  async function handleMarkSharedSettled(row: BankingTransactionRow) {
    try {
      setMarkingSharedSettledId(row.id);
      await patchJson<BankingTransactionRow>(`/banking/transactions/${row.id}`, {
        shared_expense_settled: true,
      });
      onToast("Movimiento marcado como liquidado.");
      setSelectedSharedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      await reloadBankingTransactions(bankingTxPage);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo marcar como liquidado");
    } finally {
      setMarkingSharedSettledId(null);
    }
  }

  async function handleBulkSharedSettled() {
    if (selectedSharedIds.size === 0) return;
    try {
      setBulkSettlingShared(true);
      const out = await postJson<{ updated: number }>("/banking/transactions/bulk-shared-settled", {
        transaction_ids: [...selectedSharedIds],
      });
      onToast(`${out.updated} movimiento(s) marcado(s) como liquidado(s).`);
      setSelectedSharedIds(new Set());
      await reloadBankingTransactions(bankingTxPage);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo liquidar la selección");
    } finally {
      setBulkSettlingShared(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[min(100%,1560px)] space-y-6 px-4 pb-28 pt-4 md:px-10 md:pt-6">
      {accounts.length > 0 ? (
        <section aria-labelledby="banking-account-balances-heading">
          <h2 id="banking-account-balances-heading" className="mb-3 text-lg font-semibold text-white">
            Saldos cuentas
          </h2>
          <DndContext sensors={columnDndSensors} collisionDetection={closestCenter} onDragEnd={handleBalanceCardDragEnd}>
            <div className="space-y-3 md:space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                {bankingNonCreditBalances.length > 0 ? (
                  <BankingNonCreditTotalBalanceCard accounts={bankingNonCreditBalances} />
                ) : null}
                <BankingCreditCardUnpaidDebtCard amountClp={bankingDebtTotals.credit_card_unpaid_clp} />
                <BankingSharedUnsettledDebtCard amountClp={bankingDebtTotals.shared_unsettled_clp} />
              </div>
              {bankingNonCreditBalances.length > 0 ? (
                <SortableContext
                  items={bankingNonCreditBalances.map((a) => a.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                    {bankingNonCreditBalances.map((a) => (
                      <SortableBankingBalanceCard key={a.id} account={a} />
                    ))}
                  </div>
                </SortableContext>
              ) : null}
            </div>
          </DndContext>
        </section>
      ) : null}

      <section className={BANKING_MOVEMENTS_SECTION_CLASS} aria-label="Movimientos">
        <div className={BANKING_MOVEMENTS_TABLIST_CLASS} role="tablist" aria-label="Tipo de vista">
          <button
            type="button"
            role="tab"
            aria-selected={movementTab === "all"}
            onClick={() => setMovementTab("all")}
            className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition ${
              movementTab === "all"
                ? "border border-b-0 border-slate-600 bg-slate-900 text-white"
                : "border border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            }`}
          >
            Movimientos bancarios
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={movementTab === "credit_card"}
            onClick={() => setMovementTab("credit_card")}
            className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition ${
              movementTab === "credit_card"
                ? "border border-b-0 border-slate-600 bg-slate-900 text-white"
                : "border border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            }`}
          >
            Tarjeta de crédito
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={movementTab === "shared"}
            onClick={() => setMovementTab("shared")}
            className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition ${
              movementTab === "shared"
                ? "border border-b-0 border-slate-600 bg-slate-900 text-white"
                : "border border-transparent text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            }`}
          >
            Pago compartido
          </button>
        </div>

        <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">
            {movementTab === "credit_card"
              ? "Tarjeta de crédito"
              : movementTab === "shared"
                ? "Pago compartido"
                : "Movimientos bancarios"}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {movementTab === "credit_card"
              ? "Cargos y pagos de TC; arriba, cargos pendientes por tarjeta para marcarlos pagados al liquidar."
              : movementTab === "shared"
                ? "Solo movimientos compartidos; arriba, pendientes de liquidar. Puedes marcar varios a la vez con la casilla y «Liquidar seleccionados»."
                : "Ingresos y egresos por cuenta: el signo del monto define el tipo (positivo / negativo)."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div ref={columnPickerWrapRef} className="relative">
            <button
              type="button"
              aria-expanded={columnPickerOpen}
              aria-haspopup="dialog"
              aria-controls="banking-tx-column-picker"
              onClick={() => setColumnPickerOpen((o) => !o)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-white transition hover:border-slate-500 hover:bg-slate-700"
            >
              <IconColumns className="h-4 w-4 text-slate-300" aria-hidden />
              Columnas
            </button>
            {columnPickerOpen && (
              <div
                id="banking-tx-column-picker"
                role="dialog"
                aria-label="Columnas de la tabla"
                className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[min(calc(100vw-2rem),21rem)] rounded-xl border border-slate-600 bg-slate-900 p-3 shadow-2xl ring-1 ring-black/30"
              >
                <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-slate-400">
                  Orden y visibilidad
                </p>
                <p className="mb-2 text-[12px] leading-snug text-slate-500">
                  Arrastra ⋮⋮ para ordenar. Fecha y Monto no se pueden ocultar.
                </p>
                <DndContext
                  sensors={columnDndSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleBankingTxColumnDragEnd}
                >
                  <SortableContext
                    items={columnOrder.map((k) => bankingTxSortableColumnId(k))}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="max-h-[min(60vh,22rem)] space-y-1 overflow-y-auto pr-1 tx-scroll">
                      {columnOrder.map((key) => (
                        <SortableBankingTxColumnPickerRow
                          key={key}
                          columnKey={key}
                          visible={columnVisibility[key]}
                          requiredCol={isBankingTxColumnRequired(key)}
                          onToggle={() => toggleBankingTxColumn(key)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
                <button
                  type="button"
                  onClick={resetBankingTxColumns}
                  className="mt-3 w-full rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white"
                >
                  Restablecer orden y columnas
                </button>
              </div>
            )}
          </div>
          <Link
            to="/banking/settings"
            className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-white transition hover:border-slate-500 hover:bg-slate-700"
          >
            Cuentas
          </Link>
          <button
            type="button"
            disabled={!hasVisibleAccount}
            onClick={openNew}
            className="rounded-lg border border-[#166534] bg-[#22c55e]/90 px-4 py-2 text-sm font-medium text-white hover:bg-[#16a34a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Nuevo movimiento
          </button>
        </div>
      </div>

      {accounts.length === 0 && !loading && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90">
          Primero crea al menos un producto en{" "}
          <Link to="/banking/settings" className="text-[#58a6ff] underline">
            Cuentas
          </Link>
          .
        </p>
      )}
      {accounts.length > 0 && !hasVisibleAccount && !loading && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90">
          Ningún producto está visible para movimientos. Activa al menos uno en{" "}
          <Link to="/banking/settings" className="text-[#58a6ff] underline">
            Cuentas
          </Link>
          .
        </p>
      )}

      {movementTab === "credit_card" && !loading && ccUnpaidGroups.length > 0 ? (
        <div className="space-y-1">
          {ccUnpaidGroups.map((g) => (
            <BankingCcPendingChargesTable
              key={g.account_id}
              accountId={g.account_id}
              accountHeading={g.account_name}
              rows={g.items}
              orderedVisibleBankingTxColumns={bankingCcPendingVisibleColumns}
              tableMinWidthPx={pendingCcTableMinWidthPx}
              markingPaidId={markingPaidId}
              onMarkPaid={handleMarkCcChargePaid}
              openEdit={openEdit}
              removeRow={removeRow}
            />
          ))}
        </div>
      ) : null}

      {movementTab === "shared" && !loading && sharedUnsettledGroups.length > 0 ? (
        <div className="space-y-1">
          {sharedUnsettledGroups.map((g) => (
            <BankingSharedPendingChargesTable
              key={g.account_id}
              accountId={g.account_id}
              accountHeading={g.account_name}
              rows={g.items}
              orderedVisibleBankingTxColumns={bankingCcPendingVisibleColumns}
              tableMinWidthPx={pendingSharedTableMinWidthPx}
              markingSettledId={markingSharedSettledId}
              bulkSettling={bulkSettlingShared}
              selectedIds={selectedSharedIds}
              onToggleRow={toggleSharedRow}
              onToggleSelectAll={() => toggleSharedSelectAll(g.items)}
              onBulkSettle={handleBulkSharedSettled}
              onMarkSettled={handleMarkSharedSettled}
              openEdit={openEdit}
              removeRow={removeRow}
            />
          ))}
        </div>
      ) : null}

      <div className={BANKING_MAIN_TX_CARD_CLASS}>
        {loading ? (
          <p className="p-6 text-sm text-slate-400">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-slate-400">No hay movimientos todavía.</p>
        ) : (
          <BankingTxFilterUICtx.Provider value={bankingTxFilterUICtxValue}>
            <div className={BANKING_MAIN_TX_TOOLBAR_CLASS}>
              <p className="text-xs text-slate-400">
                {bankingTxTotalPages > 1 ? (
                  <>
                    Página{" "}
                    <strong className="tabular-nums text-slate-100">{bankingTxPage}</strong>/
                    <strong className="tabular-nums text-slate-100">{bankingTxTotalPages}</strong>
                    {" · "}
                  </>
                ) : null}
                <strong className="tabular-nums text-slate-100">{bankingTxTotal}</strong> movimientos
                {filteredBankingTxItems.length !== items.length && items.length > 0 ? (
                  <>
                    {" · "}
                    <strong className="tabular-nums text-emerald-400">{filteredBankingTxItems.length}</strong>
                    {" / "}
                    <strong className="tabular-nums text-slate-100">{items.length}</strong>
                    <span className="text-slate-500"> en esta página</span>
                  </>
                ) : null}
              </p>
              {bankingTxFiltersActive ? (
                <button
                  type="button"
                  onClick={clearBankingTxFilters}
                  className="rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700"
                >
                  Limpiar filtros
                </button>
              ) : null}
            </div>
            {filteredBankingTxItems.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-sm font-medium text-slate-100">Ningún movimiento coincide con los filtros</p>
                <p className="mt-1 text-xs text-slate-400">Ajusta los filtros en los encabezados o pulsa «Limpiar filtros».</p>
                <button
                  type="button"
                  onClick={clearBankingTxFilters}
                  className="mt-4 rounded-lg border border-[#58a6ff]/40 bg-[#58a6ff]/10 px-4 py-2 text-sm font-medium text-[#58a6ff] transition hover:bg-[#58a6ff]/20"
                >
                  Limpiar filtros
                </button>
              </div>
            ) : (
              <>
                <table
                  className="w-full table-fixed border-collapse text-[12px]"
                  style={{ minWidth: bankingTableMinWidthPx }}
                >
                  <colgroup>
                    {orderedVisibleBankingTxColumns.map((colKey) => (
                      <col key={colKey} style={{ width: BANKING_TX_COL_WIDTH[colKey] }} />
                    ))}
                    <col style={{ width: "5rem" }} />
                  </colgroup>
                  <thead className={BANKING_MAIN_TX_THEAD_CLASS}>
                    <tr>
                      {orderedVisibleBankingTxColumns.map((colKey) => (
                        <BankingTxColumnHeader key={colKey} colKey={colKey} />
                      ))}
                      <th className="px-1.5 py-3 text-center text-[12px] font-semibold uppercase tracking-wide text-slate-400 sm:px-2" aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody className={BANKING_MAIN_TX_TBODY_CLASS}>
                    {filteredBankingTxItems.map((row) => {
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
                    const accountingLabel = formatBankingAccountingMonth(row.accounting_month);
                    return (
                      <tr key={row.id} className={BANKING_MAIN_TX_TR_CLASS}>
                        {orderedVisibleBankingTxColumns.map((colKey) => (
                          <BankingTxTd
                            key={colKey}
                            colKey={colKey}
                            row={row}
                            income={income}
                            sharedSettledLabel={sharedSettledLabel}
                            ccPaidLabel={ccPaidLabel}
                            accountingLabel={accountingLabel}
                          />
                        ))}
                        <td className="align-middle px-1.5 py-3 sm:px-2">
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              type="button"
                              disabled={row.peer_transaction_id != null || row.is_provision_reversal === true}
                              title={
                                row.peer_transaction_id != null
                                  ? "Las transferencias entre cuentas propias no se pueden editar aquí"
                                  : row.is_provision_reversal === true
                                    ? "Las reversas de provisión solo se pueden eliminar"
                                    : "Editar movimiento"
                              }
                              onClick={() => openEdit(row)}
                              className={`${txIconBtn} disabled:pointer-events-none disabled:opacity-30`}
                            >
                              <IconPencil />
                            </button>
                            <button
                              type="button"
                              title="Eliminar movimiento"
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
                  </tbody>
                </table>
                <div className={BANKING_MAIN_TX_FOOTER_CLASS}>
                  <p className="text-[12px] leading-snug text-slate-400">
                    Hasta <strong className="text-slate-100">{BANKING_TX_PAGE_SIZE}</strong> movimientos por página.
                    {filterAccountId !== "" ? (
                      <span className="text-slate-500"> Cuenta acotada en servidor.</span>
                    ) : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      disabled={loading || bankingTxPage <= 1}
                      onClick={() => void goBankingTxPage(bankingTxPage - 1)}
                      className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      Anterior
                    </button>
                    <span className="text-xs tabular-nums text-slate-300">
                      Página <strong className="text-white">{bankingTxPage}</strong> /{" "}
                      <strong className="text-white">{bankingTxTotalPages}</strong>
                    </span>
                    <button
                      type="button"
                      disabled={loading || bankingTxPage >= bankingTxTotalPages}
                      onClick={() => void goBankingTxPage(bankingTxPage + 1)}
                      className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </>
            )}
            {headerFilterOpen && headerFilterPopoverPos
              ? createPortal(
                  <div
                    ref={filterPopoverPanelRef}
                    role="dialog"
                    aria-label={`Filtro: ${BANKING_TX_COLUMN_LABELS[headerFilterOpen]}`}
                    className="rounded-xl border border-slate-600 bg-slate-900 p-3 shadow-xl ring-1 ring-black/30"
                    style={{
                      position: "fixed",
                      top: headerFilterPopoverPos.top,
                      left: headerFilterPopoverPos.left,
                      width: headerFilterPopoverPos.width,
                      zIndex: 95,
                    }}
                  >
                    <div className="max-h-[min(70vh,420px)] overflow-y-auto pr-1 tx-scroll">
                      <BankingTxHeaderFilterFields colKey={headerFilterOpen} />
                    </div>
                  </div>,
                  document.body,
                )
              : null}
          </BankingTxFilterUICtx.Provider>
        )}
      </div>

        </div>
      </section>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="banking-tx-modal-title"
        >
          <div className="tx-scroll max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[#30363d] bg-[#161b22] p-6 shadow-xl">
            <h3 id="banking-tx-modal-title" className="text-base font-semibold text-white">
              {editing ? "Editar movimiento" : "Nuevo movimiento"}
            </h3>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-xs text-[#8b949e]">Fecha de la transacción</span>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFecha(v);
                    setAccountingMonthYm(v.slice(0, 7));
                  }}
                  onClick={pickDate}
                  className={dateInputClass}
                />
              </label>

              <label className="block">
                <span className="text-xs text-[#8b949e]">Producto o cuenta</span>
                <select
                  value={accountId === "" ? "" : String(accountId)}
                  onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}
                  className="mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white outline-none focus:border-[#58a6ff]"
                >
                  {accountOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-[#8b949e]">Descripción</span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white outline-none focus:border-[#58a6ff]"
                  placeholder="Ej. Supermercado, transferencia…"
                  required
                />
              </label>

              <label className="block">
                <span className="text-xs text-[#8b949e]">Monto (positivo = ingreso, negativo = egreso)</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white outline-none focus:border-[#58a6ff]"
                  placeholder="Ej. 50000 o -12000"
                />
              </label>

              <div ref={categoryMenuRef} className="space-y-1.5">
                <span id="banking-tx-category-label" className="text-xs text-[#8b949e]">
                  Categoría
                </span>
                <button
                  ref={categoryTriggerRef}
                  type="button"
                  aria-expanded={categoryMenuOpen}
                  aria-haspopup="listbox"
                  aria-labelledby="banking-tx-category-label"
                  disabled={categoryOptions.length === 0}
                  onClick={() => categoryOptions.length > 0 && setCategoryMenuOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 overflow-hidden rounded-lg border border-slate-600 bg-slate-950 py-2 pl-3 pr-3 text-left text-sm outline-none transition hover:border-slate-500 focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span
                    className={`min-w-0 flex-1 truncate font-semibold ${selectedCategory ? "text-slate-100" : "text-slate-500"}`}
                  >
                    {selectedCategory?.name ?? "Selecciona categoría"}
                  </span>
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden
                    className={`h-5 w-5 shrink-0 text-[#8b949e] transition ${categoryMenuOpen ? "rotate-180" : ""}`}
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.24 4.496a.75.75 0 01-1.08 0l-4.24-4.497a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>

              {categoryId !== "" && (
                <label className="block">
                  <span className="text-xs text-[#8b949e]">Subcategoría</span>
                  <select
                    value={subcategoryId === "" ? "" : String(subcategoryId)}
                    onChange={(e) => setSubcategoryId(e.target.value ? Number(e.target.value) : "")}
                    className="mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white outline-none focus:border-[#58a6ff]"
                    disabled={subOptions.length === 0}
                  >
                    {subOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {isOwnAccountsTransfer && !editing && (
                <label className="block">
                  <span className="text-xs text-[#8b949e]">¿A qué producto va la transferencia?</span>
                  <select
                    value={transferDestinationAccountId === "" ? "" : String(transferDestinationAccountId)}
                    onChange={(e) =>
                      setTransferDestinationAccountId(e.target.value ? Number(e.target.value) : "")
                    }
                    className="mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white outline-none focus:border-[#58a6ff]"
                    disabled={transferDestinationOptions.length === 0}
                  >
                    <option value="">Selecciona cuenta destino…</option>
                    {transferDestinationOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[12px] leading-snug text-[#8b949e]">
                    No puede ser la cuenta de este movimiento ni una tarjeta de crédito. Se creará un segundo
                    movimiento en la cuenta destino con el monto de signo contrario.
                  </p>
                  {transferDestinationOptions.length === 0 && (
                    <p className="mt-1 text-[12px] text-amber-200/90">
                      No hay otra cuenta disponible. Crea otra cuenta (no tarjeta) en Cuentas.
                    </p>
                  )}
                </label>
              )}

              <div ref={scopeMenuRef} className="relative space-y-1.5">
                <span id="banking-tx-scope-label" className="text-xs text-[#8b949e]">
                  Tipo de movimiento
                </span>
                <button
                  ref={scopeTriggerRef}
                  type="button"
                  aria-expanded={scopeMenuOpen}
                  aria-haspopup="listbox"
                  aria-labelledby="banking-tx-scope-label"
                  onClick={() => setScopeMenuOpen((o) => !o)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-[#58a6ff]/35 ${
                    isShared
                      ? "border-violet-500/40 bg-gradient-to-br from-violet-950/50 to-[#0d1117] text-violet-100 ring-1 ring-violet-500/20"
                      : "border-emerald-500/35 bg-gradient-to-br from-emerald-950/40 to-[#0d1117] text-emerald-50 ring-1 ring-emerald-500/15"
                  }`}
                >
                  <span>
                    <span className="block text-[13px] font-semibold">
                      {isShared ? "Compartido" : "Personal"}
                    </span>
                    <span className="mt-0.5 block text-[12px] font-normal opacity-85">
                      {isShared
                        ? "Divide el monto entre varias personas"
                        : "Solo aplica a tus finanzas"}
                    </span>
                  </span>
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden
                    className={`h-5 w-5 shrink-0 opacity-70 transition ${scopeMenuOpen ? "rotate-180" : ""}`}
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.24 4.496a.75.75 0 01-1.08 0l-4.24-4.497a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {isShared && (
                  <div className="space-y-4 border-t border-[#30363d]/50 pt-4">
                    <div className="overflow-hidden rounded-xl border border-[#30363d] bg-[#0d1117]/80">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-[#30363d] bg-[#21262d]/90">
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[#8b949e]">
                              Personas
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[#8b949e]">
                              Monto P/P
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="align-middle">
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                value={splitParticipants}
                                onChange={(e) => setSplitParticipants(e.target.value)}
                                className="w-[4.25rem] rounded-lg border border-[#30363d] bg-[#161b22] px-2 py-1.5 text-center font-mono text-sm text-white outline-none focus:border-[#58a6ff]"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[#e6edf3]">
                              {amountPerPersonLabel}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <SiNoField
                      label="¿Gasto compartido pagado?"
                      value={sharedExpenseSettled}
                      onChange={setSharedExpenseSettled}
                    />
                  </div>
                )}
              </div>

              {isCreditCardAccount && (
                <SiNoField
                  label="¿Movimiento TC pagado?"
                  value={creditCardChargePaid}
                  onChange={setCreditCardChargePaid}
                />
              )}

              {isEditingProvision && (
                <SiNoField
                  label="Provisión reversada"
                  value={provisionReversalOnSave}
                  onChange={setProvisionReversalOnSave}
                />
              )}

              <div ref={accountingMonthWrapRef} className="block">
                <span id="banking-tx-accounting-month-label" className="text-xs text-[#8b949e]">
                  Mes contable
                </span>
                <div
                  ref={accountingMonthTriggerRef}
                  role="group"
                  aria-labelledby="banking-tx-accounting-month-label"
                  className="mt-1.5 flex min-h-[42px] items-center justify-between gap-2 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm outline-none transition hover:border-[#484f58] focus-within:border-[#58a6ff] focus-within:ring-2 focus-within:ring-[#58a6ff]/25 [color-scheme:dark]"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-left text-[#e6edf3] transition hover:bg-[#21262d] hover:text-[#58a6ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff]/40"
                      aria-label={`Mes: ${ACCOUNTING_MONTH_ABBR_ES[accountingYmParts.m - 1]}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setAccountingPickMode((prev) => (prev === "month" ? null : "month"));
                      }}
                    >
                      {ACCOUNTING_MONTH_ABBR_ES[accountingYmParts.m - 1]}
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 tabular-nums text-[#e6edf3] transition hover:bg-[#21262d] hover:text-[#58a6ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff]/40"
                      aria-label={`Año: ${accountingYmParts.y}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setAccountingPickMode((prev) => (prev === "year" ? null : "year"));
                      }}
                    >
                      {accountingYmParts.y}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-[#8b949e] outline-none transition hover:bg-[#21262d] hover:text-[#58a6ff] focus-visible:ring-2 focus-visible:ring-[#58a6ff]/40"
                    aria-label="Elegir mes"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAccountingPickMode((prev) => (prev === "month" ? null : "month"));
                    }}
                  >
                    <IconCalendar className="h-5 w-5" />
                  </button>
                </div>
                <span className="mt-1 block text-[12px] text-[#8b949e]">
                  Por defecto coincide con el mes de la fecha de la transacción (útil para filtros y reportes). Pulsa el
                  mes o el ícono para los meses; pulsa el año para elegir año.
                </span>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setEditing(null);
                  setScopeMenuOpen(false);
                  setCategoryMenuOpen(false);
                  setAccountingPickMode(null);
                  setProvisionReversalOnSave(false);
                }}
                className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#e6edf3] hover:bg-[#21262d]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  saving ||
                  accountId === "" ||
                  categoryId === "" ||
                  subcategoryId === "" ||
                  subOptions.length === 0 ||
                  (isOwnAccountsTransfer &&
                    !editing &&
                    (transferDestinationAccountId === "" || transferDestinationOptions.length === 0))
                }
                onClick={() => void saveModal()}
                className="rounded-lg border border-[#166534] bg-[#22c55e]/90 px-4 py-2 text-sm font-medium text-white hover:bg-[#16a34a] disabled:opacity-40"
              >
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {scopeMenuOpen &&
        scopePanelBox !== null &&
        createPortal(
          <div
            ref={scopePanelRef}
            role="listbox"
            style={{
              position: "fixed",
              top: scopePanelBox.top,
              left: scopePanelBox.left,
              width: scopePanelBox.width,
              zIndex: 9999,
            }}
            className="overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] shadow-2xl ring-1 ring-black/40"
          >
            <div className="grid gap-2 p-2 sm:grid-cols-2">
              <button
                type="button"
                role="option"
                aria-selected={!isShared}
                className={`rounded-xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-emerald-500/40 ${
                  !isShared
                    ? "border-emerald-400/55 bg-emerald-950/55 ring-2 ring-emerald-500/30"
                    : "border-emerald-600/25 bg-emerald-950/20 hover:border-emerald-500/45 hover:bg-emerald-950/35"
                }`}
                onClick={() => {
                  setIsShared(false);
                  setScopeMenuOpen(false);
                }}
              >
                <span className="block text-sm font-semibold text-emerald-100">Personal</span>
                <span className="mt-1 block text-[12px] leading-snug text-emerald-200/75">
                  Movimiento individual
                </span>
              </button>
              <button
                type="button"
                role="option"
                aria-selected={isShared}
                className={`rounded-xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-violet-500/40 ${
                  isShared
                    ? "border-violet-400/55 bg-violet-950/55 ring-2 ring-violet-500/35"
                    : "border-violet-600/25 bg-violet-950/25 hover:border-violet-500/45 hover:bg-violet-950/45"
                }`}
                onClick={() => {
                  setIsShared(true);
                  setScopeMenuOpen(false);
                }}
              >
                <span className="block text-sm font-semibold text-violet-100">Compartido</span>
                <span className="mt-1 block text-[12px] leading-snug text-violet-200/75">
                  Reparto entre personas
                </span>
              </button>
            </div>
          </div>,
          document.body,
        )}

      {categoryMenuOpen &&
        categoryPanelBox !== null &&
        createPortal(
          <div
            ref={categoryPanelRef}
            role="listbox"
            aria-labelledby="banking-tx-category-label"
            style={{
              position: "fixed",
              top: categoryPanelBox.top,
              left: categoryPanelBox.left,
              width: categoryPanelBox.width,
              zIndex: 10000,
            }}
            className="tx-scroll max-h-56 overflow-y-auto rounded-xl border border-slate-600 bg-slate-900 py-1 shadow-2xl ring-1 ring-black/40"
          >
            {categoryOptions.map((c) => {
              const sel = c.id === categoryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  className={`flex w-full border-b border-slate-700/60 py-2.5 pl-3 pr-3 text-left text-sm font-semibold transition last:border-b-0 ${
                    sel ? "bg-slate-800 text-sky-400" : "text-slate-100 hover:bg-slate-800/80"
                  }`}
                  onClick={() => {
                    setCategoryId(c.id);
                    setCategoryMenuOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}

      {accountingPickMode &&
        accountingMonthPanelBox !== null &&
        createPortal(
          <div
            ref={accountingMonthPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label={accountingPickMode === "month" ? "Elegir mes" : "Elegir año"}
            style={{
              position: "fixed",
              top: accountingMonthPanelBox.top,
              left: accountingMonthPanelBox.left,
              width: accountingMonthPanelBox.width,
              zIndex: 10001,
            }}
            className="overflow-hidden rounded-xl border border-[#30363d] bg-[#161b22] shadow-2xl ring-1 ring-black/40"
          >
            {accountingPickMode === "month" ? (
              <div className="grid grid-cols-3 gap-1 p-2">
                {ACCOUNTING_MONTH_ABBR_ES.map((abbr, idx) => {
                  const mi = idx + 1;
                  const sel = accountingYmParts.m === mi;
                  return (
                    <button
                      key={abbr}
                      type="button"
                      className={`rounded-lg px-2 py-2 text-sm font-medium transition ${
                        sel
                          ? "bg-[#21262d] text-[#58a6ff] ring-2 ring-[#58a6ff]/35"
                          : "text-[#e6edf3] hover:bg-[#21262d]"
                      }`}
                      onClick={() => {
                        setAccountingMonthYm(buildYm(accountingYmParts.y, mi));
                        setAccountingPickMode(null);
                      }}
                    >
                      {abbr}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="tx-scroll max-h-56 overflow-y-auto p-2">
                <div className="grid grid-cols-4 gap-1">
                  {accountingYearRange(accountingYmParts.y).map((yy) => {
                    const sel = yy === accountingYmParts.y;
                    return (
                      <button
                        key={yy}
                        type="button"
                        className={`rounded-lg px-2 py-2 text-sm tabular-nums transition ${
                          sel
                            ? "bg-[#21262d] text-[#58a6ff] ring-2 ring-[#58a6ff]/35"
                            : "text-[#e6edf3] hover:bg-[#21262d]"
                        }`}
                        onClick={() => {
                          setAccountingMonthYm(buildYm(yy, accountingYmParts.m));
                          setAccountingPickMode(null);
                        }}
                      >
                        {yy}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
