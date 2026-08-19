/** Filtros de columnas y picker de visibilidad (extraídos de BankingTransactionsPage). */

import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BankingAccountRow, BankingCategoryRow } from "./types";
import {
  BANKING_TX_COLUMN_KEYS,
  BANKING_TX_COLUMN_LABELS,
  bankingMainTxFilterInputClass,
  bankingSwitchThumbClass,
  bankingSwitchTrackClass,
  bankingTxSortableColumnId,
  bankingTxThBaseClass,
  toggleEnumInList,
  toggleNumInSortedList,
  type BankingTxColumnKey,
  type BankingTxLiquidadoOption,
  type BankingTxSharedScopeOption,
  type BankingTxTcPaidOption,
} from "./bankingTxShared";
import { IconFilter, IconGripVertical } from "./bankingTxIcons";

export function BankingTxColumnVisibilityToggle({
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
      className={bankingSwitchTrackClass(on)}
    >
      <span className={bankingSwitchThumbClass(on)} />
    </button>
  );
}

export type BankingTxFilterUICtxValue = {
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

export const BankingTxFilterUICtx = createContext<BankingTxFilterUICtxValue | null>(null);

export function useBankingTxFilterUICtx(): BankingTxFilterUICtxValue {
  const v = useContext(BankingTxFilterUICtx);
  if (!v) throw new Error("BankingTx filter UI context missing");
  return v;
}

/** Chip de selección (tipo/liquidado/cargo TC): píldora en vez de fila rectangular. */
function bankingTxFilterChipClass(selected: boolean): string {
  return `rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
    selected
      ? "border-indigo-300 bg-indigo-50 text-indigo-700 banking-dark:border-indigo-500/40 banking-dark:bg-indigo-500/15 banking-dark:text-indigo-300"
      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 banking-dark:border-zinc-700 banking-dark:bg-zinc-900 banking-dark:text-zinc-300 banking-dark:hover:bg-zinc-800"
  }`;
}

const bankingTxFilterClearBtnClass =
  "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 banking-dark:border-zinc-700 banking-dark:bg-zinc-900 banking-dark:text-zinc-300 banking-dark:hover:bg-zinc-800";
const bankingTxFilterApplyBtnClass =
  "rounded-full bg-slate-900 px-4 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-slate-800 banking-dark:bg-amber-600 banking-dark:text-zinc-950 banking-dark:hover:bg-amber-500";

/** Pie común: Borrar (limpia y aplica) + Aplicar. */
function BankingTxFilterApplyBar({
  onClear,
  applyAsSubmit = false,
  onApply,
}: {
  onClear: () => void;
  /** Si true, el botón Aplicar es type=submit (form padre). */
  applyAsSubmit?: boolean;
  onApply?: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 banking-dark:border-zinc-800">
      <button type="button" onClick={onClear} className={bankingTxFilterClearBtnClass}>
        Borrar
      </button>
      <button
        type={applyAsSubmit ? "submit" : "button"}
        onClick={applyAsSubmit ? undefined : onApply}
        className={bankingTxFilterApplyBtnClass}
      >
        Aplicar
      </button>
    </div>
  );
}

export function BankingTxCategoryFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const sel = bankingMainTxFilterInputClass;
  const [query, setQuery] = useState("");
  /** Borrador local: el popover se desmonta al cerrar, así el draft se reinicia al reabrir. */
  const [draftIds, setDraftIds] = useState(() => [...ctx.filterCategoryIds]);
  const qNorm = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!qNorm) return ctx.filterCategoriesSorted;
    return ctx.filterCategoriesSorted.filter((c) => c.name.toLowerCase().includes(qNorm));
  }, [ctx.filterCategoriesSorted, qNorm]);

  const apply = useCallback(() => {
    ctx.setFilterCategoryIds([...draftIds]);
  }, [ctx, draftIds]);

  const clear = useCallback(() => {
    setDraftIds([]);
    ctx.setFilterCategoryIds([]);
  }, [ctx]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Categorías (varias)</span>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Buscar categoría</span>
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
            const picked = draftIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setDraftIds((prev) => toggleNumInSortedList(prev, c.id))}
                className={`flex w-full items-center rounded-xl border px-3 py-2 text-left text-sm font-medium text-slate-800 transition banking-dark:text-zinc-100 ${
                  picked ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200 banking-dark:border-indigo-500/40 banking-dark:bg-indigo-500/15 banking-dark:ring-indigo-500/25" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 banking-dark:border-zinc-700 banking-dark:bg-zinc-900 banking-dark:hover:bg-zinc-800"
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
        {ctx.filterCategoriesSorted.length === 0 ? (
          <p className="text-[12px] leading-snug text-slate-500">No hay categorías disponibles.</p>
        ) : filtered.length === 0 ? (
          <p className="text-[12px] leading-snug text-slate-500">
            Ninguna categoría coincide con «{query.trim()}».
          </p>
        ) : null}
      </div>
      <BankingTxFilterApplyBar onClear={clear} onApply={apply} />
    </div>
  );
}

export function BankingTxSubcategoryFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const sel = bankingMainTxFilterInputClass;
  const [query, setQuery] = useState("");
  const [draftIds, setDraftIds] = useState(() => [...ctx.filterSubcategoryIds]);
  const qNorm = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!qNorm) return ctx.filterSubcategoryDropdownRows;
    return ctx.filterSubcategoryDropdownRows.filter((r) => r.label.toLowerCase().includes(qNorm));
  }, [ctx.filterSubcategoryDropdownRows, qNorm]);

  const apply = useCallback(() => {
    ctx.setFilterSubcategoryIds([...draftIds]);
  }, [ctx, draftIds]);

  const clear = useCallback(() => {
    setDraftIds([]);
    ctx.setFilterSubcategoryIds([]);
  }, [ctx]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Subcategorías (varias)</span>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Buscar subcategoría</span>
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
            const picked = draftIds.includes(r.id);
            const shortLabel =
              ctx.filterCategoryIds.length !== 1 ? r.label : (r.label.split(" › ").pop() ?? r.label);
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => setDraftIds((prev) => toggleNumInSortedList(prev, r.id))}
                className={`flex w-full items-center rounded-xl border px-3 py-2 text-left text-sm font-medium text-slate-800 transition banking-dark:text-zinc-100 ${
                  picked ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200 banking-dark:border-indigo-500/40 banking-dark:bg-indigo-500/15 banking-dark:ring-indigo-500/25" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 banking-dark:border-zinc-700 banking-dark:bg-zinc-900 banking-dark:hover:bg-zinc-800"
                }`}
              >
                {shortLabel}
              </button>
            );
          })}
        </div>
        {ctx.filterSubcategoryDropdownRows.length === 0 ? (
          <p className="text-[12px] leading-snug text-slate-500">
            No hay subcategorías disponibles
            {ctx.filterCategoryIds.length > 0 ? " para las categorías seleccionadas." : "."}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-[12px] leading-snug text-slate-500">
            Ninguna subcategoría coincide con «{query.trim()}».
          </p>
        ) : null}
      </div>
      <BankingTxFilterApplyBar onClear={clear} onApply={apply} />
    </div>
  );
}

export function BankingTxDescriptionFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const sel = bankingMainTxFilterInputClass;
  const [draft, setDraft] = useState(ctx.filterDescription);

  const apply = useCallback(() => {
    const next = draft.trim();
    setDraft(next);
    ctx.setFilterDescription(next);
  }, [ctx, draft]);

  const clear = useCallback(() => {
    setDraft("");
    ctx.setFilterDescription("");
  }, [ctx]);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Contiene texto</span>
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Buscar en la descripción…"
          autoComplete="off"
          className={`${sel} mt-1`}
        />
      </label>
      <BankingTxFilterApplyBar onClear={clear} applyAsSubmit />
    </form>
  );
}

export function BankingTxDateFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const sel = bankingMainTxFilterInputClass;
  const [draftFrom, setDraftFrom] = useState(ctx.filterDateFrom);
  const [draftTo, setDraftTo] = useState(ctx.filterDateTo);

  const apply = useCallback(() => {
    ctx.setFilterDateFrom(draftFrom);
    ctx.setFilterDateTo(draftTo);
  }, [ctx, draftFrom, draftTo]);

  const clear = useCallback(() => {
    setDraftFrom("");
    setDraftTo("");
    ctx.setFilterDateFrom("");
    ctx.setFilterDateTo("");
  }, [ctx]);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Fecha desde</span>
        <input
          type="date"
          value={draftFrom}
          onChange={(e) => setDraftFrom(e.target.value)}
          className={`${sel} mt-1 cursor-pointer`}
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Fecha hasta</span>
        <input
          type="date"
          value={draftTo}
          onChange={(e) => setDraftTo(e.target.value)}
          className={`${sel} mt-1 cursor-pointer`}
        />
      </label>
      <BankingTxFilterApplyBar onClear={clear} applyAsSubmit />
    </form>
  );
}

export function BankingTxAmountFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const sel = bankingMainTxFilterInputClass;
  const [draftMin, setDraftMin] = useState(ctx.filterAmountMin);
  const [draftMax, setDraftMax] = useState(ctx.filterAmountMax);

  const apply = useCallback(() => {
    const nextMin = draftMin.trim();
    const nextMax = draftMax.trim();
    setDraftMin(nextMin);
    setDraftMax(nextMax);
    ctx.setFilterAmountMin(nextMin);
    ctx.setFilterAmountMax(nextMax);
  }, [ctx, draftMin, draftMax]);

  const clear = useCallback(() => {
    setDraftMin("");
    setDraftMax("");
    ctx.setFilterAmountMin("");
    ctx.setFilterAmountMax("");
  }, [ctx]);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Monto mínimo</span>
        <input
          inputMode="decimal"
          value={draftMin}
          onChange={(e) => setDraftMin(e.target.value)}
          placeholder="Ej. -50000"
          className={`${sel} mt-1`}
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Monto máximo</span>
        <input
          inputMode="decimal"
          value={draftMax}
          onChange={(e) => setDraftMax(e.target.value)}
          placeholder="Ej. 250000"
          className={`${sel} mt-1`}
        />
      </label>
      <BankingTxFilterApplyBar onClear={clear} applyAsSubmit />
    </form>
  );
}

export function BankingTxProductFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const [draftIds, setDraftIds] = useState(() => [...ctx.filterAccountIds]);

  const apply = useCallback(() => {
    ctx.setFilterAccountIds([...draftIds]);
  }, [ctx, draftIds]);

  const clear = useCallback(() => {
    setDraftIds([]);
    ctx.setFilterAccountIds([]);
  }, [ctx]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Productos (varios)</span>
        <div className="mt-1 max-h-[min(50vh,280px)] space-y-1 overflow-y-auto pr-0.5 tx-scroll">
          {ctx.filterAccountsSorted.map((a) => {
            const picked = draftIds.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setDraftIds((prev) => toggleNumInSortedList(prev, a.id))}
                className={`flex w-full items-center rounded-xl border px-3 py-2 text-left text-sm transition banking-dark:text-zinc-100 ${
                  picked ? "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200 banking-dark:border-indigo-500/40 banking-dark:bg-indigo-500/15 banking-dark:ring-indigo-500/25" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 banking-dark:border-zinc-700 banking-dark:bg-zinc-900 banking-dark:hover:bg-zinc-800"
                }`}
              >
                <span className={picked ? "font-semibold text-indigo-700 banking-dark:text-indigo-300" : "text-slate-800 banking-dark:text-zinc-100"}>{a.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <BankingTxFilterApplyBar onClear={clear} onApply={apply} />
    </div>
  );
}

export function BankingTxSharedScopeFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const [draft, setDraft] = useState(() => [...ctx.filterSharedScopes]);

  const apply = useCallback(() => {
    ctx.setFilterSharedScopes([...draft]);
  }, [ctx, draft]);

  const clear = useCallback(() => {
    setDraft([]);
    ctx.setFilterSharedScopes([]);
  }, [ctx]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Tipo (varios)</span>
        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDraft((prev) => toggleEnumInList(prev, "personal"))}
            className={bankingTxFilterChipClass(draft.includes("personal"))}
          >
            Solo personal
          </button>
          <button
            type="button"
            onClick={() => setDraft((prev) => toggleEnumInList(prev, "shared_any"))}
            className={bankingTxFilterChipClass(draft.includes("shared_any"))}
          >
            Solo compartido
          </button>
        </div>
        <p className="text-[11px] text-slate-400 banking-dark:text-zinc-500">Sin selección = mostrar todos. Varios = unión (cualquiera).</p>
      </div>
      <BankingTxFilterApplyBar onClear={clear} onApply={apply} />
    </div>
  );
}

export function BankingTxLiquidadoFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const [draft, setDraft] = useState(() => [...ctx.filterLiquidadoValues]);

  const apply = useCallback(() => {
    ctx.setFilterLiquidadoValues([...draft]);
  }, [ctx, draft]);

  const clear = useCallback(() => {
    setDraft([]);
    ctx.setFilterLiquidadoValues([]);
  }, [ctx]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Valor en tabla (varios)</span>
        <div className="mt-1 flex flex-wrap gap-2">
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
              onClick={() => setDraft((prev) => toggleEnumInList(prev, val))}
              className={bankingTxFilterChipClass(draft.includes(val))}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 banking-dark:text-zinc-500">Sin selección = todos. Varios = unión.</p>
      </div>
      <BankingTxFilterApplyBar onClear={clear} onApply={apply} />
    </div>
  );
}

export function BankingTxTcPaidFilterBody() {
  const ctx = useBankingTxFilterUICtx();
  const [draft, setDraft] = useState(() => [...ctx.filterTcPaidValues]);

  const apply = useCallback(() => {
    ctx.setFilterTcPaidValues([...draft]);
  }, [ctx, draft]);

  const clear = useCallback(() => {
    setDraft([]);
    ctx.setFilterTcPaidValues([]);
  }, [ctx]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">Valor en tabla (varios)</span>
        <div className="mt-1 flex flex-wrap gap-2">
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
              onClick={() => setDraft((prev) => toggleEnumInList(prev, val))}
              className={bankingTxFilterChipClass(draft.includes(val))}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 banking-dark:text-zinc-500">Sin selección = todos. Varios = unión.</p>
      </div>
      <BankingTxFilterApplyBar onClear={clear} onApply={apply} />
    </div>
  );
}

export function BankingTxColumnHeader({ colKey }: { colKey: BankingTxColumnKey }) {
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
          open
            ? "bg-slate-100 ring-1 ring-inset ring-slate-300 banking-dark:bg-zinc-900 banking-dark:ring-zinc-600"
            : "hover:bg-slate-50 banking-dark:hover:bg-zinc-900/80"
        }`}
      >
        <span
          className={`block ${titleSize} font-semibold uppercase tracking-wide text-slate-700 banking-dark:text-zinc-200`}
        >
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

export function BankingTxHeaderFilterFields({ colKey }: { colKey: BankingTxColumnKey }) {
  switch (colKey) {
    case "fecha":
      return <BankingTxDateFilterBody />;
    case "descripcion":
      return <BankingTxDescriptionFilterBody />;
    case "producto":
      return <BankingTxProductFilterBody />;
    case "monto":
      return <BankingTxAmountFilterBody />;
    case "categoria":
      return <BankingTxCategoryFilterBody />;
    case "subcategoria":
      return <BankingTxSubcategoryFilterBody />;
    case "tipo_movimiento":
      return <BankingTxSharedScopeFilterBody />;
    case "compartido_liquidado":
      return <BankingTxLiquidadoFilterBody />;
    case "cargo_tc":
      return <BankingTxTcPaidFilterBody />;
    default:
      return null;
  }
}

/** Botón «Filtros» + panel único con todos los filtros apilados (reemplaza el filtro por columna de la tabla). */
export function BankingTxFiltersPanelButton() {
  const ctx = useBankingTxFilterUICtx();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<BankingTxColumnKey | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeCount = useMemo(
    () => BANKING_TX_COLUMN_KEYS.filter((k) => ctx.isColumnFilterActive(k)).length,
    [ctx],
  );

  useEffect(() => {
    if (!open) return;
    function handleDown(e: MouseEvent) {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="banking-tx-filters-panel"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:hover:border-zinc-500 banking-dark:hover:bg-zinc-800"
      >
        <IconFilter className="h-4 w-4 text-slate-400 banking-dark:text-zinc-500" />
        Filtros
        {activeCount > 0 ? (
          <span className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-bold leading-none text-white banking-dark:bg-amber-500 banking-dark:text-zinc-950">
            {activeCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id="banking-tx-filters-panel"
          role="dialog"
          aria-label="Filtros de movimientos"
          className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[min(calc(100vw-2rem),22rem)] max-h-[min(75vh,32rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-300/30 tx-scroll banking-dark:border-zinc-700 banking-dark:bg-zinc-900 banking-dark:shadow-black/40"
        >
          <ul className="space-y-1">
            {BANKING_TX_COLUMN_KEYS.map((k) => {
              const active = ctx.isColumnFilterActive(k);
              const isOpen = expanded === k;
              return (
                <li key={k} className="list-none">
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => (prev === k ? null : k))}
                    aria-expanded={isOpen}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition ${
                      isOpen
                        ? "bg-slate-100 text-slate-900 banking-dark:bg-zinc-800 banking-dark:text-zinc-100"
                        : "text-slate-700 hover:bg-slate-50 banking-dark:text-zinc-300 banking-dark:hover:bg-zinc-900/70"
                    }`}
                  >
                    <span>{BANKING_TX_COLUMN_LABELS[k]}</span>
                    {active ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500 banking-dark:bg-indigo-400" aria-hidden />
                    ) : null}
                  </button>
                  {isOpen ? (
                    <div className="px-2.5 pb-2 pt-2">
                      <BankingTxHeaderFilterFields colKey={k} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Píldora Sí / No / — para columnas Compartido liquidado y Cargo TC. */
export function BankingTxSiNoDashBadge({ text }: { text: string }) {
  if (text === "—") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-slate-400 banking-dark:bg-zinc-800 banking-dark:text-zinc-500">
        —
      </span>
    );
  }
  if (text === "Sí") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-600 banking-dark:bg-emerald-500/15 banking-dark:text-emerald-300">
        Sí
      </span>
    );
  }
  if (text === "No") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600 banking-dark:bg-rose-500/15 banking-dark:text-rose-300">
        No
      </span>
    );
  }
  return <span className="text-[12px] text-slate-500 banking-dark:text-zinc-400">{text}</span>;
}

export function SortableBankingTxColumnPickerRow({
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
      <div className="flex items-center gap-2 rounded-lg border border-transparent px-1 py-1.5 transition hover:border-slate-300 hover:bg-slate-50 banking-dark:hover:border-zinc-700 banking-dark:hover:bg-zinc-900/70">
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="inline-flex shrink-0 cursor-grab touch-manipulation rounded-md p-1 text-slate-400 hover:bg-slate-200/80 hover:text-slate-800 active:cursor-grabbing banking-dark:text-zinc-500 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-200"
          aria-label={`Arrastrar ${label}`}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800 banking-dark:text-zinc-200">{label}</span>
        {requiredCol ? (
          <span className="shrink-0 rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-400">
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

