import type { CSSProperties, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { IconDotsHorizontal } from "./bankingTxIcons";
import { useBankingTheme } from "./BankingThemeContext";
import type {
  BankingAccountRow,
  BankingBankRow,
  BankingCategoryRow,
  BankingProductType,
  BankingSubcategoryRow,
} from "./types";

/** Coincide con `backend` `_BANK_CAT_DEFAULT`: acento verde del nuevo estilo, para categorías nuevas. */
const BANKING_DEFAULT_NEW_CATEGORY_COLOR = "#4B7B63";

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Color de categoría para usar como texto: en modo claro, los pasteles pensados para fondo
 * oscuro (p. ej. #8FBFA6, #C79A56) casi no contrastan sobre blanco/crema — se limita el
 * lightness a un máximo legible. En oscuro se usa el color tal cual (ahí sí contrasta bien).
 */
function categoryTextColor(hex: string, isDark: boolean): string {
  if (isDark) return hex;
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const cappedL = Math.min(hsl.l, 42);
  if (cappedL === hsl.l) return hex;
  return hslToHex(hsl.h, hsl.s, cappedL);
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

/** Activo/inactivo para producto, categoría o subcategoría (`role="switch"`, no checkbox). */
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
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFFFFF] banking-dark:focus-visible:ring-offset-[#12161d] disabled:cursor-not-allowed disabled:opacity-50 ${
        enabled ? "border-[#6FA588] bg-[#8FBFA6]" : "border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#EDE7D9] banking-dark:bg-[#21262d]"
      }`}
    >
      <span
        className={`pointer-events-none absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          enabled ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

type SettingsMenuItem = {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
};

/**
 * Menú «⋯» con acciones (Editar/Eliminar…), mismo patrón que en Movimientos.
 * Se monta en un portal con posición `fixed` para no quedar recortado por el
 * `overflow-hidden` de las tarjetas de categoría cuando están minimizadas.
 */
function BankingSettingsMenu({ items, ariaLabel }: { items: SettingsMenuItem[]; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuWidth = 176;

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onReflow() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - menuWidth, window.innerWidth - menuWidth - 8)) });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8A8072] banking-dark:text-[#8b949e] transition-colors hover:bg-[#ECE5D6] banking-dark:hover:bg-[#1c2129] hover:text-[#2B2620] banking-dark:hover:text-[#F3F1EC]"
      >
        <IconDotsHorizontal className="h-4 w-4" />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={ariaLabel}
              className="fixed z-[90] w-44 overflow-hidden rounded-xl border border-[#EDE7D9] banking-dark:border-[#21262d] bg-[#F5F1E8] banking-dark:bg-[#161b22] py-1 shadow-2xl shadow-black/12 banking-dark:shadow-black/40"
              style={{ top: pos.top, left: pos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              {items.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  title={it.title}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    it.onClick();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    it.danger ? "text-[#DC2626] banking-dark:text-[#f85149] hover:bg-[#DC2626]/10 banking-dark:hover:bg-[#f85149]/10" : "text-[#4A453C] banking-dark:text-[#c9d1d9] hover:bg-[#ECE5D6] banking-dark:hover:bg-[#1c2129]"
                  }`}
                >
                  {it.icon}
                  {it.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Vista flotante mientras se arrastra: mismo ancho que la lista y altura similar si está expandida. */
function CategoryDragPreview({ cat, expanded }: { cat: BankingCategoryRow; expanded: boolean }) {
  const { isDark } = useBankingTheme();
  return (
    <div className="pointer-events-none box-border w-full min-w-[min(100%,42rem)] max-w-full cursor-grabbing overflow-hidden rounded-xl border border-[#8FBFA6]/40 bg-[#F5F1E8] banking-dark:bg-[#161b22] shadow-2xl shadow-black/15 banking-dark:shadow-black/50 ring-2 ring-[#8FBFA6]/25">
      <div className="flex items-center gap-2 px-4 py-2.5">
        <IconGripVertical className="h-4 w-4 shrink-0 text-[#9A9284] banking-dark:text-[#6b7280]" />
        <span
          className="min-w-0 flex-1 text-sm font-medium leading-snug"
          style={{ color: categoryTextColor(cat.color, isDark) }}
        >
          {cat.name}
        </span>
        <span className="shrink-0 text-xs text-[#9A9284] banking-dark:text-[#6b7280]">({cat.subcategories.length})</span>
      </div>
      {expanded ? (
        <div className="border-t border-[#EDE7D9] banking-dark:border-[#21262d] px-4 py-2.5 text-[11px] leading-relaxed text-[#9A9284] banking-dark:text-[#6b7280]">
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

const btnGreen =
  "inline-flex items-center gap-1.5 rounded-lg bg-[#8FBFA6] px-3.5 py-2 text-sm font-semibold text-[#1F2E25] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50";

const selectFieldClass =
  "mt-1.5 w-full rounded-lg border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FBFAF7] banking-dark:bg-[#0d1117] px-3 py-2 text-sm text-[#2B2620] banking-dark:text-[#F3F1EC] shadow-sm outline-none transition focus:border-[#58a6ff] focus:ring-2 focus:ring-[#58a6ff]/20 [color-scheme:light] banking-dark:[color-scheme:dark]";

const bankingSettingsCardClass = "rounded-2xl border border-[#E8E1D4] banking-dark:border-[#1e242e] bg-[#FFFFFF] banking-dark:bg-[#12161d] p-5";

const settingsMuted = "text-[#8A8072] banking-dark:text-[#8b949e]";

const settingsGhostBtn =
  "rounded-lg border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#F5F1E8] banking-dark:bg-[#161b22] px-4 py-2 text-sm text-[#4A453C] banking-dark:text-[#c9d1d9] transition hover:bg-[#ECE5D6] banking-dark:hover:bg-[#1c2129]";

const settingsGhostBtnSm =
  "shrink-0 rounded-lg border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#F5F1E8] banking-dark:bg-[#161b22] px-3 py-1.5 text-xs text-[#4A453C] banking-dark:text-[#c9d1d9] transition hover:bg-[#ECE5D6] banking-dark:hover:bg-[#1c2129]";

/** Asa de arrastre / chevron en filas de categoría. */
const categoryHandleHover = "text-[#9A9284] banking-dark:text-[#6b7280] hover:bg-[#ECE5D6] banking-dark:hover:bg-[#1c2129] hover:text-[#5C7F6C] banking-dark:hover:text-[#8FBFA6]";

/**
 * Reordena para mostrar visibles primero y ocultas (`enabled === false`) al final,
 * preservando el orden relativo dentro de cada grupo. El backend de reordenar exige
 * la lista completa (visibles + ocultas), así que esto solo cambia la presentación,
 * no separa las ocultas en un contexto de drag-and-drop distinto.
 */
function partitionByEnabled<T extends { enabled?: boolean }>(rows: T[]): T[] {
  const visible = rows.filter((r) => r.enabled ?? true);
  const hidden = rows.filter((r) => !(r.enabled ?? true));
  return [...visible, ...hidden];
}

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

type SettingsTab = "productos" | "categorias";

const NAV_ITEMS: { id: SettingsTab; label: string; icon: (p: { className?: string }) => ReactNode }[] = [
  {
    id: "productos",
    label: "Productos",
    icon: ({ className }) => (
      <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20M6 15h.01M10 15h4" />
      </svg>
    ),
  },
  {
    id: "categorias",
    label: "Categorías",
    icon: ({ className }) => (
      <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
];

/**
 * Contenido embebido en Perfil → pestaña «Banking» (ya no es una página propia con ruta:
 * ver Profile.tsx). Usa pestañas tipo pill (Productos/Categorías) en vez de nav lateral
 * para no anidar dos columnas de navegación dentro del layout de Perfil.
 */
export function BankingSettingsSection({ onToast }: { onToast: (msg: string | null) => void }) {
  const { isDark } = useBankingTheme();
  const [tab, setTab] = useState<SettingsTab>("productos");
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
    () => partitionByEnabled(categories.filter((c) => !c.internal_reserved)),
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

  async function removeSubcategory(cat: BankingCategoryRow, sub: BankingSubcategoryRow) {
    if (sub.has_transactions) return;
    if (!confirm(`¿Eliminar «${sub.name}»?`)) return;
    setBusyKey(`del-sub-${sub.id}`);
    try {
      const r = await apiFetch(`/banking/subcategories/${sub.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { detail?: string } | null;
        onToast(j?.detail ?? "No se pudo eliminar la subcategoría");
        return;
      }
      if (subNameEdit?.id === sub.id) setSubNameEdit(null);
      onToast("Subcategoría eliminada");
      await load();
    } catch {
      onToast("No se pudo eliminar la subcategoría");
    } finally {
      setBusyKey(null);
    }
    void cat;
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
    <div className={`rounded-2xl bg-[#FAF7F1] p-5 banking-dark:bg-[#0d1117] ${isDark ? "banking-dark" : ""}`}>
      <div className="mb-5 flex flex-wrap items-center gap-1.5 border-b border-[#E8E1D4] banking-dark:border-[#1e242e] pb-3">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              tab === id
                ? "bg-[#8FBFA6]/16 banking-dark:bg-[#8FBFA6]/10 text-[#5C7F6C] banking-dark:text-[#8FBFA6]"
                : "text-[#8A8072] banking-dark:text-[#8b949e] hover:text-[#4A453C] banking-dark:hover:text-[#c9d1d9]"
            }`}
          >
            <Icon className="shrink-0" />
            {label}
          </button>
        ))}
      </div>

      <div>
        {tab === "productos" && (
          <div>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">Productos</h3>
                <p className="mt-1 text-sm text-[#8A8072] banking-dark:text-[#8b949e]">
                  Activa la visibilidad en «Nuevo movimiento» y, en cuentas líquidas, si suman en el «Saldo real» del
                  resumen en Movimientos.
                </p>
              </div>
              <button type="button" onClick={openNewProduct} className={btnGreen}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Agregar producto
              </button>
            </div>

            <div className={`${bankingSettingsCardClass} p-0`}>
              {loading ? (
                <p className={`p-5 text-sm ${settingsMuted}`}>Cargando…</p>
              ) : accounts.length === 0 ? (
                <p className={`p-5 text-sm ${settingsMuted}`}>No hay productos todavía. Usa «Agregar producto».</p>
              ) : (
                <ul className="divide-y divide-[#F0EAE0] banking-dark:divide-[#1a1f2e]" role="list">
                  {accounts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#2B2620] banking-dark:text-[#F3F1EC]">{a.name}</p>
                        <p className={`text-xs ${settingsMuted}`}>
                          {productTypeLabel(a.product_type)}
                          {a.bank_name ? ` · ${a.bank_name}` : ""}
                          {a.product_type === "tarjeta_credito" && a.linked_checking_account_name
                            ? ` · Liquidación: ${a.linked_checking_account_name}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-4">
                        <div
                          className="flex flex-col items-center gap-1"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <span className="text-[9.5px] font-semibold uppercase tracking-wide text-[#9A9284] banking-dark:text-[#6b7280]">Activa</span>
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
                            className="flex flex-col items-center gap-1"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            <span className="text-[9.5px] font-semibold uppercase tracking-wide text-[#9A9284] banking-dark:text-[#6b7280]">En total</span>
                            <BankingEnabledToggle
                              enabled={a.include_in_total_balance !== false}
                              disabled={busyKey !== null}
                              onChange={(next) => void setAccountIncludeInTotalRow(a, next)}
                              title={
                                a.include_in_total_balance !== false
                                  ? "Incluida en el saldo total del resumen"
                                  : "Excluida del saldo total (respaldos / transitorias)"
                              }
                              ariaLabel={`«${a.name}»: ${a.include_in_total_balance !== false ? "incluida en saldo total" : "excluida del saldo total"}`}
                            />
                          </div>
                        ) : null}
                        <BankingSettingsMenu
                          ariaLabel={`Acciones para «${a.name}»`}
                          items={[
                            {
                              label: "Editar",
                              icon: <IconPencil className="h-3.5 w-3.5" />,
                              onClick: () => openEditAccount(a),
                            },
                            {
                              label: "Eliminar",
                              icon: <IconTrash className="h-3.5 w-3.5" />,
                              danger: true,
                              disabled: !!a.has_transactions || busyKey !== null,
                              title: a.has_transactions
                                ? "Hay movimientos: no se puede eliminar; desactiva la visibilidad si no quieres usarlo."
                                : "Eliminar producto",
                              onClick: () => void removeAccount(a),
                            },
                          ]}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {tab === "categorias" && (
          <div>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">Categorías y subcategorías</h3>
                <p className={`mt-1 text-sm ${settingsMuted}`}>
                  Categorías iniciales desde el servidor; puedes añadir las tuyas, editar nombre y color (salvo
                  plantilla fijada) y crear subcategorías en cualquier categoría manual o de plantilla. Arrastra ⋮⋮
                  para reordenar (mismo orden en movimientos).
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
                className={btnGreen}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Nueva categoría
              </button>
            </div>

            {newCategoryForm ? (
              <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-dashed border-[#8FBFA6]/35 bg-[#8FBFA6]/[0.06] p-4 sm:flex-row sm:flex-wrap sm:items-end">
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
                    className="h-10 w-14 cursor-pointer rounded-lg border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FBFAF7] banking-dark:bg-[#0d1117] p-1 shadow-sm"
                    title="Color de la categoría"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyKey !== null}
                    onClick={() => void createCategory()}
                    className={`${btnGreen} px-4 py-2 text-sm`}
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
                <div className="flex flex-col gap-2.5">
                  <SortableContext items={sortableCategories.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    {sortableCategories.map((cat, catIdx) => {
                      const catHidden = !(cat.enabled ?? true);
                      const prevHidden = catIdx > 0 && !(sortableCategories[catIdx - 1].enabled ?? true);
                      const isFirstHidden = catHidden && !prevHidden;
                      return (
                      <Fragment key={cat.id}>
                        {isFirstHidden ? (
                          <p className={`mt-1 text-xs leading-relaxed ${settingsMuted}`}>
                            Ocultas — no aparecen al elegir categoría en movimientos nuevos, pero podés reactivarlas
                            cuando quieras.
                          </p>
                        ) : null}
                      <SortableCategoryWrapper id={cat.id} disabled={busyKey !== null}>
                        {(handle) => (
                          <details
                            className={`group overflow-hidden rounded-2xl border bg-[#FFFFFF] banking-dark:bg-[#12161d] ${
                              catHidden ? "border-dashed border-[#DCD3C2] banking-dark:border-[#30363d] opacity-70" : "border-[#E8E1D4] banking-dark:border-[#1e242e]"
                            }`}
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
                            <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-[#E8E1D4] banking-dark:border-[#1e242e] px-3 py-2.5 marker:content-none sm:px-4 [&::-webkit-details-marker]:hidden">
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
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[#9A9284] banking-dark:text-[#6b7280] transition-transform duration-200 group-open:rotate-180"
                                aria-hidden
                              >
                                <IconChevronDown className="block h-4 w-4" />
                              </span>
                              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                                {categoryFullEdit?.id === cat.id ? (
                                  <>
                                    <input
                                      type="text"
                                      className="min-w-[10rem] flex-1 rounded-lg border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FBFAF7] banking-dark:bg-[#0d1117] px-2 py-1.5 text-sm font-medium text-[#2B2620] banking-dark:text-[#F3F1EC] shadow-sm outline-none focus:border-[#58a6ff] focus:ring-2 focus:ring-[#58a6ff]/20"
                                      value={categoryFullEdit.name}
                                      onChange={(e) =>
                                        setCategoryFullEdit({ ...categoryFullEdit, name: e.target.value })
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                      aria-label="Nombre de categoría"
                                    />
                                    <span className={`shrink-0 text-xs ${settingsMuted}`}>({cat.subcategories.length})</span>
                                    <div
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                      }}
                                    >
                                      <BankingEnabledToggle
                                        enabled={cat.enabled ?? true}
                                        disabled={busyKey !== null}
                                        onChange={(next) => void setCategoryEnabled(cat, next)}
                                        title={
                                          cat.enabled ?? true
                                            ? "Visible al elegir categoría en movimientos nuevos"
                                            : "Oculta: no aparece al elegir categoría en movimientos nuevos"
                                        }
                                        ariaLabel={`Categoría «${cat.name}»: ${cat.enabled ?? true ? "activa" : "oculta"}`}
                                      />
                                    </div>
                                    <input
                                      type="color"
                                      value={categoryFullEdit.color}
                                      onChange={(e) =>
                                        setCategoryFullEdit({ ...categoryFullEdit, color: e.target.value })
                                      }
                                      className="h-9 w-12 shrink-0 cursor-pointer rounded border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FBFAF7] banking-dark:bg-[#0d1117] p-0.5 shadow-sm"
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
                                      className={`${btnGreen} shrink-0 px-3 py-1.5 text-xs`}
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
                                  </>
                                ) : (
                                  <>
                                    <span
                                      className="h-3 w-3 shrink-0 rounded"
                                      style={{ background: cat.color }}
                                      aria-hidden
                                    />
                                    <p
                                      className="m-0 min-w-0 flex-1 text-sm font-medium leading-snug"
                                      style={{ color: categoryTextColor(cat.color, isDark) }}
                                    >
                                      {cat.name}{" "}
                                      <span className={`font-normal ${settingsMuted}`}>({cat.subcategories.length})</span>
                                    </p>
                                    {catHidden ? (
                                      <span className="shrink-0 rounded-md border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FBFAF7] banking-dark:bg-[#0d1117] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[#8A8072] banking-dark:text-[#8b949e]">
                                        Oculta
                                      </span>
                                    ) : null}
                                    <div className="ml-auto flex h-8 shrink-0 items-center gap-2">
                                      <div
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                        }}
                                      >
                                        <BankingEnabledToggle
                                          enabled={cat.enabled ?? true}
                                          disabled={busyKey !== null}
                                          onChange={(next) => void setCategoryEnabled(cat, next)}
                                          title={
                                            cat.enabled ?? true
                                              ? "Visible al elegir categoría en movimientos nuevos"
                                              : "Oculta: no aparece al elegir categoría en movimientos nuevos"
                                          }
                                          ariaLabel={`Categoría «${cat.name}»: ${cat.enabled ?? true ? "activa" : "oculta"}`}
                                        />
                                      </div>
                                      <BankingSettingsMenu
                                        ariaLabel={`Acciones para «${cat.name}»`}
                                        items={[
                                          {
                                            label: "Editar",
                                            icon: <IconPencil className="h-3.5 w-3.5" />,
                                            onClick: () => {
                                              setCategoryFullEdit({
                                                id: cat.id,
                                                name: cat.name,
                                                color: cat.color || BANKING_DEFAULT_NEW_CATEGORY_COLOR,
                                              });
                                            },
                                          },
                                          {
                                            label: "Eliminar categoría",
                                            icon: <IconTrash className="h-3.5 w-3.5" />,
                                            danger: true,
                                            disabled: cat.names_locked || !!(cat.has_transactions ?? false) || busyKey !== null,
                                            title: cat.names_locked
                                              ? "Categoría fijada por plantilla: no se puede eliminar."
                                              : (cat.has_transactions ?? false)
                                                ? "Hay movimientos con esta categoría; no se puede eliminar."
                                                : "Eliminar categoría",
                                            onClick: () => void removeCategory(cat),
                                          },
                                        ]}
                                      />
                                    </div>
                                  </>
                                )}
                              </div>
                            </summary>
                            <ul className="list-none space-y-1.5 px-3 py-3 sm:px-4" role="list">
                              <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragEnd={(e) => handleSubcategoriesDragEnd(cat.id, e)}
                              >
                                <SortableContext
                                  items={partitionByEnabled(cat.subcategories).map((s) => subSortableId(s.id))}
                                  strategy={verticalListSortingStrategy}
                                >
                                  {partitionByEnabled(cat.subcategories).map((s, subIdx, orderedSubs) => {
                                    const parentEnabled = cat.enabled ?? true;
                                    const subHidden = !(s.enabled ?? true);
                                    const subPrevHidden = subIdx > 0 && !(orderedSubs[subIdx - 1].enabled ?? true);
                                    const isFirstHiddenSub = subHidden && !subPrevHidden;
                                    const dragDisabled = busyKey !== null || !parentEnabled;
                                    const toggleDisabled = busyKey !== null || !parentEnabled;
                                    const showOn = parentEnabled ? (s.enabled ?? true) : false;
                                    const isEditingThis = subNameEdit?.id === s.id;
                                    return (
                                      <Fragment key={s.id}>
                                      {isFirstHiddenSub ? (
                                        <li className={`list-none px-1 pt-1.5 text-[10.5px] font-medium uppercase tracking-wide ${settingsMuted}`}>
                                          Ocultas
                                        </li>
                                      ) : null}
                                      <SortableSubcategoryWrapper subId={s.id} disabled={dragDisabled}>
                                        {(handle) =>
                                          isEditingThis ? (
                                            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#8FBFA6]/50 bg-[#FBFAF7] banking-dark:bg-[#0d1117] p-2">
                                              <input
                                                type="text"
                                                className="min-w-[8rem] flex-1 rounded-md border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FFFFFF] banking-dark:bg-[#12161d] px-2.5 py-1.5 text-sm text-[#2B2620] banking-dark:text-[#F3F1EC] outline-none focus:border-[#8FBFA6]"
                                                value={subNameEdit.name}
                                                onChange={(e) => setSubNameEdit({ ...subNameEdit, name: e.target.value })}
                                                onClick={(e) => e.stopPropagation()}
                                                aria-label="Nombre de subcategoría"
                                                autoFocus
                                              />
                                              <div className="flex shrink-0 gap-1.5">
                                                <button
                                                  type="button"
                                                  disabled={busyKey !== null}
                                                  className="rounded-md bg-[#8FBFA6] px-3 py-1.5 text-xs font-semibold text-[#1F2E25] hover:brightness-110 disabled:opacity-40"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    void saveSubNameEdit();
                                                  }}
                                                >
                                                  Guardar
                                                </button>
                                                <button
                                                  type="button"
                                                  disabled={busyKey !== null}
                                                  className="rounded-md border border-[#DCD3C2] banking-dark:border-[#30363d] px-3 py-1.5 text-xs text-[#8A8072] banking-dark:text-[#8b949e] hover:bg-[#ECE5D6] banking-dark:hover:bg-[#1c2129]"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSubNameEdit(null);
                                                  }}
                                                >
                                                  Cancelar
                                                </button>
                                              </div>
                                            </div>
                                          ) : (
                                            <div
                                              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2 py-2 text-xs ${
                                                !parentEnabled
                                                  ? "cursor-not-allowed border-[#E8E1D4] banking-dark:border-[#1e242e] bg-[#F3EEE3] banking-dark:bg-[#0d1117]/60 text-[#9A9284] banking-dark:text-[#6b7280]"
                                                  : subHidden
                                                    ? "border-dashed border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#F3EEE3] banking-dark:bg-[#0d1117]/60 text-[#8A8072] banking-dark:text-[#8b949e]"
                                                    : "border-[#E8E1D4] banking-dark:border-[#1e242e] bg-[#FBFAF7] banking-dark:bg-[#0d1117] text-[#4A453C] banking-dark:text-[#c9d1d9]"
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
                                                <span className="min-w-0 flex-1">{s.name}</span>
                                              </div>
                                              <div
                                                className="flex shrink-0 items-center gap-2"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                <div>
                                                  <BankingEnabledToggle
                                                    enabled={showOn}
                                                    disabled={toggleDisabled}
                                                    onChange={(next) => void setSubcategoryEnabled(s, next)}
                                                    title={
                                                      !parentEnabled
                                                        ? "Activa la categoría primero para poder usar o cambiar subcategorías."
                                                        : showOn
                                                          ? "Visible al elegir subcategoría en movimientos nuevos"
                                                          : "Oculta: no aparece al elegir subcategoría en movimientos nuevos"
                                                    }
                                                    ariaLabel={`Subcategoría «${s.name}»: ${showOn ? "activa" : "oculta"}`}
                                                  />
                                                </div>
                                                <BankingSettingsMenu
                                                  ariaLabel={`Acciones para «${s.name}»`}
                                                  items={[
                                                    {
                                                      label: "Editar",
                                                      icon: <IconPencil className="h-3.5 w-3.5" />,
                                                      disabled: busyKey !== null || !parentEnabled,
                                                      onClick: () =>
                                                        setSubNameEdit({ id: s.id, categoryId: cat.id, name: s.name }),
                                                    },
                                                    {
                                                      label: "Eliminar",
                                                      icon: <IconTrash className="h-3.5 w-3.5" />,
                                                      danger: true,
                                                      disabled: busyKey !== null || !parentEnabled || !!(s.has_transactions ?? false),
                                                      title: !parentEnabled
                                                        ? "Activa la categoría primero para poder eliminar subcategorías."
                                                        : (s.has_transactions ?? false)
                                                          ? "Hay movimientos con esta subcategoría; no se puede eliminar."
                                                          : "Eliminar subcategoría",
                                                      onClick: () => void removeSubcategory(cat, s),
                                                    },
                                                  ]}
                                                />
                                              </div>
                                            </div>
                                          )
                                        }
                                      </SortableSubcategoryWrapper>
                                      </Fragment>
                                    );
                                  })}
                                </SortableContext>
                              </DndContext>
                              <li className="mt-2 flex list-none flex-wrap items-center gap-2 border-t border-[#E8E1D4] banking-dark:border-[#1e242e] pt-3">
                                <input
                                  type="text"
                                  value={newSubDraft[cat.id] ?? ""}
                                  onChange={(e) => setNewSubDraft((d) => ({ ...d, [cat.id]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      void createSubcategory(cat.id);
                                    }
                                  }}
                                  placeholder="Nueva subcategoría…"
                                  className="min-w-[10rem] flex-1 rounded-lg border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FBFAF7] banking-dark:bg-[#0d1117] px-2.5 py-1.5 text-xs text-[#2B2620] banking-dark:text-[#F3F1EC] outline-none focus:border-[#58a6ff]"
                                  disabled={busyKey !== null || !(cat.enabled ?? true)}
                                />
                                <button
                                  type="button"
                                  disabled={busyKey !== null || !(cat.enabled ?? true)}
                                  className={`${btnGreen} shrink-0 px-3 py-1.5 text-xs`}
                                  onClick={() => void createSubcategory(cat.id)}
                                >
                                  Añadir
                                </button>
                              </li>
                            </ul>
                          </details>
                        )}
                      </SortableCategoryWrapper>
                      </Fragment>
                      );
                    })}
                  </SortableContext>
                  {reservedCategories.length > 0 ? (
                    <p className={`text-xs leading-relaxed ${settingsMuted}`}>
                      Categorías reservadas para la aplicación (siempre activas; no aparecen al agregar movimientos a
                      mano). El color sí se puede personalizar.
                    </p>
                  ) : null}
                  {reservedCategories.map((cat) => (
                    <div key={cat.id}>
                      <details
                        className="group overflow-hidden rounded-2xl border border-dashed border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FDFCF9] banking-dark:bg-[#12161d]/60"
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
                        <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-[#DCD3C2] banking-dark:border-[#30363d] px-3 py-2.5 marker:content-none sm:px-4 [&::-webkit-details-marker]:hidden">
                          <span className="inline-flex h-8 w-8 shrink-0" aria-hidden />
                          <span
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[#9A9284] banking-dark:text-[#6b7280] transition-transform duration-200 group-open:rotate-180"
                            aria-hidden
                          >
                            <IconChevronDown className="block h-4 w-4" />
                          </span>
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                            {categoryEdit?.id === cat.id ? (
                              <>
                                <span className="h-3 w-3 shrink-0 rounded" style={{ background: cat.color }} aria-hidden />
                                <p className="m-0 min-w-0 flex-1 text-sm font-medium leading-snug" style={{ color: categoryTextColor(cat.color, isDark) }}>
                                  {cat.name}{" "}
                                  <span className={`font-normal ${settingsMuted}`}>({cat.subcategories.length})</span>
                                </p>
                                <span className="shrink-0 rounded-md border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FBFAF7] banking-dark:bg-[#0d1117] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[#8A8072] banking-dark:text-[#8b949e]">
                                  Siempre activa
                                </span>
                                <input
                                  type="color"
                                  value={categoryEdit.color}
                                  onChange={(e) => setCategoryEdit({ ...categoryEdit, color: e.target.value })}
                                  className="h-9 w-12 shrink-0 cursor-pointer rounded border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FBFAF7] banking-dark:bg-[#0d1117] p-0.5 shadow-sm"
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
                                  className={`${btnGreen} shrink-0 px-3 py-1.5 text-xs`}
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
                                <span className="h-3 w-3 shrink-0 rounded" style={{ background: cat.color }} aria-hidden />
                                <p className="m-0 min-w-0 flex-1 text-sm font-medium leading-snug" style={{ color: categoryTextColor(cat.color, isDark) }}>
                                  {cat.name}{" "}
                                  <span className={`font-normal ${settingsMuted}`}>({cat.subcategories.length})</span>
                                </p>
                                <div className="ml-auto flex h-8 shrink-0 items-center gap-2">
                                  <span className="shrink-0 rounded-md border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#FBFAF7] banking-dark:bg-[#0d1117] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[#8A8072] banking-dark:text-[#8b949e]">
                                    Siempre activa
                                  </span>
                                  <button
                                    type="button"
                                    title="Cambiar color"
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#8A8072] banking-dark:text-[#8b949e] transition hover:bg-[#ECE5D6] banking-dark:hover:bg-[#1c2129] hover:text-[#2B2620] banking-dark:hover:text-[#F3F1EC]"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setCategoryEdit({ id: cat.id, color: cat.color || BANKING_DEFAULT_NEW_CATEGORY_COLOR });
                                    }}
                                  >
                                    <IconPencil className="h-4 w-4" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        </summary>
                        <ul className="list-none space-y-1.5 px-3 py-3 sm:px-4" role="list">
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
                                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#E8E1D4] banking-dark:border-[#1e242e] bg-[#FBFAF7] banking-dark:bg-[#0d1117] px-2 py-2 text-xs text-[#4A453C] banking-dark:text-[#c9d1d9]">
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
                                          className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-[#9A9284] banking-dark:text-[#6b7280]"
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
        )}

        <p className="mt-10 text-center text-xs text-[#9A9284] banking-dark:text-[#6b7280]">
          <Link to="/banking/transactions" className="font-medium text-[#5C7F6C] banking-dark:text-[#8FBFA6] hover:underline">
            Ir a movimientos
          </Link>
        </p>
      </div>

      {accountModalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="banking-product-modal-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#EDE7D9] banking-dark:border-[#21262d] bg-[#F5F1E8] banking-dark:bg-[#161b22] p-6 shadow-2xl shadow-black/12 banking-dark:shadow-black/40">
            <h3 id="banking-product-modal-title" className="text-base font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
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
                    <p className="mt-1.5 text-xs text-[#B45309] banking-dark:text-[#d29922]">
                      No tienes una cuenta corriente en este banco. Agrégala primero y vuelve a editar esta tarjeta.
                    </p>
                  ) : null}
                </label>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#F3EEE3] banking-dark:bg-[#0d1117]/60 px-3 py-3 shadow-sm">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-[#2B2620] banking-dark:text-[#F3F1EC]">Activa</span>
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
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#DCD3C2] banking-dark:border-[#30363d] bg-[#F3EEE3] banking-dark:bg-[#0d1117]/60 px-3 py-3 shadow-sm">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-[#2B2620] banking-dark:text-[#F3F1EC]">En total</span>
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
              <button type="button" disabled={saving} onClick={() => void saveAccountModal()} className={btnGreen}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
