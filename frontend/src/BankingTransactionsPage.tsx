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
import type { CSSProperties, Dispatch, SetStateAction } from "react";
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

function bankingAccountAtBank(a: BankingAccountRow): number {
  const p = a.provision_net_sum ?? 0;
  return a.balance_at_bank !== undefined ? a.balance_at_bank : a.balance - p;
}

/** Deuda pendiente CLP por grupo de cargos TC (egresos no pagados). Coincide con backend sum(-amount). */
function sumUnpaidTcDebtFromItems(items: BankingTransactionRow[]): number {
  let s = 0;
  for (const tx of items) {
    if (tx.amount < 0) s += -tx.amount;
  }
  return s;
}

/**
 * Reparte cargos TC no pagados por cuenta corriente asociada (`linked_checking_account_id`).
 * Solo esas TC descuentan el «saldo real» de la cuenta líquida enlazada.
 */
function creditCardUnpaidAllocatedByChecking(
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
function BankingAccountBalanceCard({
  account: a,
  creditCardUnpaidAllocatedClp = 0,
}: {
  account: BankingAccountRow;
  /** Solo cuentas líquidas con TC asociadas: cargos TC no pagados enlazados a esta cuenta corriente. */
  creditCardUnpaidAllocatedClp?: number;
}) {
  const liquid = a.product_type !== "tarjeta_credito";
  const unpaidCut = liquid ? Math.max(0, creditCardUnpaidAllocatedClp) : 0;
  const saldoReal = liquid ? a.balance - unpaidCut : a.balance;

  const inactive = Math.abs(a.balance) < 1e-9;
  const prov = a.provision_net_sum ?? 0;
  const atBank =
    a.balance_at_bank !== undefined ? a.balance_at_bank : a.balance - prov;

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col rounded-2xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-cyan-50/80 p-3.5 shadow-[0_10px_36px_-12px_rgba(14,165,233,0.2)] ring-1 ring-sky-100/80 ${
        inactive ? "opacity-[0.88]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 ring-1 ring-sky-200/80"
          aria-hidden
        >
          <svg className="h-4 w-4 text-sky-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 10h18M5 10V8a2 2 0 012-2h10a2 2 0 012 2v2M5 10v10h14V10M9 14h6"
            />
          </svg>
        </div>
        <span className="max-w-[55%] shrink-0 truncate rounded-full bg-sky-100/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-800">
          {bankingProductBadgeLabel(a.product_type)}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 min-h-[2rem] text-sm font-bold leading-snug text-slate-800">{a.name}</p>

      <p
        className="mt-1.5 text-lg font-bold tabular-nums tracking-tight text-slate-900"
        title={
          liquid
            ? `Saldo real (libro): incluye provisiones en el saldo libro; menos cargos en TC no pagados asociados a esta cuenta (${formatClpDots(unpaidCut)}).`
            : "Saldo libro en la cuenta tarjeta (egresos no pagados siguen pendientes hasta marcarlos o pagar)."
        }
      >
        {formatClpDots(saldoReal)}
      </p>
      <div className="mt-1 border-t border-sky-100 pt-1">
        <div
          className={`grid gap-x-2 gap-y-0 leading-none ${unpaidCut > 0 ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-wide text-sky-600/90">Saldo actual</p>
            <p
              className="mt-0.5 truncate text-[12px] font-semibold tabular-nums leading-tight text-slate-700"
              title="Efectivo en cuenta (libro menos neto de Provisiones)."
            >
              {formatClpDots(atBank)}
            </p>
          </div>
          {unpaidCut > 0 ? (
            <div className="min-w-0 text-right">
              <p className="text-[9px] font-medium uppercase tracking-wide text-sky-600/90">Deuda TC</p>
              <p
                className="mt-0.5 truncate text-[12px] font-semibold tabular-nums leading-tight text-rose-600"
                title="Cargos en tarjeta(s) asociada(s) a esta cuenta marcados como no pagados."
              >
                {formatClpDots(unpaidCut)}
              </p>
            </div>
          ) : null}
          <div className="min-w-0 text-right">
            <p className="text-[9px] font-medium uppercase tracking-wide text-sky-600/90">Provisiones</p>
            <p
              className="mt-0.5 truncate text-[12px] font-semibold tabular-nums leading-tight text-rose-600"
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

/**
 * Saldo real (libro neto TC): suma saldos libro líquidos − deuda pendiente solo de TC con cuenta asociada.
 * Saldo actual: suma saldos «en banco» (libro − neto provisiones), sin restar TC.
 */
function BankingNonCreditTotalBalanceCard({
  liquidAccounts,
  creditCardUnpaidLinkedTotalClp,
}: {
  liquidAccounts: BankingAccountRow[];
  creditCardUnpaidLinkedTotalClp: number;
}) {
  const liquidBook = liquidAccounts.reduce((s, a) => s + a.balance, 0);
  const liquidAtBank = liquidAccounts.reduce((s, a) => s + bankingAccountAtBank(a), 0);
  const unpaidLinked = Math.max(0, creditCardUnpaidLinkedTotalClp);
  const totalReal = liquidBook - unpaidLinked;
  const totalAtBank = liquidAtBank;
  const provisionSumDisplay = liquidAccounts.reduce((s, a) => s + Math.abs(a.provision_net_sum ?? 0), 0);
  const inactive = Math.abs(totalReal) < 1e-9;

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-200/95 via-emerald-100 to-teal-200/90 p-3.5 shadow-[0_10px_36px_-12px_rgba(5,150,105,0.3)] ring-1 ring-emerald-300/70 ${
        inactive ? "opacity-[0.88]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-600/95 ring-1 ring-emerald-700/50"
          aria-hidden
        >
          <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <span className="max-w-[58%] shrink-0 truncate rounded-full bg-emerald-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-50 shadow-sm">
          Total
        </span>
      </div>

      <p className="mt-2 line-clamp-2 min-h-[2rem] text-sm font-bold leading-snug text-emerald-950">Saldo real</p>

      <p
        className="mt-1.5 text-lg font-bold tabular-nums tracking-tight text-emerald-950"
        title="Suma de saldos libro (incluye provisiones en libro) en cuentas líquidas, menos cargos TC no pagados solo en tarjetas con cuenta corriente asociada."
      >
        {formatClpDots(totalReal)}
      </p>
      <div className="mt-1 border-t border-emerald-500/35 pt-1">
        <div
          className={`grid gap-x-2 gap-y-0 leading-none ${unpaidLinked > 0 ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-wide text-emerald-950/90">Saldo actual</p>
            <p
              className="mt-0.5 truncate text-[12px] font-semibold tabular-nums leading-tight text-slate-700"
              title="Suma de saldos «en banco» por cuenta líquida (movimientos sin efecto neto de categoría Provisiones)."
            >
              {formatClpDots(totalAtBank)}
            </p>
          </div>
          {unpaidLinked > 0 ? (
            <div className="min-w-0 text-right">
              <p className="text-[9px] font-medium uppercase tracking-wide text-emerald-950/90">Deuda TC</p>
              <p
                className="mt-0.5 truncate text-[12px] font-semibold tabular-nums leading-tight text-rose-600"
                title="Suma de cargos en tarjetas con cuenta corriente asociada marcados como no pagados."
              >
                {formatClpDots(unpaidLinked)}
              </p>
            </div>
          ) : null}
          <div className="min-w-0 text-right">
            <p className="text-[9px] font-medium uppercase tracking-wide text-emerald-950/90">Provisiones</p>
            <p
              className="mt-0.5 truncate text-[12px] font-semibold tabular-nums leading-tight text-rose-600"
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

/** Deuda pago compartido — mismo lenguaje visual que tarjetas de cuenta (gradiente violeta suave). */
const BANKING_SHARED_DEBT_CARD_CLASS =
  "flex h-full min-h-0 w-full min-w-0 flex-col rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50/75 p-3.5 shadow-[0_10px_36px_-12px_rgba(139,92,246,0.2)] ring-1 ring-violet-100/80 backdrop-blur-sm";

/** Movimientos compartidos aún sin marcar como liquidados (suma de |monto|). */
function BankingSharedUnsettledDebtCard({ amountClp }: { amountClp: number }) {
  const inactive = Math.abs(amountClp) < 1e-9;
  return (
    <div className={`${BANKING_SHARED_DEBT_CARD_CLASS} ${inactive ? "opacity-[0.88]" : ""}`}>
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-100 ring-1 ring-violet-200/80"
          aria-hidden
        >
          <svg className="h-4 w-4 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
            />
          </svg>
        </div>
        <span className="max-w-[58%] shrink-0 truncate rounded-full bg-violet-100/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-800">
          Compartido
        </span>
      </div>
      <p className="mt-2 line-clamp-2 min-h-[2rem] text-sm font-bold leading-snug text-slate-800">Deuda Pago Compartido</p>
      <p
        className="mt-1.5 text-lg font-bold tabular-nums tracking-tight text-slate-900"
        title="Suma de valores absolutos de movimientos compartidos con liquidación pendiente."
      >
        {formatClpDots(amountClp)}
      </p>
    </div>
  );
}

const BANKING_TX_TABLE_PREFS_STORAGE_KEY = "banking_tx_table_prefs_v2";

/** Opciones multi-selección «Tipo de movimiento». Vacío = todas. */
type BankingTxSharedScopeOption = "personal" | "shared_any";

/** Opciones multi-selección «Compartido liquidado». Vacío = todas. */
type BankingTxLiquidadoOption = "yes" | "no" | "na";

/** Opciones multi-selección «Cargo TC». Vacío = todas. */
type BankingTxTcPaidOption = "paid" | "unpaid" | "na";

function toggleNumInSortedList(prev: number[], id: number): number[] {
  const i = prev.indexOf(id);
  if (i >= 0) return prev.filter((x) => x !== id);
  return [...prev, id].sort((a, b) => a - b);
}

function toggleEnumInList<T extends string>(prev: T[], v: T): T[] {
  return prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v];
}

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

/** Filtros popover — inputs sobre fondo claro (fintech pastel). */
const bankingMainTxFilterInputClass =
  "mt-1 w-full rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 [color-scheme:light]";

/** Modal nuevo/editar movimiento y toolbars secundarios — controles sobre blanco. */
const bankingModalControlClass =
  "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 [color-scheme:light]";
const bankingModalCategoryTriggerClass =
  "flex w-full items-center justify-between gap-2 overflow-hidden rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-3 text-left text-sm outline-none shadow-sm transition hover:border-teal-200 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 disabled:cursor-not-allowed disabled:opacity-40 [color-scheme:light]";
const bankingToolbarGhostBtnClass =
  "rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50/90";
const bankingToolbarGhostBtnMdClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-teal-200 hover:bg-teal-50/90 disabled:cursor-not-allowed disabled:opacity-35";
const bankingAuxActionBtnClass =
  "rounded-lg border border-teal-200 bg-gradient-to-b from-teal-50 to-emerald-50 px-2 py-1 text-[11px] font-semibold text-teal-900 shadow-sm ring-1 ring-teal-100 transition hover:from-teal-100 hover:to-emerald-50 disabled:cursor-wait disabled:opacity-40";
const bankingAuxBulkBtnClass =
  "rounded-xl border border-teal-200 bg-gradient-to-b from-teal-50 to-emerald-50 px-3 py-1.5 text-xs font-semibold text-teal-900 shadow-sm ring-1 ring-teal-100 transition hover:from-teal-100 hover:to-emerald-50 disabled:cursor-not-allowed disabled:opacity-40";

/** Tabla principal — tarjeta blanca + menta muy suave (modo claro). */
const BANKING_MAIN_TX_CARD_CLASS =
  "banking-table-scroll overflow-x-auto rounded-2xl border border-teal-100 bg-white/95 pb-2 shadow-[0_8px_40px_-12px_rgba(45,212,191,0.18),inset_0_1px_0_0_rgba(255,255,255,0.9)] backdrop-blur-sm";
const BANKING_MAIN_TX_TOOLBAR_CLASS =
  "sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-teal-100/90 bg-gradient-to-r from-teal-50/95 to-cyan-50/80 px-3 py-2.5";
const BANKING_MAIN_TX_THEAD_CLASS =
  "border-b border-teal-100 bg-gradient-to-r from-teal-50 via-emerald-50/90 to-teal-50";
const BANKING_MAIN_TX_TBODY_CLASS = "divide-y divide-slate-100";
const BANKING_MAIN_TX_TR_CLASS =
  "odd:bg-white even:bg-slate-50/90 text-slate-800 transition-colors hover:bg-teal-50/70";
const BANKING_MAIN_TX_FOOTER_CLASS =
  "flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/95 px-3 py-2.5";

/** Pendientes TC / compartidos — violeta pastel sobre claro. */
const BANKING_AUX_TX_CARD_CLASS =
  "banking-table-scroll overflow-x-auto rounded-2xl border border-violet-100 bg-white/95 pb-2 shadow-[0_8px_40px_-12px_rgba(139,92,246,0.12)] backdrop-blur-sm";
const BANKING_AUX_TX_THEAD_CLASS =
  "border-b border-violet-100 bg-gradient-to-r from-violet-50 via-fuchsia-50/70 to-violet-50";
const BANKING_AUX_TX_TBODY_CLASS = "divide-y divide-slate-100";
const BANKING_AUX_TX_TR_CLASS =
  "odd:bg-white even:bg-violet-50/40 text-slate-800 transition-colors hover:bg-violet-50/90";
const BANKING_AUX_TX_TH_TEXT_CLASS =
  "text-[12px] font-semibold uppercase tracking-wide text-violet-900/75";
const BANKING_AUX_SECTION_HEADING_CLASS = "text-sm font-semibold text-slate-700";

/** Contenedor pestañas «Movimientos». */
const BANKING_MOVEMENTS_SECTION_CLASS =
  "overflow-hidden rounded-2xl border border-teal-100 bg-white/90 shadow-[0_12px_48px_-16px_rgba(20,184,166,0.15)] backdrop-blur-sm";
const BANKING_MOVEMENTS_TABLIST_CLASS =
  "flex flex-wrap gap-2 border-b border-teal-100 bg-gradient-to-r from-teal-50/90 to-cyan-50/70 px-2 pt-3";

/** Botones ícono filas auxiliares. */
const txIconBtnAux =
  "inline-flex h-8 w-8 items-center justify-center rounded-xl border border-transparent text-slate-500 transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700";
const txIconBtnAuxDanger = `${txIconBtnAux} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600`;

/** Casilla circular para pendientes TC / compartidos: borde gris → al marcar fondo verde con ✓ (parcial = guión). */
function BankingAuxRoundCheckbox({
  checked,
  indeterminate,
  onChange,
  title,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  title?: string;
  "aria-label": string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) el.indeterminate = !!indeterminate;
  }, [indeterminate]);

  const partial = !!indeterminate;

  return (
    <label className="inline-flex cursor-pointer select-none items-center justify-center" title={title}>
      <input
        ref={inputRef}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
      />
      <span
        className={[
          "flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color,box-shadow] duration-150",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-teal-400/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white",
          partial
            ? "border-amber-300 bg-amber-50 shadow-sm"
            : checked
              ? "border-teal-500 bg-teal-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)]"
              : "border-slate-300 bg-white hover:border-teal-300 hover:bg-teal-50/50",
        ].join(" ")}
        aria-hidden
      >
        {partial ? (
          <span className="h-0.5 w-2 rounded-full bg-amber-100/95" />
        ) : checked ? (
          <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path
              d="M3.75 8.25L6.75 11.25L12.25 4.75"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        ) : null}
      </span>
    </label>
  );
}

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

function SortableBankingBalanceCard({
  account,
  creditCardUnpaidAllocatedClp = 0,
}: {
  account: BankingAccountRow;
  creditCardUnpaidAllocatedClp?: number;
}) {
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
      <BankingAccountBalanceCard
        account={account}
        creditCardUnpaidAllocatedClp={creditCardUnpaidAllocatedClp}
      />
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
      className={`inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full border p-[3px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "justify-end border-teal-400 bg-teal-400 shadow-inner" : "justify-start border-slate-300 bg-slate-200"
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

function bankingTxColumnFilterActive(colKey: BankingTxColumnKey, f: BankingTxFilterSnapshot): boolean {
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
    case "mes_contable":
      return f.filterAccountingMonthYms.length > 0;
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
  filterAccountIds: number[];
  setFilterAccountIds: Dispatch<SetStateAction<number[]>>;
  filterAmountMin: string;
  setFilterAmountMin: (v: string) => void;
  filterAmountMax: string;
  setFilterAmountMax: (v: string) => void;
  filterCategoryIds: number[];
  setFilterCategoryIds: Dispatch<SetStateAction<number[]>>;
  filterSubcategoryIds: number[];
  setFilterSubcategoryIds: Dispatch<SetStateAction<number[]>>;
  filterSharedScopes: BankingTxSharedScopeOption[];
  setFilterSharedScopes: Dispatch<SetStateAction<BankingTxSharedScopeOption[]>>;
  filterLiquidadoValues: BankingTxLiquidadoOption[];
  setFilterLiquidadoValues: Dispatch<SetStateAction<BankingTxLiquidadoOption[]>>;
  filterTcPaidValues: BankingTxTcPaidOption[];
  setFilterTcPaidValues: Dispatch<SetStateAction<BankingTxTcPaidOption[]>>;
  filterAccountingMonthYms: string[];
  setFilterAccountingMonthYms: Dispatch<SetStateAction<string[]>>;
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

function BankingTxMesContableFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const sel = bankingMainTxFilterInputClass;
  const [pickerKey, setPickerKey] = useState(0);

  return (
    <div className="space-y-2">
      <span className="text-xs text-slate-500">Meses contables</span>
      {ctx.filterAccountingMonthYms.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {ctx.filterAccountingMonthYms.map((ym) => (
            <button
              key={ym}
              type="button"
              title="Quitar"
              onClick={() =>
                ctx.setFilterAccountingMonthYms((prev) => prev.filter((x) => x !== ym))
              }
              className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[12px] font-medium text-teal-900 ring-1 ring-teal-100 transition hover:bg-teal-100/80"
            >
              <span className="tabular-nums">{ym}</span>
              <span className="text-teal-600" aria-hidden>
                ×
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <input
        key={pickerKey}
        type="month"
        className={`${sel} mt-1 cursor-pointer`}
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          ctx.setFilterAccountingMonthYms((prev) =>
            prev.includes(v) ? prev : [...prev, v].sort(),
          );
          setPickerKey((k) => k + 1);
        }}
      />
      <p className="text-[11px] leading-snug text-slate-500">Elige meses con el selector; puedes combinar varios.</p>
    </div>
  );
}

function BankingTxCategoryFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const sel = bankingMainTxFilterInputClass;
  const [query, setQuery] = useState("");
  const qNorm = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!qNorm) return ctx.filterCategoriesSorted;
    return ctx.filterCategoriesSorted.filter((c) => c.name.toLowerCase().includes(qNorm));
  }, [ctx.filterCategoriesSorted, qNorm]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">Categorías (varias)</span>
        <button
          type="button"
          onClick={() => ctx.setFilterCategoryIds([])}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-teal-50"
        >
          Borrar selección
        </button>
      </div>
      <label className="block">
        <span className="text-xs text-slate-500">Buscar categoría</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Escribe para acotar la lista…"
          autoComplete="off"
          className={`${sel} mt-1`}
        />
      </label>
      <div className="mt-1 max-h-[min(50vh,280px)] space-y-1 overflow-y-auto pr-0.5 tx-scroll">
        {filtered.map((c) => {
          const picked = ctx.filterCategoryIds.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() =>
                ctx.setFilterCategoryIds((prev) => toggleNumInSortedList(prev, c.id))
              }
              className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm font-medium text-slate-800 transition hover:bg-teal-50 ${
                picked ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300" : "border border-slate-200 bg-white"
              }`}
            >
              {c.name}
            </button>
          );
        })}
      </div>
      {ctx.filterCategoriesSorted.length === 0 ? (
        <p className="text-[12px] leading-snug text-slate-500">No hay categorías en los movimientos cargados.</p>
      ) : filtered.length === 0 ? (
        <p className="text-[12px] leading-snug text-slate-500">
          Ninguna categoría coincide con «{query.trim()}».
        </p>
      ) : null}
    </div>
  );
}

function BankingTxSubcategoryFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const sel = bankingMainTxFilterInputClass;
  const [query, setQuery] = useState("");
  const qNorm = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!qNorm) return ctx.filterSubcategoryDropdownRows;
    return ctx.filterSubcategoryDropdownRows.filter((r) => r.label.toLowerCase().includes(qNorm));
  }, [ctx.filterSubcategoryDropdownRows, qNorm]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">Subcategorías (varias)</span>
        <button
          type="button"
          onClick={() => ctx.setFilterSubcategoryIds([])}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-teal-50"
        >
          Borrar selección
        </button>
      </div>
      <label className="block">
        <span className="text-xs text-slate-500">Buscar subcategoría</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nombre o categoría › subcategoría…"
          autoComplete="off"
          className={`${sel} mt-1`}
        />
      </label>
      <div className="mt-1 max-h-[min(50vh,280px)] space-y-1 overflow-y-auto pr-0.5 tx-scroll">
        {filtered.map((r) => {
          const picked = ctx.filterSubcategoryIds.includes(r.id);
          const shortLabel =
            ctx.filterCategoryIds.length !== 1 ? r.label : (r.label.split(" › ").pop() ?? r.label);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() =>
                ctx.setFilterSubcategoryIds((prev) => toggleNumInSortedList(prev, r.id))
              }
              className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm font-medium text-slate-800 transition hover:bg-teal-50 ${
                picked ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300" : "border border-slate-200 bg-white"
              }`}
            >
              {shortLabel}
            </button>
          );
        })}
      </div>
      {ctx.filterSubcategoryDropdownRows.length === 0 ? (
        <p className="text-[12px] leading-snug text-slate-500">
          No hay subcategorías en los movimientos cargados
          {ctx.filterCategoryIds.length > 0 ? " para las categorías seleccionadas." : "."}
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-[12px] leading-snug text-slate-500">
          Ninguna subcategoría coincide con «{query.trim()}».
        </p>
      ) : null}
    </div>
  );
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
          open ? "bg-teal-100/90 ring-1 ring-inset ring-teal-300/60" : "hover:bg-teal-50/80"
        }`}
      >
        <span className={`block ${titleSize} font-semibold uppercase tracking-wide text-teal-900/85`}>{label}</span>
        <span
          className={`mt-0.5 block text-[9px] font-medium normal-case tracking-normal ${
            active ? "text-teal-700" : "text-slate-500"
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
            <span className="text-xs text-slate-500">Fecha desde</span>
            <input
              type="date"
              value={ctx.filterDateFrom}
              onChange={(e) => ctx.setFilterDateFrom(e.target.value)}
              className={`${sel} mt-1 cursor-pointer`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Fecha hasta</span>
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
          <span className="text-xs text-slate-500">Contiene texto</span>
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
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500">Productos (varios)</span>
            <button
              type="button"
              onClick={() => ctx.setFilterAccountIds([])}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-teal-50"
            >
              Borrar selección
            </button>
          </div>
          <div className="mt-1 max-h-[min(50vh,280px)] space-y-1 overflow-y-auto pr-0.5 tx-scroll">
            {ctx.filterAccountsSorted.map((a) => {
              const picked = ctx.filterAccountIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() =>
                    ctx.setFilterAccountIds((prev) => toggleNumInSortedList(prev, a.id))
                  }
                  className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-teal-50 ${
                    picked ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300" : "border border-slate-200 bg-white"
                  }`}
                >
                  <span className={picked ? "font-semibold text-teal-900" : "text-slate-800"}>{a.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    case "monto":
      return (
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-slate-500">Monto mínimo</span>
            <input
              inputMode="decimal"
              value={ctx.filterAmountMin}
              onChange={(e) => ctx.setFilterAmountMin(e.target.value)}
              placeholder="Ej. -50000"
              className={`${sel} mt-1`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500">Monto máximo</span>
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
      return <BankingTxCategoryFilterBody />;
    case "subcategoria":
      return <BankingTxSubcategoryFilterBody />;
    case "tipo_movimiento":
      return (
        <div className="space-y-2">
          <span className="text-xs text-slate-500">Tipo (varios)</span>
          <div className="mt-1 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() =>
                ctx.setFilterSharedScopes((prev) => toggleEnumInList(prev, "personal"))
              }
              className={`rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-teal-50 ${
                ctx.filterSharedScopes.includes("personal")
                  ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300"
                  : "border-slate-200 bg-white"
              }`}
            >
              Solo personal
            </button>
            <button
              type="button"
              onClick={() =>
                ctx.setFilterSharedScopes((prev) => toggleEnumInList(prev, "shared_any"))
              }
              className={`rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-teal-50 ${
                ctx.filterSharedScopes.includes("shared_any")
                  ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300"
                  : "border-slate-200 bg-white"
              }`}
            >
              Solo compartido
            </button>
          </div>
          <p className="text-[11px] text-slate-500">Sin selección = mostrar todos. Varios = unión (cualquiera).</p>
        </div>
      );
    case "compartido_liquidado":
      return (
        <div className="space-y-2">
          <span className="text-xs text-slate-500">Valor en tabla (varios)</span>
          <div className="mt-1 flex flex-col gap-1.5">
            {(
              [
                ["yes", "Sí"],
                ["no", "No"],
                ["na", "—"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() =>
                  ctx.setFilterLiquidadoValues((prev) => toggleEnumInList(prev, val))
                }
                className={`rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-teal-50 ${
                  ctx.filterLiquidadoValues.includes(val)
                    ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300"
                    : "border-slate-200 bg-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">Sin selección = todos. Varios = unión.</p>
        </div>
      );
    case "cargo_tc":
      return (
        <div className="space-y-2">
          <span className="text-xs text-slate-500">Valor en tabla (varios)</span>
          <div className="mt-1 flex flex-col gap-1.5">
            {(
              [
                ["paid", "Sí"],
                ["unpaid", "No"],
                ["na", "—"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => ctx.setFilterTcPaidValues((prev) => toggleEnumInList(prev, val))}
                className={`rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-teal-50 ${
                  ctx.filterTcPaidValues.includes(val)
                    ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300"
                    : "border-slate-200 bg-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">Sin selección = todos. Varios = unión.</p>
        </div>
      );
    case "mes_contable":
      return <BankingTxMesContableFilterBody />;
    default:
      return null;
  }
}

/** Píldora Sí / No / — para columnas Compartido liquidado y Cargo TC. */
function BankingTxSiNoDashBadge({ text }: { text: string }) {
  if (text === "—") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-slate-500 ring-1 ring-slate-200">
        —
      </span>
    );
  }
  if (text === "Sí") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-emerald-100 px-2 py-0.5 text-[12px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
        Sí
      </span>
    );
  }
  if (text === "No") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-rose-100 px-2 py-0.5 text-[12px] font-semibold text-rose-800 ring-1 ring-rose-200">
        No
      </span>
    );
  }
  return <span className="text-[12px] text-slate-500">{text}</span>;
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
        <td className="align-middle whitespace-nowrap px-2 py-3 text-center text-[12px] text-slate-700 sm:px-2.5">
          {row.fecha.slice(0, 10)}
        </td>
      );
    case "descripcion":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-left text-[12px] leading-snug text-slate-600 sm:px-2.5">
          <span className="line-clamp-3 break-words [overflow-wrap:anywhere]">
            {row.description?.trim() || "—"}
          </span>
        </td>
      );
    case "producto":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-center text-[12px] text-slate-700 sm:px-2.5">
          <span className="line-clamp-3 break-words [overflow-wrap:anywhere]">{row.account_name}</span>
        </td>
      );
    case "monto": {
      /** Colores como actividad de inversiones; tamaño más compacto que la lista principal. */
      const signClass = income ? "text-teal-600" : "text-rose-600";
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
        <td className="align-middle min-w-0 px-2 py-3 text-center text-[11.5px] text-slate-700 sm:px-2.5">
          <span className="line-clamp-2 break-words font-medium leading-snug [overflow-wrap:anywhere]">
            {row.category_name}
          </span>
        </td>
      );
    case "subcategoria":
      return (
        <td className="align-middle min-w-0 px-2 py-3 text-center text-[11.5px] text-slate-700 sm:px-2.5">
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
                ? "bg-violet-100 text-violet-900 ring-1 ring-violet-200"
                : "bg-teal-100 text-teal-900 ring-1 ring-teal-200"
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
        <td className="align-middle whitespace-nowrap px-2 py-3 text-center text-[12px] text-slate-500 sm:px-2.5">
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
      <div className="flex items-center gap-2 rounded-lg border border-transparent px-1 py-1.5 transition hover:border-teal-100 hover:bg-teal-50/60">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="inline-flex shrink-0 cursor-grab touch-manipulation rounded-md p-1 text-slate-400 hover:bg-slate-200/80 hover:text-slate-800 active:cursor-grabbing"
          aria-label={`Arrastrar ${label}`}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800">{label}</span>
        {requiredCol ? (
          <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
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
  "inline-flex h-8 w-8 items-center justify-center rounded-xl border border-transparent text-slate-500 transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700";
const txIconBtnDanger = `${txIconBtn} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600`;

/** Monto en CLP que aporta un cargo TC a la deuda (egreso negativo → valor positivo). */
function tcChargeDebtMagnitudeClp(row: BankingTransactionRow): number {
  if (row.amount < 0) return -row.amount;
  return Math.abs(row.amount);
}

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
      s += tcChargeDebtMagnitudeClp(row);
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
        Cargos pendientes · {accountHeading}
      </h3>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-100 bg-teal-50/80 px-3 py-2 text-xs leading-snug text-slate-600 shadow-sm">
        <p className="min-w-0 flex-1">
          {selectedIds.size > 0 ? (
            <>
              <span className="text-slate-400">Suma seleccionada (cuadrar con pago al banco): </span>
              <strong className="tabular-nums text-teal-700">{formatClpDots(selectedSumClp)}</strong>
              <span className="text-slate-500"> · {selectedIds.size} movimiento(s)</span>
            </>
          ) : (
            <span className="text-slate-400">
              Marca cargos para ver la suma y alinearla con el monto que transferirás desde la cuenta corriente asociada.
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
                      accountingLabel={accountingLabel}
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
            className={bankingAuxBulkBtnClass}
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
                      accountingLabel={accountingLabel}
                    />
                  ))}
                  <td className="align-middle px-1.5 py-3 text-center sm:px-2">
                    <button
                      type="button"
                      disabled={markingSettledId === row.id}
                      onClick={() => void onMarkSettled(row)}
                      className={bankingAuxActionBtnClass}
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
  "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 [color-scheme:light]";

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

/** Sí / No — píldoras pastel (tema Banking). */
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
      <span className="text-xs text-slate-500">{label}</span>
      <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-1">
        <button
          type="button"
          aria-pressed={value === true}
          onClick={() => onChange(true)}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            value === true
              ? "border border-teal-300 bg-teal-100 text-teal-900 shadow-sm"
              : "border border-transparent text-slate-600 hover:bg-white hover:text-slate-900"
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
              ? "border border-rose-200 bg-rose-100 text-rose-900 shadow-sm"
              : "border border-transparent text-slate-600 hover:bg-white hover:text-slate-900"
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
  const [filterAccountIds, setFilterAccountIds] = useState<number[]>([]);
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [filterCategoryIds, setFilterCategoryIds] = useState<number[]>([]);
  const [filterSubcategoryIds, setFilterSubcategoryIds] = useState<number[]>([]);
  const [filterSharedScopes, setFilterSharedScopes] = useState<BankingTxSharedScopeOption[]>([]);
  const [filterLiquidadoValues, setFilterLiquidadoValues] = useState<BankingTxLiquidadoOption[]>([]);
  const [filterTcPaidValues, setFilterTcPaidValues] = useState<BankingTxTcPaidOption[]>([]);
  const [filterAccountingMonthYms, setFilterAccountingMonthYms] = useState<string[]>([]);
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
    const usedCat = new Set(items.map((r) => r.category_id));
    setFilterCategoryIds((prev) => prev.filter((id) => usedCat.has(id)));
  }, [items]);

  useEffect(() => {
    const usedSub = new Set(items.map((r) => r.subcategory_id));
    setFilterSubcategoryIds((prev) => prev.filter((id) => usedSub.has(id)));
  }, [items]);

  useEffect(() => {
    if (filterCategoryIds.length === 0) return;
    const allowed = new Set<number>();
    for (const cid of filterCategoryIds) {
      const cat = categories.find((c) => c.id === cid);
      if (cat) for (const s of cat.subcategories) allowed.add(s.id);
    }
    setFilterSubcategoryIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [filterCategoryIds, categories]);

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
      filterAccountIds,
      filterAmountMin,
      filterAmountMax,
      filterCategoryIds,
      filterSubcategoryIds,
      filterSharedScopes,
      filterLiquidadoValues,
      filterTcPaidValues,
      filterAccountingMonthYms,
    }),
    [
      filterDateFrom,
      filterDateTo,
      filterDescription,
      filterAccountIds,
      filterAmountMin,
      filterAmountMax,
      filterCategoryIds,
      filterSubcategoryIds,
      filterSharedScopes,
      filterLiquidadoValues,
      filterTcPaidValues,
      filterAccountingMonthYms,
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
    if (filterAccountIds.length === 1) {
      params.set("account_id", String(filterAccountIds[0]));
    } else if (filterAccountIds.length > 1) {
      for (const id of filterAccountIds) params.append("account_ids", String(id));
    }
    if (movementTab === "credit_card") params.set("scope", "credit_card");
    if (movementTab === "shared") params.set("scope", "shared");

    const [acc, cats, txList, debt, ccUg] = await Promise.all([
      fetchJson<BankingAccountRow[]>("/banking/accounts"),
      fetchJson<BankingCategoryRow[]>("/banking/categories"),
      fetchJson<{
        items: BankingTransactionRow[];
        total: number;
        page: number;
        page_size: number;
      }>(`/banking/transactions?${params.toString()}`),
      fetchJson<BankingDebtTotalsOut>("/banking/debt-totals"),
      fetchJson<{ groups: BankingCreditCardUnpaidGroup[] }>("/banking/credit-card/unpaid-grouped"),
    ]);
    const groups = ccUg.groups;
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
  }, [filterAccountIds, movementTab]);

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

  /** Ancho mínimo tabla pendientes TC (checkbox + columnas + Pagado + acciones). */
  const pendingCcTableMinWidthPx = useMemo(
    () => Math.max(440, bankingCcPendingVisibleColumns.length * 88 + 128 + 84 + 44),
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

  const { byCheckingId: ccUnpaidByCheckingId, totalLinkedUnpaidClp } = useMemo(
    () => creditCardUnpaidAllocatedByChecking(accounts, ccUnpaidGroups),
    [accounts, ccUnpaidGroups],
  );

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
    if (filterCategoryIds.length === 0) return rows;
    const allow = new Set(filterCategoryIds);
    return rows.filter((r) => allow.has(r.categoryId));
  }, [categories, items, filterCategoryIds]);

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

      if (filterAccountIds.length > 0 && !filterAccountIds.includes(row.account_id)) return false;

      if (filterCategoryIds.length > 0 && !filterCategoryIds.includes(row.category_id)) return false;
      if (filterSubcategoryIds.length > 0 && !filterSubcategoryIds.includes(row.subcategory_id)) return false;

      if (filterAmountMin.trim()) {
        const mn = parseAmt(filterAmountMin);
        if (!Number.isNaN(mn) && row.amount < mn) return false;
      }
      if (filterAmountMax.trim()) {
        const mx = parseAmt(filterAmountMax);
        if (!Number.isNaN(mx) && row.amount > mx) return false;
      }

      if (filterSharedScopes.length > 0) {
        const ok = filterSharedScopes.some((scope) => {
          if (scope === "personal") return !row.is_shared;
          if (scope === "shared_any") return row.is_shared;
          return false;
        });
        if (!ok) return false;
      }

      if (filterLiquidadoValues.length > 0) {
        const matchesLiq = (v: BankingTxLiquidadoOption) => {
          if (v === "yes") return row.is_shared && row.shared_expense_settled;
          if (v === "no") return row.is_shared && !row.shared_expense_settled;
          if (v === "na") return !row.is_shared;
          return false;
        };
        if (!filterLiquidadoValues.some(matchesLiq)) return false;
      }

      if (filterTcPaidValues.length > 0) {
        const matchesTc = (v: BankingTxTcPaidOption) => {
          if (v === "paid") return row.credit_card_charge_paid === true;
          if (v === "unpaid") return row.credit_card_charge_paid === false;
          if (v === "na") return row.credit_card_charge_paid == null;
          return false;
        };
        if (!filterTcPaidValues.some(matchesTc)) return false;
      }

      if (filterAccountingMonthYms.length > 0) {
        const rowYm = row.accounting_month ? row.accounting_month.slice(0, 7) : row.fecha.slice(0, 7);
        if (!filterAccountingMonthYms.includes(rowYm)) return false;
      }

      return true;
    });
  }, [
    items,
    filterDateFrom,
    filterDateTo,
    filterDescription,
    filterAccountIds,
    filterAmountMin,
    filterAmountMax,
    filterCategoryIds,
    filterSubcategoryIds,
    filterSharedScopes,
    filterLiquidadoValues,
    filterTcPaidValues,
    filterAccountingMonthYms,
  ]);

  useEffect(() => {
    if (filteredBankingTxItems.length === 0) setHeaderFilterOpen(null);
  }, [filteredBankingTxItems.length]);

  const bankingTxFiltersActive = useMemo(() => {
    return (
      filterDateFrom !== "" ||
      filterDateTo !== "" ||
      filterDescription.trim() !== "" ||
      filterAccountIds.length > 0 ||
      filterAmountMin.trim() !== "" ||
      filterAmountMax.trim() !== "" ||
      filterCategoryIds.length > 0 ||
      filterSubcategoryIds.length > 0 ||
      filterSharedScopes.length > 0 ||
      filterLiquidadoValues.length > 0 ||
      filterTcPaidValues.length > 0 ||
      filterAccountingMonthYms.length > 0
    );
  }, [
    filterDateFrom,
    filterDateTo,
    filterDescription,
    filterAccountIds,
    filterAmountMin,
    filterAmountMax,
    filterCategoryIds,
    filterSubcategoryIds,
    filterSharedScopes,
    filterLiquidadoValues,
    filterTcPaidValues,
    filterAccountingMonthYms,
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
      filterAccountIds,
      setFilterAccountIds,
      filterAmountMin,
      setFilterAmountMin,
      filterAmountMax,
      setFilterAmountMax,
      filterCategoryIds,
      setFilterCategoryIds,
      filterSubcategoryIds,
      setFilterSubcategoryIds,
      filterSharedScopes,
      setFilterSharedScopes,
      filterLiquidadoValues,
      setFilterLiquidadoValues,
      filterTcPaidValues,
      setFilterTcPaidValues,
      filterAccountingMonthYms,
      setFilterAccountingMonthYms,
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
      filterAccountIds,
      filterAmountMin,
      filterAmountMax,
      filterCategoryIds,
      filterSubcategoryIds,
      filterSharedScopes,
      filterLiquidadoValues,
      filterTcPaidValues,
      filterAccountingMonthYms,
      filterAccountsSorted,
      filterCategoriesSorted,
      filterSubcategoryDropdownRows,
    ],
  );

  const clearBankingTxFilters = useCallback(() => {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterDescription("");
    setFilterAccountIds([]);
    setFilterAmountMin("");
    setFilterAmountMax("");
    setFilterCategoryIds([]);
    setFilterSubcategoryIds([]);
    setFilterSharedScopes([]);
    setFilterLiquidadoValues([]);
    setFilterTcPaidValues([]);
    setFilterAccountingMonthYms([]);
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
    <div className="banking-theme min-h-full bg-gradient-to-br from-slate-50 via-cyan-50/90 to-indigo-50/70 text-slate-800">
    <div className="mx-auto w-full max-w-[min(100%,1560px)] space-y-6 px-4 pb-28 pt-4 md:px-10 md:pt-6">
      {accounts.length > 0 ? (
        <section aria-labelledby="banking-account-balances-heading">
          <h2 id="banking-account-balances-heading" className="mb-3 text-lg font-semibold text-slate-800">
            Saldos cuentas
          </h2>
          <DndContext sensors={columnDndSensors} collisionDetection={closestCenter} onDragEnd={handleBalanceCardDragEnd}>
            <div className="space-y-3 md:space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                {bankingNonCreditBalances.length > 0 ? (
                  <BankingNonCreditTotalBalanceCard
                    liquidAccounts={bankingNonCreditBalances}
                    creditCardUnpaidLinkedTotalClp={totalLinkedUnpaidClp}
                  />
                ) : null}
                <BankingSharedUnsettledDebtCard amountClp={bankingDebtTotals.shared_unsettled_clp} />
              </div>
              {bankingNonCreditBalances.length > 0 ? (
                <SortableContext
                  items={bankingNonCreditBalances.map((a) => a.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                    {bankingNonCreditBalances.map((a) => (
                      <SortableBankingBalanceCard
                        key={a.id}
                        account={a}
                        creditCardUnpaidAllocatedClp={ccUnpaidByCheckingId.get(a.id) ?? 0}
                      />
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
            className={`rounded-t-xl px-5 py-2.5 text-sm font-medium transition ${
              movementTab === "all"
                ? "border border-b-0 border-teal-200 bg-white text-teal-900 shadow-sm"
                : "rounded-xl border border-transparent text-slate-600 hover:bg-white/70 hover:text-teal-800"
            }`}
          >
            Movimientos bancarios
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={movementTab === "credit_card"}
            onClick={() => setMovementTab("credit_card")}
            className={`rounded-t-xl px-5 py-2.5 text-sm font-medium transition ${
              movementTab === "credit_card"
                ? "border border-b-0 border-teal-200 bg-white text-teal-900 shadow-sm"
                : "rounded-xl border border-transparent text-slate-600 hover:bg-white/70 hover:text-teal-800"
            }`}
          >
            Tarjeta de crédito
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={movementTab === "shared"}
            onClick={() => setMovementTab("shared")}
            className={`rounded-t-xl px-5 py-2.5 text-sm font-medium transition ${
              movementTab === "shared"
                ? "border border-b-0 border-teal-200 bg-white text-teal-900 shadow-sm"
                : "rounded-xl border border-transparent text-slate-600 hover:bg-white/70 hover:text-teal-800"
            }`}
          >
            Pago compartido
          </button>
        </div>

        <div className="space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            {movementTab === "credit_card"
              ? "Tarjeta de crédito"
              : movementTab === "shared"
                ? "Pago compartido"
                : "Movimientos bancarios"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
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
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-teal-300 hover:bg-teal-50/80"
            >
              <IconColumns className="h-4 w-4 text-slate-300" aria-hidden />
              Columnas
            </button>
            {columnPickerOpen && (
              <div
                id="banking-tx-column-picker"
                role="dialog"
                aria-label="Columnas de la tabla"
                className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[min(calc(100vw-2rem),21rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-300/40 ring-1 ring-slate-100"
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
                  className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-900"
                >
                  Restablecer orden y columnas
                </button>
              </div>
            )}
          </div>
          <Link
            to="/banking/settings"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-teal-300 hover:bg-teal-50"
          >
            Cuentas
          </Link>
          <button
            type="button"
            disabled={!hasVisibleAccount}
            onClick={openNew}
            className="rounded-xl border border-teal-400/80 bg-gradient-to-r from-teal-400 to-emerald-400 px-5 py-2 text-sm font-semibold text-white shadow-[0_6px_24px_-6px_rgba(20,184,166,0.45)] hover:from-teal-500 hover:to-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Nuevo movimiento
          </button>
        </div>
      </div>

      {accounts.length === 0 && !loading && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900/90">
          Primero crea al menos un producto en{" "}
          <Link to="/banking/settings" className="font-medium text-teal-700 underline decoration-teal-300 hover:text-teal-800">
            Cuentas
          </Link>
          .
        </p>
      )}
      {accounts.length > 0 && !hasVisibleAccount && !loading && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900/90">
          Ningún producto está visible para movimientos. Activa al menos uno en{" "}
          <Link to="/banking/settings" className="font-medium text-teal-700 underline decoration-teal-300 hover:text-teal-800">
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
                    <strong className="tabular-nums text-slate-800">{bankingTxPage}</strong>/
                    <strong className="tabular-nums text-slate-800">{bankingTxTotalPages}</strong>
                    {" · "}
                  </>
                ) : null}
                <strong className="tabular-nums text-slate-800">{bankingTxTotal}</strong> movimientos
                {filteredBankingTxItems.length !== items.length && items.length > 0 ? (
                  <>
                    {" · "}
                    <strong className="tabular-nums text-teal-700">{filteredBankingTxItems.length}</strong>
                    {" / "}
                    <strong className="tabular-nums text-slate-800">{items.length}</strong>
                    <span className="text-slate-500"> en esta página</span>
                  </>
                ) : null}
              </p>
              {bankingTxFiltersActive ? (
                <button
                  type="button"
                  onClick={clearBankingTxFilters}
                  className={bankingToolbarGhostBtnClass}
                >
                  Limpiar filtros
                </button>
              ) : null}
            </div>
            {filteredBankingTxItems.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-sm font-medium text-slate-800">Ningún movimiento coincide con los filtros</p>
                <p className="mt-1 text-xs text-slate-400">Ajusta los filtros en los encabezados o pulsa «Limpiar filtros».</p>
                <button
                  type="button"
                  onClick={clearBankingTxFilters}
                  className="mt-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm font-medium text-teal-900 shadow-sm transition hover:bg-teal-100"
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
                      <th className="px-1.5 py-3 text-center text-[12px] font-semibold uppercase tracking-wide text-teal-900/75 sm:px-2" aria-label="Acciones" />
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
                    Hasta <strong className="text-slate-800">{BANKING_TX_PAGE_SIZE}</strong> movimientos por página.
                    {filterAccountIds.length > 0 ? (
                      <span className="text-slate-500">
                        {" "}
                        {filterAccountIds.length === 1
                          ? "Cuenta acotada en servidor."
                          : "Cuentas acotadas en servidor."}
                      </span>
                    ) : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      disabled={loading || bankingTxPage <= 1}
                      onClick={() => void goBankingTxPage(bankingTxPage - 1)}
                      className={bankingToolbarGhostBtnMdClass}
                    >
                      Anterior
                    </button>
                    <span className="text-xs tabular-nums text-slate-600">
                      Página <strong className="text-slate-800">{bankingTxPage}</strong> /{" "}
                      <strong className="text-slate-800">{bankingTxTotalPages}</strong>
                    </span>
                    <button
                      type="button"
                      disabled={loading || bankingTxPage >= bankingTxTotalPages}
                      onClick={() => void goBankingTxPage(bankingTxPage + 1)}
                      className={bankingToolbarGhostBtnMdClass}
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
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
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
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="banking-tx-modal-title"
        >
          <div className="tx-scroll max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl shadow-teal-900/10">
            <h3 id="banking-tx-modal-title" className="text-base font-semibold text-slate-900">
              {editing ? "Editar movimiento" : "Nuevo movimiento"}
            </h3>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-xs text-slate-500">Fecha de la transacción</span>
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
                <span className="text-xs text-slate-500">Producto o cuenta</span>
                <select
                  value={accountId === "" ? "" : String(accountId)}
                  onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}
                  className={bankingModalControlClass}
                >
                  {accountOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs text-slate-500">Descripción</span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={bankingModalControlClass}
                  placeholder="Ej. Supermercado, transferencia…"
                  required
                />
              </label>

              <label className="block">
                <span className="text-xs text-slate-500">Monto (positivo = ingreso, negativo = egreso)</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={bankingModalControlClass}
                  placeholder="Ej. 50000 o -12000"
                />
              </label>

              <div ref={categoryMenuRef} className="space-y-1.5">
                <span id="banking-tx-category-label" className="text-xs text-slate-500">
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
                  className={bankingModalCategoryTriggerClass}
                >
                  <span
                    className={`min-w-0 flex-1 truncate font-semibold ${selectedCategory ? "text-slate-800" : "text-slate-500"}`}
                  >
                    {selectedCategory?.name ?? "Selecciona categoría"}
                  </span>
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden
                    className={`h-5 w-5 shrink-0 text-slate-500 transition ${categoryMenuOpen ? "rotate-180" : ""}`}
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
                  <span className="text-xs text-slate-500">Subcategoría</span>
                  <select
                    value={subcategoryId === "" ? "" : String(subcategoryId)}
                    onChange={(e) => setSubcategoryId(e.target.value ? Number(e.target.value) : "")}
                    className={bankingModalControlClass}
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
                  <span className="text-xs text-slate-500">¿A qué producto va la transferencia?</span>
                  <select
                    value={transferDestinationAccountId === "" ? "" : String(transferDestinationAccountId)}
                    onChange={(e) =>
                      setTransferDestinationAccountId(e.target.value ? Number(e.target.value) : "")
                    }
                    className={bankingModalControlClass}
                    disabled={transferDestinationOptions.length === 0}
                  >
                    <option value="">Selecciona cuenta destino…</option>
                    {transferDestinationOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[12px] leading-snug text-slate-500">
                    No puede ser la cuenta de este movimiento ni una tarjeta de crédito. Se creará un segundo
                    movimiento en la cuenta destino con el monto de signo contrario.
                  </p>
                  {transferDestinationOptions.length === 0 && (
                    <p className="mt-1 text-[12px] text-amber-800/90">
                      No hay otra cuenta disponible. Crea otra cuenta (no tarjeta) en Cuentas.
                    </p>
                  )}
                </label>
              )}

              <div ref={scopeMenuRef} className="relative space-y-1.5">
                <span id="banking-tx-scope-label" className="text-xs text-slate-500">
                  Tipo de movimiento
                </span>
                <button
                  ref={scopeTriggerRef}
                  type="button"
                  aria-expanded={scopeMenuOpen}
                  aria-haspopup="listbox"
                  aria-labelledby="banking-tx-scope-label"
                  onClick={() => setScopeMenuOpen((o) => !o)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left text-sm font-medium shadow-sm transition focus:outline-none focus:ring-2 focus:ring-teal-300/50 ${
                    isShared
                      ? "border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 text-violet-900 ring-1 ring-violet-100"
                      : "border-teal-200 bg-gradient-to-br from-teal-50 to-cyan-50 text-teal-900 ring-1 ring-teal-100"
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
                  <div className="space-y-4 border-t border-slate-200 pt-4">
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-white">
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Personas
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                                className="w-[4.25rem] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center font-mono text-sm text-slate-800 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 [color-scheme:light]"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-800">
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
                <span id="banking-tx-accounting-month-label" className="text-xs text-slate-500">
                  Mes contable
                </span>
                <div
                  ref={accountingMonthTriggerRef}
                  role="group"
                  aria-labelledby="banking-tx-accounting-month-label"
                  className="mt-1.5 flex min-h-[42px] items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none shadow-sm transition hover:border-slate-300 focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-400/20 [color-scheme:light]"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-left text-slate-800 transition hover:bg-teal-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/60"
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
                      className="rounded-md px-2 py-1 tabular-nums text-slate-800 transition hover:bg-teal-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/60"
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
                    className="shrink-0 rounded-md p-1 text-slate-500 outline-none transition hover:bg-teal-50 hover:text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-300/60"
                    aria-label="Elegir mes"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAccountingPickMode((prev) => (prev === "month" ? null : "month"));
                    }}
                  >
                    <IconCalendar className="h-5 w-5" />
                  </button>
                </div>
                <span className="mt-1 block text-[12px] text-slate-500">
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
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50"
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
                className="rounded-xl border border-teal-400/80 bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:from-teal-600 hover:to-emerald-600 disabled:opacity-40"
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
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 ring-1 ring-slate-100"
          >
            <div className="grid gap-2 p-2 sm:grid-cols-2">
              <button
                type="button"
                role="option"
                aria-selected={!isShared}
                className={`rounded-xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-teal-300/60 ${
                  !isShared
                    ? "border-teal-300 bg-teal-50 ring-2 ring-teal-200"
                    : "border-slate-200 bg-white hover:border-teal-200 hover:bg-teal-50/50"
                }`}
                onClick={() => {
                  setIsShared(false);
                  setScopeMenuOpen(false);
                }}
              >
                <span className="block text-sm font-semibold text-teal-900">Personal</span>
                <span className="mt-1 block text-[12px] leading-snug text-teal-700/85">
                  Movimiento individual
                </span>
              </button>
              <button
                type="button"
                role="option"
                aria-selected={isShared}
                className={`rounded-xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-violet-300/60 ${
                  isShared
                    ? "border-violet-300 bg-violet-50 ring-2 ring-violet-200"
                    : "border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/50"
                }`}
                onClick={() => {
                  setIsShared(true);
                  setScopeMenuOpen(false);
                }}
              >
                <span className="block text-sm font-semibold text-violet-900">Compartido</span>
                <span className="mt-1 block text-[12px] leading-snug text-violet-700/85">
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
            className="tx-scroll max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-2xl shadow-slate-900/10 ring-1 ring-slate-100"
          >
            {categoryOptions.map((c) => {
              const sel = c.id === categoryId;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  className={`flex w-full border-b border-slate-100 py-2.5 pl-3 pr-3 text-left text-sm font-semibold transition last:border-b-0 ${
                    sel ? "bg-teal-50 text-teal-900" : "text-slate-800 hover:bg-slate-50"
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
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 ring-1 ring-slate-100"
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
                          ? "bg-teal-100 text-teal-900 ring-2 ring-teal-300"
                          : "text-slate-800 hover:bg-slate-50"
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
                            ? "bg-teal-100 text-teal-900 ring-2 ring-teal-300"
                            : "text-slate-800 hover:bg-slate-50"
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
    </div>
  );
}
