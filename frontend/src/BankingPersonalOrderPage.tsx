import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiFetch, fetchJson, patchJson, postJson } from "./api";
import { BankingAuxRoundCheckbox } from "./BankingAuxRoundCheckbox";
import { localYearMonthString } from "./localDate";
import { useBankingTheme } from "./BankingThemeContext";
import { formatBankingClpSigned, formatClpDots, parseChileanAmountInput } from "./format";
import { BANKING_MAIN_TX_CARD_CLASS, BANKING_MAIN_TX_ROW_CLASS } from "./bankingTxShared";

function savingsGoalProgressPercent(balance: number, target: number | null | undefined): number | null {
  if (target == null || !(target > 0)) return null;
  return Math.round((balance / target) * 100);
}

type PersonalSavingsAdjustment = {
  id: number;
  goal_id: number;
  amount: number;
  created_at: string;
};

function groupSavingsAdjustmentsByGoal(rows: PersonalSavingsAdjustment[]): Record<number, PersonalSavingsAdjustment[]> {
  const m: Record<number, PersonalSavingsAdjustment[]> = {};
  for (const r of rows) {
    if (!m[r.goal_id]) m[r.goal_id] = [];
    m[r.goal_id].push(r);
  }
  for (const k of Object.keys(m)) {
    m[Number(k)].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id,
    );
  }
  return m;
}

function formatSavingsAdjustmentWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-CL", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
import type { BankingAccountRow } from "./types";

type PersonalProvisionItem = {
  id: number;
  description: string;
  account_id: number | null;
  account_name: string | null;
  category_label: string | null;
  amount_clp: number | null;
  paid: boolean;
  sort_order: number;
};

type PersonalSavingsGoal = {
  id: number;
  title: string;
  account_id: number;
  account_name: string;
  balance_clp: number;
  /** Monto meta CLP; null/undefined = solo seguimiento, sin % */
  target_amount_clp?: number | null;
};

const cardClass =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm banking-dark:border-zinc-700 banking-dark:bg-zinc-900/80";
const labelClass =
  "block text-[10px] font-semibold uppercase tracking-wide text-slate-500 banking-dark:text-zinc-400";
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-indigo-400/0 transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/35 banking-dark:border-zinc-600 banking-dark:bg-zinc-950 banking-dark:text-zinc-100 banking-dark:focus:border-amber-500 banking-dark:focus:ring-amber-500/35";
/** Filtros popover provisiones — alineado con tabla movimientos bancarios. */
const bankingProvFilterInputClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/25 [color-scheme:light] banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:placeholder:text-zinc-500 banking-dark:focus:border-amber-700/55 banking-dark:focus:ring-amber-500/15";

const PROVISION_LABEL_NONE = "__none__";

const LS_PO_PROVISIONS_EXPANDED = "bankingPersonalOrder.provisionsExpanded.v1";
const LS_PO_SAVINGS_EXPANDED = "bankingPersonalOrder.savingsExpanded.v1";

function readStoredExpanded(key: string, defaultExpanded: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* private mode */
  }
  return defaultExpanded;
}

function writeStoredExpanded(key: string, expanded: boolean): void {
  try {
    localStorage.setItem(key, expanded ? "1" : "0");
  } catch {
    /* ignore */
  }
}

type ProvisionFilterColKey = "paid" | "descripcion" | "etiqueta" | "monto" | "cuenta";

const PROVISION_FILTER_LABELS: Record<ProvisionFilterColKey, string> = {
  paid: "Pago",
  descripcion: "Descripción",
  etiqueta: "Etiqueta",
  monto: "Monto ref.",
  cuenta: "Cuenta",
};

type ProvisionFilterSnapshot = {
  filterDescription: string;
  filterAmountMin: string;
  filterAmountMax: string;
  filterPaidScopes: ("paid" | "unpaid")[];
  filterAccountIds: number[];
  filterAccountNull: boolean;
  filterLabelContains: string;
  filterLabelTokens: string[];
};

function toggleNumInSortedList(prev: number[], id: number): number[] {
  const i = prev.indexOf(id);
  if (i >= 0) return prev.filter((x) => x !== id);
  return [...prev, id].sort((a, b) => a - b);
}

function toggleEnumInList<T extends string>(prev: T[], v: T): T[] {
  return prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v];
}

function toggleStrSorted(prev: string[], s: string): string[] {
  const i = prev.indexOf(s);
  if (i >= 0) return prev.filter((x) => x !== s);
  return [...prev, s].sort((a, b) => a.localeCompare(b));
}

function provisionColumnFilterActive(colKey: ProvisionFilterColKey, f: ProvisionFilterSnapshot): boolean {
  switch (colKey) {
    case "paid":
      return f.filterPaidScopes.length > 0;
    case "descripcion":
      return !!f.filterDescription.trim();
    case "etiqueta":
      return !!f.filterLabelContains.trim() || f.filterLabelTokens.length > 0;
    case "monto":
      return !!(f.filterAmountMin.trim() || f.filterAmountMax.trim());
    case "cuenta":
      return f.filterAccountIds.length > 0 || f.filterAccountNull;
    default:
      return false;
  }
}

/** Chip de filtro por columna — reemplaza el antiguo encabezado de tabla; misma lógica, look de píldora moderna. */
function ProvisionColumnFilterChip({
  colKey,
  active,
  open,
  registerRef,
  toggle,
}: {
  colKey: ProvisionFilterColKey;
  active: boolean;
  open: boolean;
  registerRef: (el: HTMLButtonElement | null) => void;
  toggle: () => void;
}) {
  const label = PROVISION_FILTER_LABELS[colKey];
  return (
    <button
      ref={registerRef}
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        active
          ? "border-indigo-300 bg-indigo-50 text-indigo-800 banking-dark:border-amber-700/55 banking-dark:bg-amber-950/40 banking-dark:text-amber-200"
          : open
            ? "border-slate-300 bg-slate-100 text-slate-800 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-100"
            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 banking-dark:border-zinc-700 banking-dark:bg-zinc-900 banking-dark:text-zinc-300 banking-dark:hover:border-zinc-600"
      }`}
    >
      {label}
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          active ? "bg-indigo-500 banking-dark:bg-amber-400" : "bg-slate-300 banking-dark:bg-zinc-600"
        }`}
        aria-hidden
      />
    </button>
  );
}

function ProvisionLabelFilterBody({
  sel,
  distinctLabels,
  showNoneOption,
  filterLabelContains,
  setFilterLabelContains,
  filterLabelTokens,
  setFilterLabelTokens,
}: {
  sel: string;
  distinctLabels: string[];
  showNoneOption: boolean;
  filterLabelContains: string;
  setFilterLabelContains: (v: string) => void;
  filterLabelTokens: string[];
  setFilterLabelTokens: Dispatch<SetStateAction<string[]>>;
}) {
  const [query, setQuery] = useState("");
  const qNorm = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!qNorm) return distinctLabels;
    return distinctLabels.filter((l) => l.toLowerCase().includes(qNorm));
  }, [distinctLabels, qNorm]);

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-slate-500 banking-dark:text-zinc-400">Contiene texto en etiqueta</span>
        <input
          type="search"
          value={filterLabelContains}
          onChange={(e) => setFilterLabelContains(e.target.value)}
          placeholder="Opcional: filtrar por texto…"
          autoComplete="off"
          className={`${sel} mt-1`}
        />
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500 banking-dark:text-zinc-400">Etiquetas en los ítems (varias)</span>
        <button
          type="button"
          onClick={() => setFilterLabelTokens([])}
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-indigo-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-300 banking-dark:hover:bg-zinc-800"
        >
          Borrar selección
        </button>
      </div>
      <label className="block">
        <span className="text-xs text-slate-500 banking-dark:text-zinc-400">Buscar etiqueta</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Escribe para filtrar la lista…"
          autoComplete="off"
          className={`${sel} mt-1`}
        />
      </label>
      <div className="mt-1 max-h-[min(50vh,280px)] space-y-1 overflow-y-auto pr-0.5 tx-scroll">
        {showNoneOption ? (
          <button
            type="button"
            onClick={() =>
              setFilterLabelTokens((prev) => toggleStrSorted(prev, PROVISION_LABEL_NONE))
            }
            className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm font-medium transition hover:bg-indigo-50 banking-dark:hover:bg-zinc-800 ${
              filterLabelTokens.includes(PROVISION_LABEL_NONE)
                ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
                : "border border-slate-300 bg-white banking-dark:border-zinc-600 banking-dark:bg-zinc-950"
            }`}
          >
            <span className="text-slate-600 banking-dark:text-zinc-300">Sin etiqueta</span>
          </button>
        ) : null}
        {filtered.map((lab) => {
          const picked = filterLabelTokens.includes(lab);
          return (
            <button
              key={lab}
              type="button"
              onClick={() => setFilterLabelTokens((prev) => toggleStrSorted(prev, lab))}
              className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm font-medium text-slate-800 transition hover:bg-indigo-50 banking-dark:text-zinc-100 banking-dark:hover:bg-zinc-800 ${
                picked
                  ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
                  : "border border-slate-300 bg-white banking-dark:border-zinc-600 banking-dark:bg-zinc-950"
              }`}
            >
              {lab}
            </button>
          );
        })}
      </div>
      {distinctLabels.length === 0 && !showNoneOption ? (
        <p className="text-[12px] leading-snug text-slate-500 banking-dark:text-zinc-500">
          No hay etiquetas en los ítems todavía.
        </p>
      ) : filtered.length === 0 && qNorm ? (
        <p className="text-[12px] leading-snug text-slate-500 banking-dark:text-zinc-500">
          Ninguna etiqueta coincide con «{query.trim()}».
        </p>
      ) : null}
      <p className="text-[11px] text-slate-500 banking-dark:text-zinc-500">
        Sin selección en la lista = no filtrar por etiqueta concreta (solo por «contiene texto» si lo usas).
      </p>
    </div>
  );
}

function ProvisionHeaderFilterFields({
  colKey,
  sel,
  accountsSorted,
  distinctLabels,
  showNoneLabelOption,
  filterDescription,
  setFilterDescription,
  filterAmountMin,
  setFilterAmountMin,
  filterAmountMax,
  setFilterAmountMax,
  filterPaidScopes,
  setFilterPaidScopes,
  filterAccountIds,
  setFilterAccountIds,
  filterAccountNull,
  setFilterAccountNull,
  filterLabelContains,
  setFilterLabelContains,
  filterLabelTokens,
  setFilterLabelTokens,
}: {
  colKey: ProvisionFilterColKey;
  sel: string;
  accountsSorted: BankingAccountRow[];
  distinctLabels: string[];
  showNoneLabelOption: boolean;
  filterDescription: string;
  setFilterDescription: (v: string) => void;
  filterAmountMin: string;
  setFilterAmountMin: (v: string) => void;
  filterAmountMax: string;
  setFilterAmountMax: (v: string) => void;
  filterPaidScopes: ("paid" | "unpaid")[];
  setFilterPaidScopes: Dispatch<SetStateAction<("paid" | "unpaid")[]>>;
  filterAccountIds: number[];
  setFilterAccountIds: Dispatch<SetStateAction<number[]>>;
  filterAccountNull: boolean;
  setFilterAccountNull: Dispatch<SetStateAction<boolean>>;
  filterLabelContains: string;
  setFilterLabelContains: (v: string) => void;
  filterLabelTokens: string[];
  setFilterLabelTokens: Dispatch<SetStateAction<string[]>>;
}) {
  switch (colKey) {
    case "paid":
      return (
        <div className="space-y-2">
          <span className="text-xs text-slate-500 banking-dark:text-zinc-400">Estado (varios)</span>
          <div className="mt-1 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setFilterPaidScopes((prev) => toggleEnumInList(prev, "unpaid"))}
              className={`rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-indigo-50 banking-dark:hover:bg-zinc-800 ${
                filterPaidScopes.includes("unpaid")
                  ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
                  : "border-slate-300 bg-white banking-dark:border-zinc-600 banking-dark:bg-zinc-950"
              }`}
            >
              No pagado
            </button>
            <button
              type="button"
              onClick={() => setFilterPaidScopes((prev) => toggleEnumInList(prev, "paid"))}
              className={`rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-indigo-50 banking-dark:hover:bg-zinc-800 ${
                filterPaidScopes.includes("paid")
                  ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
                  : "border-slate-300 bg-white banking-dark:border-zinc-600 banking-dark:bg-zinc-950"
              }`}
            >
              Pagado
            </button>
          </div>
          <p className="text-[11px] text-slate-500 banking-dark:text-zinc-500">Sin selección = todos. Varios = unión.</p>
        </div>
      );
    case "descripcion":
      return (
        <label className="block">
          <span className="text-xs text-slate-500 banking-dark:text-zinc-400">Contiene texto</span>
          <input
            type="search"
            value={filterDescription}
            onChange={(e) => setFilterDescription(e.target.value)}
            placeholder="Buscar en la descripción…"
            autoComplete="off"
            className={`${sel} mt-1`}
          />
        </label>
      );
    case "etiqueta":
      return (
        <ProvisionLabelFilterBody
          sel={sel}
          distinctLabels={distinctLabels}
          showNoneOption={showNoneLabelOption}
          filterLabelContains={filterLabelContains}
          setFilterLabelContains={setFilterLabelContains}
          filterLabelTokens={filterLabelTokens}
          setFilterLabelTokens={setFilterLabelTokens}
        />
      );
    case "monto":
      return (
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-slate-500 banking-dark:text-zinc-400">Monto mínimo (CLP)</span>
            <input
              inputMode="decimal"
              value={filterAmountMin}
              onChange={(e) => setFilterAmountMin(e.target.value)}
              placeholder="Ej. 5000"
              className={`${sel} mt-1`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-500 banking-dark:text-zinc-400">Monto máximo (CLP)</span>
            <input
              inputMode="decimal"
              value={filterAmountMax}
              onChange={(e) => setFilterAmountMax(e.target.value)}
              placeholder="Ej. 250000"
              className={`${sel} mt-1`}
            />
          </label>
        </div>
      );
    case "cuenta":
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500 banking-dark:text-zinc-400">Cuentas (varias)</span>
            <button
              type="button"
              onClick={() => {
                setFilterAccountIds([]);
                setFilterAccountNull(false);
              }}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-indigo-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-300 banking-dark:hover:bg-zinc-800"
            >
              Borrar selección
            </button>
          </div>
          <div className="mt-1 max-h-[min(50vh,280px)] space-y-1 overflow-y-auto pr-0.5 tx-scroll">
            <button
              type="button"
              onClick={() => setFilterAccountNull((prev) => !prev)}
              className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-indigo-50 banking-dark:hover:bg-zinc-800 ${
                filterAccountNull
                  ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
                  : "border border-slate-300 bg-white banking-dark:border-zinc-600 banking-dark:bg-zinc-950"
              }`}
            >
              <span className={filterAccountNull ? "font-semibold text-indigo-900 banking-dark:text-amber-100" : "text-slate-800 banking-dark:text-zinc-100"}>
                Sin cuenta
              </span>
            </button>
            {accountsSorted.map((a) => {
              const picked = filterAccountIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setFilterAccountIds((prev) => toggleNumInSortedList(prev, a.id))}
                  className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-indigo-50 banking-dark:hover:bg-zinc-800 ${
                    picked
                      ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
                      : "border border-slate-300 bg-white banking-dark:border-zinc-600 banking-dark:bg-zinc-950"
                  }`}
                >
                  <span className={picked ? "font-semibold text-indigo-900 banking-dark:text-amber-100" : "text-slate-800 banking-dark:text-zinc-100"}>
                    {a.name}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500 banking-dark:text-zinc-500">Sin selección = todas. Varios = unión.</p>
        </div>
      );
    default:
      return null;
  }
}

const btnPrimary =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 banking-dark:bg-amber-500 banking-dark:text-zinc-950 banking-dark:shadow-md banking-dark:hover:bg-amber-400 banking-dark:disabled:opacity-45";
const btnSecondary =
  "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 banking-dark:border-zinc-500 banking-dark:bg-zinc-900 banking-dark:text-zinc-100 banking-dark:shadow-sm banking-dark:hover:border-zinc-400 banking-dark:hover:bg-zinc-800";
/** Íconos de fila — patrón movimientos bancarios; mejor contraste del trazo en modo oscuro. */
const poIconBtn =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-slate-600 transition hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900 banking-dark:text-zinc-300 banking-dark:hover:border-zinc-500 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-white";
const poIconBtnDanger = `${poIconBtn} hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 banking-dark:hover:border-rose-600 banking-dark:hover:bg-rose-950/60 banking-dark:hover:text-rose-200`;

const modalBackdropClass =
  "fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[1px] banking-dark:bg-black/55";
const modalPanelClass =
  "relative z-[1] w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:shadow-black/40";

function GripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 6a2 2 0 11-4 0 2 2 0 014 0zM8 12a2 2 0 11-4 0 2 2 0 014 0zM8 18a2 2 0 11-4 0 2 2 0 014 0zM20 6a2 2 0 11-4 0 2 2 0 014 0zM20 12a2 2 0 11-4 0 2 2 0 014 0zM20 18a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function ChevronExpandIcon({ expanded, className }: { expanded: boolean; className?: string }) {
  return (
    <svg
      className={`${className ?? ""} shrink-0 transition-transform duration-200 ease-out ${expanded ? "rotate-0" : "-rotate-90"}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  );
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

function PaidToggleButton({
  paid,
  onToggle,
}: {
  paid: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={paid}
      title={paid ? "Clic para marcar como no pagado" : "Clic para marcar como pagado"}
      onClick={onToggle}
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${
        paid
          ? "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 banking-dark:bg-emerald-600 banking-dark:hover:bg-emerald-500"
          : "border border-indigo-800 bg-indigo-800 text-white shadow-sm hover:border-indigo-700 hover:bg-indigo-700 banking-dark:border-amber-600/70 banking-dark:bg-amber-700/90 banking-dark:hover:border-amber-500 banking-dark:hover:bg-amber-600"
      }`}
    >
      {paid ? "PAGADO" : "NO PAGADO"}
    </button>
  );
}

/** Selector de cuenta modernizado: mismo `inputClass` que el resto del formulario + flecha propia (reemplaza la flecha nativa del navegador). */
function AccountSelect({
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
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 banking-dark:text-amber-200/70"
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

/** Contenido compartido de la fila (card): descripción/etiqueta/cuenta, monto, pagado, acciones. */
function ProvisionRowInner({
  row,
  onTogglePaid,
  onEdit,
  onRemove,
}: {
  row: PersonalProvisionItem;
  onTogglePaid: (r: PersonalProvisionItem) => void;
  onEdit: (r: PersonalProvisionItem) => void;
  onRemove: (id: number) => void;
}) {
  const initial = row.description.trim().charAt(0).toUpperCase() || "?";
  return (
    <>
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-[13px] font-bold text-indigo-600 banking-dark:bg-amber-500/15 banking-dark:text-amber-300"
        aria-hidden
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`line-clamp-2 break-words text-[13px] font-semibold leading-snug [overflow-wrap:anywhere] ${
            row.paid
              ? "text-slate-400 line-through banking-dark:text-zinc-500"
              : "text-slate-800 banking-dark:text-zinc-100"
          }`}
        >
          {row.description}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-slate-400 banking-dark:text-zinc-500">
          {row.category_label?.trim() ? row.category_label : "Sin etiqueta"}
          {row.account_name ? ` · ${row.account_name}` : ""}
        </p>
      </div>
      <div className="w-28 shrink-0 text-right">
        {row.amount_clp != null ? (
          <span className="text-[13px] font-bold tabular-nums text-slate-800 banking-dark:text-amber-200/90">
            {formatClpDots(row.amount_clp)}
          </span>
        ) : (
          <span className="text-[13px] text-slate-400 banking-dark:text-zinc-600">—</span>
        )}
      </div>
      <PaidToggleButton paid={row.paid} onToggle={() => onTogglePaid(row)} />
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          title="Editar recordatorio"
          aria-label="Editar recordatorio"
          onClick={() => onEdit(row)}
          className={poIconBtn}
        >
          <IconPencil />
        </button>
        <button
          type="button"
          title="Eliminar recordatorio"
          aria-label="Eliminar recordatorio"
          onClick={() => void onRemove(row.id)}
          className={poIconBtnDanger}
        >
          <IconTrash />
        </button>
      </div>
    </>
  );
}

function SortableProvisionRow({
  row,
  selected,
  onSelectChange,
  onTogglePaid,
  onEdit,
  onRemove,
}: {
  row: PersonalProvisionItem;
  selected: boolean;
  onSelectChange: (checked: boolean) => void;
  onTogglePaid: (r: PersonalProvisionItem) => void;
  onEdit: (r: PersonalProvisionItem) => void;
  onRemove: (id: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(row.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className={BANKING_MAIN_TX_ROW_CLASS}>
      <button
        type="button"
        className="flex shrink-0 cursor-grab touch-none items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:cursor-grabbing banking-dark:text-zinc-500 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-200"
        aria-label="Arrastrar para reordenar"
        {...attributes}
        {...listeners}
      >
        <GripIcon className="h-4 w-4" />
      </button>
      <div onPointerDown={(e) => e.stopPropagation()}>
        <BankingAuxRoundCheckbox
          checked={selected}
          onChange={() => onSelectChange(!selected)}
          color="indigo"
          aria-label={`Seleccionar provisión: ${row.description.slice(0, 80)}`}
        />
      </div>
      <ProvisionRowInner row={row} onTogglePaid={onTogglePaid} onEdit={onEdit} onRemove={onRemove} />
    </div>
  );
}

function StaticProvisionRow({
  row,
  selected,
  onSelectChange,
  onTogglePaid,
  onEdit,
  onRemove,
}: {
  row: PersonalProvisionItem;
  selected: boolean;
  onSelectChange: (checked: boolean) => void;
  onTogglePaid: (r: PersonalProvisionItem) => void;
  onEdit: (r: PersonalProvisionItem) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <div className={BANKING_MAIN_TX_ROW_CLASS}>
      <div className="w-7 shrink-0" aria-hidden />
      <BankingAuxRoundCheckbox
        checked={selected}
        onChange={() => onSelectChange(!selected)}
        color="indigo"
        aria-label={`Seleccionar provisión: ${row.description.slice(0, 80)}`}
      />
      <ProvisionRowInner row={row} onTogglePaid={onTogglePaid} onEdit={onEdit} onRemove={onRemove} />
    </div>
  );
}

export function BankingPersonalOrderPage({ onToast }: { onToast: (msg: string | null) => void }) {
  const { isDark } = useBankingTheme();
  const [accounts, setAccounts] = useState<BankingAccountRow[]>([]);
  const [provisionItems, setProvisionItems] = useState<PersonalProvisionItem[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<PersonalSavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const [newProvDesc, setNewProvDesc] = useState("");
  const [newProvAmount, setNewProvAmount] = useState("");
  const [newProvAccountId, setNewProvAccountId] = useState<number | "">("");
  const [newProvLabel, setNewProvLabel] = useState("");

  const [filterDescription, setFilterDescription] = useState("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [filterPaidScopes, setFilterPaidScopes] = useState<("paid" | "unpaid")[]>([]);
  const [filterAccountIds, setFilterAccountIds] = useState<number[]>([]);
  const [filterAccountNull, setFilterAccountNull] = useState(false);
  const [filterLabelContains, setFilterLabelContains] = useState("");
  const [filterLabelTokens, setFilterLabelTokens] = useState<string[]>([]);

  const [headerFilterOpen, setHeaderFilterOpen] = useState<ProvisionFilterColKey | null>(null);
  const [headerFilterPopoverPos, setHeaderFilterPopoverPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const headerFilterCellRefs = useRef<Partial<Record<ProvisionFilterColKey, HTMLButtonElement | null>>>({});
  const filterPopoverPanelRef = useRef<HTMLDivElement | null>(null);

  const registerProvisionHeaderRef = useCallback((k: ProvisionFilterColKey, el: HTMLButtonElement | null) => {
    headerFilterCellRefs.current[k] = el;
  }, []);

  const toggleProvisionHeaderFilter = useCallback((k: ProvisionFilterColKey) => {
    setHeaderFilterOpen((prev) => (prev === k ? null : k));
  }, []);

  const [newSavTitle, setNewSavTitle] = useState("");
  const [newSavAccountId, setNewSavAccountId] = useState<number | "">("");
  const [newSavInitial, setNewSavInitial] = useState("");
  /** Monto objetivo opcional al crear (vacío = solo control de saldo). */
  const [newSavTarget, setNewSavTarget] = useState("");

  const [adjustInputs, setAdjustInputs] = useState<Record<number, string>>({});
  const [savingsAdjustmentsByGoal, setSavingsAdjustmentsByGoal] = useState<
    Record<number, PersonalSavingsAdjustment[]>
  >({});

  const [editingProvision, setEditingProvision] = useState<PersonalProvisionItem | null>(null);
  const [epDesc, setEpDesc] = useState("");
  const [epLabel, setEpLabel] = useState("");
  const [epAmount, setEpAmount] = useState("");
  const [epAccountId, setEpAccountId] = useState<number | "">("");

  const [editingSavings, setEditingSavings] = useState<PersonalSavingsGoal | null>(null);
  const [svTitle, setSvTitle] = useState("");
  const [svAccountId, setSvAccountId] = useState<number | "">("");
  const [svTarget, setSvTarget] = useState("");

  const [newProvisionModalOpen, setNewProvisionModalOpen] = useState(false);
  const [registerMovesModalOpen, setRegisterMovesModalOpen] = useState(false);
  const [registerMovesYm, setRegisterMovesYm] = useState(() => localYearMonthString());
  const [registerMovesSaving, setRegisterMovesSaving] = useState(false);
  const [newSavingsModalOpen, setNewSavingsModalOpen] = useState(false);

  const [editingSavingsAdjustment, setEditingSavingsAdjustment] = useState<PersonalSavingsAdjustment | null>(null);
  const [editSavingsAdjAmount, setEditSavingsAdjAmount] = useState("");
  const [savingSavingsAdjEdit, setSavingSavingsAdjEdit] = useState(false);

  const [provisionsExpanded, setProvisionsExpanded] = useState(() =>
    readStoredExpanded(LS_PO_PROVISIONS_EXPANDED, true),
  );
  const [savingsExpanded, setSavingsExpanded] = useState(() =>
    readStoredExpanded(LS_PO_SAVINGS_EXPANDED, true),
  );

  const toggleProvisionsSection = useCallback(() => {
    setProvisionsExpanded((prev) => {
      const next = !prev;
      writeStoredExpanded(LS_PO_PROVISIONS_EXPANDED, next);
      return next;
    });
  }, []);

  const toggleSavingsSection = useCallback(() => {
    setSavingsExpanded((prev) => {
      const next = !prev;
      writeStoredExpanded(LS_PO_SAVINGS_EXPANDED, next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!provisionsExpanded) setHeaderFilterOpen(null);
  }, [provisionsExpanded]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const fetchSavingsAdjustmentsMap = useCallback(async () => {
    const adj = await fetchJson<PersonalSavingsAdjustment[]>("/banking/personal-order/savings-adjustments");
    setSavingsAdjustmentsByGoal(groupSavingsAdjustmentsByGoal(adj));
  }, []);

  const reloadSavingsSection = useCallback(async () => {
    const [sav, adj] = await Promise.all([
      fetchJson<PersonalSavingsGoal[]>("/banking/personal-order/savings-goals"),
      fetchJson<PersonalSavingsAdjustment[]>("/banking/personal-order/savings-adjustments"),
    ]);
    setSavingsGoals(sav);
    setSavingsAdjustmentsByGoal(groupSavingsAdjustmentsByGoal(adj));
  }, []);

  const loadAll = useCallback(async () => {
    const [acc, prov, sav] = await Promise.all([
      fetchJson<BankingAccountRow[]>("/banking/accounts"),
      fetchJson<PersonalProvisionItem[]>("/banking/personal-order/provision-items"),
      fetchJson<PersonalSavingsGoal[]>("/banking/personal-order/savings-goals"),
    ]);
    setAccounts(acc.filter((a) => (a.enabled ?? true) !== false));
    setProvisionItems(prov);
    setSavingsGoals(sav);
    try {
      await fetchSavingsAdjustmentsMap();
    } catch {
      setSavingsAdjustmentsByGoal({});
    }
  }, [fetchSavingsAdjustmentsMap]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadAll()
      .catch((e) => {
        console.error(e);
        if (!cancelled) onToast("No se pudo cargar Orden personal.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAll, onToast]);

  useLayoutEffect(() => {
    if (headerFilterOpen == null) {
      setHeaderFilterPopoverPos(null);
      return;
    }
    const col = headerFilterOpen;
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
    const col = headerFilterOpen;
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

  useEffect(() => {
    if (!editingProvision) return;
    setEpDesc(editingProvision.description);
    setEpLabel(editingProvision.category_label ?? "");
    setEpAmount(editingProvision.amount_clp != null ? String(Math.round(editingProvision.amount_clp)) : "");
    setEpAccountId(editingProvision.account_id ?? "");
  }, [editingProvision]);

  useEffect(() => {
    if (!editingSavings) return;
    setSvTitle(editingSavings.title);
    setSvAccountId(editingSavings.account_id);
    const tg = editingSavings.target_amount_clp;
    setSvTarget(tg != null && tg > 0 ? String(Math.round(tg)) : "");
  }, [editingSavings]);

  useEffect(() => {
    if (
      !editingProvision &&
      !editingSavings &&
      !editingSavingsAdjustment &&
      !newProvisionModalOpen &&
      !newSavingsModalOpen &&
      !registerMovesModalOpen
    )
      return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setEditingProvision(null);
        setEditingSavings(null);
        setEditingSavingsAdjustment(null);
        setNewProvisionModalOpen(false);
        setNewSavingsModalOpen(false);
        setRegisterMovesModalOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    editingProvision,
    editingSavings,
    editingSavingsAdjustment,
    newProvisionModalOpen,
    newSavingsModalOpen,
    registerMovesModalOpen,
  ]);

  const accountsSorted = useMemo(
    () => [...accounts].sort((a, b) => a.name.localeCompare(b.name, "es")),
    [accounts],
  );

  const provisionDistinctLabels = useMemo(() => {
    const s = new Set<string>();
    for (const r of provisionItems) {
      const lab = (r.category_label ?? "").trim();
      if (lab) s.add(lab);
    }
    return [...s].sort((a, b) => a.localeCompare(b, "es"));
  }, [provisionItems]);

  const showNoneLabelOption = useMemo(
    () => provisionItems.some((r) => !(r.category_label ?? "").trim()),
    [provisionItems],
  );

  const filterSnapshot = useMemo(
    (): ProvisionFilterSnapshot => ({
      filterDescription,
      filterAmountMin,
      filterAmountMax,
      filterPaidScopes,
      filterAccountIds,
      filterAccountNull,
      filterLabelContains,
      filterLabelTokens,
    }),
    [
      filterDescription,
      filterAmountMin,
      filterAmountMax,
      filterPaidScopes,
      filterAccountIds,
      filterAccountNull,
      filterLabelContains,
      filterLabelTokens,
    ],
  );

  const sortedProvisionItems = useMemo(() => {
    return [...provisionItems].sort((a, b) =>
      a.sort_order !== b.sort_order ? a.sort_order - b.sort_order : a.id - b.id,
    );
  }, [provisionItems]);

  const columnFiltersActive = useMemo(() => {
    const keys: ProvisionFilterColKey[] = ["paid", "descripcion", "etiqueta", "monto", "cuenta"];
    return keys.some((k) => provisionColumnFilterActive(k, filterSnapshot));
  }, [filterSnapshot]);

  const filteredProvisionItems = useMemo(() => {
    let rows = sortedProvisionItems;

    const d = filterDescription.trim().toLowerCase();
    if (d) rows = rows.filter((r) => r.description.toLowerCase().includes(d));

    if (filterPaidScopes.length > 0) {
      rows = rows.filter((r) =>
        filterPaidScopes.some((scope) => (scope === "paid" ? r.paid : !r.paid)),
      );
    }

    const accountColActive = filterAccountIds.length > 0 || filterAccountNull;
    if (accountColActive) {
      rows = rows.filter((r) => {
        if (r.account_id == null) return filterAccountNull;
        return filterAccountIds.includes(r.account_id);
      });
    }

    const labSub = filterLabelContains.trim().toLowerCase();
    if (labSub) {
      rows = rows.filter((r) => (r.category_label ?? "").toLowerCase().includes(labSub));
    }

    if (filterLabelTokens.length > 0) {
      rows = rows.filter((r) => {
        const lab = (r.category_label ?? "").trim();
        const isNone = !lab;
        return filterLabelTokens.some((tok) =>
          tok === PROVISION_LABEL_NONE ? isNone : lab === tok,
        );
      });
    }

    const amin = filterAmountMin.trim() !== "" ? parseChileanAmountInput(filterAmountMin.trim()) : null;
    const amax = filterAmountMax.trim() !== "" ? parseChileanAmountInput(filterAmountMax.trim()) : null;
    if (amin !== null || amax !== null) {
      rows = rows.filter((r) => {
        if (r.amount_clp == null) return false;
        if (amin !== null && r.amount_clp < amin) return false;
        if (amax !== null && r.amount_clp > amax) return false;
        return true;
      });
    }

    return rows;
  }, [
    sortedProvisionItems,
    filterDescription,
    filterPaidScopes,
    filterAccountIds,
    filterAccountNull,
    filterLabelContains,
    filterLabelTokens,
    filterAmountMin,
    filterAmountMax,
  ]);

  const [selectedProvisionIds, setSelectedProvisionIds] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    const valid = new Set(provisionItems.map((r) => r.id));
    setSelectedProvisionIds((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [provisionItems]);

  const visibleProvisionRowsForSelection = useMemo(
    () => (columnFiltersActive ? filteredProvisionItems : sortedProvisionItems),
    [columnFiltersActive, filteredProvisionItems, sortedProvisionItems],
  );

  const provisionSelectionStats = useMemo(() => {
    let sum = 0;
    let sel = 0;
    let selWithoutAmount = 0;
    for (const r of visibleProvisionRowsForSelection) {
      if (!selectedProvisionIds.has(r.id)) continue;
      sel += 1;
      if (r.amount_clp != null) sum += r.amount_clp;
      else selWithoutAmount += 1;
    }
    return { sum, sel, selWithoutAmount };
  }, [visibleProvisionRowsForSelection, selectedProvisionIds]);

  /** Ítems seleccionados en la vista actual (respeta filtros de tabla). */
  const selectedVisibleProvisionIds = useMemo(() => {
    const ids: number[] = [];
    for (const r of visibleProvisionRowsForSelection) {
      if (selectedProvisionIds.has(r.id)) ids.push(r.id);
    }
    return ids;
  }, [visibleProvisionRowsForSelection, selectedProvisionIds]);

  const toggleProvisionSelected = useCallback((id: number, checked: boolean) => {
    setSelectedProvisionIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleSelectAllVisibleProvisions = useCallback(() => {
    const visible = columnFiltersActive ? filteredProvisionItems : sortedProvisionItems;
    setSelectedProvisionIds((prev) => {
      const next = new Set(prev);
      const allOn = visible.length > 0 && visible.every((r) => next.has(r.id));
      if (allOn) {
        for (const r of visible) next.delete(r.id);
      } else {
        for (const r of visible) next.add(r.id);
      }
      return next;
    });
  }, [columnFiltersActive, filteredProvisionItems, sortedProvisionItems]);

  const openRegisterMovesModal = useCallback(() => {
    setRegisterMovesYm(localYearMonthString());
    setRegisterMovesModalOpen(true);
  }, []);

  const confirmRegisterProvisionMoves = async () => {
    if (selectedVisibleProvisionIds.length === 0) {
      onToast("No hay ítems seleccionados en la vista actual.");
      return;
    }
    const accountingIso = `${registerMovesYm}-01`;
    setRegisterMovesSaving(true);
    try {
      const out = await postJson<{
        created: number;
        skipped: number;
        messages: string[];
      }>("/banking/personal-order/provision-items/register-movements", {
        accounting_month: accountingIso,
        item_ids: selectedVisibleProvisionIds,
      });
      setRegisterMovesModalOpen(false);
      const head = `Movimientos creados: ${out.created}.${out.skipped > 0 ? ` Omitidos: ${out.skipped}.` : ""}`;
      if (out.messages.length > 0) {
        const extra = out.messages.slice(0, 4).join(" ");
        const more =
          out.messages.length > 4 ? ` …(+${out.messages.length - 4} aviso(s))` : "";
        onToast(`${head} ${extra}${more}`);
      } else {
        onToast(head);
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo registrar en movimientos bancarios.");
    } finally {
      setRegisterMovesSaving(false);
    }
  };

  const allVisibleProvisionsSelected =
    visibleProvisionRowsForSelection.length > 0 &&
    provisionSelectionStats.sel === visibleProvisionRowsForSelection.length;

  const handleProvisionDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedProvisionItems.findIndex((r) => String(r.id) === active.id);
    const newIndex = sortedProvisionItems.findIndex((r) => String(r.id) === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(sortedProvisionItems, oldIndex, newIndex);
    const item_ids = next.map((r) => r.id);
    try {
      const updated = await postJson<PersonalProvisionItem[]>("/banking/personal-order/provision-items/reorder", {
        item_ids,
      });
      setProvisionItems(updated);
    } catch {
      onToast("No se pudo guardar el orden.");
      void loadAll();
    }
  };

  const addProvision = async () => {
    const d = newProvDesc.trim();
    if (!d) {
      onToast("Escribe una descripción.");
      return;
    }
    try {
      const amtRaw = newProvAmount.trim();
      let amount_clp: number | null = null;
      if (amtRaw !== "") {
        const parsed = parseChileanAmountInput(amtRaw);
        if (Number.isFinite(parsed)) amount_clp = parsed;
      }
      const lab = newProvLabel.trim();
      const row = await postJson<PersonalProvisionItem>("/banking/personal-order/provision-items", {
        description: d,
        account_id: newProvAccountId === "" ? null : newProvAccountId,
        category_label: lab === "" ? null : lab,
        amount_clp,
      });
      setProvisionItems((prev) => [...prev, row]);
      setNewProvDesc("");
      setNewProvAmount("");
      setNewProvAccountId("");
      setNewProvLabel("");
      setNewProvisionModalOpen(false);
      onToast("Ítem agregado.");
    } catch {
      onToast("No se pudo crear el ítem.");
    }
  };

  const togglePaid = async (row: PersonalProvisionItem) => {
    try {
      const updated = await patchJson<PersonalProvisionItem>(`/banking/personal-order/provision-items/${row.id}`, {
        paid: !row.paid,
      });
      setProvisionItems((prev) => prev.map((x) => (x.id === row.id ? updated : x)));
    } catch {
      onToast("No se pudo actualizar.");
    }
  };

  const resetPaid = async () => {
    if (!confirm("¿Marcar todos los ítems como no pagados?")) return;
    try {
      const r = await apiFetch("/banking/personal-order/provision-items/reset-paid", { method: "POST" });
      if (!r.ok) throw new Error(String(r.status));
      setProvisionItems((prev) => prev.map((x) => ({ ...x, paid: false })));
      onToast("Listo: todos sin marcar como pagados.");
    } catch {
      onToast("No se pudo restablecer.");
    }
  };

  const removeProvision = async (id: number) => {
    if (!confirm("¿Eliminar este recordatorio?")) return;
    try {
      const r = await apiFetch(`/banking/personal-order/provision-items/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(String(r.status));
      setProvisionItems((prev) => prev.filter((x) => x.id !== id));
      setSelectedProvisionIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setEditingProvision((cur) => (cur?.id === id ? null : cur));
      onToast("Eliminado.");
    } catch {
      onToast("No se pudo eliminar.");
    }
  };

  const addSavingsGoal = async () => {
    const t = newSavTitle.trim();
    if (!t) {
      onToast("Escribe un nombre para el ahorro.");
      return;
    }
    if (newSavAccountId === "") {
      onToast("Selecciona una cuenta.");
      return;
    }
    const initial = parseChileanAmountInput(newSavInitial.trim() || "0");
    let targetPayload: number | null = null;
    const tgtRaw = newSavTarget.trim();
    if (tgtRaw !== "") {
      const tp = parseChileanAmountInput(tgtRaw);
      if (!Number.isFinite(tp) || tp <= 0) {
        onToast("El monto objetivo no es válido; déjalo vacío si solo quieres llevar el saldo.");
        return;
      }
      targetPayload = tp;
    }
    try {
      const row = await postJson<PersonalSavingsGoal>("/banking/personal-order/savings-goals", {
        title: t,
        account_id: newSavAccountId,
        initial_balance_clp: initial,
        target_amount_clp: targetPayload,
      });
      setSavingsGoals((prev) => [...prev, row]);
      setNewSavTitle("");
      setNewSavAccountId("");
      setNewSavInitial("");
      setNewSavTarget("");
      setNewSavingsModalOpen(false);
      onToast("Meta de ahorro creada.");
      try {
        await fetchSavingsAdjustmentsMap();
      } catch {
        /* historial: recarga en próxima visita */
      }
    } catch {
      onToast("No se pudo crear la meta.");
    }
  };

  const applyAdjust = async (g: PersonalSavingsGoal) => {
    const raw = (adjustInputs[g.id] ?? "").trim();
    if (raw === "") {
      onToast("Ingresa un monto (positivo o negativo).");
      return;
    }
    const delta = parseChileanAmountInput(raw);
    try {
      const updated = await postJson<PersonalSavingsGoal>(
        `/banking/personal-order/savings-goals/${g.id}/adjust`,
        { amount: delta },
      );
      setSavingsGoals((prev) => prev.map((x) => (x.id === g.id ? updated : x)));
      setAdjustInputs((m) => ({ ...m, [g.id]: "" }));
      onToast("Saldo actualizado.");
      try {
        await fetchSavingsAdjustmentsMap();
      } catch {
        /* historial: recarga con la página */
      }
    } catch {
      onToast("No se pudo aplicar el ajuste.");
    }
  };

  const removeSavings = async (id: number) => {
    if (!confirm("¿Eliminar esta meta de ahorro? El historial de ajustes se pierde.")) return;
    try {
      const r = await apiFetch(`/banking/personal-order/savings-goals/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(String(r.status));
      setSavingsGoals((prev) => prev.filter((x) => x.id !== id));
      setEditingSavings((cur) => (cur?.id === id ? null : cur));
      setSavingsAdjustmentsByGoal((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      onToast("Meta eliminada.");
    } catch {
      onToast("No se pudo eliminar.");
    }
  };

  const openEditSavingsAdjustment = useCallback((row: PersonalSavingsAdjustment) => {
    setEditingSavingsAdjustment(row);
    setEditSavingsAdjAmount(String(row.amount));
  }, []);

  const saveSavingsAdjustmentEdit = async () => {
    if (!editingSavingsAdjustment) return;
    const amt = parseChileanAmountInput(editSavingsAdjAmount.trim());
    if (!Number.isFinite(amt) || amt === 0) {
      onToast("Indica un monto distinto de cero.");
      return;
    }
    setSavingSavingsAdjEdit(true);
    try {
      const updated = await patchJson<PersonalSavingsGoal>(
        `/banking/personal-order/savings-adjustments/${editingSavingsAdjustment.id}`,
        { amount: amt },
      );
      setSavingsGoals((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setEditingSavingsAdjustment(null);
      await fetchSavingsAdjustmentsMap();
      onToast("Movimiento actualizado.");
    } catch {
      onToast("No se pudo guardar.");
    } finally {
      setSavingSavingsAdjEdit(false);
    }
  };

  const removeSavingsAdjustmentRow = async (adj: PersonalSavingsAdjustment) => {
    if (!confirm("¿Eliminar este movimiento del historial? El saldo seguido se actualizará.")) return;
    try {
      const r = await apiFetch(`/banking/personal-order/savings-adjustments/${adj.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(String(r.status));
      await reloadSavingsSection();
      setEditingSavingsAdjustment((cur) => (cur?.id === adj.id ? null : cur));
      onToast("Movimiento eliminado.");
    } catch {
      onToast("No se pudo eliminar.");
    }
  };

  const openProvisionEdit = useCallback((row: PersonalProvisionItem) => {
    setEditingProvision(row);
  }, []);

  const openNewProvisionModal = useCallback(() => {
    setNewProvDesc("");
    setNewProvAmount("");
    setNewProvAccountId("");
    setNewProvLabel("");
    setNewProvisionModalOpen(true);
  }, []);

  const openNewSavingsModal = useCallback(() => {
    setNewSavTitle("");
    setNewSavAccountId("");
    setNewSavInitial("");
    setNewSavTarget("");
    setNewSavingsModalOpen(true);
  }, []);

  const saveProvisionEdit = async () => {
    if (!editingProvision) return;
    const d = epDesc.trim();
    if (!d) {
      onToast("Escribe una descripción.");
      return;
    }
    let amount_clp: number | null;
    if (epAmount.trim() === "") {
      amount_clp = null;
    } else {
      const parsed = parseChileanAmountInput(epAmount.trim());
      if (!Number.isFinite(parsed)) {
        onToast("El monto orientativo no es válido.");
        return;
      }
      amount_clp = parsed;
    }
    const lab = epLabel.trim();
    try {
      const updated = await patchJson<PersonalProvisionItem>(`/banking/personal-order/provision-items/${editingProvision.id}`, {
        description: d,
        category_label: lab === "" ? null : lab,
        amount_clp,
        account_id: epAccountId === "" ? null : epAccountId,
      });
      setProvisionItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setEditingProvision(null);
      onToast("Recordatorio actualizado.");
    } catch {
      onToast("No se pudo guardar.");
    }
  };

  const saveSavingsEdit = async () => {
    if (!editingSavings) return;
    const t = svTitle.trim();
    if (!t) {
      onToast("Escribe un nombre para la meta.");
      return;
    }
    if (svAccountId === "") {
      onToast("Selecciona una cuenta.");
      return;
    }
    let targetPatch: number | null;
    const tgtTrim = svTarget.trim();
    if (tgtTrim === "") {
      targetPatch = null;
    } else {
      const tp = parseChileanAmountInput(tgtTrim);
      if (!Number.isFinite(tp) || tp <= 0) {
        onToast("Monto objetivo no válido; vacía el campo para solo seguimiento de saldo.");
        return;
      }
      targetPatch = tp;
    }
    try {
      const updated = await patchJson<PersonalSavingsGoal>(`/banking/personal-order/savings-goals/${editingSavings.id}`, {
        title: t,
        account_id: svAccountId,
        target_amount_clp: targetPatch,
      });
      setSavingsGoals((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setEditingSavings(null);
      onToast("Meta actualizada.");
    } catch {
      onToast("No se pudo guardar.");
    }
  };

  /** Al menos el alto visible bajo el header fijo (`h-14`), para no dejar ver el shell `#0d1117` debajo del contenido. */
  const pageWrapClass = `banking-theme w-full min-h-[calc(100dvh-3.5rem)] ${
    isDark
      ? "bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(251,191,36,0.055),transparent_52%),linear-gradient(to_bottom,#0d0d0d,#070707)] text-zinc-300"
      : "bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100/80 text-slate-800"
  }`;

  const innerClass = "mx-auto max-w-[1100px] space-y-10 p-4 pb-28 md:p-6";

  if (loading) {
    return (
      <div className={pageWrapClass}>
        <div className={innerClass}>
          <p className="text-sm text-slate-600 banking-dark:text-zinc-400">Cargando…</p>
        </div>
      </div>
    );
  }

  const sortableIds = sortedProvisionItems.map((r) => String(r.id));

  return (
    <div className={pageWrapClass}>
      <div className={innerClass}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 banking-dark:text-zinc-50">
              Orden personal
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600 banking-dark:text-zinc-400">
              Recordatorios y seguimiento que no modifican tu libro bancario. Lo que guardas queda almacenado en el
              servidor asociado a tu usuario: al iniciar sesión de nuevo verás la misma lista, orden y estado de pago.
            </p>
          </div>
        </header>

        <section className={cardClass} aria-labelledby="prov-heading">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <h2
              id="prov-heading"
              className="min-w-0 flex-1 text-lg font-semibold leading-snug text-slate-900 banking-dark:text-zinc-100"
            >
              <button
                type="button"
                className="flex w-full items-start gap-3 rounded-xl border border-transparent px-1 py-0.5 text-left outline-none ring-indigo-400/0 transition hover:border-slate-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-400/35 banking-dark:hover:border-zinc-700 banking-dark:hover:bg-zinc-900/60 banking-dark:focus-visible:ring-amber-500/35"
                onClick={toggleProvisionsSection}
                aria-expanded={provisionsExpanded}
                aria-controls="prov-panel"
              >
                <ChevronExpandIcon
                  expanded={provisionsExpanded}
                  className="mt-0.5 text-slate-500 banking-dark:text-zinc-400"
                />
                <span className="min-w-0 flex-1">
                  <span className="block">Provisiones a tener presente</span>
                  <span className="mt-1 block text-xs font-normal text-slate-500 banking-dark:text-zinc-500">
                    La etiqueta es texto libre (ej. «Streaming», «Seguros»): no tiene que coincidir con las categorías de
                    movimientos bancarios. Monto orientativo solo como referencia. Los filtros funcionan como en
                    movimientos bancarios: cada encabezado muestra «Filtrar» o «Filtro activo». Puedes arrastrar filas
                    cuando no hay filtros activos.
                  </span>
                </span>
              </button>
            </h2>
            <button type="button" className={`${btnPrimary} shrink-0`} onClick={openNewProvisionModal}>
              Nueva Provisión
            </button>
          </div>

          {!provisionsExpanded ? (
            <p className="text-sm text-slate-600 banking-dark:text-zinc-400" role="status">
              <strong>{provisionItems.length}</strong> ítem(s). Pulsa el encabezado para ver la tabla y los filtros.
            </p>
          ) : provisionItems.length === 0 ? (
            <p id="prov-panel" className="text-sm text-slate-500 banking-dark:text-zinc-500">
              No hay ítems todavía.
            </p>
          ) : (
            <div id="prov-panel">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3 banking-dark:border-zinc-800">
                <p className="text-xs text-slate-500 banking-dark:text-zinc-500">
                  {columnFiltersActive ? (
                    <>
                      Mostrando <strong>{filteredProvisionItems.length}</strong> de {provisionItems.length} ·{" "}
                      <span className="text-amber-700 banking-dark:text-amber-400/90">
                        Quita los filtros de la tabla para reordenar con el asa ⋮⋮
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>{provisionItems.length}</strong> ítem(s) · arrastra con el asa para ordenar
                    </>
                  )}
                </p>
                <button type="button" className={btnSecondary} onClick={() => void resetPaid()}>
                  Reset (todo no pagado)
                </button>
              </div>

              {filteredProvisionItems.length === 0 ? (
                <p className="text-sm text-slate-500 banking-dark:text-zinc-500">
                  Ningún ítem coincide con los filtros. Abre cada columna con «Filtrar» y limpia lo que necesites.
                </p>
              ) : (
                <>
                  {provisionSelectionStats.sel > 0 ? (
                    <div
                      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200/90 bg-indigo-50/90 px-3 py-2.5 text-sm banking-dark:border-amber-900/60 banking-dark:bg-amber-950/35"
                      role="status"
                      aria-live="polite"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-indigo-900 banking-dark:text-amber-100">
                          Selección:{" "}
                          <strong>{provisionSelectionStats.sel}</strong>{" "}
                          {provisionSelectionStats.sel === 1 ? "ítem visible" : "ítems visibles"}
                        </p>
                        <p className="mt-0.5 tabular-nums text-indigo-800 banking-dark:text-amber-200/95">
                          Suma montos ref.: <strong>{formatClpDots(provisionSelectionStats.sum)}</strong>
                          {provisionSelectionStats.selWithoutAmount > 0 ? (
                            <span className="ml-2 font-normal text-indigo-700/90 banking-dark:text-zinc-400">
                              · {provisionSelectionStats.selWithoutAmount}{" "}
                              {provisionSelectionStats.selWithoutAmount === 1 ? "ítem sin" : "ítems sin"} monto ref.
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={`${btnPrimary} text-xs`}
                          onClick={openRegisterMovesModal}
                          title="Crea movimientos en categoría Provisiones (monto negativo, cargo TC no pagado si aplica)"
                        >
                          Al libro bancario…
                        </button>
                        <button
                          type="button"
                          className={`${btnSecondary} text-xs`}
                          onClick={() => setSelectedProvisionIds(new Set())}
                        >
                          Quitar selección
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-1.5 pr-2.5 shadow-sm banking-dark:border-zinc-700 banking-dark:bg-zinc-900">
                      <BankingAuxRoundCheckbox
                        checked={allVisibleProvisionsSelected}
                        indeterminate={provisionSelectionStats.sel > 0 && !allVisibleProvisionsSelected}
                        onChange={toggleSelectAllVisibleProvisions}
                        color="indigo"
                        title={allVisibleProvisionsSelected ? "Desmarcar todas las visibles" : "Seleccionar todas las visibles"}
                        aria-label={
                          columnFiltersActive
                            ? "Seleccionar todas las provisiones que ves con el filtro actual"
                            : "Seleccionar todas las provisiones de la lista"
                        }
                      />
                      <span className="text-[11px] font-semibold text-slate-500 banking-dark:text-zinc-400">Todos</span>
                    </div>
                    <ProvisionColumnFilterChip
                      colKey="paid"
                      active={provisionColumnFilterActive("paid", filterSnapshot)}
                      open={headerFilterOpen === "paid"}
                      registerRef={(el) => registerProvisionHeaderRef("paid", el)}
                      toggle={() => toggleProvisionHeaderFilter("paid")}
                    />
                    <ProvisionColumnFilterChip
                      colKey="descripcion"
                      active={provisionColumnFilterActive("descripcion", filterSnapshot)}
                      open={headerFilterOpen === "descripcion"}
                      registerRef={(el) => registerProvisionHeaderRef("descripcion", el)}
                      toggle={() => toggleProvisionHeaderFilter("descripcion")}
                    />
                    <ProvisionColumnFilterChip
                      colKey="etiqueta"
                      active={provisionColumnFilterActive("etiqueta", filterSnapshot)}
                      open={headerFilterOpen === "etiqueta"}
                      registerRef={(el) => registerProvisionHeaderRef("etiqueta", el)}
                      toggle={() => toggleProvisionHeaderFilter("etiqueta")}
                    />
                    <ProvisionColumnFilterChip
                      colKey="monto"
                      active={provisionColumnFilterActive("monto", filterSnapshot)}
                      open={headerFilterOpen === "monto"}
                      registerRef={(el) => registerProvisionHeaderRef("monto", el)}
                      toggle={() => toggleProvisionHeaderFilter("monto")}
                    />
                    <ProvisionColumnFilterChip
                      colKey="cuenta"
                      active={provisionColumnFilterActive("cuenta", filterSnapshot)}
                      open={headerFilterOpen === "cuenta"}
                      registerRef={(el) => registerProvisionHeaderRef("cuenta", el)}
                      toggle={() => toggleProvisionHeaderFilter("cuenta")}
                    />
                  </div>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => {
                      if (!columnFiltersActive) void handleProvisionDragEnd(e);
                    }}
                  >
                    <div className={BANKING_MAIN_TX_CARD_CLASS}>
                      {columnFiltersActive ? (
                        filteredProvisionItems.map((row) => (
                          <StaticProvisionRow
                            key={row.id}
                            row={row}
                            selected={selectedProvisionIds.has(row.id)}
                            onSelectChange={(checked) => toggleProvisionSelected(row.id, checked)}
                            onTogglePaid={togglePaid}
                            onEdit={openProvisionEdit}
                            onRemove={removeProvision}
                          />
                        ))
                      ) : (
                        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                          {sortedProvisionItems.map((row) => (
                            <SortableProvisionRow
                              key={row.id}
                              row={row}
                              selected={selectedProvisionIds.has(row.id)}
                              onSelectChange={(checked) => toggleProvisionSelected(row.id, checked)}
                              onTogglePaid={togglePaid}
                              onEdit={openProvisionEdit}
                              onRemove={removeProvision}
                            />
                          ))}
                        </SortableContext>
                      )}
                    </div>
                  </DndContext>
                  {headerFilterOpen && headerFilterPopoverPos
                    ? createPortal(
                        <div
                          ref={filterPopoverPanelRef}
                          role="dialog"
                          aria-label={`Filtro: ${PROVISION_FILTER_LABELS[headerFilterOpen]}`}
                          className="banking-theme rounded-xl border border-slate-300 bg-white p-3 shadow-xl shadow-slate-900/10 ring-1 ring-slate-300 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:shadow-black/40 banking-dark:ring-zinc-700"
                          style={{
                            position: "fixed",
                            top: headerFilterPopoverPos.top,
                            left: headerFilterPopoverPos.left,
                            width: headerFilterPopoverPos.width,
                            zIndex: 95,
                          }}
                        >
                          <div className="max-h-[min(70vh,420px)] overflow-y-auto pr-1 tx-scroll">
                            <ProvisionHeaderFilterFields
                              colKey={headerFilterOpen}
                              sel={bankingProvFilterInputClass}
                              accountsSorted={accountsSorted}
                              distinctLabels={provisionDistinctLabels}
                              showNoneLabelOption={showNoneLabelOption}
                              filterDescription={filterDescription}
                              setFilterDescription={setFilterDescription}
                              filterAmountMin={filterAmountMin}
                              setFilterAmountMin={setFilterAmountMin}
                              filterAmountMax={filterAmountMax}
                              setFilterAmountMax={setFilterAmountMax}
                              filterPaidScopes={filterPaidScopes}
                              setFilterPaidScopes={setFilterPaidScopes}
                              filterAccountIds={filterAccountIds}
                              setFilterAccountIds={setFilterAccountIds}
                              filterAccountNull={filterAccountNull}
                              setFilterAccountNull={setFilterAccountNull}
                              filterLabelContains={filterLabelContains}
                              setFilterLabelContains={setFilterLabelContains}
                              filterLabelTokens={filterLabelTokens}
                              setFilterLabelTokens={setFilterLabelTokens}
                            />
                          </div>
                        </div>,
                        document.body,
                      )
                    : null}
                </>
              )}
            </div>
          )}
        </section>

        <section className={cardClass} aria-labelledby="sav-heading">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <h2
              id="sav-heading"
              className="min-w-0 flex-1 text-lg font-semibold leading-snug text-slate-900 banking-dark:text-zinc-100"
            >
              <button
                type="button"
                className="flex w-full items-start gap-3 rounded-xl border border-transparent px-1 py-0.5 text-left outline-none ring-indigo-400/0 transition hover:border-slate-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-400/35 banking-dark:hover:border-zinc-700 banking-dark:hover:bg-zinc-900/60 banking-dark:focus-visible:ring-amber-500/35"
                onClick={toggleSavingsSection}
                aria-expanded={savingsExpanded}
                aria-controls="sav-panel"
              >
                <ChevronExpandIcon
                  expanded={savingsExpanded}
                  className="mt-0.5 text-slate-500 banking-dark:text-zinc-400"
                />
                <span className="min-w-0 flex-1">
                  <span className="block">Ahorro por objetivo</span>
                  <span className="mt-1 block text-xs font-normal text-slate-500 banking-dark:text-zinc-500">
                    El saldo es solo un registro tuyo (el dinero real sigue en la cuenta del banco). Puedes definir un
                    monto objetivo opcional para ver el % de avance; si no, la tarjeta sirve solo para ir actualizando el
                    saldo al cierre de mes u otro control. Cada ajuste queda guardado en el historial del servidor. Usa
                    montos + o − como antes.
                  </span>
                </span>
              </button>
            </h2>
            <button type="button" className={`${btnPrimary} shrink-0`} onClick={openNewSavingsModal}>
              Nuevo Objetivo
            </button>
          </div>

          {!savingsExpanded ? (
            <p className="text-sm text-slate-600 banking-dark:text-zinc-400" role="status">
              <strong>{savingsGoals.length}</strong> meta(s). Pulsa el encabezado para ver las tarjetas y los ajustes.
            </p>
          ) : savingsGoals.length === 0 ? (
            <p id="sav-panel" className="text-sm text-slate-500 banking-dark:text-zinc-500">
              No hay metas de ahorro todavía.
            </p>
          ) : (
            <ul id="sav-panel" className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {savingsGoals.map((g) => {
                const target = g.target_amount_clp ?? null;
                const pct = savingsGoalProgressPercent(g.balance_clp, target);
                const barPct =
                  pct != null && target != null && target > 0
                    ? Math.min(100, Math.max(0, (g.balance_clp / target) * 100))
                    : 0;
                const hist = savingsAdjustmentsByGoal[g.id] ?? [];
                let running = 0;
                const histRows = hist.map((h) => {
                  running += h.amount;
                  return { ...h, balanceAfter: running };
                });
                return (
                <li
                  key={g.id}
                  className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-100 bg-slate-50/80 p-4 banking-dark:border-zinc-700 banking-dark:bg-zinc-950/40"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-snug text-slate-900 banking-dark:text-zinc-100">{g.title}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500 banking-dark:text-zinc-500">{g.account_name}</p>
                    </div>
                    <div className="flex shrink-0 items-start gap-2">
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-wide text-slate-500 banking-dark:text-zinc-500">
                          Saldo seguido
                        </p>
                        <p className="text-base font-bold tabular-nums text-indigo-800 sm:text-lg banking-dark:text-amber-200">
                          {formatBankingClpSigned(g.balance_clp)}
                        </p>
                      </div>
                      <div className="flex items-center gap-0.5 border-l border-slate-200 pl-2 banking-dark:border-zinc-600">
                        <button
                          type="button"
                          title="Editar meta"
                          aria-label="Editar meta"
                          className={poIconBtn}
                          onClick={() => setEditingSavings(g)}
                        >
                          <IconPencil />
                        </button>
                        <button
                          type="button"
                          title="Eliminar meta"
                          aria-label="Eliminar meta"
                          className={poIconBtnDanger}
                          onClick={() => void removeSavings(g.id)}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </div>
                  </div>
                  {pct != null && target != null ? (
                    <div className="mt-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 banking-dark:text-zinc-500">
                          Avance al objetivo
                        </span>
                        <span className="text-sm font-bold tabular-nums text-indigo-900 banking-dark:text-amber-200">
                          {pct}%
                        </span>
                      </div>
                      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-200/90 banking-dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-600 banking-dark:from-amber-600 banking-dark:to-amber-500"
                          style={{ width: `${barPct}%` }}
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Avance ${pct} por ciento`}
                        />
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-500 banking-dark:text-zinc-500">
                        Objetivo: <span className="tabular-nums text-slate-700 banking-dark:text-zinc-300">{formatClpDots(target)}</span>
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-[11px] leading-snug text-slate-500 banking-dark:text-zinc-500">
                      Sin monto objetivo: solo seguimiento del saldo (p. ej. cierre de mes).
                    </p>
                  )}
                  <div className="mt-4 flex flex-1 flex-col gap-3">
                    <div className="w-full">
                      <label className={labelClass}>Ajuste CLP (+ o −)</label>
                      <input
                        className={`${inputClass} tabular-nums`}
                        inputMode="decimal"
                        value={adjustInputs[g.id] ?? ""}
                        onChange={(e) => setAdjustInputs((m) => ({ ...m, [g.id]: e.target.value }))}
                        placeholder="Ej.: 50000 o -10000"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={btnPrimary} onClick={() => void applyAdjust(g)}>
                        Aplicar
                      </button>
                    </div>
                    <details className="rounded-lg border border-slate-200/90 bg-white/60 p-2 banking-dark:border-zinc-700 banking-dark:bg-zinc-950/35">
                      <summary className="cursor-pointer select-none text-xs font-semibold text-slate-600 outline-none banking-dark:text-zinc-400">
                        Historial de movimientos ({hist.length})
                      </summary>
                      {histRows.length === 0 ? (
                        <p className="mt-2 text-[11px] leading-snug text-slate-500 banking-dark:text-zinc-500">
                          Sin movimientos registrados. Si el saldo inicial fue 0, el primer ajuste creará la primera línea.
                        </p>
                      ) : (
                        <div className="mt-2 max-h-44 overflow-auto rounded-md border border-slate-100 banking-dark:border-zinc-800">
                          <table className="w-full min-w-[280px] border-collapse text-left text-[11px]">
                            <thead className="sticky top-0 bg-slate-100/95 banking-dark:bg-zinc-900/95">
                              <tr>
                                <th className="px-2 py-1.5 font-semibold text-slate-600 banking-dark:text-zinc-400">
                                  Fecha
                                </th>
                                <th className="px-2 py-1.5 text-right font-semibold text-slate-600 banking-dark:text-zinc-400">
                                  Movimiento
                                </th>
                                <th className="px-2 py-1.5 text-right font-semibold text-slate-600 banking-dark:text-zinc-400">
                                  Saldo después
                                </th>
                                <th className="w-px whitespace-nowrap px-1 py-1.5 text-center font-semibold text-slate-600 banking-dark:text-zinc-400">
                                  <span className="sr-only">Acciones</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {histRows.map((row) => (
                                <tr
                                  key={row.id}
                                  className="border-t border-slate-100 banking-dark:border-zinc-800"
                                >
                                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700 banking-dark:text-zinc-300">
                                    {formatSavingsAdjustmentWhen(row.created_at)}
                                  </td>
                                  <td
                                    className={`px-2 py-1.5 text-right font-medium tabular-nums ${
                                      row.amount >= 0
                                        ? "text-indigo-800 banking-dark:text-indigo-400"
                                        : "text-rose-700 banking-dark:text-rose-400"
                                    }`}
                                  >
                                    {formatBankingClpSigned(row.amount)}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-800 banking-dark:text-zinc-100">
                                    {formatBankingClpSigned(row.balanceAfter)}
                                  </td>
                                  <td className="whitespace-nowrap px-1 py-1">
                                    <div className="flex items-center justify-end gap-0.5">
                                      <button
                                        type="button"
                                        title="Editar movimiento"
                                        aria-label="Editar movimiento"
                                        className={`${poIconBtn} !h-7 !w-7`}
                                        onClick={() => openEditSavingsAdjustment(row)}
                                      >
                                        <IconPencil className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Eliminar movimiento"
                                        aria-label="Eliminar movimiento"
                                        className={`${poIconBtnDanger} !h-7 !w-7`}
                                        onClick={() => void removeSavingsAdjustmentRow(row)}
                                      >
                                        <IconTrash className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </details>
                  </div>
                </li>
              );
              })}
            </ul>
          )}
        </section>

        {editingProvision ? (
          <div className={modalBackdropClass} role="presentation">
            <button
              type="button"
              aria-label="Cerrar"
              className="absolute inset-0 cursor-default bg-transparent"
              onClick={() => setEditingProvision(null)}
            />
            <div
              className={modalPanelClass}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-prov-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="edit-prov-title" className="text-lg font-semibold text-slate-900 banking-dark:text-zinc-100">
                Editar recordatorio
              </h3>
              <div className="mt-4 space-y-3">
                <div>
                  <label className={labelClass}>Descripción</label>
                  <input
                    className={inputClass}
                    value={epDesc}
                    onChange={(e) => setEpDesc(e.target.value)}
                    maxLength={4000}
                  />
                </div>
                <div>
                  <label className={labelClass}>Etiqueta libre (opcional)</label>
                  <input
                    className={inputClass}
                    value={epLabel}
                    onChange={(e) => setEpLabel(e.target.value)}
                    maxLength={255}
                  />
                </div>
                <div>
                  <label className={labelClass}>Monto orientativo (CLP, opcional)</label>
                  <input
                    className={`${inputClass} tabular-nums`}
                    inputMode="decimal"
                    value={epAmount}
                    onChange={(e) => setEpAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>Cuenta asociada (opcional)</label>
                  <AccountSelect value={epAccountId} onChange={setEpAccountId} accounts={accounts} placeholder="—" />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" className={btnSecondary} onClick={() => setEditingProvision(null)}>
                  Cancelar
                </button>
                <button type="button" className={btnPrimary} onClick={() => void saveProvisionEdit()}>
                  Guardar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {editingSavings ? (
          <div className={modalBackdropClass} role="presentation">
            <button
              type="button"
              aria-label="Cerrar"
              className="absolute inset-0 cursor-default bg-transparent"
              onClick={() => setEditingSavings(null)}
            />
            <div
              className={modalPanelClass}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-sav-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="edit-sav-title" className="text-lg font-semibold text-slate-900 banking-dark:text-zinc-100">
                Editar meta de ahorro
              </h3>
              <p className="mt-1 text-xs text-slate-500 banking-dark:text-zinc-500">
                El saldo seguido se actualiza con «Aplicar» en la tarjeta. El monto objetivo es opcional: vacía el campo
                para seguir solo el saldo sin porcentaje.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className={labelClass}>Nombre del objetivo</label>
                  <input className={inputClass} value={svTitle} onChange={(e) => setSvTitle(e.target.value)} maxLength={512} />
                </div>
                <div>
                  <label className={labelClass}>Cuenta en la que ahorras</label>
                  <AccountSelect value={svAccountId} onChange={setSvAccountId} accounts={accounts} placeholder="Selecciona…" />
                </div>
                <div>
                  <label className={labelClass}>Monto objetivo (CLP, opcional)</label>
                  <input
                    className={`${inputClass} tabular-nums`}
                    inputMode="decimal"
                    value={svTarget}
                    onChange={(e) => setSvTarget(e.target.value)}
                    placeholder="Vacío = solo seguimiento de saldo"
                  />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" className={btnSecondary} onClick={() => setEditingSavings(null)}>
                  Cancelar
                </button>
                <button type="button" className={btnPrimary} onClick={() => void saveSavingsEdit()}>
                  Guardar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {editingSavingsAdjustment ? (
          <div className={modalBackdropClass} role="presentation">
            <button
              type="button"
              aria-label="Cerrar"
              className="absolute inset-0 cursor-default bg-transparent"
              onClick={() => !savingSavingsAdjEdit && setEditingSavingsAdjustment(null)}
            />
            <div
              className={modalPanelClass}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-sav-adj-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="edit-sav-adj-title" className="text-lg font-semibold text-slate-900 banking-dark:text-zinc-100">
                Editar movimiento
              </h3>
              <p className="mt-1 text-xs text-slate-500 banking-dark:text-zinc-500">
                {savingsGoals.find((x) => x.id === editingSavingsAdjustment.goal_id)?.title ?? "Meta"} ·{" "}
                {formatSavingsAdjustmentWhen(editingSavingsAdjustment.created_at)}
              </p>
              <div className="mt-4">
                <label className={labelClass} htmlFor="edit-sav-adj-amt">
                  Monto CLP (+ o −)
                </label>
                <input
                  id="edit-sav-adj-amt"
                  className={`${inputClass} tabular-nums`}
                  inputMode="decimal"
                  value={editSavingsAdjAmount}
                  onChange={(e) => setEditSavingsAdjAmount(e.target.value)}
                  disabled={savingSavingsAdjEdit}
                />
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={savingSavingsAdjEdit}
                  onClick={() => setEditingSavingsAdjustment(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={savingSavingsAdjEdit}
                  onClick={() => void saveSavingsAdjustmentEdit()}
                >
                  {savingSavingsAdjEdit ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {registerMovesModalOpen ? (
          <div className={modalBackdropClass} role="presentation">
            <button
              type="button"
              aria-label="Cerrar"
              className="absolute inset-0 cursor-default bg-transparent"
              onClick={() => !registerMovesSaving && setRegisterMovesModalOpen(false)}
            />
            <div
              className={modalPanelClass}
              role="dialog"
              aria-modal="true"
              aria-labelledby="reg-moves-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="reg-moves-modal-title" className="text-lg font-semibold text-slate-900 banking-dark:text-zinc-100">
                Registrar en movimientos bancarios
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 banking-dark:text-zinc-400">
                Se creará un movimiento por cada ítem seleccionado en esta vista: categoría{" "}
                <strong>Provisiones</strong>, monto <strong>negativo</strong> según el monto de referencia,{" "}
                <strong>fecha de hoy</strong> y <strong>mes contable</strong> el que elijas abajo. En tarjeta de crédito el
                cargo queda <strong>sin pagar</strong> para que puedas gestionarlo en Movimientos bancarios.
              </p>
              <div className="mt-4">
                <label className={labelClass} htmlFor="reg-moves-month">
                  Mes contable
                </label>
                <input
                  id="reg-moves-month"
                  className={`${inputClass} tabular-nums`}
                  type="month"
                  value={registerMovesYm}
                  onChange={(e) => setRegisterMovesYm(e.target.value)}
                  disabled={registerMovesSaving}
                />
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={registerMovesSaving}
                  onClick={() => setRegisterMovesModalOpen(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={registerMovesSaving || selectedVisibleProvisionIds.length === 0}
                  onClick={() => void confirmRegisterProvisionMoves()}
                >
                  {registerMovesSaving ? "Creando…" : "Crear movimientos"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {newProvisionModalOpen ? (
          <div className={modalBackdropClass} role="presentation">
            <button
              type="button"
              aria-label="Cerrar"
              className="absolute inset-0 cursor-default bg-transparent"
              onClick={() => setNewProvisionModalOpen(false)}
            />
            <div
              className={modalPanelClass}
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-prov-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="new-prov-modal-title" className="text-lg font-semibold text-slate-900 banking-dark:text-zinc-100">
                Nueva Provisión
              </h3>
              <div className="mt-4 space-y-3">
                <div>
                  <label className={labelClass}>Descripción</label>
                  <input
                    className={inputClass}
                    value={newProvDesc}
                    onChange={(e) => setNewProvDesc(e.target.value)}
                    placeholder="Ej.: Netflix, UF abril…"
                    maxLength={4000}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Etiqueta libre (opcional)</label>
                    <input
                      className={inputClass}
                      value={newProvLabel}
                      onChange={(e) => setNewProvLabel(e.target.value)}
                      placeholder="Ej.: Suscripciones, Casa, Auto…"
                      maxLength={255}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Monto orientativo (CLP, opcional)</label>
                    <input
                      className={`${inputClass} tabular-nums`}
                      inputMode="decimal"
                      value={newProvAmount}
                      onChange={(e) => setNewProvAmount(e.target.value)}
                      placeholder="Solo referencia"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Cuenta asociada (opcional)</label>
                  <AccountSelect
                    value={newProvAccountId}
                    onChange={setNewProvAccountId}
                    accounts={accounts}
                    placeholder="—"
                  />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" className={btnSecondary} onClick={() => setNewProvisionModalOpen(false)}>
                  Cancelar
                </button>
                <button type="button" className={btnPrimary} onClick={() => void addProvision()}>
                  Agregar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {newSavingsModalOpen ? (
          <div className={modalBackdropClass} role="presentation">
            <button
              type="button"
              aria-label="Cerrar"
              className="absolute inset-0 cursor-default bg-transparent"
              onClick={() => setNewSavingsModalOpen(false)}
            />
            <div
              className={modalPanelClass}
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-sav-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="new-sav-modal-title" className="text-lg font-semibold text-slate-900 banking-dark:text-zinc-100">
                Nuevo Objetivo
              </h3>
              <div className="mt-4 space-y-3">
                <div>
                  <label className={labelClass}>Nombre del objetivo</label>
                  <input
                    className={inputClass}
                    value={newSavTitle}
                    onChange={(e) => setNewSavTitle(e.target.value)}
                    placeholder="Ej.: Viaje fin de año"
                    maxLength={512}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Cuenta en la que ahorras</label>
                    <AccountSelect
                      value={newSavAccountId}
                      onChange={setNewSavAccountId}
                      accounts={accounts}
                      placeholder="Selecciona…"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Saldo inicial (CLP)</label>
                    <input
                      className={`${inputClass} tabular-nums`}
                      inputMode="decimal"
                      value={newSavInitial}
                      onChange={(e) => setNewSavInitial(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Monto objetivo (CLP, opcional)</label>
                  <input
                    className={`${inputClass} tabular-nums`}
                    inputMode="decimal"
                    value={newSavTarget}
                    onChange={(e) => setNewSavTarget(e.target.value)}
                    placeholder="Si lo dejas vacío, solo verás el saldo sin % de avance"
                  />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" className={btnSecondary} onClick={() => setNewSavingsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="button" className={btnPrimary} onClick={() => void addSavingsGoal()}>
                  Crear meta
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
