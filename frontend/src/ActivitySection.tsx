import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { apiFetch, fetchJson } from "./api";
import {
  formatAxisMoney,
  formatMonthlyTooltipValue,
  formatSharesExact,
  formatTxSignedAmount,
} from "./format";
import { TransactionDetailModal } from "./TransactionDetailModal";
import type { MonthlyChartPoint, MonthlyMovementRow, TransactionRow } from "./types";
import { TxAvatar, badgeLabel, badgeStyleForTx, txDisplayName } from "./transactionUi";

type CurFilter = "USD" | "CLP";
/** Vista del gráfico mensual: billetera, acciones US, fondos CLP o consolidado. */
type MonthScopeFilter = "wallet" | "stocks" | "fondos";
type Pill = "Todos" | string;

/** Columna de etiqueta (más estrecha = menos hueco hasta las píldoras / input). */
function filterLabelClass(isDark: boolean): string {
  return `w-[5rem] shrink-0 text-left text-[10px] font-semibold uppercase leading-tight tracking-wide ${
    isDark ? "text-[#8b949e]" : "text-[#8A8072]"
  }`;
}

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
  /** When true (default), shows the monthly movements chart too — used by the Panel's "Actividad" tab. */
  showMonthly?: boolean;
  /** Tema explícito (pantalla fuera de /banking/* o /profile — ver docs/design-colors.md). */
  isDark: boolean;
}

export function ActivitySection({
  dataVersion,
  onEdit,
  onToast,
  onMutate,
  showMonthly = true,
  isDark,
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

  const activityCardClass = `rounded-2xl border p-5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] md:p-6 ${
    isDark ? "border-[#30363d] bg-[#161b22]" : "border-[#E8E1D4] bg-white shadow-none shadow-[#2B2620]/[0.04]"
  }`;
  const headingClass = isDark ? "text-[#F3F1EC]" : "text-[#2B2620]";
  const subHeadingClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const mutedLabelClass = `text-[10px] font-medium uppercase tracking-wide ${
    isDark ? "text-[#6e7681]" : "text-[#9A9284]"
  }`;
  const segPillActive = isDark ? "bg-[#8FBFA6] text-[#1F2E25]" : "bg-[#8FBFA6] text-[#1F2E25]";
  const segPillIdle = isDark
    ? "bg-[#21262d] text-[#8b949e] hover:text-[#F3F1EC]"
    : "bg-[#F5F1E8] text-[#8A8072] hover:text-[#2B2620]";
  const axisColor = isDark ? "#8b949e" : "#8A8072";
  const gridColor = isDark ? "#21262d" : "#E8E1D4";
  const tooltipCardClass = isDark
    ? "rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-xs shadow-lg"
    : "rounded-lg border border-[#E8E1D4] bg-white px-3 py-2 text-xs shadow-lg shadow-[#2B2620]/10";
  const tooltipValueClass = isDark ? "text-[#F3F1EC]" : "text-[#2B2620]";
  const searchInputClass = isDark
    ? "h-[38px] w-full min-w-[12rem] flex-1 rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm leading-tight text-[#F3F1EC] placeholder:text-[#484f58] focus:border-[#8FBFA6] focus:outline-none lg:min-w-[22rem]"
    : "h-[38px] w-full min-w-[12rem] flex-1 rounded-lg border border-[#DCD3C2] bg-white px-3 py-2 text-sm leading-tight text-[#2B2620] placeholder:text-[#9A9284] focus:border-[#8FBFA6] focus:outline-none lg:min-w-[22rem]";
  const listContainerClass = isDark
    ? "border-[#21262d] bg-[#0d1117]"
    : "border-[#E8E1D4] bg-[#FBFAF7]";
  const emptyTextClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";

  return (
    <section>
      <div className={showMonthly ? "space-y-6" : ""}>
        {showMonthly && (
          <h2 className={`text-base font-bold uppercase tracking-[0.12em] ${headingClass}`}>Actividad</h2>
        )}

        {showMonthly && (
          <div className={activityCardClass}>
            <div className="mb-5 flex flex-col gap-4">
              <div className="flex flex-row flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <h3 className={`flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-[0.08em] ${subHeadingClass}`}>
                  <span className={`text-base font-bold tracking-[0.12em] ${headingClass}`}>Movimientos mensuales</span>
                </h3>
                <div className="flex flex-shrink-0 flex-row flex-wrap items-center justify-end gap-x-5 gap-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={mutedLabelClass}>Moneda</span>
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
                            monthCur === k ? segPillActive : segPillIdle
                          } ${usdDisabled ? "cursor-not-allowed opacity-40" : ""}`}
                        >
                          {k}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={mutedLabelClass}>Vista</span>
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
                          monthScope === id ? segPillActive : segPillIdle
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className={`flex flex-wrap items-center gap-4 text-[10px] sm:justify-end ${subHeadingClass}`}>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${isDark ? "bg-[#34d399]" : "bg-[#059669]"}`}
                    aria-hidden
                  />
                  {chartGreenLabel}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${isDark ? "bg-[#fb7185]" : "bg-[#e11d48]"}`}
                    aria-hidden
                  />
                  {chartRedLabel}
                </span>
              </div>
            </div>
          <div className="h-[200px] w-full sm:h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={gridColor} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: axisColor, fontSize: 10 }}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={56}
                />
                <YAxis tick={{ fill: axisColor, fontSize: 10 }} tickFormatter={chartFmt} width={64} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as MonthlyChartPoint;
                    return (
                      <div className={tooltipCardClass}>
                        <p className={`mb-2 font-medium ${tooltipValueClass}`}>{p.label}</p>
                        <p className={isDark ? "text-[#34d399]" : "text-[#059669]"}>
                          {chartGreenLabel}{" "}
                          <span className={`tabular-nums ${tooltipValueClass}`}>{tooltipMoney(p.barGreen)}</span>
                        </p>
                        <p className={`mt-0.5 ${isDark ? "text-[#fb7185]" : "text-[#e11d48]"}`}>
                          {chartRedLabel}{" "}
                          <span className={`tabular-nums ${tooltipValueClass}`}>{tooltipMoney(p.barRed)}</span>
                        </p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="barGreen"
                  name={chartGreenLabel}
                  fill={isDark ? "#34d399" : "#059669"}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="barRed"
                  name={chartRedLabel}
                  fill={isDark ? "#fb7185" : "#e11d48"}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Transacciones — misma familia visual que movimientos mensuales */}
      <div className={activityCardClass}>
        <div className="mb-5">
          <h3 className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs font-semibold uppercase tracking-[0.08em] ${subHeadingClass}`}>
            <span className={`text-base font-bold tracking-[0.12em] ${headingClass}`}>Transacciones</span>
            <span className={`tabular-nums ${headingClass}`}>({total})</span>
            {loading && items.length > 0 && (
              <span className={`text-[11px] font-normal normal-case tracking-normal ${isDark ? "text-[#6e7681]" : "text-[#9A9284]"}`}>
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
              isDark={isDark}
            />
            <TipoFilterRow value={tipo} onChange={setTipo} options={availableTipos} isDark={isDark} />
          </div>
          {/* Derecha: Buscar arriba, Moneda abajo (alineados a la derecha) */}
          <div className="flex w-full shrink-0 flex-col items-stretch gap-3 lg:w-auto lg:items-end">
            <div
              className={`flex min-w-0 w-full items-center ${FILTER_ROW_GAP} lg:w-[min(100%,34rem)] lg:justify-end lg:self-end`}
            >
              <span className={filterLabelClass(isDark)}>Buscar</span>
              <input
                type="search"
                enterKeyHint="search"
                className={searchInputClass}
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
                isDark={isDark}
              />
            </div>
          </div>
        </div>

        {loading && items.length === 0 && (
          <p className={`text-sm ${emptyTextClass}`}>Cargando…</p>
        )}
        {!loading && items.length === 0 && (
          <p className={`text-sm ${emptyTextClass}`}>No hay transacciones con estos filtros.</p>
        )}

        {items.length > 0 && (
          <div
            className={`tx-scroll overflow-y-auto overscroll-y-contain rounded-xl border ${listContainerClass} ${txListScrollClass}`}
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
                    const r = await apiFetch(`/transactions/${tx.id}`, { method: "DELETE" });
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
                isDark={isDark}
              />
            </div>
          </div>
        )}
      </div>
      </div>

      {detailTx != null && (
        <TransactionDetailModal key={detailTx.id} tx={detailTx} onClose={() => setDetailTx(null)} isDark={isDark} />
      )}
    </section>
  );
}

function TipoFilterRow({
  value,
  onChange,
  options,
  isDark,
}: {
  value: Pill;
  onChange: (v: Pill) => void;
  options: string[];
  isDark: boolean;
}) {
  const pills: Pill[] = ["Todos", ...options];
  return (
    <div className={`flex min-w-0 items-center ${FILTER_ROW_GAP}`}>
      <span className={filterLabelClass(isDark)}>Tipo</span>
      <div
        className={`${isDark ? "filter-pills-scroll" : "filter-pills-scroll-light"} flex min-w-0 flex-1 flex-nowrap gap-1.5 overflow-x-auto pb-0.5`}
      >
        {pills.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={tipoFilterPillClass(o, value === o, isDark)}
          >
            {TIPO_FILTER_LABELS[o] ?? o.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Mismo mapeo de color que `badgeStyleForTx` (transactionUi.tsx) — píldora de filtro «Tipo» seleccionada. */
function tipoFilterPillClass(option: string, selected: boolean, isDark: boolean): string {
  const base = "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors";
  if (!selected) {
    return isDark
      ? `${base} bg-[#21262d] text-[#8b949e] hover:text-[#F3F1EC]`
      : `${base} bg-[#F5F1E8] text-[#8A8072] hover:text-[#2B2620]`;
  }
  if (option === "Todos") return `${base} bg-[#8FBFA6] text-[#1F2E25]`;
  if (isDark) {
    const colorsDark: Record<string, string> = {
      dividendo: "bg-[#C79A56]/18 text-[#E9CB9B]",
      deposito: "bg-[#8FBFA6]/20 text-[#8FBFA6]",
      retiro: "bg-[#cc998e]/20 text-[#e7c3b6]",
      interes_caja: "bg-[#8ec2cc]/20 text-[#b6dfe7]",
      compensacion: "bg-[#21262d] text-[#9ca3af]",
      fusion_caja: "bg-[#ccc78e]/18 text-[#e6dfa0]",
      desinversion: "bg-[#a8cc8e]/18 text-[#b9e6a0]",
      acat_ingreso: "bg-[#8eccbd]/18 text-[#a0e6d4]",
      acat_comision: "bg-[#cc8eb8]/18 text-[#e6a8d4]",
      acat_egreso: "bg-[#cc8eb8]/18 text-[#e6a8d4]",
      warrant_comision: "bg-[#8ea8cc]/18 text-[#a8bfe6]",
      warrant_costo: "bg-[#8ea8cc]/18 text-[#a8bfe6]",
      compra: "bg-[#998ecc]/18 text-[#c4b8ed]",
      reinversion: "bg-[#bd8ecc]/18 text-[#d9b8e6]",
      venta: "bg-[#cc8e9e]/20 text-[#e7b4c0]",
    };
    return `${base} ${colorsDark[option] ?? "bg-[#8FBFA6] text-[#1F2E25]"}`;
  }
  const colorsLight: Record<string, string> = {
    dividendo: "bg-[#C79A56]/18 text-[#8A6631]",
    deposito: "bg-[#8FBFA6]/20 text-[#3F6B52]",
    retiro: "bg-[#cc998e]/20 text-[#a3705f]",
    interes_caja: "bg-[#8ec2cc]/20 text-[#4a7d8c]",
    compensacion: "bg-[#F5F1E8] text-[#8A8072]",
    fusion_caja: "bg-[#ccc78e]/18 text-[#8a8250]",
    desinversion: "bg-[#a8cc8e]/18 text-[#5f8a4a]",
    acat_ingreso: "bg-[#8eccbd]/18 text-[#4a8a76]",
    acat_comision: "bg-[#cc8eb8]/18 text-[#8a4a72]",
    acat_egreso: "bg-[#cc8eb8]/18 text-[#8a4a72]",
    warrant_comision: "bg-[#8ea8cc]/18 text-[#4a5f8a]",
    warrant_costo: "bg-[#8ea8cc]/18 text-[#4a5f8a]",
    compra: "bg-[#998ecc]/18 text-[#5f549e]",
    reinversion: "bg-[#bd8ecc]/18 text-[#8a5a9e]",
    venta: "bg-[#cc8e9e]/20 text-[#A65568]",
  };
  return `${base} ${colorsLight[option] ?? "bg-[#8FBFA6] text-[#1F2E25]"}`;
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
  isDark,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: Pill) => void;
  pillsSingleRow?: boolean;
  inline?: boolean;
  isDark: boolean;
}) {
  const pillStrip = pillsSingleRow
    ? `${isDark ? "filter-pills-scroll" : "filter-pills-scroll-light"} flex min-w-0 flex-1 flex-nowrap gap-1.5 overflow-x-auto pb-0.5`
    : inline
      ? "flex min-w-0 flex-wrap gap-1.5"
      : "flex min-w-0 flex-1 flex-wrap gap-1.5";
  const rowCls = inline ? "inline-flex max-w-full" : "flex min-w-0";
  return (
    <div className={`${rowCls} items-center ${FILTER_ROW_GAP}`}>
      <span className={filterLabelClass(isDark)}>{label}</span>
      <div className={pillStrip}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              value === o
                ? "bg-[#8FBFA6] text-[#1F2E25]"
                : isDark
                  ? "bg-[#21262d] text-[#8b949e] hover:text-[#F3F1EC]"
                  : "bg-[#F5F1E8] text-[#8A8072] hover:text-[#2B2620]"
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
  isDark,
}: {
  items: TransactionRow[];
  onOpenDetail: (tx: TransactionRow) => void;
  onEdit: (tx: TransactionRow) => void;
  onDelete: (tx: TransactionRow) => void;
  deletingId: number | null;
  isDark: boolean;
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

  const yearStripClass = isDark
    ? "border-[#3d444d] bg-[#111820]"
    : "border-[#DCD3C2] bg-[#F5F1E8]";
  const yearNumberClass = isDark ? "text-[#F3F1EC]" : "text-[#2B2620]";
  const yearCountClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const listBgClass = isDark ? "divide-[#21262d] bg-[#0d1117]" : "divide-[#F0EAE0] bg-[#FBFAF7]";

  return (
    <div className="flex flex-col">
      {groups.map(({ year, rows }, gi) => (
        <section key={year} className={gi === 0 ? "-mt-2 sm:-mt-3" : ""}>
          {/* Franja de año: líneas más visibles que divide-y de filas + fondo apenas distinto para leer al scroll */}
          <div className={`-mx-2 flex flex-wrap items-center gap-2 border-y px-2 py-3.5 sm:-mx-3 sm:px-3 ${yearStripClass}`}>
            <span className={`text-lg font-bold tabular-nums leading-none tracking-tight ${yearNumberClass}`}>{year}</span>
            <span className={`text-sm font-medium leading-none ${yearCountClass}`}>{rows.length} movimientos</span>
          </div>
          <ul className={`-mx-2 divide-y overflow-x-auto px-2 sm:-mx-3 sm:px-3 ${listBgClass}`}>
            {rows.map((tx) => (
              <TransactionRowView
                key={tx.id}
                tx={tx}
                onOpenDetail={() => onOpenDetail(tx)}
                onEdit={() => onEdit(tx)}
                onDelete={() => onDelete(tx)}
                deleting={deletingId === tx.id}
                isDark={isDark}
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
  isDark,
}: {
  tx: TransactionRow;
  onOpenDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  isDark: boolean;
}) {
  const isFintualSynced =
    tx.source === "fintual" || tx.source === "wallet" || tx.id >= 10_000_000;
  const d = new Date(tx.fecha + "T12:00:00");
  const day = d.getDate();
  const mo = d.toLocaleDateString("es", { month: "short" }).replace(".", "").toUpperCase() + ".";
  const isDivision = (tx.tipo || "").toLowerCase() === "division_accion";
  const mutedClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const amountFmt = isDivision
    ? { text: "Sin flujo USD", signClass: mutedClass }
    : formatTxSignedAmount(tx.monto_total, tx.currency, tx.tipo, isDark);
  const { text, signClass } = amountFmt;
  const showShares =
    ((tx.tipo === "compra" || tx.tipo === "reinversion" || tx.tipo === "venta") && tx.acciones > 1e-8) ||
    (isDivision && (tx.acciones > 1e-18 || tx.precio_unitario > 1e-18));
  const dayClass = isDark ? "text-[#F3F1EC]" : "text-[#2B2620]";
  const moClass = isDark ? "text-[#9ca3af]" : "text-[#9A9284]";
  const nameClass = isDark ? "text-[#F3F1EC]" : "text-[#2B2620]";

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
          <p className={`text-xl font-bold leading-none tracking-tight sm:text-2xl ${dayClass}`}>{day}</p>
          <p className={`mt-0.5 text-[9px] font-semibold uppercase tracking-wide sm:text-[10px] ${moClass}`}>{mo}</p>
        </div>

        <div className="flex w-[138px] shrink-0 items-center justify-center">
          <span
            className={`flex ${BADGE_FIXED} items-center justify-center rounded-full px-2 text-center text-[9px] font-bold uppercase leading-none tracking-wide sm:text-[10px] ${badgeStyleForTx(tx, isDark)}`}
          >
            {badgeLabel(tx)}
          </span>
        </div>

        <div className="flex shrink-0 items-center justify-center">
          <TxAvatar tx={tx} isDark={isDark} />
        </div>

        <p className={`min-w-0 flex-1 truncate pl-0.5 text-left text-[14px] font-semibold sm:pl-1 sm:text-[15px] ${nameClass}`}>
          {txDisplayName(tx)}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-center gap-0.5 pl-2 sm:ml-2 sm:w-[min(100%,128px)] sm:pl-0 md:ml-3 md:w-36">
        <p className={`text-[15px] font-semibold tabular-nums sm:text-base ${signClass}`}>{text}</p>
        {showShares && (
          <p className={`text-[11px] ${mutedClass}`}>
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
              className={isDark ? "text-[#8FBFA6] hover:underline" : "text-[#3F6B52] hover:underline"}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              Editar
            </button>
            <button
              type="button"
              className={
                isDark
                  ? "text-[#cc8e9e] hover:underline disabled:opacity-40"
                  : "text-[#A65568] hover:underline disabled:opacity-40"
              }
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
