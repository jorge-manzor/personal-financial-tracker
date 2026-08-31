import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch, fetchJson, patchJson, postJson } from "./api";
import { useBankingTheme } from "./BankingThemeContext";
import { formatClpDots } from "./format";

type ProjectContributionRow = {
  id: number;
  project_id: number;
  amount: number;
  fecha: string;
  note: string | null;
  created_at: string;
};

type ProjectItemPaymentRow = {
  id: number;
  item_id: number;
  amount: number;
  fecha: string;
  note: string | null;
  created_at: string;
};

type ProjectItemRow = {
  id: number;
  project_id: number;
  name: string;
  costo_total: number;
  fecha_limite: string | null;
  sort_order: number;
  monto_pagado: number;
  monto_restante: number;
  payments: ProjectItemPaymentRow[];
};

type ProjectListRow = {
  id: number;
  name: string;
  description: string | null;
  is_archived: boolean;
  presupuesto_total: number;
  comprometido: number;
  pagado: number;
  disponible: number;
  items_count: number;
};

type ProjectSortKey = "name" | "presupuesto_total" | "comprometido" | "pagado" | "disponible" | "items_count";

/** Fila unificada del historial de movimientos: aportes (entradas) y abonos a ítems (salidas). */
type MovementRow =
  | {
      kind: "in";
      key: string;
      fecha: string;
      sortKey: string;
      amount: number;
      note: string | null;
      contributionId: number;
    }
  | {
      kind: "out";
      key: string;
      fecha: string;
      sortKey: string;
      amount: number;
      note: string | null;
      itemName: string;
      itemId: number;
      paymentId: number;
    };

/** Acción de borrado pendiente de confirmación dentro del detalle de un proyecto. */
type PendingDelete =
  | { kind: "project" }
  | { kind: "contribution"; id: number }
  | { kind: "item"; id: number }
  | { kind: "payment"; itemId: number; paymentId: number };

type ProjectDetailRow = {
  id: number;
  name: string;
  description: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  presupuesto_total: number;
  comprometido: number;
  pagado: number;
  disponible: number;
  contributions: ProjectContributionRow[];
  items: ProjectItemRow[];
};

/** Misma paleta que las páginas de banking (indigo claro / ámbar oscuro), vía `isDark` explícito. */
function pageShell(isDark: boolean): string {
  return `w-full min-h-[calc(100dvh-3.5rem)] ${
    isDark
      ? "bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(251,191,36,0.055),transparent_52%),linear-gradient(to_bottom,#0d0d0d,#070707)] text-zinc-300"
      : "bg-slate-100 bg-gradient-to-br from-slate-100 via-white to-slate-100 text-slate-800"
  }`;
}

function panelCard(isDark: boolean): string {
  return isDark
    ? "rounded-2xl border border-zinc-700 bg-zinc-900/95 p-5 shadow-none ring-1 ring-white/5"
    : "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/[0.04]";
}

function fieldLabel(isDark: boolean): string {
  return `block text-[10px] font-semibold uppercase tracking-wide ${
    isDark ? "text-zinc-400" : "text-slate-500"
  }`;
}

function fieldInput(isDark: boolean): string {
  return [
    "mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none ring-indigo-400/0 transition focus:ring-2",
    isDark
      ? "border-zinc-600 bg-zinc-950 text-zinc-100 focus:border-amber-500 focus:ring-amber-500/35"
      : "border-slate-300 bg-white text-slate-900 focus:border-indigo-400 focus:ring-indigo-400/35 [color-scheme:light]",
  ].join(" ");
}

/** Igual que `fieldInput` pero sin el margen superior — para formularios inline sin `<label>` de por medio. */
function compactInput(isDark: boolean): string {
  return [
    "w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none transition focus:ring-2",
    isDark
      ? "border-zinc-600 bg-zinc-950 text-zinc-100 focus:border-amber-500 focus:ring-amber-500/35"
      : "border-slate-300 bg-white text-slate-900 focus:border-indigo-400 focus:ring-indigo-400/35 [color-scheme:light]",
  ].join(" ");
}

function primaryBtn(isDark: boolean): string {
  return [
    "rounded-lg px-4 py-2 text-sm font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-50",
    isDark
      ? "bg-amber-500 text-zinc-950 shadow-md hover:bg-amber-400 disabled:opacity-45"
      : "bg-indigo-600 text-white hover:bg-indigo-700",
  ].join(" ");
}

function secondaryBtn(isDark: boolean): string {
  return [
    "rounded-lg border px-4 py-2 text-sm font-medium shadow-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
    isDark
      ? "border-zinc-500 bg-zinc-900 text-zinc-100 hover:border-indigo-400/55 hover:bg-indigo-950/35"
      : "border-slate-300 bg-white text-slate-800 hover:border-indigo-400 hover:bg-indigo-50",
  ].join(" ");
}

function dangerBtn(isDark: boolean): string {
  return [
    "rounded-lg border px-3 py-1.5 text-sm font-medium shadow-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
    isDark
      ? "border-rose-500/50 bg-rose-950/35 text-rose-400 hover:border-rose-400/80 hover:bg-rose-950/55"
      : "border-rose-300 bg-rose-50 text-rose-800 hover:border-rose-400 hover:bg-rose-100",
  ].join(" ");
}

/** Botón «+ Nuevo …», mismo estilo que «+ Nuevo movimiento» en movimientos bancarios. */
function newBtn(isDark: boolean): string {
  return isDark
    ? "rounded-xl border border-amber-600/45 bg-amber-600 px-4 py-2 text-xs font-semibold text-zinc-950 shadow-sm transition hover:border-amber-500/55 hover:bg-amber-500"
    : "rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800";
}

function modalOverlay(isDark: boolean): string {
  return isDark
    ? "fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-[3px]"
    : "fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[2px]";
}

function modalBox(isDark: boolean): string {
  return isDark
    ? "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl shadow-black/50"
    : "max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15";
}

function modalHeader(isDark: boolean): string {
  return `flex items-center justify-between gap-3 border-b px-6 py-4 ${
    isDark ? "border-zinc-800" : "border-slate-100"
  }`;
}

function modalTitle(isDark: boolean): string {
  return `text-base font-semibold ${isDark ? "text-zinc-100" : "text-slate-900"}`;
}

function modalCloseBtn(isDark: boolean): string {
  return isDark
    ? "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-40"
    : "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:pointer-events-none disabled:opacity-40";
}

function modalFooter(isDark: boolean): string {
  return `flex justify-end gap-2 border-t px-6 py-4 ${isDark ? "border-zinc-800" : "border-slate-100"}`;
}

function modalSecondaryBtn(isDark: boolean): string {
  return isDark
    ? "rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
    : "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
}

function modalPrimaryBtn(isDark: boolean): string {
  return isDark
    ? "rounded-xl border border-amber-600/45 bg-amber-600 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-sm transition hover:border-amber-500/55 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
    : "rounded-xl border border-indigo-800 bg-indigo-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:border-indigo-700 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40";
}

function modalDangerBtn(isDark: boolean): string {
  return isDark
    ? "rounded-xl border border-rose-600/60 bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:border-rose-500/70 hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
    : "rounded-xl border border-rose-600 bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:border-rose-500 hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40";
}

function ghostBtn(isDark: boolean): string {
  return isDark
    ? "text-xs font-semibold text-amber-300 hover:text-amber-200"
    : "text-xs font-semibold text-indigo-600 hover:text-indigo-700";
}

function heading1(isDark: boolean): string {
  return `text-2xl font-bold tracking-tight ${isDark ? "text-zinc-50" : "text-slate-900"}`;
}

function heading2(isDark: boolean): string {
  return `text-lg font-semibold ${isDark ? "text-zinc-100" : "text-slate-900"}`;
}

function heading3(isDark: boolean): string {
  return `text-base font-semibold ${isDark ? "text-zinc-100" : "text-slate-900"}`;
}

function bodyText(isDark: boolean): string {
  return `text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`;
}

function mutedText(isDark: boolean): string {
  return `text-xs ${isDark ? "text-zinc-500" : "text-slate-500"}`;
}

function warningText(isDark: boolean): string {
  return `text-xs ${isDark ? "text-amber-400" : "text-amber-700"}`;
}

function strongText(isDark: boolean): string {
  return isDark ? "text-zinc-100" : "text-slate-900";
}

function positiveText(isDark: boolean): string {
  return isDark ? "text-emerald-400" : "text-emerald-700";
}

function accentText(isDark: boolean): string {
  return isDark ? "text-amber-300" : "text-indigo-700";
}

function negativeText(isDark: boolean): string {
  return isDark ? "text-rose-400" : "text-rose-600";
}

function badgeClass(isDark: boolean): string {
  return isDark
    ? "rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400"
    : "rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500";
}

function completedBadgeClass(isDark: boolean): string {
  return isDark
    ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400"
    : "rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700";
}

/** Un proyecto se considera completado cuando lo comprometido en ítems ya fue pagado en su totalidad. */
function isProjectCompleted(comprometido: number, pagado: number): boolean {
  return comprometido > 0 && pagado >= comprometido;
}

function overdueBadgeClass(isDark: boolean): string {
  return isDark
    ? "rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-400"
    : "rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700";
}

/** Vencido: tiene fecha límite pasada y aún queda algo por pagar. */
function isItemOverdue(item: { fecha_limite: string | null; monto_restante: number }): boolean {
  if (!item.fecha_limite || item.monto_restante <= 0) return false;
  return item.fecha_limite < todayIso();
}

function sortArrow(active: boolean, dir: "asc" | "desc"): string {
  if (!active) return "";
  return dir === "asc" ? " ↑" : " ↓";
}

function bigAmountInput(isDark: boolean): string {
  return `w-full min-w-0 bg-transparent text-2xl font-bold tracking-tight outline-none placeholder:font-bold ${
    isDark ? "text-zinc-50 placeholder:text-zinc-700" : "text-slate-900 placeholder:text-slate-300"
  }`;
}

/** Línea inferior que resalta al enfocar el input de monto (afordancia de campo sin encajonarlo). */
function amountFieldWrap(isDark: boolean): string {
  return isDark
    ? "border-b-2 border-zinc-700 transition-colors focus-within:border-amber-500"
    : "border-b-2 border-slate-200 transition-colors focus-within:border-indigo-500";
}

/** Fila de historial estilo lista de movimientos (icono + detalle + monto), más cercana a Revolut que una tabla. */
function historyRow(isDark: boolean): string {
  return isDark
    ? "group flex items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-zinc-800/60"
    : "group flex items-center gap-2.5 rounded-xl px-2 py-2 transition hover:bg-slate-50";
}

function historyRowEditing(isDark: boolean): string {
  return isDark
    ? "flex flex-col items-stretch gap-2 rounded-xl bg-zinc-800/60 px-2 py-2.5"
    : "flex flex-col items-stretch gap-2 rounded-xl bg-slate-50 px-2 py-2.5";
}

function historyIconBadge(isDark: boolean, kind: "in" | "out"): string {
  if (kind === "out") {
    return isDark
      ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-500/15 text-rose-400"
      : "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600";
  }
  return isDark
    ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300"
    : "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600";
}

function IconArrowUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M10 15.5V5M10 5 5 10M10 5l5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconArrowDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M10 4.5V15M10 15l-5-5M10 15l5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Misma línea visual que la tabla de movimientos bancarios: card contenedor + cabecera + filas con hover. */
function tableWrapper(isDark: boolean): string {
  return isDark
    ? "overflow-x-auto rounded-2xl border border-zinc-700 bg-zinc-900/95 shadow-none ring-1 ring-white/5"
    : "overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.04]";
}

function theadRow(isDark: boolean): string {
  return isDark ? "border-b border-zinc-700 bg-zinc-950/60" : "border-b border-slate-200 bg-slate-50";
}

function thCell(isDark: boolean): string {
  return `whitespace-nowrap px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wide ${
    isDark ? "text-zinc-400" : "text-slate-500"
  }`;
}

function tbodyRow(isDark: boolean, clickable: boolean): string {
  return [
    "border-b transition-colors last:border-b-0",
    clickable ? "cursor-pointer" : "",
    isDark ? "border-zinc-800/90 hover:bg-zinc-900/70" : "border-slate-100 hover:bg-slate-50",
  ].join(" ");
}

const tdCellClass = "px-4 py-3 align-middle text-sm";

/** Celdas compactas para la lista de abonos dentro del modal de un ítem (más densa que las tablas principales). */
const compactTdCellClass = "px-3 py-1.5 align-middle text-xs";

function compactThCell(isDark: boolean): string {
  return `whitespace-nowrap px-3 py-1.5 text-left text-[9px] font-semibold uppercase tracking-wide ${
    isDark ? "text-zinc-400" : "text-slate-500"
  }`;
}

function progressTrack(isDark: boolean): string {
  return isDark ? "h-1.5 w-16 overflow-hidden rounded-full bg-zinc-700" : "h-1.5 w-16 overflow-hidden rounded-full bg-slate-200";
}

function progressFill(isDark: boolean, pct: number): string {
  const color = pct >= 100 ? (isDark ? "bg-emerald-400" : "bg-emerald-500") : isDark ? "bg-amber-500" : "bg-indigo-600";
  return `h-full rounded-full ${color}`;
}

function itemCompletionPct(item: { costo_total: number; monto_pagado: number }): number {
  if (item.costo_total <= 0) return 0;
  return Math.min(100, Math.round((item.monto_pagado / item.costo_total) * 100));
}

function iconBtn(isDark: boolean, variant: "danger" | "neutral" = "neutral"): string {
  const base = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition disabled:pointer-events-none disabled:opacity-40";
  if (variant === "danger") {
    return isDark
      ? `${base} text-rose-400 hover:bg-rose-950/45 hover:text-rose-300`
      : `${base} text-rose-600 hover:bg-rose-50 hover:text-rose-700`;
  }
  return isDark
    ? `${base} text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200`
    : `${base} text-slate-400 hover:bg-slate-100 hover:text-slate-700`;
}

/** Botón «volver», mismo lenguaje visual que los botones secundarios de la página. */
function backBtn(isDark: boolean): string {
  return [
    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium shadow-sm transition-colors duration-150",
    isDark
      ? "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-amber-500/55 hover:bg-amber-950/25 hover:text-amber-200"
      : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700",
  ].join(" ");
}

function IconArrowLeft({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path d="M12.5 4.5 6 10l6.5 5.5M6.5 10H16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

function IconTrash({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <path d="M4 6h12M8 6V4.5A1.5 1.5 0 019.5 3h1A1.5 1.5 0 0112 4.5V6m2 0v9.5A1.5 1.5 0 0112.5 17h-5A1.5 1.5 0 016 15.5V6h8z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      <path d="M13.5 3.5a1.5 1.5 0 0 1 2.12 2.12L6.5 14.75l-3 .75.75-3 9.25-9z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function parseMoney(raw: string): number {
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Confirmación de borrado con la misma estética de los demás modales (reemplaza `window.confirm`). */
function ConfirmDialog({
  isDark,
  title,
  message,
  busy,
  onConfirm,
  onCancel,
}: {
  isDark: boolean;
  title: string;
  message: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className={modalOverlay(isDark)}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className={`${modalBox(isDark)} max-w-sm`}>
        <div className={modalHeader(isDark)}>
          <h3 id="confirm-dialog-title" className={modalTitle(isDark)}>
            {title}
          </h3>
        </div>
        <div className="px-6 py-5">
          <p className={bodyText(isDark)}>{message}</p>
        </div>
        <div className={modalFooter(isDark)}>
          <button type="button" disabled={busy} className={modalSecondaryBtn(isDark)} onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" disabled={busy} className={modalDangerBtn(isDark)} onClick={onConfirm}>
            {busy ? "Eliminando…" : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const MAX_MOVEMENTS_SHOWN = 10;

/** Formatea dígitos como monto chileno con puntos de miles a medida que se escribe (ej. "100000" -> "100.000"). */
function formatAmountDots(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("es-CL");
}

const MONTH_SHORT_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Muestra «27 ago 2026» a partir de ISO `YYYY-MM-DD`. */
function formatDateEs(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return `${d} ${MONTH_SHORT_ES[m - 1]} ${y}`;
}

export function ProjectsPage({ onToast }: { onToast: (msg: string | null) => void }) {
  const { id } = useParams();
  const navigate = useNavigate();

  if (id) {
    return <ProjectDetail projectId={Number(id)} onToast={onToast} onBack={() => navigate("/proyectos")} />;
  }
  return <ProjectList onToast={onToast} onOpen={(pid) => navigate(`/proyectos/${pid}`)} />;
}

function ProjectList({
  onToast,
  onOpen,
}: {
  onToast: (msg: string | null) => void;
  onOpen: (id: number) => void;
}) {
  const { isDark } = useBankingTheme();
  const [projects, setProjects] = useState<ProjectListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [hideArchived, setHideArchived] = useState(false);
  const [sortKey, setSortKey] = useState<ProjectSortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: ProjectSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newInitialAmount, setNewInitialAmount] = useState("");
  const [newInitialFecha, setNewInitialFecha] = useState(() => todayIso());

  const loadProjects = useCallback(async () => {
    const rows = await fetchJson<ProjectListRow[]>("/proyectos/projects");
    setProjects(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadProjects()
      .catch((e) => {
        console.error(e);
        if (!cancelled) onToast("No se pudieron cargar los proyectos.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadProjects, onToast]);

  const openNewProjectModal = () => {
    setNewName("");
    setNewDescription("");
    setNewInitialAmount("");
    setNewInitialFecha(todayIso());
    setNewProjectModalOpen(true);
  };

  const closeNewProjectModal = () => {
    if (saving) return;
    setNewProjectModalOpen(false);
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) {
      onToast("Escribe un nombre para el proyecto.");
      return;
    }
    let initialAmount: number | undefined;
    if (newInitialAmount.trim() !== "") {
      const amount = parseMoney(newInitialAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        onToast("El aporte inicial debe ser un monto válido mayor que cero.");
        return;
      }
      initialAmount = amount;
    }
    setSaving(true);
    try {
      await postJson<ProjectDetailRow>("/proyectos/projects", {
        name,
        description: newDescription.trim() || null,
        initial_contribution_amount: initialAmount ?? null,
        initial_contribution_fecha: initialAmount != null ? newInitialFecha : null,
      });
      onToast("Proyecto creado ✅");
      setNewProjectModalOpen(false);
      await loadProjects();
    } catch (e) {
      console.error(e);
      onToast(e instanceof Error ? e.message : "No se pudo crear el proyecto.");
    } finally {
      setSaving(false);
    }
  };

  const [confirmDeleteProject, setConfirmDeleteProject] = useState<ProjectListRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const confirmDeleteProjectNow = async () => {
    if (!confirmDeleteProject) return;
    setDeleteBusy(true);
    try {
      const r = await apiFetch(`/proyectos/projects/${confirmDeleteProject.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      onToast("Proyecto eliminado.");
      setConfirmDeleteProject(null);
      await loadProjects();
    } catch {
      onToast("No se pudo eliminar el proyecto.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const innerClass = "mx-auto max-w-[1000px] space-y-8 p-4 pb-28 md:p-6";

  const filteredProjects = hideArchived ? projects.filter((p) => !p.is_archived) : projects;
  const visibleProjects = [...filteredProjects].sort((a, b) => {
    const cmp = sortKey === "name" ? a.name.localeCompare(b.name, "es") : a[sortKey] - b[sortKey];
    return sortDir === "asc" ? cmp : -cmp;
  });
  const summary = visibleProjects.reduce(
    (acc, p) => ({
      presupuesto_total: acc.presupuesto_total + p.presupuesto_total,
      comprometido: acc.comprometido + p.comprometido,
      pagado: acc.pagado + p.pagado,
      disponible: acc.disponible + p.disponible,
    }),
    { presupuesto_total: 0, comprometido: 0, pagado: 0, disponible: 0 },
  );

  if (loading) {
    return (
      <div className={pageShell(isDark)}>
        <div className={innerClass}>
          <p className={bodyText(isDark)}>Cargando…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={pageShell(isDark)}>
      <div className={innerClass}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className={heading1(isDark)}>Proyectos y presupuestos</h1>
            <p className={`mt-1 max-w-2xl leading-relaxed ${bodyText(isDark)}`}>
              Haz seguimiento de tus proyectos personales (matrimonio, muebles, etc.): cuánto presupuesto tienes,
              cuánto está comprometido en ítems, cuánto has pagado y cuánto te queda disponible.
            </p>
          </div>
          <button type="button" className={newBtn(isDark)} onClick={openNewProjectModal}>
            + Nuevo Proyecto
          </button>
        </header>

        <section aria-labelledby="projects-heading">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="projects-heading" className={heading2(isDark)}>
              Tus proyectos
            </h2>
            {projects.some((p) => p.is_archived) && (
              <label className={`flex cursor-pointer items-center gap-2 ${mutedText(isDark)}`}>
                <input
                  type="checkbox"
                  checked={hideArchived}
                  onChange={(e) => setHideArchived(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                />
                Ocultar archivados
              </label>
            )}
          </div>

          {projects.length === 0 ? (
            <p className={bodyText(isDark)}>Aún no tienes proyectos. Pulsa «+ Nuevo Proyecto» para crear el primero.</p>
          ) : (
            <>
              <dl className={`mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4 ${panelCard(isDark)}`}>
                <div>
                  <dt className={fieldLabel(isDark)}>Presupuesto total</dt>
                  <dd className={`mt-0.5 font-semibold ${strongText(isDark)}`}>
                    {formatClpDots(summary.presupuesto_total)}
                  </dd>
                </div>
                <div>
                  <dt className={fieldLabel(isDark)}>Comprometido</dt>
                  <dd className={`mt-0.5 font-semibold ${strongText(isDark)}`}>
                    {formatClpDots(summary.comprometido)}
                  </dd>
                </div>
                <div>
                  <dt className={fieldLabel(isDark)}>Pagado</dt>
                  <dd className={`mt-0.5 font-semibold ${positiveText(isDark)}`}>{formatClpDots(summary.pagado)}</dd>
                </div>
                <div>
                  <dt className={fieldLabel(isDark)}>Disponible</dt>
                  <dd
                    className={`mt-0.5 font-semibold ${
                      summary.disponible < 0 ? negativeText(isDark) : accentText(isDark)
                    }`}
                  >
                    {formatClpDots(summary.disponible)}
                  </dd>
                </div>
              </dl>

              {visibleProjects.length === 0 ? (
                <p className={bodyText(isDark)}>No hay proyectos que coincidan con el filtro.</p>
              ) : (
                <div className={tableWrapper(isDark)}>
                  <table className="w-full min-w-[720px] border-collapse">
                    <thead>
                      <tr className={theadRow(isDark)}>
                        <th className={thCell(isDark)}>
                          <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("name")}>
                            Proyecto{sortArrow(sortKey === "name", sortDir)}
                          </button>
                        </th>
                        <th className={`${thCell(isDark)} text-right`}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => toggleSort("presupuesto_total")}
                          >
                            Presupuesto{sortArrow(sortKey === "presupuesto_total", sortDir)}
                          </button>
                        </th>
                        <th className={`${thCell(isDark)} text-right`}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => toggleSort("comprometido")}
                          >
                            Comprometido{sortArrow(sortKey === "comprometido", sortDir)}
                          </button>
                        </th>
                        <th className={`${thCell(isDark)} text-right`}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => toggleSort("pagado")}
                          >
                            Pagado{sortArrow(sortKey === "pagado", sortDir)}
                          </button>
                        </th>
                        <th className={`${thCell(isDark)} text-right`}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => toggleSort("disponible")}
                          >
                            Disponible{sortArrow(sortKey === "disponible", sortDir)}
                          </button>
                        </th>
                        <th className={`${thCell(isDark)} text-center`}>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1"
                            onClick={() => toggleSort("items_count")}
                          >
                            Ítems{sortArrow(sortKey === "items_count", sortDir)}
                          </button>
                        </th>
                        <th className={thCell(isDark)}>
                          <span className="sr-only">Acciones</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleProjects.map((p) => (
                        <tr
                          key={p.id}
                          className={`${tbodyRow(isDark, true)} ${p.is_archived ? "opacity-55" : ""}`}
                          onClick={() => onOpen(p.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onOpen(p.id);
                          }}
                        >
                          <td className={tdCellClass}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`font-semibold ${strongText(isDark)}`}>{p.name}</span>
                              {isProjectCompleted(p.comprometido, p.pagado) && (
                                <span className={completedBadgeClass(isDark)}>Completado</span>
                              )}
                              {p.is_archived && <span className={badgeClass(isDark)}>Archivado</span>}
                            </div>
                            {p.description && <p className={`mt-0.5 ${mutedText(isDark)}`}>{p.description}</p>}
                          </td>
                          <td className={`${tdCellClass} text-right font-semibold ${strongText(isDark)}`}>
                            {formatClpDots(p.presupuesto_total)}
                          </td>
                          <td className={`${tdCellClass} text-right font-semibold ${strongText(isDark)}`}>
                            {formatClpDots(p.comprometido)}
                          </td>
                          <td className={`${tdCellClass} text-right font-semibold ${positiveText(isDark)}`}>
                            {formatClpDots(p.pagado)}
                          </td>
                          <td
                            className={`${tdCellClass} text-right font-semibold ${
                              p.disponible < 0 ? negativeText(isDark) : accentText(isDark)
                            }`}
                          >
                            {formatClpDots(p.disponible)}
                          </td>
                          <td className={`${tdCellClass} text-center ${bodyText(isDark)}`}>{p.items_count}</td>
                          <td className={`${tdCellClass} text-right`}>
                            <button
                              type="button"
                              className={iconBtn(isDark, "danger")}
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteProject(p);
                              }}
                              aria-label={`Eliminar ${p.name}`}
                            >
                              <IconTrash className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>

        {newProjectModalOpen && (
          <div
            className={modalOverlay(isDark)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeNewProjectModal();
            }}
          >
            <div className={modalBox(isDark)}>
              <div className={modalHeader(isDark)}>
                <h3 id="new-project-modal-title" className={modalTitle(isDark)}>
                  Nuevo Proyecto
                </h3>
                <button
                  type="button"
                  disabled={saving}
                  onClick={closeNewProjectModal}
                  aria-label="Cerrar"
                  className={modalCloseBtn(isDark)}
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-6 py-5">
                <label className="block">
                  <span className={fieldLabel(isDark)}>Nombre</span>
                  <input
                    className={fieldInput(isDark)}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ej. Mi matrimonio"
                    autoFocus
                  />
                </label>
                <label className="block">
                  <span className={fieldLabel(isDark)}>Descripción (opcional)</span>
                  <input
                    className={fieldInput(isDark)}
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Ej. Presupuesto para la boda de octubre"
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className={fieldLabel(isDark)}>Aporte inicial (CLP, opcional)</span>
                    <input
                      className={fieldInput(isDark)}
                      inputMode="numeric"
                      value={newInitialAmount}
                      onChange={(e) => setNewInitialAmount(e.target.value)}
                      placeholder="Ej. 2000000"
                    />
                  </label>
                  <label className="block">
                    <span className={fieldLabel(isDark)}>Fecha del aporte inicial</span>
                    <input
                      className={fieldInput(isDark)}
                      type="date"
                      value={newInitialFecha}
                      onChange={(e) => setNewInitialFecha(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className={modalFooter(isDark)}>
                <button
                  type="button"
                  disabled={saving}
                  className={modalSecondaryBtn(isDark)}
                  onClick={closeNewProjectModal}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving || newName.trim() === ""}
                  className={modalPrimaryBtn(isDark)}
                  onClick={() => void submitCreate()}
                >
                  {saving ? "Guardando…" : "Crear proyecto"}
                </button>
              </div>
            </div>
          </div>
        )}

        {confirmDeleteProject && (
          <ConfirmDialog
            isDark={isDark}
            title="Eliminar proyecto"
            message={`¿Eliminar el proyecto "${confirmDeleteProject.name}"? Se borrarán también sus aportes, ítems y abonos.`}
            busy={deleteBusy}
            onCancel={() => setConfirmDeleteProject(null)}
            onConfirm={() => void confirmDeleteProjectNow()}
          />
        )}
      </div>
    </div>
  );
}

function ProjectDetail({
  projectId,
  onToast,
  onBack,
}: {
  projectId: number;
  onToast: (msg: string | null) => void;
  onBack: () => void;
}) {
  const { isDark } = useBankingTheme();
  const [project, setProject] = useState<ProjectDetailRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editingHeader, setEditingHeader] = useState(false);

  const [newContribModalOpen, setNewContribModalOpen] = useState(false);
  const [newContribAmount, setNewContribAmount] = useState("");
  const [newContribFecha, setNewContribFecha] = useState(() => todayIso());
  const [newContribNote, setNewContribNote] = useState("");

  const [newItemModalOpen, setNewItemModalOpen] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemCosto, setNewItemCosto] = useState("");
  const [newItemFechaLimite, setNewItemFechaLimite] = useState("");
  const [newItemInitialPayment, setNewItemInitialPayment] = useState("");
  const [newItemInitialFecha, setNewItemInitialFecha] = useState(() => todayIso());

  const [managingItemId, setManagingItemId] = useState<number | null>(null);
  const [newPaymentAmount, setNewPaymentAmount] = useState("");
  const [newPaymentFecha, setNewPaymentFecha] = useState(() => todayIso());
  const [newPaymentNote, setNewPaymentNote] = useState("");
  const [editingCosto, setEditingCosto] = useState(false);
  const [editCostoValue, setEditCostoValue] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [showAllMovements, setShowAllMovements] = useState(false);
  const [editingMovementKey, setEditingMovementKey] = useState<string | null>(null);
  const [editMovementAmount, setEditMovementAmount] = useState("");
  const [editMovementFecha, setEditMovementFecha] = useState("");
  const [editMovementNote, setEditMovementNote] = useState("");
  const [itemReorderBusy, setItemReorderBusy] = useState(false);

  const loadProject = useCallback(async () => {
    const row = await fetchJson<ProjectDetailRow>(`/proyectos/projects/${projectId}`);
    setProject(row);
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadProject()
      .catch((e) => {
        console.error(e);
        if (!cancelled) onToast("No se pudo cargar el proyecto.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadProject, onToast]);

  const startEditHeader = () => {
    if (!project) return;
    setEditName(project.name);
    setEditDescription(project.description ?? "");
    setEditingHeader(true);
  };

  const saveHeader = async () => {
    if (!project) return;
    const name = editName.trim();
    if (!name) {
      onToast("El nombre no puede estar vacío.");
      return;
    }
    setBusy(true);
    try {
      await patchJson<ProjectDetailRow>(`/proyectos/projects/${project.id}`, {
        name,
        description: editDescription.trim() || null,
      });
      onToast("Proyecto actualizado.");
      setEditingHeader(false);
      await loadProject();
    } catch (e) {
      console.error(e);
      onToast(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  };

  const toggleArchived = async () => {
    if (!project) return;
    setBusy(true);
    try {
      await patchJson<ProjectDetailRow>(`/proyectos/projects/${project.id}`, {
        is_archived: !project.is_archived,
      });
      onToast(project.is_archived ? "Proyecto desarchivado." : "Proyecto archivado.");
      await loadProject();
    } catch (e) {
      console.error(e);
      onToast("No se pudo actualizar el proyecto.");
    } finally {
      setBusy(false);
    }
  };

  const requestDeleteProject = () => setPendingDelete({ kind: "project" });

  const openNewContribModal = () => {
    setNewContribAmount("");
    setNewContribFecha(todayIso());
    setNewContribNote("");
    setNewContribModalOpen(true);
  };

  const closeNewContribModal = () => {
    if (busy) return;
    setNewContribModalOpen(false);
  };

  const addContribution = async () => {
    if (!project) return;
    const amount = parseMoney(newContribAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      onToast("Indica un monto de aporte válido mayor que cero.");
      return;
    }
    if (!newContribFecha) {
      onToast("Indica la fecha del aporte.");
      return;
    }
    setBusy(true);
    try {
      await postJson<ProjectDetailRow>(`/proyectos/projects/${project.id}/contributions`, {
        amount,
        fecha: newContribFecha,
        note: newContribNote.trim() || null,
      });
      onToast("Aporte agregado ✅");
      setNewContribModalOpen(false);
      await loadProject();
    } catch (e) {
      console.error(e);
      onToast(e instanceof Error ? e.message : "No se pudo agregar el aporte.");
    } finally {
      setBusy(false);
    }
  };

  const requestDeleteContribution = (contributionId: number) =>
    setPendingDelete({ kind: "contribution", id: contributionId });

  const openNewItemModal = () => {
    setNewItemName("");
    setNewItemCosto("");
    setNewItemFechaLimite("");
    setNewItemInitialPayment("");
    setNewItemInitialFecha(todayIso());
    setNewItemModalOpen(true);
  };

  const closeNewItemModal = () => {
    if (busy) return;
    setNewItemModalOpen(false);
  };

  const addItem = async () => {
    if (!project) return;
    const name = newItemName.trim();
    if (!name) {
      onToast("Escribe un nombre para el ítem.");
      return;
    }
    const costo = parseMoney(newItemCosto);
    if (!Number.isFinite(costo) || costo <= 0) {
      onToast("Indica un costo total válido mayor que cero.");
      return;
    }
    let initialPayment: number | undefined;
    if (newItemInitialPayment.trim() !== "") {
      const amount = parseMoney(newItemInitialPayment);
      if (!Number.isFinite(amount) || amount <= 0) {
        onToast("El abono inicial debe ser un monto válido mayor que cero.");
        return;
      }
      initialPayment = amount;
    }
    setBusy(true);
    try {
      await postJson<ProjectItemRow>(`/proyectos/projects/${project.id}/items`, {
        name,
        costo_total: costo,
        fecha_limite: newItemFechaLimite || null,
        initial_payment_amount: initialPayment ?? null,
        initial_payment_fecha: initialPayment != null ? newItemInitialFecha : null,
      });
      onToast("Ítem agregado ✅");
      setNewItemModalOpen(false);
      await loadProject();
    } catch (e) {
      console.error(e);
      onToast(e instanceof Error ? e.message : "No se pudo agregar el ítem.");
    } finally {
      setBusy(false);
    }
  };

  const requestDeleteItem = (itemId: number) => setPendingDelete({ kind: "item", id: itemId });

  const openManageItem = (itemId: number) => {
    setNewPaymentAmount("");
    setNewPaymentFecha(todayIso());
    setNewPaymentNote("");
    setEditingCosto(false);
    setManagingItemId(itemId);
  };

  const closeManageItem = () => {
    if (busy) return;
    setEditingCosto(false);
    setManagingItemId(null);
  };

  const startEditCosto = (item: ProjectItemRow) => {
    setEditCostoValue(item.costo_total.toLocaleString("es-CL"));
    setEditingCosto(true);
  };

  const cancelEditCosto = () => setEditingCosto(false);

  const saveCosto = async () => {
    if (!project || managingItemId == null) return;
    const value = parseMoney(editCostoValue);
    if (!Number.isFinite(value) || value <= 0) {
      onToast("Indica un costo total válido mayor que cero.");
      return;
    }
    setBusy(true);
    try {
      await patchJson<ProjectItemRow>(`/proyectos/projects/${project.id}/items/${managingItemId}`, {
        costo_total: value,
      });
      onToast("Costo total actualizado.");
      setEditingCosto(false);
      await loadProject();
    } catch (e) {
      console.error(e);
      onToast(e instanceof Error ? e.message : "No se pudo actualizar el costo total.");
    } finally {
      setBusy(false);
    }
  };

  const addPayment = async () => {
    if (!project || managingItemId == null) return;
    const amount = parseMoney(newPaymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      onToast("Indica un monto de abono válido mayor que cero.");
      return;
    }
    if (!newPaymentFecha) {
      onToast("Indica la fecha del abono.");
      return;
    }
    setBusy(true);
    try {
      await postJson<ProjectItemRow>(`/proyectos/projects/${project.id}/items/${managingItemId}/payments`, {
        amount,
        fecha: newPaymentFecha,
        note: newPaymentNote.trim() || null,
      });
      onToast("Abono agregado ✅");
      setNewPaymentAmount("");
      setNewPaymentNote("");
      await loadProject();
    } catch (e) {
      console.error(e);
      onToast(e instanceof Error ? e.message : "No se pudo agregar el abono.");
    } finally {
      setBusy(false);
    }
  };

  const requestDeletePayment = (itemId: number, paymentId: number) =>
    setPendingDelete({ kind: "payment", itemId, paymentId });

  const confirmPendingDelete = async () => {
    if (!project || !pendingDelete) return;
    setBusy(true);
    try {
      if (pendingDelete.kind === "project") {
        const r = await apiFetch(`/proyectos/projects/${project.id}`, { method: "DELETE" });
        if (!r.ok) throw new Error();
        onToast("Proyecto eliminado.");
        onBack();
        return;
      }
      if (pendingDelete.kind === "contribution") {
        const r = await apiFetch(`/proyectos/projects/${project.id}/contributions/${pendingDelete.id}`, {
          method: "DELETE",
        });
        if (!r.ok) throw new Error();
        onToast("Aporte eliminado.");
      } else if (pendingDelete.kind === "item") {
        const r = await apiFetch(`/proyectos/projects/${project.id}/items/${pendingDelete.id}`, {
          method: "DELETE",
        });
        if (!r.ok) throw new Error();
        onToast("Ítem eliminado.");
        if (managingItemId === pendingDelete.id) setManagingItemId(null);
      } else if (pendingDelete.kind === "payment") {
        const r = await apiFetch(
          `/proyectos/projects/${project.id}/items/${pendingDelete.itemId}/payments/${pendingDelete.paymentId}`,
          { method: "DELETE" },
        );
        if (!r.ok) throw new Error();
        onToast("Abono eliminado.");
      }
      setPendingDelete(null);
      await loadProject();
    } catch {
      onToast("No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  const startEditMovement = (m: MovementRow) => {
    setEditingMovementKey(m.key);
    setEditMovementAmount(m.amount.toLocaleString("es-CL"));
    setEditMovementFecha(m.fecha);
    setEditMovementNote(m.note ?? "");
  };

  const cancelEditMovement = () => setEditingMovementKey(null);

  const saveEditMovement = async (m: MovementRow) => {
    if (!project) return;
    const amount = parseMoney(editMovementAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      onToast("Indica un monto válido mayor que cero.");
      return;
    }
    if (!editMovementFecha) {
      onToast("Indica la fecha.");
      return;
    }
    setBusy(true);
    try {
      if (m.kind === "in") {
        await patchJson<ProjectDetailRow>(`/proyectos/projects/${project.id}/contributions/${m.contributionId}`, {
          amount,
          fecha: editMovementFecha,
          note: editMovementNote.trim() || null,
        });
      } else {
        await patchJson<ProjectItemRow>(
          `/proyectos/projects/${project.id}/items/${m.itemId}/payments/${m.paymentId}`,
          {
            amount,
            fecha: editMovementFecha,
            note: editMovementNote.trim() || null,
          },
        );
      }
      onToast("Movimiento actualizado.");
      setEditingMovementKey(null);
      await loadProject();
    } catch (e) {
      console.error(e);
      onToast(e instanceof Error ? e.message : "No se pudo actualizar el movimiento.");
    } finally {
      setBusy(false);
    }
  };

  const moveItem = async (itemId: number, direction: "up" | "down") => {
    if (!project || itemReorderBusy) return;
    const ordered = [...project.items].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((it) => it.id === itemId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= ordered.length) return;
    const current = ordered[index];
    const target = ordered[swapWith];
    setItemReorderBusy(true);
    try {
      await Promise.all([
        patchJson<ProjectItemRow>(`/proyectos/projects/${project.id}/items/${current.id}`, {
          sort_order: target.sort_order,
        }),
        patchJson<ProjectItemRow>(`/proyectos/projects/${project.id}/items/${target.id}`, {
          sort_order: current.sort_order,
        }),
      ]);
      await loadProject();
    } catch (e) {
      console.error(e);
      onToast("No se pudo reordenar el ítem.");
    } finally {
      setItemReorderBusy(false);
    }
  };

  const innerClass = "mx-auto max-w-[1000px] space-y-8 p-4 pb-28 md:p-6";

  if (loading || !project) {
    return (
      <div className={pageShell(isDark)}>
        <div className={innerClass}>
          <p className={bodyText(isDark)}>Cargando…</p>
        </div>
      </div>
    );
  }

  const managingItem = managingItemId != null ? project.items.find((it) => it.id === managingItemId) ?? null : null;

  const pendingDeleteInfo = (() => {
    if (!pendingDelete) return null;
    if (pendingDelete.kind === "project") {
      return {
        title: "Eliminar proyecto",
        message: `¿Eliminar el proyecto "${project.name}"? Se borrarán también sus aportes, ítems y abonos.`,
      };
    }
    if (pendingDelete.kind === "contribution") {
      return { title: "Eliminar aporte", message: "¿Eliminar este aporte? Esta acción no se puede deshacer." };
    }
    if (pendingDelete.kind === "item") {
      const item = project.items.find((it) => it.id === pendingDelete.id);
      return {
        title: "Eliminar ítem",
        message: `¿Eliminar "${item?.name ?? "este ítem"}"? Se borrarán también sus abonos.`,
      };
    }
    return { title: "Eliminar abono", message: "¿Eliminar este abono? Esta acción no se puede deshacer." };
  })();

  const movements: MovementRow[] = [
    ...project.contributions.map((c) => ({
      kind: "in" as const,
      key: `in-${c.id}`,
      fecha: c.fecha,
      sortKey: c.created_at,
      amount: c.amount,
      note: c.note,
      contributionId: c.id,
    })),
    ...project.items.flatMap((it) =>
      it.payments.map((p) => ({
        kind: "out" as const,
        key: `out-${p.id}`,
        fecha: p.fecha,
        sortKey: p.created_at,
        amount: p.amount,
        note: p.note,
        itemName: it.name,
        itemId: it.id,
        paymentId: p.id,
      })),
    ),
  ].sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));

  return (
    <div className={pageShell(isDark)}>
      <div className={innerClass}>
        <Link to="/proyectos" onClick={onBack} className={backBtn(isDark)}>
          <IconArrowLeft className="h-4 w-4" />
          Volver a proyectos
        </Link>

        <header className={panelCard(isDark)}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className={heading1(isDark)}>{project.name}</h1>
                {isProjectCompleted(project.comprometido, project.pagado) && (
                  <span className={completedBadgeClass(isDark)}>Completado</span>
                )}
                {project.is_archived && <span className={badgeClass(isDark)}>Archivado</span>}
              </div>
              {project.description && <p className={`mt-1 ${bodyText(isDark)}`}>{project.description}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" className={newBtn(isDark)} onClick={openNewContribModal}>
                + Agregar aporte
              </button>
              <button type="button" className={secondaryBtn(isDark)} onClick={startEditHeader}>
                Editar
              </button>
              <button
                type="button"
                className={secondaryBtn(isDark)}
                disabled={busy}
                onClick={() => void toggleArchived()}
              >
                {project.is_archived ? "Desarchivar" : "Archivar"}
              </button>
              <button type="button" className={dangerBtn(isDark)} onClick={requestDeleteProject}>
                Eliminar
              </button>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className={fieldLabel(isDark)}>Presupuesto total</dt>
              <dd className={`mt-0.5 text-lg font-semibold ${strongText(isDark)}`}>
                {formatClpDots(project.presupuesto_total)}
              </dd>
            </div>
            <div>
              <dt className={fieldLabel(isDark)}>Comprometido</dt>
              <dd className={`mt-0.5 text-lg font-semibold ${strongText(isDark)}`}>
                {formatClpDots(project.comprometido)}
              </dd>
            </div>
            <div>
              <dt className={fieldLabel(isDark)}>Pagado</dt>
              <dd className={`mt-0.5 text-lg font-semibold ${positiveText(isDark)}`}>
                {formatClpDots(project.pagado)}
              </dd>
            </div>
            <div>
              <dt className={fieldLabel(isDark)}>Disponible</dt>
              <dd
                className={`mt-0.5 text-lg font-semibold ${
                  project.disponible < 0 ? negativeText(isDark) : accentText(isDark)
                }`}
              >
                {formatClpDots(project.disponible)}
              </dd>
            </div>
          </dl>
        </header>

        {editingHeader && (
          <div
            className={modalOverlay(isDark)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-project-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget && !busy) setEditingHeader(false);
            }}
          >
            <div className={modalBox(isDark)}>
              <div className={modalHeader(isDark)}>
                <h3 id="edit-project-modal-title" className={modalTitle(isDark)}>
                  Editar proyecto
                </h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setEditingHeader(false)}
                  aria-label="Cerrar"
                  className={modalCloseBtn(isDark)}
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-6 py-5">
                <label className="block">
                  <span className={fieldLabel(isDark)}>Nombre</span>
                  <input
                    className={fieldInput(isDark)}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                  />
                </label>
                <label className="block">
                  <span className={fieldLabel(isDark)}>Descripción</span>
                  <input
                    className={fieldInput(isDark)}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Opcional"
                  />
                </label>
              </div>

              <div className={modalFooter(isDark)}>
                <button
                  type="button"
                  disabled={busy}
                  className={modalSecondaryBtn(isDark)}
                  onClick={() => setEditingHeader(false)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy || editName.trim() === ""}
                  className={modalPrimaryBtn(isDark)}
                  onClick={() => void saveHeader()}
                >
                  {busy ? "Guardando…" : "Guardar cambios"}
                </button>
              </div>
            </div>
          </div>
        )}

        <section aria-labelledby="items-heading">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="items-heading" className={heading2(isDark)}>
              Ítems
            </h2>
            <button type="button" className={newBtn(isDark)} onClick={openNewItemModal}>
              + Nuevo Ítem
            </button>
          </div>

          {project.items.length === 0 ? (
            <p className={bodyText(isDark)}>Aún no hay ítems en este proyecto. Pulsa «+ Nuevo Ítem» para agregar uno.</p>
          ) : (
            <div className={tableWrapper(isDark)}>
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className={theadRow(isDark)}>
                    <th className={thCell(isDark)}>Ítem</th>
                    <th className={`${thCell(isDark)} text-right`}>Costo total</th>
                    <th className={`${thCell(isDark)} text-right`}>Pagado</th>
                    <th className={`${thCell(isDark)} text-right`}>Restante</th>
                    <th className={thCell(isDark)}>% Completado</th>
                    <th className={thCell(isDark)}>Vence</th>
                    <th className={thCell(isDark)}>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {project.items.map((item, index) => (
                    <tr
                      key={item.id}
                      className={tbodyRow(isDark, true)}
                      onClick={() => openManageItem(item.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openManageItem(item.id);
                      }}
                    >
                      <td className={`${tdCellClass} font-semibold ${strongText(isDark)}`}>{item.name}</td>
                      <td className={`${tdCellClass} text-right font-semibold ${strongText(isDark)}`}>
                        {formatClpDots(item.costo_total)}
                      </td>
                      <td className={`${tdCellClass} text-right font-semibold ${positiveText(isDark)}`}>
                        {formatClpDots(item.monto_pagado)}
                      </td>
                      <td
                        className={`${tdCellClass} text-right font-semibold ${
                          item.monto_restante > 0 ? negativeText(isDark) : mutedText(isDark)
                        }`}
                      >
                        {formatClpDots(item.monto_restante)}
                      </td>
                      <td className={tdCellClass}>
                        <div className="flex items-center gap-2">
                          <div className={progressTrack(isDark)}>
                            <div
                              className={progressFill(isDark, itemCompletionPct(item))}
                              style={{ width: `${itemCompletionPct(item)}%` }}
                            />
                          </div>
                          <span className={`text-xs font-semibold ${strongText(isDark)}`}>
                            {itemCompletionPct(item)}%
                          </span>
                        </div>
                      </td>
                      <td className={tdCellClass}>
                        <div className="flex items-center gap-2">
                          <span className={bodyText(isDark)}>{item.fecha_limite ?? "—"}</span>
                          {isItemOverdue(item) && <span className={overdueBadgeClass(isDark)}>Vencido</span>}
                        </div>
                      </td>
                      <td className={`${tdCellClass} text-right`}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className={iconBtn(isDark)}
                            disabled={index === 0 || itemReorderBusy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void moveItem(item.id, "up");
                            }}
                            aria-label={`Mover ${item.name} hacia arriba`}
                          >
                            <IconArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={iconBtn(isDark)}
                            disabled={index === project.items.length - 1 || itemReorderBusy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void moveItem(item.id, "down");
                            }}
                            aria-label={`Mover ${item.name} hacia abajo`}
                          >
                            <IconArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={iconBtn(isDark, "danger")}
                            onClick={(e) => {
                              e.stopPropagation();
                              requestDeleteItem(item.id);
                            }}
                            aria-label={`Eliminar ${item.name}`}
                          >
                            <IconTrash className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {newItemModalOpen && (
          <div
            className={modalOverlay(isDark)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-item-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeNewItemModal();
            }}
          >
            <div className={modalBox(isDark)}>
              <div className={modalHeader(isDark)}>
                <h3 id="new-item-modal-title" className={modalTitle(isDark)}>
                  Nuevo Ítem
                </h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={closeNewItemModal}
                  aria-label="Cerrar"
                  className={modalCloseBtn(isDark)}
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-6 py-5">
                <label className="block">
                  <span className={fieldLabel(isDark)}>Nombre</span>
                  <input
                    className={fieldInput(isDark)}
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="Ej. Catering"
                    autoFocus
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className={fieldLabel(isDark)}>Costo total (CLP)</span>
                    <input
                      className={fieldInput(isDark)}
                      inputMode="numeric"
                      value={newItemCosto}
                      onChange={(e) => setNewItemCosto(e.target.value)}
                      placeholder="Ej. 1200000"
                    />
                  </label>
                  <label className="block">
                    <span className={fieldLabel(isDark)}>Fecha límite (opcional)</span>
                    <input
                      className={fieldInput(isDark)}
                      type="date"
                      value={newItemFechaLimite}
                      onChange={(e) => setNewItemFechaLimite(e.target.value)}
                    />
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className={fieldLabel(isDark)}>Abono inicial (CLP, opcional)</span>
                    <input
                      className={fieldInput(isDark)}
                      inputMode="numeric"
                      value={newItemInitialPayment}
                      onChange={(e) => setNewItemInitialPayment(e.target.value)}
                      placeholder="Ej. 200000"
                    />
                  </label>
                  <label className="block">
                    <span className={fieldLabel(isDark)}>Fecha del abono inicial</span>
                    <input
                      className={fieldInput(isDark)}
                      type="date"
                      value={newItemInitialFecha}
                      onChange={(e) => setNewItemInitialFecha(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className={modalFooter(isDark)}>
                <button
                  type="button"
                  disabled={busy}
                  className={modalSecondaryBtn(isDark)}
                  onClick={closeNewItemModal}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy || newItemName.trim() === "" || newItemCosto.trim() === ""}
                  className={modalPrimaryBtn(isDark)}
                  onClick={() => void addItem()}
                >
                  {busy ? "Guardando…" : "Crear ítem"}
                </button>
              </div>
            </div>
          </div>
        )}

        {managingItem && (
          <div
            className={modalOverlay(isDark)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-item-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeManageItem();
            }}
          >
            <div className={modalBox(isDark)}>
              <div className={modalHeader(isDark)}>
                <h3 id="manage-item-modal-title" className={modalTitle(isDark)}>
                  Abonos · {managingItem.name}
                </h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={closeManageItem}
                  aria-label="Cerrar"
                  className={modalCloseBtn(isDark)}
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-5 px-6 py-5">
                <dl className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
                  <div>
                    <dt className={fieldLabel(isDark)}>Costo total</dt>
                    {editingCosto ? (
                      <div className="mt-1 flex flex-col items-center gap-1.5">
                        <input
                          className={`${fieldInput(isDark)} mt-0 w-32 px-2 text-center`}
                          inputMode="numeric"
                          autoFocus
                          value={editCostoValue}
                          onChange={(e) => setEditCostoValue(formatAmountDots(e.target.value))}
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className={iconBtn(isDark)}
                            disabled={busy}
                            onClick={() => void saveCosto()}
                            aria-label="Guardar costo total"
                          >
                            <IconCheck className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className={iconBtn(isDark)}
                            disabled={busy}
                            onClick={cancelEditCosto}
                            aria-label="Cancelar edición"
                          >
                            <IconX className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-0.5 flex items-center justify-center gap-1">
                        <dd className={`font-semibold ${strongText(isDark)}`}>
                          {formatClpDots(managingItem.costo_total)}
                        </dd>
                        <button
                          type="button"
                          className={iconBtn(isDark)}
                          onClick={() => startEditCosto(managingItem)}
                          aria-label="Editar costo total"
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <dt className={fieldLabel(isDark)}>Pagado</dt>
                    <dd className={`mt-0.5 font-semibold ${positiveText(isDark)}`}>
                      {formatClpDots(managingItem.monto_pagado)}
                    </dd>
                  </div>
                  <div>
                    <dt className={fieldLabel(isDark)}>Restante</dt>
                    <dd
                      className={`mt-0.5 font-semibold ${
                        managingItem.monto_restante > 0 ? negativeText(isDark) : mutedText(isDark)
                      }`}
                    >
                      {formatClpDots(managingItem.monto_restante)}
                    </dd>
                  </div>
                  <div>
                    <dt className={fieldLabel(isDark)}>% Completado</dt>
                    <dd className="mt-1.5 flex flex-col items-center gap-1.5">
                      <div className={progressTrack(isDark)}>
                        <div
                          className={progressFill(isDark, itemCompletionPct(managingItem))}
                          style={{ width: `${itemCompletionPct(managingItem)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold ${strongText(isDark)}`}>
                        {itemCompletionPct(managingItem)}%
                      </span>
                    </dd>
                  </div>
                </dl>

                <div className="text-center">
                  <p className={`mb-3 ${heading3(isDark)}`}>Nuevo abono</p>
                  <div className="grid gap-3 text-left sm:grid-cols-3">
                    <label>
                      <span className={fieldLabel(isDark)}>Monto (CLP)</span>
                      <input
                        className={fieldInput(isDark)}
                        inputMode="numeric"
                        value={newPaymentAmount}
                        onChange={(e) => setNewPaymentAmount(e.target.value)}
                        placeholder="Ej. 200000"
                      />
                    </label>
                    <label>
                      <span className={fieldLabel(isDark)}>Fecha</span>
                      <input
                        className={fieldInput(isDark)}
                        type="date"
                        value={newPaymentFecha}
                        onChange={(e) => setNewPaymentFecha(e.target.value)}
                      />
                    </label>
                    <label>
                      <span className={fieldLabel(isDark)}>Nota (opcional)</span>
                      <input
                        className={fieldInput(isDark)}
                        value={newPaymentNote}
                        onChange={(e) => setNewPaymentNote(e.target.value)}
                        placeholder="Ej. Anticipo"
                      />
                    </label>
                  </div>
                  {parseMoney(newPaymentAmount || "0") > managingItem.monto_restante && (
                    <p className={`mt-2 ${warningText(isDark)}`}>
                      Este abono supera el restante ({formatClpDots(managingItem.monto_restante)}).
                    </p>
                  )}
                  <div className="mt-3 flex justify-center">
                    <button
                      type="button"
                      className={primaryBtn(isDark)}
                      disabled={busy}
                      onClick={() => void addPayment()}
                    >
                      Agregar abono
                    </button>
                  </div>
                </div>

                {managingItem.payments.length > 0 && (
                  <div className={`border-t pt-4 ${isDark ? "border-zinc-800" : "border-slate-100"}`}>
                    <p className={`mb-3 ${heading3(isDark)}`}>
                      Historial ({managingItem.payments.length})
                    </p>
                    <div className={`${tableWrapper(isDark)} max-h-64 overflow-y-auto`}>
                      <table className="w-full min-w-[420px] border-collapse">
                        <thead className="sticky top-0">
                          <tr className={theadRow(isDark)}>
                            <th className={compactThCell(isDark)}>Fecha</th>
                            <th className={`${compactThCell(isDark)} text-right`}>Monto</th>
                            <th className={compactThCell(isDark)}>Nota</th>
                            <th className={compactThCell(isDark)}>
                              <span className="sr-only">Acciones</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {managingItem.payments.map((p) => (
                            <tr key={p.id} className={tbodyRow(isDark, false)}>
                              <td className={`${compactTdCellClass} ${bodyText(isDark)}`}>{p.fecha}</td>
                              <td className={`${compactTdCellClass} text-right font-semibold ${strongText(isDark)}`}>
                                {formatClpDots(p.amount)}
                              </td>
                              <td className={`${compactTdCellClass} ${mutedText(isDark)}`}>{p.note ?? "—"}</td>
                              <td className={`${compactTdCellClass} text-right`}>
                                <button
                                  type="button"
                                  className={iconBtn(isDark, "danger")}
                                  onClick={() => requestDeletePayment(managingItem.id, p.id)}
                                  aria-label="Eliminar abono"
                                >
                                  <IconTrash className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className={modalFooter(isDark)}>
                <button type="button" className={modalSecondaryBtn(isDark)} onClick={closeManageItem}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )}

        <section className={panelCard(isDark)} aria-labelledby="contributions-heading">
          <h2 id="contributions-heading" className={heading2(isDark)}>
            Movimientos
          </h2>
          <p className={`mt-1 ${mutedText(isDark)}`}>
            {showAllMovements
              ? `Todos los movimientos (${movements.length}): aportes al presupuesto y abonos pagados en tus ítems.`
              : `Últimos ${Math.min(movements.length, MAX_MOVEMENTS_SHOWN)} de ${movements.length} movimientos: aportes al presupuesto y abonos pagados en tus ítems.`}
          </p>

          {movements.length === 0 ? (
            <p className={`mt-4 ${bodyText(isDark)}`}>Aún no hay movimientos en este proyecto.</p>
          ) : (
            <>
              <ul className="mt-4">
                {(showAllMovements ? movements : movements.slice(0, MAX_MOVEMENTS_SHOWN)).map((m) =>
                  editingMovementKey === m.key ? (
                    <li key={m.key} className={historyRowEditing(isDark)}>
                      <div className="flex items-center gap-2">
                        <span className={historyIconBadge(isDark, m.kind)}>
                          {m.kind === "in" ? (
                            <IconArrowUp className="h-3.5 w-3.5" />
                          ) : (
                            <IconArrowDown className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <span className={`text-xs font-medium ${strongText(isDark)}`}>
                          {m.kind === "in" ? "Editar aporte" : `Editar abono · ${m.itemName}`}
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input
                          className={compactInput(isDark)}
                          inputMode="numeric"
                          value={editMovementAmount}
                          onChange={(e) => setEditMovementAmount(formatAmountDots(e.target.value))}
                          aria-label="Monto"
                        />
                        <input
                          className={compactInput(isDark)}
                          type="date"
                          value={editMovementFecha}
                          onChange={(e) => setEditMovementFecha(e.target.value)}
                          aria-label="Fecha"
                        />
                        <input
                          className={compactInput(isDark)}
                          value={editMovementNote}
                          onChange={(e) => setEditMovementNote(e.target.value)}
                          placeholder="Nota (opcional)"
                          aria-label="Nota"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={modalPrimaryBtn(isDark)}
                          disabled={busy}
                          onClick={() => void saveEditMovement(m)}
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          className={modalSecondaryBtn(isDark)}
                          disabled={busy}
                          onClick={cancelEditMovement}
                        >
                          Cancelar
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li key={m.key} className={historyRow(isDark)}>
                      <span className={historyIconBadge(isDark, m.kind)}>
                        {m.kind === "in" ? (
                          <IconArrowUp className="h-3.5 w-3.5" />
                        ) : (
                          <IconArrowDown className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-medium ${strongText(isDark)}`}>
                          {m.kind === "in" ? m.note || "Aporte" : m.itemName}
                        </p>
                        <p className={mutedText(isDark)}>
                          {formatDateEs(m.fecha)}
                          {m.kind === "out" && m.note ? ` · ${m.note}` : ""}
                        </p>
                      </div>
                      <span
                        className={`text-sm font-semibold ${m.kind === "in" ? accentText(isDark) : negativeText(isDark)}`}
                      >
                        {m.kind === "in" ? "+" : "-"}
                        {formatClpDots(m.amount)}
                      </span>
                      <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                        <button
                          type="button"
                          className={iconBtn(isDark)}
                          onClick={() => startEditMovement(m)}
                          aria-label={m.kind === "in" ? "Editar aporte" : "Editar abono"}
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={iconBtn(isDark, "danger")}
                          onClick={() =>
                            m.kind === "in"
                              ? requestDeleteContribution(m.contributionId)
                              : requestDeletePayment(m.itemId, m.paymentId)
                          }
                          aria-label={m.kind === "in" ? "Eliminar aporte" : "Eliminar abono"}
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ),
                )}
              </ul>
              {movements.length > MAX_MOVEMENTS_SHOWN && (
                <button
                  type="button"
                  className={`mt-3 ${ghostBtn(isDark)}`}
                  onClick={() => setShowAllMovements((v) => !v)}
                >
                  {showAllMovements ? "Ver menos" : `Ver todos (${movements.length})`}
                </button>
              )}
            </>
          )}
        </section>

        {newContribModalOpen && (
          <div
            className={modalOverlay(isDark)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-contrib-modal-title"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeNewContribModal();
            }}
          >
            <div className={modalBox(isDark)}>
              <div className={modalHeader(isDark)}>
                <h3 id="new-contrib-modal-title" className={modalTitle(isDark)}>
                  Agregar aporte
                </h3>
                <button
                  type="button"
                  disabled={busy}
                  onClick={closeNewContribModal}
                  aria-label="Cerrar"
                  className={modalCloseBtn(isDark)}
                >
                  <IconX className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div>
                  <span className={fieldLabel(isDark)}>Monto (CLP)</span>
                  <div className={`mt-1.5 flex items-baseline gap-1.5 pb-1.5 ${amountFieldWrap(isDark)}`}>
                    <span className={`text-2xl font-bold ${accentText(isDark)}`}>$</span>
                    <input
                      className={bigAmountInput(isDark)}
                      inputMode="numeric"
                      value={newContribAmount}
                      onChange={(e) => setNewContribAmount(formatAmountDots(e.target.value))}
                      placeholder="0"
                      aria-label="Monto del aporte"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className={fieldLabel(isDark)}>Fecha</span>
                    <input
                      className={fieldInput(isDark)}
                      type="date"
                      value={newContribFecha}
                      onChange={(e) => setNewContribFecha(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className={fieldLabel(isDark)}>Nota (opcional)</span>
                    <input
                      className={fieldInput(isDark)}
                      value={newContribNote}
                      onChange={(e) => setNewContribNote(e.target.value)}
                      placeholder="Ej. Bono de fin de año"
                    />
                  </label>
                </div>
              </div>

              <div className={modalFooter(isDark)}>
                <button
                  type="button"
                  disabled={busy}
                  className={modalSecondaryBtn(isDark)}
                  onClick={closeNewContribModal}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={busy || parseMoney(newContribAmount || "0") <= 0}
                  className={modalPrimaryBtn(isDark)}
                  onClick={() => void addContribution()}
                >
                  {busy ? "Guardando…" : "Agregar aporte"}
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingDeleteInfo && (
          <ConfirmDialog
            isDark={isDark}
            title={pendingDeleteInfo.title}
            message={pendingDeleteInfo.message}
            busy={busy}
            onCancel={() => setPendingDelete(null)}
            onConfirm={() => void confirmPendingDelete()}
          />
        )}
      </div>
    </div>
  );
}
