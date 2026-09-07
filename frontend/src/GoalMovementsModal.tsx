import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { formatClpDots, formatTxSignedAmount } from "./format";
import type { FintualGoalCard, TransactionRow } from "./types";

const TX_CHUNK = 10_000;

function movementTitle(tx: TransactionRow): string {
  const t = (tx.tipo || "").toLowerCase();
  if (t === "deposito") return "Depósito";
  if (t === "retiro") return "Retiro";
  return (tx.tipo || "").replace(/_/g, " ");
}

function movementSubtitle(tx: TransactionRow): string {
  const d = new Date(tx.fecha + "T12:00:00");
  const dateStr = d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
  if ((tx.currency || "").toUpperCase() === "CLP" && Math.abs(tx.monto_total) > 1e-9) {
    return `${dateStr} · ${formatClpDots(Math.abs(tx.monto_total))}`;
  }
  return dateStr;
}

function movementAmount(tx: TransactionRow, isDark: boolean): { text: string; className: string } {
  const { text, signClass } = formatTxSignedAmount(tx.monto_total, tx.currency, tx.tipo, isDark);
  return { text, className: signClass };
}

function summarizeFondos(items: TransactionRow[]): { depositos: number; retiros: number } {
  let depositos = 0;
  let retiros = 0;
  for (const tx of items) {
    const t = (tx.tipo || "").toLowerCase();
    if (t === "deposito") depositos += Math.abs(tx.monto_total);
    else if (t === "retiro") retiros += Math.abs(tx.monto_total);
  }
  return { depositos, retiros };
}

interface Props {
  goal: FintualGoalCard | null;
  onClose: () => void;
  dataVersion: number;
  isDark: boolean;
}

export function GoalMovementsModal({ goal, onClose, dataVersion, isDark }: Props) {
  const [items, setItems] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!goal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goal, onClose]);

  useEffect(() => {
    if (!goal) {
      setItems([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const gid = goal.id.trim();

    (async () => {
      try {
        const all: TransactionRow[] = [];
        let page = 1;
        let total = 0;
        for (;;) {
          const params = new URLSearchParams();
          params.set("page", String(page));
          params.set("page_size", String(TX_CHUNK));
          params.set("categoria", "Fondos");
          params.set("activo_exact", gid);
          const r = await apiFetch(`/transactions?${params}`);
          if (!r.ok) throw new Error(String(r.status));
          const res = (await r.json()) as {
            items: TransactionRow[];
            total: number;
            page: number;
            page_size: number;
          };
          if (page === 1) total = res.total;
          all.push(...res.items);
          if (all.length >= total || res.items.length === 0) break;
          page += 1;
        }
        if (!cancelled) setItems(all);
      } catch {
        if (!cancelled) {
          setItems([]);
          setError("No se pudieron cargar los movimientos.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [goal, dataVersion]);

  const { depositos, retiros } = useMemo(() => summarizeFondos(items), [items]);

  if (!goal) return null;

  const countLabel = items.length === 1 ? "1 movimiento" : `${items.length} movimientos`;

  const cardBg = isDark ? "bg-gradient-to-b from-[#1e1b2e] to-[#161b22]" : "bg-gradient-to-b from-white to-[#FBF6EE]";
  const cardBorder = isDark ? "border-[#2d2640]" : "border-[#E8E1D4]";
  const headerBorder = isDark ? "border-[#30363d]" : "border-[#E8E1D4]";
  const textPrimary = isDark ? "text-white" : "text-[#2B2620]";
  const textMuted = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const iconBg = isDark ? "bg-[#2d1f4a] ring-1 ring-[#4c3d6a]" : "bg-[#F0E9FB] ring-1 ring-[#D9C7F0]";
  const iconColor = isDark ? "text-[#f472b6]" : "text-[#a5497d]";
  const badgeColor = isDark ? "text-[#a78bfa]" : "text-[#6b3f94]";
  const rowDivider = isDark ? "divide-[#21262d]" : "divide-[#F0EAE0]";
  const emeraldClass = isDark ? "text-emerald-400" : "text-emerald-600";
  const roseClass = isDark ? "text-rose-400" : "text-rose-600";
  const closeHover = isDark ? "hover:bg-[#21262d] hover:text-white" : "hover:bg-[#F5F1E8] hover:text-[#2B2620]";
  const errorClass = isDark ? "text-[#f85149]" : "text-[#e11d48]";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-mov-title"
    >
      <button type="button" className="absolute inset-0 bg-black/65" aria-label="Cerrar" onClick={onClose} />
      <div
        className={`relative flex max-h-[min(640px,85vh)] w-full max-w-lg flex-col overflow-hidden rounded-xl border ${cardBorder} ${cardBg} shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={`flex shrink-0 items-center gap-3 border-b ${headerBorder} px-4 py-3 sm:px-5 sm:py-4`}>
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconBg}`} aria-hidden>
            <svg className={`h-6 w-6 ${iconColor}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 16l4-4 4 4 6-6" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="goal-mov-title" className={`text-lg font-bold leading-tight tracking-tight ${textPrimary}`}>
              {goal.name}
            </h2>
            <p className={`mt-0.5 truncate text-xs font-medium uppercase tracking-wide ${badgeColor}`}>
              {goal.badge_label}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`shrink-0 rounded-lg p-1.5 ${textMuted} transition ${closeHover}`}
            aria-label="Cerrar"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className={`grid shrink-0 grid-cols-3 gap-2 border-b ${headerBorder} px-4 py-3 sm:px-5`}>
          <div className="text-center">
            <p
              className={`text-[10px] font-semibold uppercase tracking-wide ${textMuted}`}
              title="Valor cuota acumulado: cuánto vale hoy tu inversión en esta meta (CLP)."
            >
              Valor (NAV)
            </p>
            <p className={`mt-1 text-sm font-bold tabular-nums ${textPrimary}`}>{formatClpDots(goal.nav_clp)}</p>
          </div>
          <div className="text-center">
            <p
              className={`text-[10px] font-semibold uppercase tracking-wide ${textMuted}`}
              title="Suma de todos los depósitos según movimientos sincronizados desde Fintual."
            >
              Depositado
            </p>
            <p className={`mt-1 text-sm font-bold tabular-nums ${emeraldClass}`}>
              {loading ? "…" : formatClpDots(depositos)}
            </p>
          </div>
          <div className="text-center">
            <p
              className={`text-[10px] font-semibold uppercase tracking-wide ${textMuted}`}
              title="Total retirado según movimientos sincronizados desde Fintual."
            >
              Retirado
            </p>
            <p className={`mt-1 text-sm font-bold tabular-nums ${roseClass}`}>{loading ? "…" : formatClpDots(retiros)}</p>
          </div>
        </div>

        <div className="tx-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-1 sm:px-3">
          {error && <p className={`px-2 py-6 text-center text-sm ${errorClass}`}>{error}</p>}
          {!error && loading && (
            <p className={`px-2 py-8 text-center text-sm ${textMuted}`}>Cargando movimientos…</p>
          )}
          {!error && !loading && items.length === 0 && (
            <p className={`px-2 py-8 text-center text-sm ${textMuted}`}>Sin movimientos sincronizados para esta meta.</p>
          )}
          {!error && !loading && items.length > 0 && (
            <ul className={`divide-y ${rowDivider}`}>
              {items.map((tx) => {
                const { text, className } = movementAmount(tx, isDark);
                return (
                  <li key={tx.id} className="flex gap-3 px-2 py-3 sm:px-3">
                    <div className="min-w-0 flex-1">
                      <p className={`text-[14px] font-semibold ${textPrimary}`}>{movementTitle(tx)}</p>
                      <p className={`mt-0.5 text-[12px] leading-snug ${textMuted}`}>{movementSubtitle(tx)}</p>
                    </div>
                    <p className={`shrink-0 text-right text-[15px] font-semibold tabular-nums ${className}`}>
                      {text}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className={`shrink-0 border-t ${headerBorder} px-4 py-2.5 text-center sm:px-5`}>
          <p className={`text-xs ${textMuted}`}>{loading ? "…" : countLabel}</p>
        </footer>
      </div>
    </div>
  );
}
