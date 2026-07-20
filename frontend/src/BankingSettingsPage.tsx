import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiFetch, fetchJson, patchJson, postJson } from "./api";
import { BankingThemeToggle, useBankingTheme } from "./BankingThemeContext";
import type {
  BankingAccountRow,
  BankingBankRow,
  BankingCategoryRow,
  BankingProductType,
  BankingSubcategoryRow,
} from "./types";

/** Coincide con `backend` `_BANK_CAT_DEFAULT`: coral / rojizo para categorías nuevas. */
const BANKING_DEFAULT_NEW_CATEGORY_COLOR = "#ff7b72";

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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function softCategorySurface(hex: string): CSSProperties {
  const rgb = hexToRgb(hex) ?? { r: 88, g: 166, b: 255 };
  const { r, g, b } = rgb;
  return {
    backgroundImage: `linear-gradient(105deg, rgba(${r},${g},${b},0.16) 0%, rgba(${r},${g},${b},0.06) 38%, transparent 70%)`,
    boxShadow: `inset 0 0 0 1px rgba(${r},${g},${b},0.14), inset 0 0 28px -12px rgba(${r},${g},${b},0.12)`,
  };
}

function IconChevronDown({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

/** Asa para reordenar categorías (mismo orden que en movimientos). */
function IconGripVertical({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M8 6a2 2 0 11-4 0 2 2 0 014 0zM8 12a2 2 0 11-4 0 2 2 0 014 0zM8 18a2 2 0 11-4 0 2 2 0 014 0zM20 6a2 2 0 11-4 0 2 2 0 014 0zM20 12a2 2 0 11-4 0 2 2 0 014 0zM20 18a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

/** Activo/inactivo para categoría o subcategoría (`role="switch"`, no checkbox). */
function BankingEnabledToggle({
  enabled,
  disabled,
  onChange,
  title,
  ariaLabel,
}: {
  enabled: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  title: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onChange(!enabled);
      }}
      className={`inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full border p-[3px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-white banking-dark:focus-visible:ring-amber-500/40 banking-dark:focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 ${
        enabled
          ? "justify-end border-teal-400 bg-teal-500 shadow-sm banking-dark:border-amber-600 banking-dark:bg-amber-600"
          : "justify-start border-slate-300 bg-slate-100 banking-dark:border-zinc-600 banking-dark:bg-zinc-800"
      }`}
    >
      <span className="pointer-events-none block h-3.5 w-3.5 shrink-0 rounded-full bg-white shadow" />
    </button>
  );
}

/** Vista flotante mientras se arrastra: mismo ancho que la lista y altura similar si está expandida. */
function CategoryDragPreview({ cat, expanded }: { cat: BankingCategoryRow; expanded: boolean }) {
  return (
    <div
      className="pointer-events-none box-border w-full min-w-[min(100%,42rem)] max-w-full cursor-grabbing overflow-hidden rounded-xl border border-teal-200 bg-white shadow-2xl shadow-teal-900/15 ring-2 ring-teal-200/80 banking-dark:border-amber-700/40 banking-dark:bg-zinc-900 banking-dark:shadow-black/40 banking-dark:ring-amber-600/25"
      style={softCategorySurface(cat.color)}
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <IconGripVertical className="h-4 w-4 shrink-0 text-slate-500 banking-dark:text-zinc-400" />
        <span className="min-w-0 flex-1 text-sm font-medium leading-snug" style={{ color: cat.color }}>
          {cat.name}
        </span>
        <span className="shrink-0 text-xs text-slate-500 banking-dark:text-zinc-400">
          ({cat.subcategories.length})
        </span>
      </div>
      {expanded ? (
        <div className="border-t border-slate-300 px-4 py-2.5 text-[11px] leading-relaxed text-slate-500 banking-dark:border-zinc-600 banking-dark:text-zinc-400">
          {cat.subcategories.length} subcategorías · arrastra el asa ⋮⋮ para orden (también en movimientos)
        </div>
      ) : null}
    </div>
  );
}

type SortableDragHandleProps = {
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  attributes: DraggableAttributes;
  listeners: Record<string, unknown> | undefined;
};

function SortableCategoryWrapper({
  id,
  disabled,
  children,
}: {
  id: number;
  disabled: boolean;
  children: (handle: SortableDragHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
    transition: {
      duration: 320,
      easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
    },
  });
  const opacityEase = "cubic-bezier(0.25, 0.1, 0.25, 1)";
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition
      ? `${transition}, opacity 220ms ${opacityEase}`
      : `opacity 220ms ${opacityEase}`,
    opacity: isDragging ? 0.28 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {children({
        setActivatorNodeRef,
        attributes,
        listeners: listeners as Record<string, unknown> | undefined,
      })}
    </div>
  );
}

function subSortableId(subId: number): UniqueIdentifier {
  return `sub-${subId}`;
}

function parseSubSortableId(id: UniqueIdentifier): number | null {
  const s = String(id);
  if (!s.startsWith("sub-")) return null;
  const n = Number(s.slice(4));
  return Number.isFinite(n) ? n : null;
}

/** Fila sortable de subcategoría (ids con prefijo `sub-` para no chocar con ids de categoría). */
function SortableSubcategoryWrapper({
  subId,
  disabled,
  children,
}: {
  subId: number;
  disabled: boolean;
  children: (handle: SortableDragHandleProps) => ReactNode;
}) {
  const id = subSortableId(subId);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
    transition: {
      duration: 280,
      easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
    },
  });
  const opacityEase = "cubic-bezier(0.25, 0.1, 0.25, 1)";
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition
      ? `${transition}, opacity 220ms ${opacityEase}`
      : `opacity 220ms ${opacityEase}`,
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="relative list-none">
      {children({
        setActivatorNodeRef,
        attributes,
        listeners: listeners as Record<string, unknown> | undefined,
      })}
    </li>
  );
}

/** El asa de arrastre: hay que encadenar los handlers de dnd-kit con stopPropagation (si no, React los pisa). */
function CategoryDragHandleButton({
  attributes,
  listeners,
  setActivatorNodeRef,
  disabled,
  title,
  "aria-label": ariaLabel,
  className,
  children,
}: {
  attributes: DraggableAttributes;
  listeners: Record<string, unknown> | undefined;
  setActivatorNodeRef: (element: HTMLElement | null) => void;
  disabled: boolean;
  title: string;
  "aria-label": string;
  className: string;
  children: ReactNode;
}) {
  const raw = listeners ?? {};
  const onPointerDownDnd = raw.onPointerDown as React.PointerEventHandler<HTMLButtonElement> | undefined;
  const onKeyDownDnd = raw.onKeyDown as React.KeyboardEventHandler<HTMLButtonElement> | undefined;
  const restListeners = { ...raw };
  delete restListeners.onPointerDown;
  delete restListeners.onKeyDown;

  return (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...(restListeners as Record<string, unknown>)}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      className={className}
      onPointerDown={(e) => {
        onPointerDownDnd?.(e);
        e.stopPropagation();
      }}
      onKeyDown={
        onKeyDownDnd
          ? (e) => {
              onKeyDownDnd(e);
              e.stopPropagation();
            }
          : undefined
      }
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </button>
  );
}

const btnGreenBanking =
  "rounded-xl border border-teal-400/80 bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:from-teal-600 hover:to-emerald-600 disabled:opacity-50 banking-dark:border-amber-600/45 banking-dark:bg-gradient-to-r banking-dark:from-amber-600 banking-dark:to-amber-500 banking-dark:text-zinc-950 banking-dark:hover:from-amber-500 banking-dark:hover:to-amber-400 banking-dark:hover:border-amber-500/50";

const iconBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-xl border border-transparent text-slate-500 transition hover:border-teal-200 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-40 banking-dark:text-zinc-400 banking-dark:hover:border-zinc-500 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-amber-200";
const iconBtnDanger = `${iconBtn} hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 banking-dark:hover:border-rose-900 banking-dark:hover:bg-rose-950/40 banking-dark:hover:text-rose-300`;

const selectFieldClass =
  "mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 [color-scheme:light] banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:focus:border-amber-700/55 banking-dark:focus:ring-amber-500/15";

const bankingSettingsCardClass =
  "rounded-xl border border-slate-300 bg-white p-5 shadow-sm banking-dark:border-zinc-700 banking-dark:bg-zinc-950 banking-dark:shadow-none";

/** Ayudas y etiquetas: legibles sobre zinc-950 / zinc-900. */
const settingsMuted = "text-slate-500 banking-dark:text-zinc-400";
const settingsGhostBtn =
  "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50 banking-dark:border-zinc-500 banking-dark:bg-zinc-900 banking-dark:text-zinc-100 banking-dark:hover:border-zinc-400 banking-dark:hover:bg-zinc-800";

const settingsGhostBtnSm =
  "shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm hover:bg-slate-50 banking-dark:border-zinc-500 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:hover:bg-zinc-800";

/** Asa de arrastre / chevron en filas de categoría. */
const categoryHandleHover =
  "text-slate-500 hover:bg-teal-50 hover:text-teal-800 banking-dark:text-zinc-400 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-amber-200";

const PRODUCT_TYPE_OPTIONS: { value: BankingProductType; label: string }[] = [
  { value: "cuenta_corriente", label: "Cuenta Corriente" },
  { value: "cuenta_vista", label: "Cuenta Vista" },
  { value: "cuenta_prepago", label: "Cuenta Prepago" },
  { value: "tarjeta_credito", label: "Tarjeta de Crédito" },
];

function productTypeLabel(t: BankingProductType | null | undefined): string {
  if (!t) return "Sin tipo";
  return PRODUCT_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

/** Subcategorías de plantilla no renombrables; las añadidas por el usuario (`template_sub_id` nulo) sí. */
function bankingSubcategoryAllowsRename(cat: BankingCategoryRow, sub: BankingSubcategoryRow): boolean {
  if (!cat.names_locked) return true;
  return sub.template_sub_id == null;
}

export function BankingSettingsPage({ onToast }: { onToast: (msg: string | null) => void }) {
  const { isDark } = useBankingTheme();
  const [accounts, setAccounts] = useState<BankingAccountRow[]>([]);
  const [banks, setBanks] = useState<BankingBankRow[]>([]);
  const [categories, setCategories] = useState<BankingCategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankingAccountRow | null>(null);
  const [productName, setProductName] = useState("");
  /** Visible en selector de movimientos (solo CLP en backend). */
  const [accountEnabledModal, setAccountEnabledModal] = useState(true);
  /** Solo cuentas líquidas: si suma en la tarjeta «Saldo real» del resumen en Movimientos. */
  const [includeInTotalModal, setIncludeInTotalModal] = useState(true);
  const [productType, setProductType] = useState<BankingProductType>("cuenta_corriente");
  const [bankSbif, setBankSbif] = useState("");
  const [linkedCheckingId, setLinkedCheckingId] = useState<number | "">("");

  /** Solo color (plantilla / categorías internas). */
  const [categoryEdit, setCategoryEdit] = useState<{ id: number; color: string } | null>(null);
  /** Nombre + color (categorías sin bloqueo de plantilla). */
  const [categoryFullEdit, setCategoryFullEdit] = useState<{ id: number; name: string; color: string } | null>(null);
  const [newCategoryForm, setNewCategoryForm] = useState<{ name: string; color: string } | null>(null);
  const [newSubDraft, setNewSubDraft] = useState<Record<number, string>>({});
  const [subNameEdit, setSubNameEdit] = useState<{ id: number; categoryId: number; name: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  /** Si el id está en el set, la categoría está expandida (por defecto todas colapsadas). */
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<number>>(new Set());
  const [activeDragId, setActiveDragId] = useState<UniqueIdentifier | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const sortableCategories = useMemo(
    () => categories.filter((c) => !c.internal_reserved),
    [categories],
  );
  const reservedCategories = useMemo(
    () =>
      categories
        .filter((c) => c.internal_reserved)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [categories],
  );

  const activeDragCategory = useMemo(
    () =>
      activeDragId == null ? null : (sortableCategories.find((c) => c.id === activeDragId) ?? null),
    [activeDragId, sortableCategories],
  );

  const linkedCheckingOptions = useMemo(() => {
    if (productType !== "tarjeta_credito" || !bankSbif) return [];
    return accounts.filter(
      (x) =>
        x.id !== editingAccount?.id &&
        (x.enabled ?? true) &&
        x.product_type === "cuenta_corriente" &&
        (x.bank_sbif ?? "") === bankSbif,
    );
  }, [accounts, productType, bankSbif, editingAccount?.id]);

  useEffect(() => {
    if (productType !== "tarjeta_credito") return;
    if (linkedCheckingId === "" || linkedCheckingId == null) return;
    if (!linkedCheckingOptions.some((x) => x.id === linkedCheckingId)) {
      setLinkedCheckingId("");
    }
  }, [productType, linkedCheckingOptions, linkedCheckingId]);

  const load = useCallback(async () => {
    const [accRows, catRows, bankRows] = await Promise.all([
      fetchJson<BankingAccountRow[]>("/banking/accounts"),
      fetchJson<BankingCategoryRow[]>("/banking/categories"),
      fetchJson<BankingBankRow[]>("/banking/banks"),
    ]);
    setBanks([...bankRows].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })));
    const sortedAcc = [...accRows].sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
    );
    const sortedCat = [...catRows]
      .map((c) => ({
        ...c,
        subcategories: [...c.subcategories].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id,
        ),
      }))
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    setAccounts(sortedAcc);
    setCategories(sortedCat);
  }, []);

  const persistCategoryReorder = useCallback(
    async (nextIds: number[]) => {
      const reservedSorted = categories
        .filter((c) => c.internal_reserved)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      const nextCats = nextIds.map((id, i) => {
        const c = categories.find((x) => x.id === id);
        if (!c) throw new Error("Categoría no encontrada");
        return { ...c, sort_order: i };
      });
      const base = nextCats.length;
      const reservedWithOrder = reservedSorted.map((c, j) => ({ ...c, sort_order: base + j }));
      setCategories([...nextCats, ...reservedWithOrder]);
      setBusyKey("reorder");
      try {
        await patchJson<{ status: string }>("/banking/categories/reorder", { category_ids: nextIds });
      } catch {
        onToast("No se pudo guardar el orden");
        await load();
      } finally {
        setBusyKey(null);
      }
    },
    [categories, load, onToast],
  );

  const persistSubReorder = useCallback(
    async (categoryId: number, nextIds: number[]) => {
      const cat = categories.find((c) => c.id === categoryId);
      if (!cat) return;
      const byId = new Map(cat.subcategories.map((s) => [s.id, s]));
      const nextSubs = nextIds.map((id, i) => {
        const s = byId.get(id);
        if (!s) throw new Error("Subcategoría no encontrada");
        return { ...s, sort_order: i };
      });
      setCategories(
        categories.map((c) => (c.id === categoryId ? { ...c, subcategories: nextSubs } : c)),
      );
      setBusyKey(`sub-reorder-${categoryId}`);
      try {
        await patchJson<{ status: string }>(`/banking/categories/${categoryId}/subcategories/reorder`, {
          subcategory_ids: nextIds,
        });
      } catch {
        onToast("No se pudo guardar el orden de subcategorías");
        await load();
      } finally {
        setBusyKey(null);
      }
    },
    [categories, load, onToast],
  );

  function handleCategoryDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id);
  }

  function handleCategoryDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortableCategories.findIndex((c) => c.id === active.id);
    const newIndex = sortableCategories.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextIds = arrayMove(
      sortableCategories.map((c) => c.id),
      oldIndex,
      newIndex,
    );
    void persistCategoryReorder(nextIds);
  }

  function handleSubcategoriesDragEnd(categoryId: number, event: DragEndEvent) {
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeNum = parseSubSortableId(active.id);
    const overNum = parseSubSortableId(over.id);
    if (activeNum == null || overNum == null) return;
    const subs = [...cat.subcategories];
    const oldIndex = subs.findIndex((s) => s.id === activeNum);
    const newIndex = subs.findIndex((s) => s.id === overNum);
    if (oldIndex < 0 || newIndex < 0) return;
    void persistSubReorder(
      categoryId,
      arrayMove(
        subs.map((s) => s.id),
        oldIndex,
        newIndex,
      ),
    );
  }

  function handleCategoryDragCancel() {
    setActiveDragId(null);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load()
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  function openNewProduct() {
    setEditingAccount(null);
    setProductName("");
    setAccountEnabledModal(true);
    setIncludeInTotalModal(true);
    setProductType("cuenta_corriente");
    setBankSbif("");
    setLinkedCheckingId("");
    setAccountModalOpen(true);
  }

  function openEditAccount(a: BankingAccountRow) {
    setEditingAccount(a);
    setProductName(a.name);
    setAccountEnabledModal(a.enabled ?? true);
    setIncludeInTotalModal(a.include_in_total_balance !== false);
    setProductType(a.product_type ?? "cuenta_corriente");
    setBankSbif(a.bank_sbif ?? "");
    setLinkedCheckingId(a.linked_checking_account_id ?? "");
    setAccountModalOpen(true);
  }

  async function saveAccountModal() {
    const n = productName.trim();
    if (!n) {
      onToast("Indica un nombre");
      return;
    }
    if (!bankSbif.trim()) {
      onToast("Selecciona un banco");
      return;
    }
    if (productType === "tarjeta_credito") {
      if (linkedCheckingId === "" || linkedCheckingId == null) {
        onToast("Selecciona la cuenta corriente asociada a esta tarjeta");
        return;
      }
    }
    setSaving(true);
    try {
      const liquidExtras =
        productType !== "tarjeta_credito" ? { include_in_total_balance: includeInTotalModal } : {};
      if (editingAccount) {
        await patchJson<BankingAccountRow>(`/banking/accounts/${editingAccount.id}`, {
          name: n,
          product_type: productType,
          bank_sbif: bankSbif.trim(),
          enabled: accountEnabledModal,
          linked_checking_account_id:
            productType === "tarjeta_credito" ? Number(linkedCheckingId) : null,
          ...liquidExtras,
        });
        onToast("Producto actualizado ✅");
      } else {
        await postJson<BankingAccountRow>("/banking/accounts", {
          name: n,
          initial_balance: 0,
          product_type: productType,
          bank_sbif: bankSbif.trim(),
          enabled: accountEnabledModal,
          linked_checking_account_id:
            productType === "tarjeta_credito" ? Number(linkedCheckingId) : null,
          ...liquidExtras,
        });
        onToast("Producto creado ✅");
      }
      setAccountModalOpen(false);
      setEditingAccount(null);
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function setAccountEnabledRow(a: BankingAccountRow, next: boolean) {
    setBusyKey(`acc-en-${a.id}`);
    try {
      await patchJson(`/banking/accounts/${a.id}`, { enabled: next });
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo actualizar");
    } finally {
      setBusyKey(null);
    }
  }

  async function setAccountIncludeInTotalRow(a: BankingAccountRow, next: boolean) {
    setBusyKey(`acc-tot-${a.id}`);
    try {
      await patchJson(`/banking/accounts/${a.id}`, { include_in_total_balance: next });
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo actualizar");
    } finally {
      setBusyKey(null);
    }
  }

  async function removeAccount(a: BankingAccountRow) {
    if (a.has_transactions) return;
    if (!confirm(`¿Eliminar «${a.name}»? Solo si no tiene movimientos.`)) return;
    try {
      const r = await apiFetch(`/banking/accounts/${a.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { detail?: string } | null;
        onToast(j?.detail ?? "No se pudo eliminar");
        return;
      }
      onToast("Producto eliminado");
      await load();
    } catch {
      onToast("No se pudo eliminar");
    }
  }

  async function saveCategoryEdit() {
    if (!categoryEdit) return;
    setBusyKey(`cat-${categoryEdit.id}`);
    try {
      await patchJson(`/banking/categories/${categoryEdit.id}`, { color: categoryEdit.color });
      setCategoryEdit(null);
      onToast("Color actualizado");
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveCategoryFullEdit() {
    if (!categoryFullEdit) return;
    const nm = categoryFullEdit.name.trim();
    if (!nm) {
      onToast("Escribe un nombre para la categoría");
      return;
    }
    setBusyKey(`cat-full-${categoryFullEdit.id}`);
    try {
      await patchJson(`/banking/categories/${categoryFullEdit.id}`, {
        name: nm,
        color: categoryFullEdit.color,
      });
      setCategoryFullEdit(null);
      onToast("Categoría actualizada");
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusyKey(null);
    }
  }

  async function createCategory() {
    if (!newCategoryForm) return;
    const nm = newCategoryForm.name.trim();
    if (!nm) {
      onToast("Escribe un nombre para la categoría");
      return;
    }
    setBusyKey("new-cat");
    try {
      await postJson("/banking/categories", {
        name: nm,
        color: newCategoryForm.color,
      });
      setNewCategoryForm(null);
      onToast("Categoría creada");
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo crear la categoría");
    } finally {
      setBusyKey(null);
    }
  }

  async function createSubcategory(categoryId: number) {
    const name = (newSubDraft[categoryId] ?? "").trim();
    if (!name) {
      onToast("Escribe un nombre para la subcategoría");
      return;
    }
    setBusyKey(`new-sub-${categoryId}`);
    try {
      await postJson(`/banking/categories/${categoryId}/subcategories`, { name });
      setNewSubDraft((d) => ({ ...d, [categoryId]: "" }));
      onToast("Subcategoría añadida");
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo añadir la subcategoría");
    } finally {
      setBusyKey(null);
    }
  }

  async function saveSubNameEdit() {
    if (!subNameEdit) return;
    const nm = subNameEdit.name.trim();
    if (!nm) {
      onToast("Escribe un nombre");
      return;
    }
    setBusyKey(`sub-name-${subNameEdit.id}`);
    try {
      await patchJson(`/banking/subcategories/${subNameEdit.id}`, { name: nm });
      setSubNameEdit(null);
      onToast("Subcategoría actualizada");
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusyKey(null);
    }
  }

  async function removeCategory(cat: BankingCategoryRow) {
    if (cat.names_locked || cat.has_transactions) return;
    setBusyKey(`del-cat-${cat.id}`);
    try {
      const r = await apiFetch(`/banking/categories/${cat.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { detail?: string } | null;
        onToast(j?.detail ?? "No se pudo eliminar la categoría");
        return;
      }
      setCategoryFullEdit(null);
      setCategoryEdit(null);
      onToast("Categoría eliminada");
      await load();
    } catch {
      onToast("No se pudo eliminar la categoría");
    } finally {
      setBusyKey(null);
    }
  }

  async function setCategoryEnabled(cat: BankingCategoryRow, next: boolean) {
    setBusyKey(`cat-en-${cat.id}`);
    try {
      await patchJson(`/banking/categories/${cat.id}`, { enabled: next });
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo actualizar");
    } finally {
      setBusyKey(null);
    }
  }

  async function setSubcategoryEnabled(sub: BankingSubcategoryRow, next: boolean) {
    setBusyKey(`sub-en-${sub.id}`);
    try {
      await patchJson(`/banking/subcategories/${sub.id}`, { enabled: next });
      await load();
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo actualizar");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div
      className={`banking-theme w-full min-h-[calc(100dvh-3.5rem)] ${
        isDark
          ? "bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(251,191,36,0.055),transparent_52%),linear-gradient(to_bottom,#0d0d0d,#070707)] text-zinc-300"
          : "bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100/80 text-slate-800"
      }`}
    >
    <div className="mx-auto max-w-[880px] space-y-10 p-4 pb-28 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
        <h2 className="text-lg font-semibold text-slate-900 banking-dark:text-zinc-100">Configuración bancaria</h2>
        <p className="mt-1 text-sm text-slate-500 banking-dark:text-zinc-400">
          Productos (cuentas) y categorías del catálogo del servidor. Activa las categorías y subcategorías que quieras
          usar en movimientos manuales; personaliza el color y el orden con el asa (⋮⋮). Al final verás categorías de
          uso interno (siempre activas, sin interruptor).
        </p>
        </div>
        <BankingThemeToggle />
      </div>

      <section className="space-y-4" aria-labelledby="banking-accounts-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="banking-accounts-heading" className="text-base font-semibold text-slate-900 banking-dark:text-zinc-100">
              Productos
            </h3>
            <p className="mt-1 text-sm text-slate-500 banking-dark:text-zinc-400">
              Activa la visibilidad en «Nuevo movimiento» y, en cuentas líquidas, si suman en el «Saldo real» del
              resumen en Movimientos (excluye respaldos o cuentas transitorias). El saldo se gestiona en el backend.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={openNewProduct} className={btnGreenBanking}>
              Agregar producto
            </button>
          </div>
        </div>

        <div className={bankingSettingsCardClass}>
          {loading ? (
            <p className={`text-sm ${settingsMuted}`}>Cargando…</p>
          ) : accounts.length === 0 ? (
            <p className={`text-sm ${settingsMuted}`}>No hay productos todavía. Usa «Agregar producto».</p>
          ) : (
            <ul
              className="space-y-0 divide-y divide-slate-100 banking-dark:divide-zinc-800"
              role="list"
            >
              {accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 banking-dark:text-zinc-100">{a.name}</p>
                    <p className={`text-xs ${settingsMuted}`}>
                      {productTypeLabel(a.product_type)}
                      {a.bank_name ? ` · ${a.bank_name}` : ""}
                      {a.product_type === "tarjeta_credito" && a.linked_checking_account_name
                        ? ` · Liquidación: ${a.linked_checking_account_name}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <div
                      className="flex items-center gap-1"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                    >
                      <span
                        className={`max-w-[3.25rem] shrink-0 text-[10px] leading-tight ${settingsMuted}`}
                        title="Visible al registrar movimientos"
                      >
                        Activa
                      </span>
                      <BankingEnabledToggle
                        enabled={a.enabled ?? true}
                        disabled={busyKey !== null}
                        onChange={(next) => void setAccountEnabledRow(a, next)}
                        title={
                          (a.enabled ?? true)
                            ? "Visible al registrar movimientos"
                            : "Oculto en el selector de movimientos"
                        }
                        ariaLabel={`Producto «${a.name}»: ${(a.enabled ?? true) ? "visible en movimientos" : "oculto"}`}
                      />
                    </div>
                    {a.product_type !== "tarjeta_credito" ? (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <span
                          className={`max-w-[3.25rem] shrink-0 text-[10px] leading-tight ${settingsMuted}`}
                          title="Incluir en saldo total del resumen en Movimientos"
                        >
                          En total
                        </span>
                        <BankingEnabledToggle
                          enabled={a.include_in_total_balance !== false}
                          disabled={busyKey !== null}
                          onChange={(next) => void setAccountIncludeInTotalRow(a, next)}
                          title={
                            (a.include_in_total_balance !== false)
                              ? "Incluida en el saldo total del resumen"
                              : "Excluida del saldo total (respaldos / transitorias)"
                          }
                          ariaLabel={`«${a.name}»: ${a.include_in_total_balance !== false ? "incluida en saldo total" : "excluida del saldo total"}`}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      title="Editar producto"
                      className={iconBtn}
                      onClick={() => openEditAccount(a)}
                    >
                      <IconPencil />
                    </button>
                    <button
                      type="button"
                      title={
                        a.has_transactions
                          ? "Hay movimientos: no se puede eliminar; desactiva la visibilidad si no quieres usarlo."
                          : "Eliminar producto"
                      }
                      className={iconBtnDanger}
                      disabled={!!a.has_transactions || busyKey !== null}
                      onClick={() => void removeAccount(a)}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="banking-categories-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3
              id="banking-categories-heading"
              className="text-base font-semibold text-slate-900 banking-dark:text-zinc-100"
            >
              Categorías y subcategorías
            </h3>
            <p className={`mt-1 text-sm ${settingsMuted}`}>
              Categorías iniciales desde el servidor; puedes añadir las tuyas, editar nombre y color (salvo plantilla
              fijada) y crear subcategorías en cualquier categoría manual o de plantilla. Las subcategorías propias se
              pueden renombrar aunque la categoría esté fijada por plantilla. El interruptor controla visibilidad en
              movimientos. Las categorías reservadas al final solo permiten color.
            </p>
          </div>
          <button
            type="button"
            disabled={loading || busyKey !== null}
            onClick={() => {
              setCategoryEdit(null);
              setCategoryFullEdit(null);
              setNewCategoryForm({ name: "", color: BANKING_DEFAULT_NEW_CATEGORY_COLOR });
            }}
            className={btnGreenBanking}
          >
            Nueva categoría
          </button>
        </div>

        <div className={bankingSettingsCardClass}>
          {newCategoryForm ? (
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-dashed border-teal-200 bg-teal-50/50 p-4 banking-dark:border-teal-900/45 banking-dark:bg-teal-950/35 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="min-w-[12rem] flex-1 text-sm">
                <span className={`text-xs ${settingsMuted}`}>Nombre</span>
                <input
                  type="text"
                  value={newCategoryForm.name}
                  onChange={(e) => setNewCategoryForm({ ...newCategoryForm, name: e.target.value })}
                  className={selectFieldClass}
                  placeholder="Ej. Gastos hogar"
                  autoFocus
                />
              </label>
              <label className="flex shrink-0 items-center gap-2">
                <span className={`text-xs ${settingsMuted}`}>Color</span>
                <input
                  type="color"
                  value={newCategoryForm.color}
                  onChange={(e) => setNewCategoryForm({ ...newCategoryForm, color: e.target.value })}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 shadow-sm banking-dark:border-zinc-600 banking-dark:bg-zinc-900"
                  title="Color de la categoría"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => void createCategory()}
                  className={`${btnGreenBanking} px-4 py-2 text-sm`}
                >
                  Crear
                </button>
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() => setNewCategoryForm(null)}
                  className={settingsGhostBtn}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}
          {loading ? (
            <p className={`text-sm ${settingsMuted}`}>Cargando categorías…</p>
          ) : categories.length === 0 ? (
            <p className={`text-sm ${settingsMuted}`}>
              No hay categorías disponibles. Comprueba que exista el archivo de catálogo en el servidor.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleCategoryDragStart}
              onDragEnd={handleCategoryDragEnd}
              onDragCancel={handleCategoryDragCancel}
            >
              <div className="flex flex-col gap-3">
              <SortableContext items={sortableCategories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  {sortableCategories.map((cat) => (
                    <SortableCategoryWrapper key={cat.id} id={cat.id} disabled={busyKey !== null}>
                      {(handle) => (
                        <details
                          className="group overflow-hidden rounded-xl border border-slate-300/80 bg-white/70 banking-dark:border-zinc-600 banking-dark:bg-zinc-900/50"
                          style={softCategorySurface(cat.color)}
                          open={expandedCategoryIds.has(cat.id)}
                          onToggle={(e) => {
                            const el = e.currentTarget;
                            setExpandedCategoryIds((prev) => {
                              const next = new Set(prev);
                              if (el.open) next.add(cat.id);
                              else next.delete(cat.id);
                              return next;
                            });
                          }}
                        >
                          <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-slate-300/80 px-3 py-2.5 marker:content-none banking-dark:border-zinc-600 sm:px-4 [&::-webkit-details-marker]:hidden">
                            <CategoryDragHandleButton
                              setActivatorNodeRef={handle.setActivatorNodeRef}
                              attributes={handle.attributes}
                              listeners={handle.listeners}
                              disabled={busyKey !== null}
                              title="Arrastrar para reordenar"
                              aria-label="Arrastrar para reordenar categoría"
                              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 ${categoryHandleHover} active:cursor-grabbing ${
                                busyKey !== null ? "cursor-not-allowed opacity-40" : "cursor-grab"
                              }`}
                            >
                              <IconGripVertical className="block h-4 w-4" />
                            </CategoryDragHandleButton>
                    <span
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-slate-500 banking-dark:text-zinc-400 transition-transform duration-200 group-open:rotate-180"
                      aria-hidden
                    >
                      <IconChevronDown className="block h-4 w-4" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    {categoryFullEdit?.id === cat.id && !cat.names_locked ? (
                      <>
                        <input
                          type="text"
                          className="min-w-[10rem] flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-900 shadow-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/25 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-100 banking-dark:focus:border-amber-600/55 banking-dark:focus:ring-amber-500/20"
                          value={categoryFullEdit.name}
                          onChange={(e) =>
                            setCategoryFullEdit({ ...categoryFullEdit, name: e.target.value })
                          }
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Nombre de categoría"
                        />
                        <span className={`shrink-0 text-xs ${settingsMuted}`}>({cat.subcategories.length})</span>
                        <div
                          className={`flex shrink-0 items-center ${(cat.has_transactions ?? false) ? "opacity-55" : ""}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <BankingEnabledToggle
                            enabled={cat.enabled ?? true}
                            disabled={busyKey !== null || !!(cat.has_transactions ?? false)}
                            onChange={(next) => void setCategoryEnabled(cat, next)}
                            title={
                              (cat.has_transactions ?? false)
                                ? "Hay movimientos con esta categoría; no se puede desactivar."
                                : "Disponible para movimientos nuevos"
                            }
                            ariaLabel={`Categoría «${cat.name}»: ${cat.enabled ?? true ? "activa" : "inactiva"}`}
                          />
                        </div>
                        <input
                          type="color"
                          value={categoryFullEdit.color}
                          onChange={(e) =>
                            setCategoryFullEdit({ ...categoryFullEdit, color: e.target.value })
                          }
                          className="h-9 w-12 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5 shadow-sm banking-dark:border-zinc-600 banking-dark:bg-zinc-900"
                          title="Color"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void saveCategoryFullEdit();
                          }}
                          className={`${btnGreenBanking} shrink-0 px-3 py-1.5 text-xs`}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setCategoryFullEdit(null);
                          }}
                          className={settingsGhostBtnSm}
                        >
                          Cancelar
                        </button>
                        {!cat.names_locked && !cat.has_transactions ? (
                          <button
                            type="button"
                            title="Eliminar categoría"
                            disabled={busyKey !== null}
                            className={iconBtnDanger}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void removeCategory(cat);
                            }}
                          >
                            <IconTrash />
                          </button>
                        ) : null}
                      </>
                    ) : categoryEdit?.id === cat.id ? (
                      <>
                        <p
                          className="m-0 min-w-0 flex-1 text-sm font-medium leading-snug text-slate-800 banking-dark:text-zinc-100"
                          style={{ color: cat.color }}
                        >
                          {cat.name}{" "}
                          <span className={`font-normal ${settingsMuted}`}>({cat.subcategories.length})</span>
                        </p>
                        <div
                          className={`flex shrink-0 items-center ${(cat.has_transactions ?? false) ? "opacity-55" : ""}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <BankingEnabledToggle
                            enabled={cat.enabled ?? true}
                            disabled={busyKey !== null || !!(cat.has_transactions ?? false)}
                            onChange={(next) => void setCategoryEnabled(cat, next)}
                            title={
                              (cat.has_transactions ?? false)
                                ? "Hay movimientos con esta categoría; no se puede desactivar."
                                : "Disponible para movimientos nuevos"
                            }
                            ariaLabel={`Categoría «${cat.name}»: ${cat.enabled ?? true ? "activa" : "inactiva"}`}
                          />
                        </div>
                        <input
                          type="color"
                          value={categoryEdit.color}
                          onChange={(e) => setCategoryEdit({ ...categoryEdit, color: e.target.value })}
                          className="h-9 w-12 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5 shadow-sm banking-dark:border-zinc-600 banking-dark:bg-zinc-900"
                          title="Color"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void saveCategoryEdit();
                          }}
                          className={`${btnGreenBanking} shrink-0 px-3 py-1.5 text-xs`}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setCategoryEdit(null);
                          }}
                          className={settingsGhostBtnSm}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <p
                          className="m-0 min-w-0 flex-1 text-sm font-medium leading-snug text-slate-800 banking-dark:text-zinc-100"
                          style={{ color: cat.color }}
                        >
                          {cat.name}{" "}
                          <span className={`font-normal ${settingsMuted}`}>({cat.subcategories.length})</span>
                        </p>
                        <div className="ml-auto flex h-8 shrink-0 items-center gap-2">
                          <div
                            className={`flex items-center ${(cat.has_transactions ?? false) ? "opacity-55" : ""}`}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            <BankingEnabledToggle
                              enabled={cat.enabled ?? true}
                              disabled={busyKey !== null || !!(cat.has_transactions ?? false)}
                              onChange={(next) => void setCategoryEnabled(cat, next)}
                              title={
                                (cat.has_transactions ?? false)
                                  ? "Hay movimientos con esta categoría; no se puede desactivar."
                                  : "Disponible para movimientos nuevos"
                              }
                              ariaLabel={`Categoría «${cat.name}»: ${cat.enabled ?? true ? "activa" : "inactiva"}`}
                            />
                          </div>
                          <button
                            type="button"
                            title={cat.names_locked ? "Cambiar color (nombre fijado por plantilla)" : "Editar nombre y color"}
                            className={iconBtn}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (cat.names_locked) {
                                setCategoryFullEdit(null);
                                setCategoryEdit({
                                  id: cat.id,
                                  color: cat.color || BANKING_DEFAULT_NEW_CATEGORY_COLOR,
                                });
                              } else {
                                setCategoryEdit(null);
                                setCategoryFullEdit({
                                  id: cat.id,
                                  name: cat.name,
                                  color: cat.color || BANKING_DEFAULT_NEW_CATEGORY_COLOR,
                                });
                              }
                            }}
                          >
                            <IconPencil />
                          </button>
                        </div>
                      </>
                    )}
                    </div>
                  </summary>
                  <ul className="list-none space-y-1 px-3 py-3 sm:px-4" role="list">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(e) => handleSubcategoriesDragEnd(cat.id, e)}
                    >
                      <SortableContext
                        items={cat.subcategories.map((s) => subSortableId(s.id))}
                        strategy={verticalListSortingStrategy}
                      >
                        {cat.subcategories.map((s) => {
                          const parentEnabled = cat.enabled ?? true;
                          const dragDisabled = busyKey !== null || !parentEnabled;
                          const toggleDisabled =
                            busyKey !== null ||
                            !!(s.has_transactions ?? false) ||
                            !parentEnabled;
                          const showOn = parentEnabled ? (s.enabled ?? true) : false;
                          return (
                            <SortableSubcategoryWrapper key={s.id} subId={s.id} disabled={dragDisabled}>
                              {(handle) => (
                                <div
                                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2 py-2 text-xs ${
                                    parentEnabled
                                      ? "border-slate-300 bg-slate-50/90 text-slate-700 banking-dark:border-zinc-600 banking-dark:bg-zinc-900/65 banking-dark:text-zinc-200"
                                      : "cursor-not-allowed border-slate-300 bg-slate-100/80 text-slate-500 banking-dark:border-zinc-700 banking-dark:bg-zinc-900/40 banking-dark:text-zinc-500"
                                  }`}
                                  aria-disabled={!parentEnabled}
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <CategoryDragHandleButton
                                      setActivatorNodeRef={handle.setActivatorNodeRef}
                                      attributes={handle.attributes}
                                      listeners={handle.listeners}
                                      disabled={dragDisabled}
                                      title="Arrastrar para reordenar subcategorías"
                                      aria-label="Arrastrar para reordenar subcategoría"
                                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 ${categoryHandleHover} active:cursor-grabbing ${
                                        dragDisabled ? "cursor-not-allowed opacity-40" : "cursor-grab"
                                      }`}
                                    >
                                      <IconGripVertical className="block h-3.5 w-3.5" />
                                    </CategoryDragHandleButton>
                                    {bankingSubcategoryAllowsRename(cat, s) && subNameEdit?.id === s.id ? (
                                      <input
                                        type="text"
                                        className="min-w-0 flex-1 rounded border border-teal-300 bg-white px-1.5 py-1 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-teal-400/35 banking-dark:border-amber-600/45 banking-dark:bg-zinc-900 banking-dark:text-zinc-100 banking-dark:focus:ring-amber-500/25"
                                        value={subNameEdit.name}
                                        onChange={(e) =>
                                          setSubNameEdit({ ...subNameEdit, name: e.target.value })
                                        }
                                        onClick={(e) => e.stopPropagation()}
                                        aria-label="Nombre de subcategoría"
                                      />
                                    ) : (
                                      <span
                                        className={`min-w-0 flex-1 ${!parentEnabled ? `${settingsMuted}` : ""}`}
                                      >
                                        {s.name}
                                      </span>
                                    )}
                                    {bankingSubcategoryAllowsRename(cat, s) && subNameEdit?.id !== s.id ? (
                                      <button
                                        type="button"
                                        title="Renombrar subcategoría"
                                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${categoryHandleHover}`}
                                        disabled={busyKey !== null || !parentEnabled}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSubNameEdit({ id: s.id, categoryId: cat.id, name: s.name });
                                        }}
                                      >
                                        <IconPencil className="h-3.5 w-3.5" />
                                      </button>
                                    ) : null}
                                    {bankingSubcategoryAllowsRename(cat, s) && subNameEdit?.id === s.id ? (
                                      <div className="flex shrink-0 gap-1">
                                        <button
                                          type="button"
                                          disabled={busyKey !== null}
                                          className="rounded-md bg-teal-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-teal-700 disabled:opacity-40"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void saveSubNameEdit();
                                          }}
                                        >
                                          OK
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busyKey !== null}
                                          className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-800 banking-dark:text-zinc-200 banking-dark:hover:bg-zinc-700"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSubNameEdit(null);
                                          }}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                  <div
                                    className={`flex shrink-0 items-center ${
                                      (s.has_transactions ?? false) &&
                                      (s.enabled ?? true) &&
                                      parentEnabled
                                        ? "opacity-55"
                                        : ""
                                    }`}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <BankingEnabledToggle
                                      enabled={showOn}
                                      disabled={toggleDisabled}
                                      onChange={(next) => void setSubcategoryEnabled(s, next)}
                                      title={
                                        !parentEnabled
                                          ? "Activa la categoría primero para poder usar o cambiar subcategorías."
                                          : (s.has_transactions ?? false)
                                            ? "Hay movimientos con esta subcategoría; no se puede desactivar."
                                            : "Disponible para movimientos nuevos"
                                      }
                                      ariaLabel={`Subcategoría «${s.name}»: ${showOn ? "activa" : "inactiva"}`}
                                    />
                                  </div>
                                </div>
                              )}
                            </SortableSubcategoryWrapper>
                          );
                        })}
                      </SortableContext>
                      <li className="mt-2 flex list-none flex-wrap items-center gap-2 border-t border-slate-300 pt-3 banking-dark:border-zinc-700">
                        <input
                          type="text"
                          placeholder="Nueva subcategoría…"
                          className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 shadow-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:focus:border-amber-600/50 banking-dark:focus:ring-amber-500/15"
                          value={newSubDraft[cat.id] ?? ""}
                          onChange={(e) =>
                            setNewSubDraft((d) => ({ ...d, [cat.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void createSubcategory(cat.id);
                            }
                          }}
                        />
                        <button
                          type="button"
                          disabled={busyKey !== null}
                          className={`${btnGreenBanking} shrink-0 px-3 py-1.5 text-xs`}
                          onClick={() => void createSubcategory(cat.id)}
                        >
                          Añadir
                        </button>
                      </li>
                    </DndContext>
                  </ul>
                        </details>
                      )}
                    </SortableCategoryWrapper>
                  ))}
              </SortableContext>
              {reservedCategories.length > 0 ? (
                <p className={`text-xs leading-relaxed ${settingsMuted}`}>
                  Categorías reservadas para la aplicación (siempre activas; no aparecen al agregar movimientos a mano). El
                  color sí se puede personalizar.
                </p>
              ) : null}
              {reservedCategories.map((cat) => (
                <div key={cat.id}>
                  <details
                    className="group overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50/50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900/35"
                    style={softCategorySurface(cat.color)}
                    open={expandedCategoryIds.has(cat.id)}
                    onToggle={(e) => {
                      const el = e.currentTarget;
                      setExpandedCategoryIds((prev) => {
                        const next = new Set(prev);
                        if (el.open) next.add(cat.id);
                        else next.delete(cat.id);
                        return next;
                      });
                    }}
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-slate-300/80 px-3 py-2.5 marker:content-none banking-dark:border-zinc-600 sm:px-4 [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex h-8 w-8 shrink-0" aria-hidden />
                      <span
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-slate-500 banking-dark:text-zinc-400 transition-transform duration-200 group-open:rotate-180"
                        aria-hidden
                      >
                        <IconChevronDown className="block h-4 w-4" />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        {categoryEdit?.id === cat.id ? (
                          <>
                            <p
                              className="m-0 min-w-0 flex-1 text-sm font-medium leading-snug text-slate-800 banking-dark:text-zinc-100"
                              style={{ color: cat.color }}
                            >
                              {cat.name}{" "}
                              <span className={`font-normal ${settingsMuted}`}>({cat.subcategories.length})</span>
                            </p>
                            <span
                              className={`shrink-0 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-medium uppercase tracking-wide banking-dark:border-zinc-600 banking-dark:bg-zinc-800 ${settingsMuted}`}
                              title="No se puede desactivar; la app usa estas categorías internamente."
                            >
                              Siempre activa
                            </span>
                            <input
                              type="color"
                              value={categoryEdit.color}
                              onChange={(e) => setCategoryEdit({ ...categoryEdit, color: e.target.value })}
                              className="h-9 w-12 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5 shadow-sm banking-dark:border-zinc-600 banking-dark:bg-zinc-900"
                              title="Color"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              type="button"
                              disabled={busyKey !== null}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void saveCategoryEdit();
                              }}
                              className={`${btnGreenBanking} shrink-0 px-3 py-1.5 text-xs`}
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              disabled={busyKey !== null}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setCategoryEdit(null);
                              }}
                              className={settingsGhostBtnSm}
                            >
                              Cancelar
                            </button>
                          </>
                        ) : (
                          <>
                            <p
                              className="m-0 min-w-0 flex-1 text-sm font-medium leading-snug text-slate-800 banking-dark:text-zinc-100"
                              style={{ color: cat.color }}
                            >
                              {cat.name}{" "}
                              <span className={`font-normal ${settingsMuted}`}>({cat.subcategories.length})</span>
                            </p>
                            <div className="ml-auto flex h-8 shrink-0 items-center gap-2">
                              <span
                                className={`shrink-0 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-medium uppercase tracking-wide banking-dark:border-zinc-600 banking-dark:bg-zinc-800 ${settingsMuted}`}
                                title="No se puede desactivar; la app usa estas categorías internamente."
                              >
                                Siempre activa
                              </span>
                              <button
                                type="button"
                                title="Cambiar color"
                                className={iconBtn}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setCategoryEdit({ id: cat.id, color: cat.color || BANKING_DEFAULT_NEW_CATEGORY_COLOR });
                                }}
                              >
                                <IconPencil />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </summary>
                    <ul className="list-none space-y-1 px-3 py-3 sm:px-4" role="list">
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(e) => handleSubcategoriesDragEnd(cat.id, e)}
                      >
                        <SortableContext
                          items={cat.subcategories.map((s) => subSortableId(s.id))}
                          strategy={verticalListSortingStrategy}
                        >
                          {cat.subcategories.map((s) => {
                            const dragDisabled = busyKey !== null;
                            return (
                              <SortableSubcategoryWrapper key={s.id} subId={s.id} disabled={dragDisabled}>
                                {(handle) => (
                                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-600 shadow-sm banking-dark:border-zinc-600 banking-dark:bg-zinc-900/70 banking-dark:text-zinc-300">
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                      <CategoryDragHandleButton
                                        setActivatorNodeRef={handle.setActivatorNodeRef}
                                        attributes={handle.attributes}
                                        listeners={handle.listeners}
                                        disabled={dragDisabled}
                                        title="Arrastrar para reordenar subcategorías"
                                        aria-label="Arrastrar para reordenar subcategoría"
                                        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-0 bg-transparent p-0 ${categoryHandleHover} active:cursor-grabbing ${
                                          dragDisabled ? "cursor-not-allowed opacity-40" : "cursor-grab"
                                        }`}
                                      >
                                        <IconGripVertical className="block h-3.5 w-3.5" />
                                      </CategoryDragHandleButton>
                                      <span className="min-w-0 flex-1">{s.name}</span>
                                    </div>
                                    <span
                                      className={`shrink-0 text-[10px] font-medium uppercase tracking-wide ${settingsMuted}`}
                                      title="Las subcategorías de esta categoría están siempre activas para la aplicación."
                                    >
                                      Activa
                                    </span>
                                  </div>
                                )}
                              </SortableSubcategoryWrapper>
                            );
                          })}
                        </SortableContext>
                      </DndContext>
                    </ul>
                  </details>
                </div>
              ))}
                </div>
              <DragOverlay
                adjustScale={false}
                dropAnimation={null}
                className="z-[90] box-border w-full max-w-[min(100vw-2rem,42rem)] min-w-0"
              >
                {activeDragCategory ? (
                  <CategoryDragPreview
                    cat={activeDragCategory}
                    expanded={expandedCategoryIds.has(activeDragCategory.id)}
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>
      </section>

      <p className={`text-center text-xs ${settingsMuted}`}>
        <Link
          to="/banking/transactions"
          className="font-medium text-teal-700 hover:text-teal-900 hover:underline banking-dark:text-amber-400 banking-dark:hover:text-amber-300"
        >
          Ir a movimientos
        </Link>
      </p>

      {accountModalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[2px] banking-dark:bg-black/55"
          role="dialog"
          aria-modal="true"
          aria-labelledby="banking-product-modal-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-300 bg-white p-6 shadow-2xl shadow-teal-900/10 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:shadow-black/40">
            <h3
              id="banking-product-modal-title"
              className="text-base font-semibold text-slate-900 banking-dark:text-zinc-100"
            >
              {editingAccount ? "Editar producto" : "Nuevo producto"}
            </h3>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className={`text-xs ${settingsMuted}`}>Nombre</span>
                <input
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className={selectFieldClass}
                  autoFocus
                />
              </label>
              <label className="block">
                <span className={`text-xs ${settingsMuted}`}>Tipo de producto</span>
                <select
                  value={productType}
                  onChange={(e) => {
                    const v = e.target.value as BankingProductType;
                    setProductType(v);
                    if (v !== "tarjeta_credito") setLinkedCheckingId("");
                  }}
                  className={selectFieldClass}
                >
                  {PRODUCT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={`text-xs ${settingsMuted}`}>Banco</span>
                <select
                  value={bankSbif}
                  onChange={(e) => setBankSbif(e.target.value)}
                  className={selectFieldClass}
                >
                  <option value="">Selecciona un banco…</option>
                  {banks.map((b) => (
                    <option key={b.sbif} value={b.sbif}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              {productType === "tarjeta_credito" ? (
                <label className="block">
                  <span className={`text-xs ${settingsMuted}`}>Cuenta Corriente asociada</span>
                  <p className={`mt-1 text-[11px] leading-snug ${settingsMuted}`}>
                    Mismo banco que la tarjeta. Sirve para registrar pagos de la tarjeta desde la cuenta correcta.
                  </p>
                  <select
                    value={linkedCheckingId === "" ? "" : String(linkedCheckingId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLinkedCheckingId(v === "" ? "" : Number(v));
                    }}
                    className={selectFieldClass}
                  >
                    <option value="">Selecciona la Cuenta Corriente…</option>
                    {linkedCheckingOptions.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  {bankSbif.trim() !== "" && linkedCheckingOptions.length === 0 ? (
                    <p className="mt-1.5 text-xs text-amber-800/95 banking-dark:text-amber-200">
                      No tienes una cuenta corriente en este banco. Agrégala primero y vuelve a editar esta tarjeta.
                    </p>
                  ) : null}
                </label>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-300 bg-slate-50/90 px-3 py-3 shadow-sm banking-dark:border-zinc-600 banking-dark:bg-zinc-800/75">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-slate-800 banking-dark:text-zinc-100">Activa</span>
                  <p className={`mt-1 text-[11px] leading-snug ${settingsMuted}`}>
                    Visible al registrar movimientos. Si está desactivado, no aparece al elegir cuenta (solo CLP en el
                    sistema).
                  </p>
                </div>
                <BankingEnabledToggle
                  enabled={accountEnabledModal}
                  disabled={saving}
                  onChange={(next) => setAccountEnabledModal(next)}
                  title={accountEnabledModal ? "Visible en el listado de cuentas al crear movimientos" : "Oculto en nuevos movimientos"}
                  ariaLabel={accountEnabledModal ? "Producto visible al registrar movimientos" : "Producto oculto"}
                />
              </div>
              {productType !== "tarjeta_credito" ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-300 bg-slate-50/90 px-3 py-3 shadow-sm banking-dark:border-zinc-600 banking-dark:bg-zinc-800/75">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-slate-800 banking-dark:text-zinc-100">En total</span>
                    <p className={`mt-1 text-[11px] leading-snug ${settingsMuted}`}>
                      Incluir en «Saldo real» del resumen en Movimientos. Si está desactivado, la cuenta no suma en la
                      tarjeta Total (útil para respaldos o transitorias). La deuda de tarjeta asociada a esta cuenta
                      tampoco descuenta ese total.
                    </p>
                  </div>
                  <BankingEnabledToggle
                    enabled={includeInTotalModal}
                    disabled={saving}
                    onChange={(next) => setIncludeInTotalModal(next)}
                    title={
                      includeInTotalModal
                        ? "Suma en el total del resumen en Movimientos"
                        : "No suma en el total del resumen"
                    }
                    ariaLabel={
                      includeInTotalModal
                        ? "Incluir esta cuenta líquida en el saldo total del resumen"
                        : "Excluir esta cuenta del saldo total del resumen"
                    }
                  />
                </div>
              ) : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAccountModalOpen(false);
                  setEditingAccount(null);
                }}
                className={settingsGhostBtn}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveAccountModal()}
                className={btnGreenBanking}
              >
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
