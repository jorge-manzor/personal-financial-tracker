import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
import { formatClpDots, parseChileanAmountInput } from "./format";
import { BANKING_MAIN_TX_CARD_CLASS, BANKING_MAIN_TX_ROW_CLASS } from "./bankingTxShared";
import {
  AccountSelect,
  RowActionsMenu,
  btnPrimary,
  btnSecondary,
  cardClass,
  inputClass,
  labelClass,
  modalBackdropClass,
  modalPanelClass,
} from "./bankingPersonalOrderShared";
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

/** Filtros popover provisiones — alineado con tabla movimientos bancarios. */
const bankingProvFilterInputClass =
  "mt-1 w-full rounded-xl border border-[#DCD3C2] bg-white px-2.5 py-2 text-sm text-[#2B2620] shadow-sm outline-none transition placeholder:text-[#9A9284] focus:border-[#8FBFA6] focus:ring-2 focus:ring-[#8FBFA6]/25 [color-scheme:light] banking-dark:border-[#30363d] banking-dark:bg-[#161b22] banking-dark:text-[#F3F1EC] banking-dark:placeholder:text-[#6b7280] banking-dark:focus:border-[#8FBFA6] banking-dark:focus:ring-[#8FBFA6]/15";

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
          ? "border-[#8FBFA6] bg-[#8FBFA6]/15 text-[#3F6B52] banking-dark:bg-[#8FBFA6]/12 banking-dark:text-[#8FBFA6]"
          : open
            ? "border-[#DCD3C2] bg-[#F5F1E8] text-[#2B2620] banking-dark:border-[#30363d] banking-dark:bg-[#161b22] banking-dark:text-[#F3F1EC]"
            : "border-[#E8E1D4] bg-white text-[#4A453C] hover:border-[#DCD3C2] hover:bg-[#F5F1E8] banking-dark:border-[#1e242e] banking-dark:bg-[#12161d] banking-dark:text-[#c9d1d9] banking-dark:hover:border-[#30363d]"
      }`}
    >
      {label}
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-[#8FBFA6]" : "bg-[#DCD3C2] banking-dark:bg-[#30363d]"}`}
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
        <span className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">Contiene texto en etiqueta</span>
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
        <span className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">Etiquetas en los ítems (varias)</span>
        <button
          type="button"
          onClick={() => setFilterLabelTokens([])}
          className="rounded-lg border border-[#DCD3C2] bg-white px-2 py-1 text-[11px] font-medium text-[#4A453C] transition hover:bg-[#8FBFA6]/10 banking-dark:border-[#30363d] banking-dark:bg-[#161b22] banking-dark:text-[#c9d1d9] banking-dark:hover:bg-[#1c2129]"
        >
          Borrar selección
        </button>
      </div>
      <label className="block">
        <span className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">Buscar etiqueta</span>
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
            onClick={() => setFilterLabelTokens((prev) => toggleStrSorted(prev, PROVISION_LABEL_NONE))}
            className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm font-medium transition hover:bg-[#8FBFA6]/10 banking-dark:hover:bg-[#1c2129] ${
              filterLabelTokens.includes(PROVISION_LABEL_NONE)
                ? "border-[#8FBFA6] bg-[#8FBFA6]/10 ring-1 ring-[#8FBFA6]/50 banking-dark:border-[#8FBFA6]/60 banking-dark:bg-[#161b22]"
                : "border border-[#DCD3C2] bg-white banking-dark:border-[#30363d] banking-dark:bg-[#0d1117]"
            }`}
          >
            <span className="text-[#4A453C] banking-dark:text-[#c9d1d9]">Sin etiqueta</span>
          </button>
        ) : null}
        {filtered.map((lab) => {
          const picked = filterLabelTokens.includes(lab);
          return (
            <button
              key={lab}
              type="button"
              onClick={() => setFilterLabelTokens((prev) => toggleStrSorted(prev, lab))}
              className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm font-medium text-[#2B2620] transition hover:bg-[#8FBFA6]/10 banking-dark:text-[#F3F1EC] banking-dark:hover:bg-[#1c2129] ${
                picked
                  ? "border-[#8FBFA6] bg-[#8FBFA6]/10 ring-1 ring-[#8FBFA6]/50 banking-dark:border-[#8FBFA6]/60 banking-dark:bg-[#161b22]"
                  : "border border-[#DCD3C2] bg-white banking-dark:border-[#30363d] banking-dark:bg-[#0d1117]"
              }`}
            >
              {lab}
            </button>
          );
        })}
      </div>
      {distinctLabels.length === 0 && !showNoneOption ? (
        <p className="text-[12px] leading-snug text-[#8A8072] banking-dark:text-[#8b949e]">
          No hay etiquetas en los ítems todavía.
        </p>
      ) : filtered.length === 0 && qNorm ? (
        <p className="text-[12px] leading-snug text-[#8A8072] banking-dark:text-[#8b949e]">
          Ninguna etiqueta coincide con «{query.trim()}».
        </p>
      ) : null}
      <p className="text-[11px] text-[#8A8072] banking-dark:text-[#8b949e]">
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
          <span className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">Estado (varios)</span>
          <div className="mt-1 flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setFilterPaidScopes((prev) => toggleEnumInList(prev, "unpaid"))}
              className={`rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-[#8FBFA6]/10 banking-dark:hover:bg-[#1c2129] ${
                filterPaidScopes.includes("unpaid")
                  ? "border-[#8FBFA6] bg-[#8FBFA6]/10 ring-1 ring-[#8FBFA6]/50 banking-dark:border-[#8FBFA6]/60 banking-dark:bg-[#161b22]"
                  : "border-[#DCD3C2] bg-white banking-dark:border-[#30363d] banking-dark:bg-[#0d1117]"
              }`}
            >
              No pagado
            </button>
            <button
              type="button"
              onClick={() => setFilterPaidScopes((prev) => toggleEnumInList(prev, "paid"))}
              className={`rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-[#8FBFA6]/10 banking-dark:hover:bg-[#1c2129] ${
                filterPaidScopes.includes("paid")
                  ? "border-[#8FBFA6] bg-[#8FBFA6]/10 ring-1 ring-[#8FBFA6]/50 banking-dark:border-[#8FBFA6]/60 banking-dark:bg-[#161b22]"
                  : "border-[#DCD3C2] bg-white banking-dark:border-[#30363d] banking-dark:bg-[#0d1117]"
              }`}
            >
              Pagado
            </button>
          </div>
          <p className="text-[11px] text-[#8A8072] banking-dark:text-[#8b949e]">Sin selección = todos. Varios = unión.</p>
        </div>
      );
    case "descripcion":
      return (
        <label className="block">
          <span className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">Contiene texto</span>
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
            <span className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">Monto mínimo (CLP)</span>
            <input
              inputMode="decimal"
              value={filterAmountMin}
              onChange={(e) => setFilterAmountMin(e.target.value)}
              placeholder="Ej. 5000"
              className={`${sel} mt-1`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">Monto máximo (CLP)</span>
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
            <span className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">Cuentas (varias)</span>
            <button
              type="button"
              onClick={() => {
                setFilterAccountIds([]);
                setFilterAccountNull(false);
              }}
              className="rounded-lg border border-[#DCD3C2] bg-white px-2 py-1 text-[11px] font-medium text-[#4A453C] transition hover:bg-[#8FBFA6]/10 banking-dark:border-[#30363d] banking-dark:bg-[#161b22] banking-dark:text-[#c9d1d9] banking-dark:hover:bg-[#1c2129]"
            >
              Borrar selección
            </button>
          </div>
          <div className="mt-1 max-h-[min(50vh,280px)] space-y-1 overflow-y-auto pr-0.5 tx-scroll">
            <button
              type="button"
              onClick={() => setFilterAccountNull((prev) => !prev)}
              className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-[#8FBFA6]/10 banking-dark:hover:bg-[#1c2129] ${
                filterAccountNull
                  ? "border-[#8FBFA6] bg-[#8FBFA6]/10 ring-1 ring-[#8FBFA6]/50 banking-dark:border-[#8FBFA6]/60 banking-dark:bg-[#161b22]"
                  : "border border-[#DCD3C2] bg-white banking-dark:border-[#30363d] banking-dark:bg-[#0d1117]"
              }`}
            >
              <span className={filterAccountNull ? "font-semibold text-[#3F6B52] banking-dark:text-[#8FBFA6]" : "text-[#2B2620] banking-dark:text-[#F3F1EC]"}>
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
                  className={`flex w-full items-center rounded-lg border px-2 py-2 text-left text-sm transition hover:bg-[#8FBFA6]/10 banking-dark:hover:bg-[#1c2129] ${
                    picked
                      ? "border-[#8FBFA6] bg-[#8FBFA6]/10 ring-1 ring-[#8FBFA6]/50 banking-dark:border-[#8FBFA6]/60 banking-dark:bg-[#161b22]"
                      : "border border-[#DCD3C2] bg-white banking-dark:border-[#30363d] banking-dark:bg-[#0d1117]"
                  }`}
                >
                  <span className={picked ? "font-semibold text-[#3F6B52] banking-dark:text-[#8FBFA6]" : "text-[#2B2620] banking-dark:text-[#F3F1EC]"}>
                    {a.name}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[#8A8072] banking-dark:text-[#8b949e]">Sin selección = todas. Varios = unión.</p>
        </div>
      );
    default:
      return null;
  }
}

function GripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 6a2 2 0 11-4 0 2 2 0 014 0zM8 12a2 2 0 11-4 0 2 2 0 014 0zM8 18a2 2 0 11-4 0 2 2 0 014 0zM20 6a2 2 0 11-4 0 2 2 0 014 0zM20 12a2 2 0 11-4 0 2 2 0 014 0zM20 18a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function PaidToggleButton({ paid, onToggle }: { paid: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={paid}
      title={paid ? "Clic para marcar como no pagado" : "Clic para marcar como pagado"}
      onClick={onToggle}
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors ${
        paid
          ? "bg-[#8FBFA6] text-[#1F2E25] shadow-sm hover:bg-[#7FB097]"
          : "border border-[#a5677a] bg-[#cc8e9e] text-[#2a1216] shadow-sm hover:bg-[#c17e90]"
      }`}
    >
      {paid ? "PAGADO" : "NO PAGADO"}
    </button>
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
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#C79A56]/15 text-[13px] font-bold text-[#8A6631] banking-dark:text-[#C79A56]"
        aria-hidden
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`line-clamp-2 break-words text-[13px] font-semibold leading-snug [overflow-wrap:anywhere] ${
            row.paid
              ? "text-[#B8AFA0] line-through banking-dark:text-[#5b6472]"
              : "text-[#2B2620] banking-dark:text-[#F3F1EC]"
          }`}
        >
          {row.description}
        </p>
        <p className="mt-0.5 truncate text-[11.5px] text-[#9A9284] banking-dark:text-[#6b7280]">
          {row.category_label?.trim() ? row.category_label : "Sin etiqueta"}
          {row.account_name ? ` · ${row.account_name}` : ""}
        </p>
      </div>
      <div className="w-24 shrink-0 text-right">
        {row.amount_clp != null ? (
          <span className="text-[13px] font-bold tabular-nums text-[#2B2620] banking-dark:text-[#F3F1EC]">
            {formatClpDots(row.amount_clp)}
          </span>
        ) : (
          <span className="text-[13px] text-[#9A9284] banking-dark:text-[#6b7280]">—</span>
        )}
      </div>
      <div className="flex w-[118px] shrink-0 justify-center">
        <PaidToggleButton paid={row.paid} onToggle={() => onTogglePaid(row)} />
      </div>
      <RowActionsMenu
        ariaLabel={`Acciones: ${row.description.slice(0, 80)}`}
        onEdit={() => onEdit(row)}
        onRemove={() => void onRemove(row.id)}
      />
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
        className="flex shrink-0 cursor-grab touch-none items-center justify-center rounded-lg p-1.5 text-[#C7BFAF] hover:bg-[#F5F1E8] hover:text-[#4A453C] active:cursor-grabbing banking-dark:text-[#4b5361] banking-dark:hover:bg-[#161b22] banking-dark:hover:text-[#c9d1d9]"
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
          color="sage"
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
        color="sage"
        aria-label={`Seleccionar provisión: ${row.description.slice(0, 80)}`}
      />
      <ProvisionRowInner row={row} onTogglePaid={onTogglePaid} onEdit={onEdit} onRemove={onRemove} />
    </div>
  );
}

export function BankingProvisionsPage({ onToast }: { onToast: (msg: string | null) => void }) {
  const [accounts, setAccounts] = useState<BankingAccountRow[]>([]);
  const [provisionItems, setProvisionItems] = useState<PersonalProvisionItem[]>([]);
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

  const [editingProvision, setEditingProvision] = useState<PersonalProvisionItem | null>(null);
  const [epDesc, setEpDesc] = useState("");
  const [epLabel, setEpLabel] = useState("");
  const [epAmount, setEpAmount] = useState("");
  const [epAccountId, setEpAccountId] = useState<number | "">("");

  const [newProvisionModalOpen, setNewProvisionModalOpen] = useState(false);
  const [registerMovesModalOpen, setRegisterMovesModalOpen] = useState(false);
  const [registerMovesYm, setRegisterMovesYm] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [registerMovesSaving, setRegisterMovesSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const loadAll = useCallback(async () => {
    const [acc, prov] = await Promise.all([
      fetchJson<BankingAccountRow[]>("/banking/accounts"),
      fetchJson<PersonalProvisionItem[]>("/banking/personal-order/provision-items"),
    ]);
    setAccounts(acc.filter((a) => (a.enabled ?? true) !== false));
    setProvisionItems(prov);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadAll()
      .catch((e) => {
        console.error(e);
        if (!cancelled) onToast("No se pudo cargar Provisiones.");
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
    if (!editingProvision && !newProvisionModalOpen && !registerMovesModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setEditingProvision(null);
        setNewProvisionModalOpen(false);
        setRegisterMovesModalOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingProvision, newProvisionModalOpen, registerMovesModalOpen]);

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
      rows = rows.filter((r) => filterPaidScopes.some((scope) => (scope === "paid" ? r.paid : !r.paid)));
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
        return filterLabelTokens.some((tok) => (tok === PROVISION_LABEL_NONE ? isNone : lab === tok));
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
    setRegisterMovesYm(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    });
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
        const more = out.messages.length > 4 ? ` …(+${out.messages.length - 4} aviso(s))` : "";
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

  const pageShell =
    "banking-theme w-full min-h-[calc(100dvh-3.5rem)] bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(199,154,86,0.09),transparent_52%),linear-gradient(to_bottom,#FAF7F1,#F5F1E8)] text-[#4A453C] banking-dark:bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(143,191,166,0.06),transparent_52%),linear-gradient(to_bottom,#0d1117,#0a0d12)] banking-dark:text-[#c9d1d9]";
  const innerClass = "mx-auto max-w-[1100px] space-y-10 p-4 pb-28 md:p-6";

  if (loading) {
    return (
      <div className={pageShell}>
        <div className={innerClass}>
          <p className="text-sm text-[#8A8072] banking-dark:text-[#8b949e]">Cargando…</p>
        </div>
      </div>
    );
  }

  const sortableIds = sortedProvisionItems.map((r) => String(r.id));

  return (
    <div className={pageShell}>
      <div className={innerClass}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#2B2620] banking-dark:text-[#F3F1EC]">Provisiones</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#4A453C] banking-dark:text-[#c9d1d9]">
              Recordatorios que no modifican tu libro bancario. La etiqueta es texto libre (ej. «Streaming», «Seguros»)
              y el monto es solo orientativo. Lo que guardas queda almacenado en el servidor asociado a tu usuario.
            </p>
          </div>
          <button type="button" className={`${btnPrimary} shrink-0`} onClick={openNewProvisionModal}>
            Nueva Provisión
          </button>
        </header>

        <section className={cardClass} aria-labelledby="prov-heading">
          <h2 id="prov-heading" className="mb-4 text-lg font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
            Tus provisiones
          </h2>

          {provisionItems.length === 0 ? (
            <p className="text-sm text-[#8A8072] banking-dark:text-[#8b949e]">No hay ítems todavía.</p>
          ) : (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-[#F0EAE0] pb-3 banking-dark:border-[#1a1f2e]">
                <p className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">
                  {columnFiltersActive ? (
                    <>
                      Mostrando <strong>{filteredProvisionItems.length}</strong> de {provisionItems.length} ·{" "}
                      <span className="text-[#8A6631] banking-dark:text-[#C79A56]">
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
                <p className="text-sm text-[#8A8072] banking-dark:text-[#8b949e]">
                  Ningún ítem coincide con los filtros. Abre cada columna con «Filtrar» y limpia lo que necesites.
                </p>
              ) : (
                <>
                  {provisionSelectionStats.sel > 0 ? (
                    <div
                      className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#8FBFA6] bg-[#8FBFA6]/[0.14] px-3 py-2.5 text-sm banking-dark:bg-[#8FBFA6]/10"
                      role="status"
                      aria-live="polite"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[#3F6B52] banking-dark:text-[#8FBFA6]">
                          Selección: <strong>{provisionSelectionStats.sel}</strong>{" "}
                          {provisionSelectionStats.sel === 1 ? "ítem visible" : "ítems visibles"}
                        </p>
                        <p className="mt-0.5 tabular-nums text-[#4C7A64] banking-dark:text-[#a9d3bd]">
                          Suma montos ref.: <strong>{formatClpDots(provisionSelectionStats.sum)}</strong>
                          {provisionSelectionStats.selWithoutAmount > 0 ? (
                            <span className="ml-2 font-normal text-[#4C7A64]/90 banking-dark:text-[#8b949e]">
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
                    <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#E8E1D4] bg-white py-1 pl-1.5 pr-2.5 shadow-sm banking-dark:border-[#1e242e] banking-dark:bg-[#12161d]">
                      <BankingAuxRoundCheckbox
                        checked={allVisibleProvisionsSelected}
                        indeterminate={provisionSelectionStats.sel > 0 && !allVisibleProvisionsSelected}
                        onChange={toggleSelectAllVisibleProvisions}
                        color="sage"
                        title={allVisibleProvisionsSelected ? "Desmarcar todas las visibles" : "Seleccionar todas las visibles"}
                        aria-label={
                          columnFiltersActive
                            ? "Seleccionar todas las provisiones que ves con el filtro actual"
                            : "Seleccionar todas las provisiones de la lista"
                        }
                      />
                      <span className="text-[11px] font-semibold text-[#8A8072] banking-dark:text-[#8b949e]">Todos</span>
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
                          className="banking-theme rounded-xl border border-[#DCD3C2] bg-white p-3 shadow-xl shadow-[#2B2620]/10 ring-1 ring-[#DCD3C2] banking-dark:border-[#30363d] banking-dark:bg-[#161b22] banking-dark:shadow-black/40 banking-dark:ring-[#30363d]"
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
              <h3 id="edit-prov-title" className="text-lg font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                Editar recordatorio
              </h3>
              <div className="mt-4 space-y-3">
                <div>
                  <label className={labelClass}>Descripción</label>
                  <input className={inputClass} value={epDesc} onChange={(e) => setEpDesc(e.target.value)} maxLength={4000} />
                </div>
                <div>
                  <label className={labelClass}>Etiqueta libre (opcional)</label>
                  <input className={inputClass} value={epLabel} onChange={(e) => setEpLabel(e.target.value)} maxLength={255} />
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
              <h3 id="reg-moves-modal-title" className="text-lg font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                Registrar en movimientos bancarios
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#4A453C] banking-dark:text-[#c9d1d9]">
                Se creará un movimiento por cada ítem seleccionado en esta vista: categoría <strong>Provisiones</strong>,
                monto <strong>negativo</strong> según el monto de referencia, <strong>fecha de hoy</strong> y{" "}
                <strong>mes contable</strong> el que elijas abajo. En tarjeta de crédito el cargo queda{" "}
                <strong>sin pagar</strong> para que puedas gestionarlo en Movimientos bancarios.
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
              <h3 id="new-prov-modal-title" className="text-lg font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
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
                  <AccountSelect value={newProvAccountId} onChange={setNewProvAccountId} accounts={accounts} placeholder="—" />
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
      </div>
    </div>
  );
}
