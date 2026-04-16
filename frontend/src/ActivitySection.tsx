import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { API_BASE } from "./config";
import {
  formatAxisMoney,
  formatMonthlyTooltipValue,
  formatSharesExact,
  formatTxSignedAmount,
} from "./format";
import { TransactionDetailModal } from "./TransactionDetailModal";
import type { MonthlyChartPoint, MonthlyMovementRow, TransactionRow } from "./types";
import { TxAvatar, badgeLabel, badgeStyleForTx, txDisplayName } from "./transactionUi";

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}

type CurFilter = "USD" | "CLP";
/** Vista del gráfico mensual: billetera, acciones US, fondos CLP o consolidado. */
type MonthScopeFilter = "wallet" | "stocks" | "fondos";
type Pill = "Todos" | string;

/** Columna de etiqueta (más estrecha = menos hueco hasta las píldoras / input). */
const FILTER_LABEL =
  "w-[5rem] shrink-0 text-left text-[10px] font-semibold uppercase leading-tight tracking-wide text-[#6e7681]";

const FILTER_ROW_GAP = "gap-1.5";

const TIPO_FILTER_LABELS: Record<string, string> = {
  Todos: "Todos",
  dividendo: "Dividendo",
  deposito: "Depósito",
  retiro: "Retiro",
  interes_caja: "Interés",
  compensacion: "Compensación",
  fusion_caja: "Fusión caja",
  desinversion: "Desinversión",
  acat_ingreso: "ACAT ingreso",
  acat_comision: "ACAT comisión",
  acat_egreso: "ACAT egreso",
  warrant_comision: "Warrant comisión",
  warrant_costo: "Warrant costo",
  compra: "Compra",
  reinversion: "Reinversión",
  venta: "Venta",
};

interface Props {
  dataVersion: number;
  onEdit: (tx: TransactionRow) => void;
  onToast: (msg: string) => void;
  onMutate: () => void | Promise<void>;
  /** When false, only the transaction list card is shown (e.g. /transactions page). */
  showMonthly?: boolean;
}

export function ActivitySection({
  dataVersion,
  onEdit,
  onToast,
  onMutate,
  showMonthly = true,
}: Props) {
  const [monthCur, setMonthCur] = useState<CurFilter>("USD");
  const [monthScope, setMonthScope] = useState<MonthScopeFilter>("stocks");
  const [monthly, setMonthly] = useState<MonthlyMovementRow[]>([]);

  const [tipo, setTipo] = useState<Pill>("Todos");
  const [categoria, setCategoria] = useState<Pill>("Todos");
  const [currency, setCurrency] = useState<Pill>("Todos");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 320);
    return () => clearTimeout(t);
  }, [q]);
  const [items, setItems] = useState<TransactionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [availableTipos, setAvailableTipos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [detailTx, setDetailTx] = useState<TransactionRow | null>(null);

  useEffect(() => {
    if (monthScope === "fondos" && monthCur === "USD") setMonthCur("CLP");
  }, [monthScope, monthCur]);

  useEffect(() => {
    if (!showMonthly) return;
    const params = new URLSearchParams();
    params.set("currency", monthScope === "fondos" ? "CLP" : monthCur);
    params.set("scope", monthScope);
    fetchJson<MonthlyMovementRow[]>(`/activity/monthly-movements?${params}`)
      .then(setMonthly)
      .catch(console.error);
  }, [monthCur, monthScope, dataVersion, showMonthly]);

  /** Coincide con el máximo del backend; si hay más filas, se piden páginas siguientes. */
  const TX_FETCH_CHUNK = 10_000;

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const all: TransactionRow[] = [];
      let reportedTotal = 0;
      let page = 1;
      for (;;) {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("page_size", String(TX_FETCH_CHUNK));
        if (tipo !== "Todos") params.set("tipo", tipo);
        if (categoria !== "Todos") params.set("categoria", categoria);
        if (currency !== "Todos") params.set("currency", currency);
        if (qDebounced) params.set("q", qDebounced);
        const res = await fetchJson<{
          items: TransactionRow[];
          total: number;
          page: number;
          page_size: number;
        }>(`/transactions?${params}`);
        if (page === 1) reportedTotal = res.total;
        all.push(...res.items);
        if (all.length >= reportedTotal || res.items.length === 0) break;
        page += 1;
      }
      setTotal(reportedTotal);
      setItems(all);
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [tipo, categoria, currency, qDebounced]);

  const loadDistinctTipos = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (categoria !== "Todos") params.set("categoria", categoria);
      if (currency !== "Todos") params.set("currency", currency);
      if (qDebounced) params.set("q", qDebounced);
      const r = await fetchJson<{ tipos: string[] }>(`/transactions/distinct-tipos?${params}`);
      setAvailableTipos(r.tipos);
      setTipo((prev) => (prev !== "Todos" && !r.tipos.includes(prev) ? "Todos" : prev));
    } catch {
      setAvailableTipos([]);
    }
  }, [categoria, currency, qDebounced]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions, dataVersion]);

  useEffect(() => {
    void loadDistinctTipos();
  }, [loadDistinctTipos, dataVersion]);

  const chartFmt = useMemo(() => {
    if (monthCur === "CLP" || monthScope === "fondos")
      return (n: number) => {
        const s = Math.round(n).toLocaleString("es-CL");
        return `$${s.replace(/,/g, ".")}`;
      };
    return (n: number) => formatAxisMoney(n);
  }, [monthCur, monthScope]);

  const tooltipCurrency: CurFilter = monthScope === "fondos" ? "CLP" : monthCur;
  const tooltipMoney = useMemo(
    () => (n: number) => formatMonthlyTooltipValue(n, tooltipCurrency),
    [tooltipCurrency],
  );

  const chartGreenLabel =
    monthScope === "stocks" ? "Compra" : monthScope === "fondos" ? "Depósitos" : "Ingresos";
  const chartRedLabel =
    monthScope === "stocks" ? "Venta" : monthScope === "fondos" ? "Retiros" : "Egresos";

  /** Acciones: `acciones_*`. Fondos: `fondos_*` (CLP). Billetera / all: ingresos/egresos. */
  const monthlyChartData: MonthlyChartPoint[] = useMemo(() => {
    return monthly.map((r) => {
      if (monthScope === "stocks") {
        return {
          ...r,
          barGreen: r.acciones_compras ?? 0,
          barRed: r.acciones_ventas ?? 0,
        };
      }
      if (monthScope === "fondos") {
        return {
          ...r,
          barGreen: r.fondos_depositos ?? 0,
          barRed: r.fondos_retiros ?? 0,
        };
      }
      return {
        ...r,
        barGreen: r.ingresos,
        barRed: r.egresos,
      };
    });
  }, [monthly, monthScope]);

  /** Lista con altura acotada y scroll interno; más alto en /transacciones (solo lista). */
  const txListScrollClass = showMonthly
    ? "max-h-[min(26rem,42dvh)] sm:max-h-[min(30rem,48dvh)]"
    : "max-h-[min(38rem,72dvh)] sm:max-h-[min(42rem,75dvh)]";

  const activityCardClass =
    "rounded-2xl border border-[#30363d] bg-[#161b22] p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] md:p-6";

  return (
    <section>
      <div className={showMonthly ? "space-y-6" : ""}>
        {showMonthly && (
          <h2 className="text-base font-bold uppercase tracking-[0.12em] text-white">Actividad</h2>
        )}

        {showMonthly && (
          <div className={activityCardClass}>
            <div className="mb-5 flex flex-col gap-4">
              <div className="flex flex-row flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <h3 className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#8b949e]">
                  <span className="text-base font-bold tracking-[0.12em] text-white">Movimientos mensuales</span>
                </h3>
                <div className="flex flex-shrink-0 flex-row flex-wrap items-center justify-end gap-x-5 gap-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-[#6e7681]">Moneda</span>
                    {(["USD", "CLP"] as const).map((k) => {
                      const usdDisabled = monthScope === "fondos" && k === "USD";
                      return (
                        <button
                          key={k}
                          type="button"
                          disabled={usdDisabled}
                          title={
                            usdDisabled
                              ? "Los fondos Fintual están solo en pesos chilenos"
                              : undefined
                          }
                          onClick={() => {
                            if (!usdDisabled) setMonthCur(k);
                          }}
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            monthCur === k ? "bg-white text-[#0d1117]" : "bg-[#21262d] text-[#8b949e] hover:text-white"
                          } ${usdDisabled ? "cursor-not-allowed opacity-40 hover:text-[#8b949e]" : ""}`}
                        >
                          {k}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-[#6e7681]">Vista</span>
                    {(
                      [
                        { id: "wallet" as const, label: "Billetera" },
                        { id: "stocks" as const, label: "Acciones" },
                        { id: "fondos" as const, label: "Fondos" },
                      ] as const
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setMonthScope(id)}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          monthScope === id ? "bg-white text-[#0d1117]" : "bg-[#21262d] text-[#8b949e] hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[10px] text-[#8b949e] sm:justify-end">
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#22c55e]" aria-hidden />
                  {chartGreenLabel}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[#ef4444]" aria-hidden />
                  {chartRedLabel}
                </span>
              </div>
            </div>
          <div className="h-[200px] w-full sm:h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#21262d" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "#8b949e", fontSize: 10 }}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={56}
                />
                <YAxis tick={{ fill: "#8b949e", fontSize: 10 }} tickFormatter={chartFmt} width={64} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as MonthlyChartPoint;
                    return (
                      <div className="rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-xs shadow-lg">
                        <p className="mb-2 font-medium text-[#e6edf3]">{p.label}</p>
                        <p className="text-[#22c55e]">
                          {chartGreenLabel}{" "}
                          <span className="text-[#e6edf3] tabular-nums">{tooltipMoney(p.barGreen)}</span>
                        </p>
                        <p className="mt-0.5 text-[#ef4444]">
                          {chartRedLabel}{" "}
                          <span className="text-[#e6edf3] tabular-nums">{tooltipMoney(p.barRed)}</span>
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="barGreen" name={chartGreenLabel} fill="#22c55e" radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="barRed" name={chartRedLabel} fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Transacciones — misma familia visual que movimientos mensuales */}
      <div className={activityCardClass}>
        <div className="mb-5">
          <h3 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-[0.08em] text-[#8b949e]">
            <span className="text-base font-bold tracking-[0.12em] text-white">Transacciones</span>
            <span className="tabular-nums text-white">({total})</span>
            {loading && items.length > 0 && (
              <span className="text-[11px] font-normal normal-case tracking-normal text-[#6e7681]">
                Actualizando…
              </span>
            )}
          </h3>
        </div>

        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
          {/* Izquierda: Categoría + Tipo */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <PillRow
              label="Categoría"
              value={categoria}
              options={["Todos", "Acciones", "Fondos", "AFP", "Wallet USD"]}
              onChange={setCategoria}
              pillsSingleRow
            />
            <TipoFilterRow value={tipo} onChange={setTipo} options={availableTipos} />
          </div>
          {/* Derecha: Buscar arriba, Moneda abajo (alineados a la derecha) */}
          <div className="flex w-full shrink-0 flex-col items-stretch gap-3 lg:w-auto lg:items-end">
            <div
              className={`flex min-w-0 w-full items-center ${FILTER_ROW_GAP} lg:w-[min(100%,34rem)] lg:justify-end lg:self-end`}
            >
              <span className={FILTER_LABEL}>Buscar</span>
              <input
                type="search"
                enterKeyHint="search"
                className="h-[38px] w-full min-w-[12rem] flex-1 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm leading-tight text-white placeholder:text-[#484f58] focus:border-[#6e7681] focus:outline-none lg:min-w-[22rem]"
                placeholder="Ticker o nombre…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Buscar por ticker o nombre"
              />
            </div>
            <div className="flex w-full justify-end">
              <PillRow
                label="Moneda"
                value={currency}
                options={["Todos", "USD", "CLP"]}
                onChange={setCurrency}
                inline
              />
            </div>
          </div>
        </div>

        {loading && items.length === 0 && (
          <p className="text-sm text-[#8b949e]">Cargando…</p>
        )}
        {!loading && items.length === 0 && (
          <p className="text-sm text-[#8b949e]">No hay transacciones con estos filtros.</p>
        )}

        {items.length > 0 && (
          <div
            className={`tx-scroll overflow-y-auto overscroll-y-contain rounded-xl border border-[#21262d] bg-[#0d1117] ${txListScrollClass}`}
          >
            <div
              className={`p-2 transition-opacity duration-150 sm:p-3 ${loading ? "opacity-60" : "opacity-100"}`}
              aria-busy={loading}
            >
              <GroupedTransactionRows
                items={items}
                onOpenDetail={(tx) => setDetailTx(tx)}
                onEdit={onEdit}
                onDelete={async (tx) => {
                  if (
                    tx.source === "fintual" ||
                    tx.source === "wallet" ||
                    tx.id >= 10_000_000
                  ) {
                    onToast("Los movimientos sincronizados desde Fintual no se eliminan aquí.");
                    return;
                  }
                  const ok = window.confirm(
                    `¿Eliminar esta transacción?\n${tx.tipo.toUpperCase()} ${tx.activo} · ${tx.fecha}`,
                  );
                  if (!ok) return;
                  setDeletingId(tx.id);
                  try {
                    const r = await fetch(`${API_BASE}/transactions/${tx.id}`, { method: "DELETE" });
                    if (!r.ok) {
                      const d = await r.json().catch(() => ({}));
                      onToast(typeof d.detail === "string" ? d.detail : "No se pudo eliminar.");
                      return;
                    }
                  onToast("Transacción eliminada ✅");
                  onMutate();
                  void loadTransactions();
                  } catch {
                    onToast("Error de red al eliminar.");
                  } finally {
                    setDeletingId(null);
                  }
                }}
                deletingId={deletingId}
              />
            </div>
          </div>
        )}
      </div>
      </div>

      {detailTx != null && (
        <TransactionDetailModal key={detailTx.id} tx={detailTx} onClose={() => setDetailTx(null)} />
      )}
    </section>
  );
}

function TipoFilterRow({
  value,
  onChange,
  options,
}: {
  value: Pill;
  onChange: (v: Pill) => void;
  options: string[];
}) {
  const pills: Pill[] = ["Todos", ...options];
  return (
    <div className={`flex min-w-0 items-center ${FILTER_ROW_GAP}`}>
      <span className={FILTER_LABEL}>Tipo</span>
      <div className="filter-pills-scroll flex min-w-0 flex-1 flex-nowrap gap-1.5 overflow-x-auto pb-0.5">
        {pills.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={tipoFilterPillClass(o, value === o)}
          >
            {TIPO_FILTER_LABELS[o] ?? o.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>
    </div>
  );
}

function tipoFilterPillClass(option: string, selected: boolean): string {
  const base = "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors";
  if (!selected) return `${base} bg-[#21262d] text-[#8b949e] hover:text-white`;
  if (option === "Todos") return `${base} bg-white text-[#0d1117]`;
  const colors: Record<string, string> = {
    dividendo: "bg-[#453008] text-[#e2b340] ring-1 ring-[#e2b340]/35",
    deposito: "bg-[#064e3b] text-[#34d399] ring-1 ring-[#34d399]/25",
    retiro: "bg-[#5c1f0d] text-[#fca5a5] ring-1 ring-[#fca5a5]/25",
    interes_caja: "bg-[#0e3c46] text-[#40c4ff] ring-1 ring-[#40c4ff]/25",
    compensacion: "bg-[#3f3f46] text-[#d4d4d8]",
    fusion_caja: "bg-[#422006] text-[#fcd34d] ring-1 ring-[#fcd34d]/20",
    desinversion: "bg-[#14532d] text-[#86efac] ring-1 ring-[#86efac]/20",
    acat_ingreso: "bg-[#134e4a] text-[#5eead4] ring-1 ring-[#5eead4]/20",
    acat_comision: "bg-[#4c0519] text-[#fda4af] ring-1 ring-[#fda4af]/20",
    acat_egreso: "bg-[#4c0519] text-[#fb7185] ring-1 ring-[#fb7185]/20",
    warrant_comision: "bg-[#3b0764] text-[#d8b4fe] ring-1 ring-[#d8b4fe]/20",
    warrant_costo: "bg-[#3b0764] text-[#c084fc] ring-1 ring-[#c084fc]/20",
    compra: "bg-[#2d2b55] text-[#a599e9] ring-1 ring-[#a599e9]/30",
    reinversion: "bg-[#312e81] text-[#a5b4fc] ring-1 ring-[#a5b4fc]/30",
    venta: "bg-[#5c1f0d] text-[#fdba74] ring-1 ring-[#fdba74]/25",
  };
  return `${base} ${colors[option] ?? "bg-white text-[#0d1117]"}`;
}

function PillRow({
  label,
  value,
  options,
  onChange,
  /** Una sola fila con scroll horizontal (evita que una píldora quede sola abajo y desalinee la grilla). */
  pillsSingleRow,
  /** Columna derecha: el grupo no estira al 100% del contenedor. */
  inline,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: Pill) => void;
  pillsSingleRow?: boolean;
  inline?: boolean;
}) {
  const pillStrip = pillsSingleRow
    ? "filter-pills-scroll flex min-w-0 flex-1 flex-nowrap gap-1.5 overflow-x-auto pb-0.5"
    : inline
      ? "flex min-w-0 flex-wrap gap-1.5"
      : "flex min-w-0 flex-1 flex-wrap gap-1.5";
  const rowCls = inline ? "inline-flex max-w-full" : "flex min-w-0";
  return (
    <div className={`${rowCls} items-center ${FILTER_ROW_GAP}`}>
      <span className={FILTER_LABEL}>{label}</span>
      <div className={pillStrip}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              value === o ? "bg-white text-[#0d1117]" : "bg-[#21262d] text-[#8b949e] hover:text-white"
            }`}
          >
            {o === "Todos" ? "Todos" : o.charAt(0).toUpperCase() + o.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

function GroupedTransactionRows({
  items,
  onOpenDetail,
  onEdit,
  onDelete,
  deletingId,
}: {
  items: TransactionRow[];
  onOpenDetail: (tx: TransactionRow) => void;
  onEdit: (tx: TransactionRow) => void;
  onDelete: (tx: TransactionRow) => void;
  deletingId: number | null;
}) {
  const groups = useMemo(() => {
    const m = new Map<number, TransactionRow[]>();
    for (const tx of items) {
      const y = new Date(tx.fecha + "T12:00:00").getFullYear();
      if (!m.has(y)) m.set(y, []);
      m.get(y)!.push(tx);
    }
    const years = [...m.keys()].sort((a, b) => b - a);
    return years.map((y) => ({ year: y, rows: m.get(y)! }));
  }, [items]);

  return (
    <div className="flex flex-col">
      {groups.map(({ year, rows }, gi) => (
        <section key={year} className={gi === 0 ? "-mt-2 sm:-mt-3" : ""}>
          {/* Franja de año: líneas más visibles que divide-y de filas + fondo apenas distinto para leer al scroll */}
          <div className="-mx-2 flex flex-wrap items-center gap-2 border-y border-[#3d444d] bg-[#111820] px-2 py-3.5 sm:-mx-3 sm:px-3">
            <span className="text-lg font-bold tabular-nums leading-none tracking-tight text-white">{year}</span>
            <span className="text-sm font-medium leading-none text-[#8b949e]">{rows.length} movimientos</span>
          </div>
          <ul className="-mx-2 divide-y divide-[#21262d] overflow-x-auto bg-[#0d1117] px-2 sm:-mx-3 sm:px-3">
            {rows.map((tx) => (
              <TransactionRowView
                key={tx.id}
                tx={tx}
                onOpenDetail={() => onOpenDetail(tx)}
                onEdit={() => onEdit(tx)}
                onDelete={() => onDelete(tx)}
                deleting={deletingId === tx.id}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Mismo ancho; altura baja tipo píldora compacta (ref. foto 2). */
const BADGE_FIXED = "h-6 w-[138px] shrink-0 sm:h-7";

function TransactionRowView({
  tx,
  onOpenDetail,
  onEdit,
  onDelete,
  deleting,
}: {
  tx: TransactionRow;
  onOpenDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isFintualSynced =
    tx.source === "fintual" || tx.source === "wallet" || tx.id >= 10_000_000;
  const d = new Date(tx.fecha + "T12:00:00");
  const day = d.getDate();
  const mo = d.toLocaleDateString("es", { month: "short" }).replace(".", "").toUpperCase() + ".";
  const isDivision = (tx.tipo || "").toLowerCase() === "division_accion";
  const amountFmt = isDivision
    ? { text: "Sin flujo USD", signClass: "text-[#8b949e]" }
    : formatTxSignedAmount(tx.monto_total, tx.currency, tx.tipo);
  const { text, signClass } = amountFmt;
  const showShares =
    ((tx.tipo === "compra" || tx.tipo === "reinversion" || tx.tipo === "venta") && tx.acciones > 1e-8) ||
    (isDivision && (tx.acciones > 1e-18 || tx.precio_unitario > 1e-18));

  return (
    <li
      className="flex cursor-pointer items-center gap-1.5 py-2 sm:gap-2.5 sm:py-2.5 md:gap-3"
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {/* Columnas alineadas: fecha | badge (ancho fijo) | icono | nombre | monto */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5 md:gap-3">
        <div className="flex w-[42px] shrink-0 flex-col items-center justify-center text-center sm:w-[48px]">
          <p className="text-xl font-bold leading-none tracking-tight text-white sm:text-2xl">{day}</p>
          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#9ca3af] sm:text-[10px]">{mo}</p>
        </div>

        <div className="flex w-[138px] shrink-0 items-center justify-center">
          <span
            className={`flex ${BADGE_FIXED} items-center justify-center rounded-full px-2 text-center text-[9px] font-bold uppercase leading-none tracking-wide sm:text-[10px] ${badgeStyleForTx(tx)}`}
          >
            {badgeLabel(tx)}
          </span>
        </div>

        <div className="flex shrink-0 items-center justify-center">
          <TxAvatar tx={tx} />
        </div>

        <p className="min-w-0 flex-1 truncate pl-0.5 text-left text-[14px] font-semibold text-white sm:pl-1 sm:text-[15px]">
          {txDisplayName(tx)}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-center gap-0.5 pl-2 sm:ml-2 sm:w-[min(100%,128px)] sm:pl-0 md:ml-3 md:w-36">
        <p className={`text-[15px] font-semibold tabular-nums sm:text-base ${signClass}`}>{text}</p>
        {showShares && (
          <p className="text-[11px] text-[#8b949e]">
            {isDivision ? (
              <>
                {formatSharesExact(tx.precio_unitario)} → {formatSharesExact(tx.acciones)} acciones
              </>
            ) : (
              <>
                {formatSharesExact(tx.acciones)} acciones
              </>
            )}
          </p>
        )}
        {!isFintualSynced && (
          <div className="flex gap-3 text-xs">
            <button
              type="button"
              className="text-[#2dd4bf] hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              Editar
            </button>
            <button
              type="button"
              className="text-[#f87171] hover:underline disabled:opacity-40"
              disabled={deleting}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              {deleting ? "…" : "Eliminar"}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
