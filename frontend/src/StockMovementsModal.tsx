import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import {
  formatMoney,
  formatSharesExact,
  formatTxSignedAmount,
} from "./format";
import { StockLogoImg } from "./transactionUi";
import type { Holding, TransactionRow } from "./types";

const TX_CHUNK = 10_000;

function effectiveTipo(tx: TransactionRow): string {
  const t = (tx.tipo || "").toLowerCase();
  if (t === "reinversion") return "reinversion";
  if (t === "compra") {
    const n = (tx.nombre_activo || "").toLowerCase();
    if (n.includes("reinversión") || n.includes("reinversion")) return "reinversion";
  }
  return t;
}

function movementTitle(tx: TransactionRow): string {
  const et = effectiveTipo(tx);
  const map: Record<string, string> = {
    reinversion: "Reinversión",
    dividendo: "Dividendo",
    venta: "Venta",
    compra: "Compra",
    division_accion: "División acción",
  };
  return map[et] ?? (tx.tipo || "").replace(/_/g, " ");
}

function movementSubtitle(tx: TransactionRow): string {
  const d = new Date(tx.fecha + "T12:00:00");
  const dateStr = d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
  const isDivision = (tx.tipo || "").toLowerCase() === "division_accion";
  if (isDivision) {
    return `${dateStr} · ${formatSharesExact(tx.precio_unitario)} → ${formatSharesExact(tx.acciones)} acciones`;
  }
  const et = effectiveTipo(tx);
  if (
    (et === "compra" || et === "reinversion" || et === "venta") &&
    tx.acciones > 1e-12 &&
    tx.precio_unitario > 0
  ) {
    return `${dateStr} · ${formatSharesExact(tx.acciones)} @ ${formatMoney(tx.precio_unitario)}`;
  }
  if (et === "dividendo" && Math.abs(tx.monto_total) > 1e-12) {
    return `${dateStr} · ${formatMoney(Math.abs(tx.monto_total))}`;
  }
  return dateStr;
}

function movementAmount(tx: TransactionRow, isDark: boolean): { text: string; className: string } {
  const isDivision = (tx.tipo || "").toLowerCase() === "division_accion";
  if (isDivision) {
    return { text: "Sin flujo USD", className: isDark ? "text-[#8b949e]" : "text-[#8A8072]" };
  }
  const { text, signClass } = formatTxSignedAmount(tx.monto_total, tx.currency, tx.tipo, isDark);
  return { text, className: signClass };
}

function summarizeComprasVentas(items: TransactionRow[]): { compras: number; ventas: number } {
  let compras = 0;
  let ventas = 0;
  for (const tx of items) {
    const et = effectiveTipo(tx);
    if (et === "compra" || et === "reinversion") {
      compras += Math.abs(tx.monto_total);
    } else if (et === "venta") {
      ventas += Math.abs(tx.monto_total);
    }
  }
  return { compras, ventas };
}

interface Props {
  holding: Holding | null;
  onClose: () => void;
  dataVersion: number;
  isDark: boolean;
}

export function StockMovementsModal({ holding, onClose, dataVersion, isDark }: Props) {
  const [items, setItems] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!holding) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [holding, onClose]);

  useEffect(() => {
    if (!holding) {
      setItems([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const sym = holding.ticker.toUpperCase();

    (async () => {
      try {
        const all: TransactionRow[] = [];
        let page = 1;
        let total = 0;
        for (;;) {
          const params = new URLSearchParams();
          params.set("page", String(page));
          params.set("page_size", String(TX_CHUNK));
          params.set("categoria", "Acciones");
          params.set("activo_exact", sym);
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
  }, [holding, dataVersion]);

  const { compras, ventas } = useMemo(() => summarizeComprasVentas(items), [items]);

  if (!holding) return null;

  const nombre = (holding.nombre || "").trim() || "—";
  const countLabel =
    items.length === 1 ? "1 movimiento" : `${items.length} movimientos`;

  const cardBg = isDark ? "bg-[#161b22]" : "bg-white";
  const cardBorder = isDark ? "border-[#30363d]" : "border-[#E8E1D4]";
  const textPrimary = isDark ? "text-white" : "text-[#2B2620]";
  const textMuted = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
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
      aria-labelledby="stock-mov-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        className={`relative flex max-h-[min(640px,85vh)] w-full max-w-lg flex-col overflow-hidden rounded-xl border ${cardBorder} ${cardBg} shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={`flex shrink-0 items-center gap-3 border-b ${cardBorder} px-4 py-3 sm:px-5 sm:py-4`}>
          <StockLogoImg symbol={holding.ticker} size="lg" isDark={isDark} />
          <div className="min-w-0 flex-1">
            <h2 id="stock-mov-title" className={`text-lg font-bold leading-tight tracking-tight ${textPrimary}`}>
              {holding.ticker}
            </h2>
            <p className={`mt-0.5 truncate text-sm leading-snug ${textMuted}`}>{nombre}</p>
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

        <div className={`grid shrink-0 grid-cols-3 gap-2 border-b ${cardBorder} px-4 py-3 sm:px-5`}>
          <div className="text-center">
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${textMuted}`}>Valor</p>
            <p className={`mt-1 text-sm font-bold tabular-nums ${textPrimary}`}>{formatMoney(holding.current_value)}</p>
          </div>
          <div className="text-center">
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${textMuted}`}>Compras</p>
            <p className={`mt-1 text-sm font-bold tabular-nums ${emeraldClass}`}>
              {loading ? "…" : formatMoney(compras)}
            </p>
          </div>
          <div className="text-center">
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${textMuted}`}>Ventas</p>
            <p className={`mt-1 text-sm font-bold tabular-nums ${roseClass}`}>
              {loading ? "…" : formatMoney(ventas)}
            </p>
          </div>
        </div>

        <div className="tx-scroll min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-1 sm:px-3">
          {error && <p className={`px-2 py-6 text-center text-sm ${errorClass}`}>{error}</p>}
          {!error && loading && (
            <p className={`px-2 py-8 text-center text-sm ${textMuted}`}>Cargando movimientos…</p>
          )}
          {!error && !loading && items.length === 0 && (
            <p className={`px-2 py-8 text-center text-sm ${textMuted}`}>Sin movimientos para este activo.</p>
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

        <footer className={`shrink-0 border-t ${cardBorder} px-4 py-2.5 text-center sm:px-5`}>
          <p className={`text-xs ${textMuted}`}>{loading ? "…" : countLabel}</p>
        </footer>
      </div>
    </div>
  );
}
