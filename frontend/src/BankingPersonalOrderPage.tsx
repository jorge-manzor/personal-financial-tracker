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
import { BankingThemeToggle, useBankingTheme } from "./BankingThemeContext";
import { formatBankingClpSigned, formatClpDots, parseChileanAmountInput } from "./format";
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
};

const cardClass =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm banking-dark:border-zinc-700 banking-dark:bg-zinc-900/80";
const labelClass =
  "block text-[10px] font-semibold uppercase tracking-wide text-slate-500 banking-dark:text-zinc-400";
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-teal-400/0 transition focus:border-teal-400 focus:ring-2 focus:ring-teal-400/35 banking-dark:border-zinc-600 banking-dark:bg-zinc-950 banking-dark:text-zinc-100 banking-dark:focus:border-amber-500 banking-dark:focus:ring-amber-500/35";
/** Filtros popover provisiones — alineado con tabla movimientos bancarios. */
const bankingProvFilterInputClass =
  "mt-1 w-full rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 [color-scheme:light] banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:placeholder:text-zinc-500 banking-dark:focus:border-amber-700/55 banking-dark:focus:ring-amber-500/15";

const PROVISION_LABEL_NONE = "__none__";

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

function ProvisionColumnHeader({
  colKey,
  active,
  open,
  registerRef,
  toggle,
}: {
  colKey: ProvisionFilterColKey;
  active: boolean;
  open: boolean;
  registerRef: (el: HTMLTableCellElement | null) => void;
  toggle: () => void;
}) {
  const label = PROVISION_FILTER_LABELS[colKey];
  return (
    <th ref={registerRef} scope="col" className="align-bottom p-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`w-full px-2 py-2.5 text-center transition sm:px-2.5 ${
          open
            ? "bg-slate-100 ring-1 ring-inset ring-slate-300 banking-dark:bg-zinc-900 banking-dark:ring-zinc-600"
            : "hover:bg-slate-50 banking-dark:hover:bg-zinc-900/80"
        }`}
      >
        <span className="block text-[12px] font-semibold uppercase tracking-wide text-slate-700 banking-dark:text-zinc-200">
          {label}
        </span>
        <span
          className={`mt-0.5 block text-[9px] font-medium normal-case tracking-normal ${
            active ? "text-slate-600 banking-dark:text-zinc-400" : "text-slate-400 banking-dark:text-zinc-500"
          }`}
        >
          {active ? "Filtro activo" : "Filtrar"}
        </span>
      </button>
    </th>
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
          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-teal-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-300 banking-dark:hover:bg-zinc-800"
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
            className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm font-medium transition hover:bg-teal-50 banking-dark:hover:bg-zinc-800 ${
              filterLabelTokens.includes(PROVISION_LABEL_NONE)
                ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
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
              className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm font-medium text-slate-800 transition hover:bg-teal-50 banking-dark:text-zinc-100 banking-dark:hover:bg-zinc-800 ${
                picked
                  ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
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
              className={`rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-teal-50 banking-dark:hover:bg-zinc-800 ${
                filterPaidScopes.includes("unpaid")
                  ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
                  : "border-slate-300 bg-white banking-dark:border-zinc-600 banking-dark:bg-zinc-950"
              }`}
            >
              No pagado
            </button>
            <button
              type="button"
              onClick={() => setFilterPaidScopes((prev) => toggleEnumInList(prev, "paid"))}
              className={`rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-teal-50 banking-dark:hover:bg-zinc-800 ${
                filterPaidScopes.includes("paid")
                  ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
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
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-teal-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-300 banking-dark:hover:bg-zinc-800"
            >
              Borrar selección
            </button>
          </div>
          <div className="mt-1 max-h-[min(50vh,280px)] space-y-1 overflow-y-auto pr-0.5 tx-scroll">
            <button
              type="button"
              onClick={() => setFilterAccountNull((prev) => !prev)}
              className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-teal-50 banking-dark:hover:bg-zinc-800 ${
                filterAccountNull
                  ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
                  : "border border-slate-300 bg-white banking-dark:border-zinc-600 banking-dark:bg-zinc-950"
              }`}
            >
              <span className={filterAccountNull ? "font-semibold text-teal-900 banking-dark:text-amber-100" : "text-slate-800 banking-dark:text-zinc-100"}>
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
                  className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-teal-50 banking-dark:hover:bg-zinc-800 ${
                    picked
                      ? "border-teal-400 bg-teal-50 ring-1 ring-teal-300 banking-dark:border-amber-600 banking-dark:bg-zinc-900 banking-dark:ring-amber-700/40"
                      : "border border-slate-300 bg-white banking-dark:border-zinc-600 banking-dark:bg-zinc-950"
                  }`}
                >
                  <span className={picked ? "font-semibold text-teal-900 banking-dark:text-amber-100" : "text-slate-800 banking-dark:text-zinc-100"}>
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
  "rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50 banking-dark:bg-amber-500 banking-dark:text-zinc-950 banking-dark:shadow-md banking-dark:hover:bg-amber-400 banking-dark:disabled:opacity-45";
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

/** Misma jerarquía tipográfica que las filas de la tabla principal de movimientos bancarios (`BankingTxTd`). */
const provisionTableTdBase =
  "align-middle px-2 py-3 text-[12px] leading-snug sm:px-2.5";

function GripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 6a2 2 0 11-4 0 2 2 0 014 0zM8 12a2 2 0 11-4 0 2 2 0 014 0zM8 18a2 2 0 11-4 0 2 2 0 014 0zM20 6a2 2 0 11-4 0 2 2 0 014 0zM20 12a2 2 0 11-4 0 2 2 0 014 0zM20 18a2 2 0 11-4 0 2 2 0 014 0z" />
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
      className={`inline-flex min-w-[7.5rem] items-center justify-center rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${
        paid
          ? "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 banking-dark:bg-emerald-600 banking-dark:hover:bg-emerald-500"
          : "bg-neutral-950 text-white shadow-sm hover:bg-neutral-900 banking-dark:border banking-dark:border-zinc-500 banking-dark:bg-zinc-800 banking-dark:text-white banking-dark:hover:bg-zinc-700"
      }`}
    >
      {paid ? "PAGADO" : "NO PAGADO"}
    </button>
  );
}

function SortableProvisionRow({
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(row.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : undefined,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="bg-white transition-colors hover:bg-slate-50/90 banking-dark:bg-zinc-950/40 banking-dark:hover:bg-zinc-900/50"
    >
      <td className={`${provisionTableTdBase} w-10 px-1 sm:px-1`}>
        <div className="flex justify-center">
          <button
            type="button"
            className="flex cursor-grab touch-none items-center justify-center rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 active:cursor-grabbing banking-dark:text-zinc-400 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-100"
            aria-label="Arrastrar para reordenar"
            {...attributes}
            {...listeners}
          >
            <GripIcon className="h-4 w-4" />
          </button>
        </div>
      </td>
      <td className={provisionTableTdBase}>
        <div className="flex justify-center">
          <PaidToggleButton paid={row.paid} onToggle={() => onTogglePaid(row)} />
        </div>
      </td>
      <td className={`${provisionTableTdBase} max-w-[240px] text-slate-600 banking-dark:text-zinc-300`}>
        <span
          className={`block font-medium leading-snug ${
            row.paid
              ? "text-slate-500 line-through banking-dark:text-zinc-500"
              : "text-slate-700 banking-dark:text-zinc-200"
          }`}
        >
          {row.description}
        </span>
      </td>
      <td className={`${provisionTableTdBase} max-w-[140px] text-slate-700 banking-dark:text-zinc-300`}>
        {row.category_label?.trim() ? row.category_label : (
          <span className="text-slate-400 banking-dark:text-zinc-600">—</span>
        )}
      </td>
      <td className={`${provisionTableTdBase} whitespace-nowrap tabular-nums`}>
        {row.amount_clp != null ? (
          <span className="font-semibold text-slate-800 banking-dark:text-amber-200/90">{formatClpDots(row.amount_clp)}</span>
        ) : (
          <span className="text-slate-400 banking-dark:text-zinc-600">—</span>
        )}
      </td>
      <td className={`${provisionTableTdBase} text-slate-700 banking-dark:text-zinc-400`}>
        {row.account_name ?? "—"}
      </td>
      <td className={`${provisionTableTdBase} whitespace-nowrap`}>
        <div className="flex items-center justify-center gap-0.5">
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
      </td>
    </tr>
  );
}

function StaticProvisionRow({
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
  return (
    <tr className="bg-white transition-colors hover:bg-slate-50/90 banking-dark:bg-zinc-950/40 banking-dark:hover:bg-zinc-900/50">
      <td className={`${provisionTableTdBase} w-10 px-1 text-center text-slate-400 banking-dark:text-zinc-600 sm:px-1`}>
        —
      </td>
      <td className={provisionTableTdBase}>
        <div className="flex justify-center">
          <PaidToggleButton paid={row.paid} onToggle={() => onTogglePaid(row)} />
        </div>
      </td>
      <td className={`${provisionTableTdBase} max-w-[240px] text-slate-600 banking-dark:text-zinc-300`}>
        <span
          className={`block font-medium leading-snug ${
            row.paid
              ? "text-slate-500 line-through banking-dark:text-zinc-500"
              : "text-slate-700 banking-dark:text-zinc-200"
          }`}
        >
          {row.description}
        </span>
      </td>
      <td className={`${provisionTableTdBase} max-w-[140px] text-slate-700 banking-dark:text-zinc-300`}>
        {row.category_label?.trim() ? row.category_label : (
          <span className="text-slate-400 banking-dark:text-zinc-600">—</span>
        )}
      </td>
      <td className={`${provisionTableTdBase} whitespace-nowrap tabular-nums`}>
        {row.amount_clp != null ? (
          <span className="font-semibold text-slate-800 banking-dark:text-amber-200/90">{formatClpDots(row.amount_clp)}</span>
        ) : (
          <span className="text-slate-400 banking-dark:text-zinc-600">—</span>
        )}
      </td>
      <td className={`${provisionTableTdBase} text-slate-700 banking-dark:text-zinc-400`}>
        {row.account_name ?? "—"}
      </td>
      <td className={`${provisionTableTdBase} whitespace-nowrap`}>
        <div className="flex items-center justify-center gap-0.5">
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
      </td>
    </tr>
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
  const headerFilterCellRefs = useRef<Partial<Record<ProvisionFilterColKey, HTMLTableCellElement | null>>>({});
  const filterPopoverPanelRef = useRef<HTMLDivElement | null>(null);

  const registerProvisionHeaderRef = useCallback((k: ProvisionFilterColKey, el: HTMLTableCellElement | null) => {
    headerFilterCellRefs.current[k] = el;
  }, []);

  const toggleProvisionHeaderFilter = useCallback((k: ProvisionFilterColKey) => {
    setHeaderFilterOpen((prev) => (prev === k ? null : k));
  }, []);

  const [newSavTitle, setNewSavTitle] = useState("");
  const [newSavAccountId, setNewSavAccountId] = useState<number | "">("");
  const [newSavInitial, setNewSavInitial] = useState("");

  const [adjustInputs, setAdjustInputs] = useState<Record<number, string>>({});

  const [editingProvision, setEditingProvision] = useState<PersonalProvisionItem | null>(null);
  const [epDesc, setEpDesc] = useState("");
  const [epLabel, setEpLabel] = useState("");
  const [epAmount, setEpAmount] = useState("");
  const [epAccountId, setEpAccountId] = useState<number | "">("");

  const [editingSavings, setEditingSavings] = useState<PersonalSavingsGoal | null>(null);
  const [svTitle, setSvTitle] = useState("");
  const [svAccountId, setSvAccountId] = useState<number | "">("");

  const [newProvisionModalOpen, setNewProvisionModalOpen] = useState(false);
  const [newSavingsModalOpen, setNewSavingsModalOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const loadAll = useCallback(async () => {
    const [acc, prov, sav] = await Promise.all([
      fetchJson<BankingAccountRow[]>("/banking/accounts"),
      fetchJson<PersonalProvisionItem[]>("/banking/personal-order/provision-items"),
      fetchJson<PersonalSavingsGoal[]>("/banking/personal-order/savings-goals"),
    ]);
    setAccounts(acc.filter((a) => (a.enabled ?? true) !== false));
    setProvisionItems(prov);
    setSavingsGoals(sav);
  }, []);

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
  }, [editingSavings]);

  useEffect(() => {
    if (!editingProvision && !editingSavings && !newProvisionModalOpen && !newSavingsModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setEditingProvision(null);
        setEditingSavings(null);
        setNewProvisionModalOpen(false);
        setNewSavingsModalOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingProvision, editingSavings, newProvisionModalOpen, newSavingsModalOpen]);

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
    try {
      const row = await postJson<PersonalSavingsGoal>("/banking/personal-order/savings-goals", {
        title: t,
        account_id: newSavAccountId,
        initial_balance_clp: initial,
      });
      setSavingsGoals((prev) => [...prev, row]);
      setNewSavTitle("");
      setNewSavAccountId("");
      setNewSavInitial("");
      setNewSavingsModalOpen(false);
      onToast("Meta de ahorro creada.");
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
      onToast("Meta eliminada.");
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
    try {
      const updated = await patchJson<PersonalSavingsGoal>(`/banking/personal-order/savings-goals/${editingSavings.id}`, {
        title: t,
        account_id: svAccountId,
      });
      setSavingsGoals((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setEditingSavings(null);
      onToast("Meta actualizada.");
    } catch {
      onToast("No se pudo guardar.");
    }
  };

  const pageWrapClass = `banking-theme min-h-full ${
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
          <BankingThemeToggle />
        </header>

        <section className={cardClass} aria-labelledby="prov-heading">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="prov-heading" className="text-lg font-semibold text-slate-900 banking-dark:text-zinc-100">
                Provisiones a tener presente
              </h2>
              <p className="mt-1 text-xs text-slate-500 banking-dark:text-zinc-500">
                La etiqueta es texto libre (ej. «Streaming», «Seguros»): no tiene que coincidir con las categorías de
                movimientos bancarios. Monto orientativo solo como referencia. Los filtros funcionan como en movimientos
                bancarios: cada encabezado muestra «Filtrar» o «Filtro activo». Puedes arrastrar filas cuando no hay
                filtros activos.
              </p>
            </div>
            <button type="button" className={`${btnPrimary} shrink-0`} onClick={openNewProvisionModal}>
              Nueva Provisión
            </button>
          </div>

          {provisionItems.length === 0 ? (
            <p className="text-sm text-slate-500 banking-dark:text-zinc-500">No hay ítems todavía.</p>
          ) : (
            <>
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
                <div className="overflow-x-auto rounded-xl border border-slate-200 banking-dark:border-zinc-700">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => {
                      if (!columnFiltersActive) void handleProvisionDragEnd(e);
                    }}
                  >
                    <table className="w-full min-w-[860px] border-collapse text-center text-[12px] leading-snug">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-slate-200 bg-slate-50 banking-dark:border-zinc-700 banking-dark:bg-zinc-900/80">
                          <th
                            scope="col"
                            className="w-10 border-b border-slate-200 bg-slate-50 px-1 py-2.5 text-center text-[12px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:border-zinc-700 banking-dark:bg-zinc-900/80 banking-dark:text-zinc-500"
                            aria-label="Orden"
                          >
                            ⋮⋮
                          </th>
                          <ProvisionColumnHeader
                            colKey="paid"
                            active={provisionColumnFilterActive("paid", filterSnapshot)}
                            open={headerFilterOpen === "paid"}
                            registerRef={(el) => registerProvisionHeaderRef("paid", el)}
                            toggle={() => toggleProvisionHeaderFilter("paid")}
                          />
                          <ProvisionColumnHeader
                            colKey="descripcion"
                            active={provisionColumnFilterActive("descripcion", filterSnapshot)}
                            open={headerFilterOpen === "descripcion"}
                            registerRef={(el) => registerProvisionHeaderRef("descripcion", el)}
                            toggle={() => toggleProvisionHeaderFilter("descripcion")}
                          />
                          <ProvisionColumnHeader
                            colKey="etiqueta"
                            active={provisionColumnFilterActive("etiqueta", filterSnapshot)}
                            open={headerFilterOpen === "etiqueta"}
                            registerRef={(el) => registerProvisionHeaderRef("etiqueta", el)}
                            toggle={() => toggleProvisionHeaderFilter("etiqueta")}
                          />
                          <ProvisionColumnHeader
                            colKey="monto"
                            active={provisionColumnFilterActive("monto", filterSnapshot)}
                            open={headerFilterOpen === "monto"}
                            registerRef={(el) => registerProvisionHeaderRef("monto", el)}
                            toggle={() => toggleProvisionHeaderFilter("monto")}
                          />
                          <ProvisionColumnHeader
                            colKey="cuenta"
                            active={provisionColumnFilterActive("cuenta", filterSnapshot)}
                            open={headerFilterOpen === "cuenta"}
                            registerRef={(el) => registerProvisionHeaderRef("cuenta", el)}
                            toggle={() => toggleProvisionHeaderFilter("cuenta")}
                          />
                          <th
                            scope="col"
                            className="border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-center text-[12px] font-semibold uppercase tracking-wide text-slate-600 banking-dark:border-zinc-700 banking-dark:bg-zinc-900/80 banking-dark:text-zinc-300"
                            aria-label="Acciones"
                          />
                        </tr>
                      </thead>
                      {columnFiltersActive ? (
                        <tbody className="divide-y divide-slate-100 banking-dark:divide-zinc-800">
                          {filteredProvisionItems.map((row) => (
                            <StaticProvisionRow
                              key={row.id}
                              row={row}
                              onTogglePaid={togglePaid}
                              onEdit={openProvisionEdit}
                              onRemove={removeProvision}
                            />
                          ))}
                        </tbody>
                      ) : (
                        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                          <tbody className="divide-y divide-slate-100 banking-dark:divide-zinc-800">
                            {sortedProvisionItems.map((row) => (
                              <SortableProvisionRow
                                key={row.id}
                                row={row}
                                onTogglePaid={togglePaid}
                                onEdit={openProvisionEdit}
                                onRemove={removeProvision}
                              />
                            ))}
                          </tbody>
                        </SortableContext>
                      )}
                    </table>
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
                </div>
              )}
            </>
          )}
        </section>

        <section className={cardClass} aria-labelledby="sav-heading">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 id="sav-heading" className="text-lg font-semibold text-slate-900 banking-dark:text-zinc-100">
                Ahorro por objetivo
              </h2>
              <p className="mt-1 text-xs text-slate-500 banking-dark:text-zinc-500">
                El saldo es solo un registro tuyo (el dinero real sigue en la cuenta del banco). Al crear la meta, el saldo
                inicial queda registrado; después puedes sumar o restar con montos positivos o negativos.
              </p>
            </div>
            <button type="button" className={`${btnPrimary} shrink-0`} onClick={openNewSavingsModal}>
              Nuevo Objetivo
            </button>
          </div>

          {savingsGoals.length === 0 ? (
            <p className="text-sm text-slate-500 banking-dark:text-zinc-500">No hay metas de ahorro todavía.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {savingsGoals.map((g) => (
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
                        <p className="text-base font-bold tabular-nums text-teal-800 sm:text-lg banking-dark:text-amber-200">
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
                  </div>
                </li>
              ))}
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
                  <select
                    className={inputClass}
                    value={epAccountId === "" ? "" : String(epAccountId)}
                    onChange={(e) => setEpAccountId(e.target.value === "" ? "" : Number(e.target.value))}
                  >
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
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
                El saldo seguido no se edita aquí; usa los ajustes en la tarjeta.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className={labelClass}>Nombre del objetivo</label>
                  <input className={inputClass} value={svTitle} onChange={(e) => setSvTitle(e.target.value)} maxLength={512} />
                </div>
                <div>
                  <label className={labelClass}>Cuenta en la que ahorras</label>
                  <select
                    className={inputClass}
                    value={svAccountId === "" ? "" : String(svAccountId)}
                    onChange={(e) => setSvAccountId(e.target.value === "" ? "" : Number(e.target.value))}
                  >
                    <option value="">Selecciona…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
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
                  <select
                    className={inputClass}
                    value={newProvAccountId === "" ? "" : String(newProvAccountId)}
                    onChange={(e) => setNewProvAccountId(e.target.value === "" ? "" : Number(e.target.value))}
                  >
                    <option value="">—</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
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
                    <select
                      className={inputClass}
                      value={newSavAccountId === "" ? "" : String(newSavAccountId)}
                      onChange={(e) => setNewSavAccountId(e.target.value === "" ? "" : Number(e.target.value))}
                    >
                      <option value="">Selecciona…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
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
