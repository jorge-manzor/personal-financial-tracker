import { useEffect, useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ActiveInvestmentsSection } from "./ActiveInvestmentsSection";
import { ActivitySection } from "./ActivitySection";
import { InactiveInvestmentsSection } from "./InactiveInvestmentsSection";
import { GoalMovementsModal } from "./GoalMovementsModal";
import { PortfolioChart } from "./PortfolioChart";
import {
  formatClpDots,
  formatClpSigned,
  formatMoney,
  formatMoneyCLP,
  formatMoneyUSDLabel,
  formatPct,
  formatSharesCard,
  formatUsdDotsTwoDecimals,
  formatUsdSignedGain,
} from "./format";
import { StockMovementsModal } from "./StockMovementsModal";
import { StockLogoImg } from "./transactionUi";
import type {
  ChartCurrency,
  ChartRow,
  Holding,
  ManualAsset,
  Period,
  FintualGoalCard,
  Portfolio,
  SectorSlice,
  TransactionRow,
} from "./types";

/** Categorías del gráfico de torta «Valor Total» (CLP); al ocultar una, se excluye del anillo y se recalculan %. */
type ValorTotalPieKey = "acciones" | "fondos" | "afp" | "manuales";

/** Paleta vibrante tipo dashboard de sectores (anillo + % en leyenda). */
const SECTOR_COLORS = [
  "#ec4899",
  "#a855f7",
  "#ef4444",
  "#f97316",
  "#06b6d4",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#6366f1",
  "#84cc16",
];

interface DashboardProps {
  portfolio: Portfolio | null;
  holdings: Holding[];
  chart: ChartRow[];
  period: Period;
  onPeriod: (p: Period) => void;
  chartCurrency: ChartCurrency;
  onChartCurrency: (c: ChartCurrency) => void;
  sectors: SectorSlice[];
  manualAssets: ManualAsset[];
  /** Metas/fondos Fintual activos (API goals). */
  fintualGoals: FintualGoalCard[];
  onManualSnapshot: (a: ManualAsset) => void;
  onDeleteManual: (m: ManualAsset) => void;
  dataVersion: number;
  onEditTransaction: (tx: TransactionRow) => void;
  onToast: (msg: string | null) => void;
  onMutate: () => void;
  chartLoading?: boolean;
}

export function Dashboard({
  portfolio,
  holdings,
  chart,
  period,
  onPeriod,
  chartCurrency,
  onChartCurrency,
  sectors,
  manualAssets,
  fintualGoals,
  onManualSnapshot,
  onDeleteManual,
  dataVersion,
  onEditTransaction,
  onToast,
  onMutate,
  chartLoading = false,
}: DashboardProps) {
  const periods: Period[] = ["1M", "3M", "6M", "1Y", "3Y", "YTD", "ALL"];
  const periodTooltip: Record<Period, string> = {
    "1M": "Último mes",
    "3M": "Últimos 3 meses",
    "6M": "Últimos 6 meses",
    "1Y": "Último año",
    "3Y": "Últimos 3 años",
    YTD: "Desde el 1 de enero",
    ALL: "Todo el historial disponible",
  };
  const lastChart = chart[chart.length - 1];

  const holdingsSorted = useMemo(
    () =>
      [...holdings].sort((a, b) => {
        const d = b.peso_portafolio_pct - a.peso_portafolio_pct;
        if (d !== 0) return d;
        return a.ticker.localeCompare(b.ticker);
      }),
    [holdings],
  );

  /** NAV ~0 → inactivas (debajo de Transacciones); el resto en Inversiones activas. */
  const { fintualGoalsActive, fintualGoalsInactive } = useMemo(() => {
    const active: FintualGoalCard[] = [];
    const inactive: FintualGoalCard[] = [];
    const eps = 0.5;
    for (const g of fintualGoals) {
      if (g.nav_clp <= eps) inactive.push(g);
      else active.push(g);
    }
    inactive.sort((a, b) => a.name.localeCompare(b.name, "es"));
    return { fintualGoalsActive: active, fintualGoalsInactive: inactive };
  }, [fintualGoals]);

  const [stockMovementsHolding, setStockMovementsHolding] = useState<Holding | null>(null);
  const [goalMovementsGoal, setGoalMovementsGoal] = useState<FintualGoalCard | null>(null);
  /** Categorías excluidas del gráfico de torta (clic = toggle); no afecta al resto del dashboard. */
  const [pieCategoryHidden, setPieCategoryHidden] = useState<Partial<Record<ValorTotalPieKey, boolean>>>({});

  const togglePieCategory = (key: ValorTotalPieKey) => {
    setPieCategoryHidden((p) => ({ ...p, [key]: !p[key] }));
  };

  const clearPieCategoryHidden = () => setPieCategoryHidden({});

  const sectorColumns = useMemo(() => {
    if (sectors.length === 0) return [[], []] as [typeof sectors, typeof sectors];
    const mid = Math.ceil(sectors.length / 2);
    return [sectors.slice(0, mid), sectors.slice(mid)] as const;
  }, [sectors]);

  const rate = portfolio?.exchange_rate_usd_clp;

  /** Desglose en CLP para torta y leyenda (misma base que la suma del portafolio). */
  const valorTotalClpBreakdown = useMemo(() => {
    if (!portfolio) return null;
    const r = portfolio.exchange_rate_usd_clp ?? 950;
    const accionesClp = portfolio.acciones_value * r;
    const fondosNavGoals = fintualGoals.reduce((s, g) => s + g.nav_clp, 0);
    const fondosManualClp = portfolio.fondos_clp ?? 0;
    /**
     * `portfolio.fondos_clp` viene de activos manuales en BD; las metas Fintual viven en la API de goals.
     * Si hay NAV de metas, usamos esa suma; si no, el valor manual (p. ej. solo histórico sin API).
     */
    const fondosClp = fondosNavGoals > 0 ? fondosNavGoals : fondosManualClp;
    const afpClp = portfolio.afp_clp ?? 0;
    const manualesClp = portfolio.manuales_value * r;
    const totalClp = accionesClp + fondosClp + afpClp + manualesClp;
    /**
     * Misma noción que el gráfico / `PortfolioValueCache` acciones: invertido = cost basis de posiciones
     * abiertas (`capital_invertido`), no la suma histórica de compras (`capital_inicial_total` / sum_compras).
     * Ganancia acciones = valor − invertido → solo no realizada en cartera abierta (como valor−invertido del chart).
     */
    const accionesInvUsd = holdings.reduce((s, h) => s + h.capital_invertido, 0);
    const accionesInvClp = accionesInvUsd * r;
    const accionesGainClp = accionesClp - accionesInvClp;
    const fondosInvClp = fintualGoals.reduce((s, g) => s + g.deposited_clp, 0);
    /** Misma regla que el total: ganancia = valor − depositado. `profit_clp` de la API puede desviarse por redondeo/fecha. */
    const fondosGainClp = fondosClp - fondosInvClp;
    /** Invertido agregado (AFP/manuales sin costo separado: usamos valor CLP como base). */
    const totalInvClp = accionesInvClp + fondosInvClp + afpClp + manualesClp;
    const totalGainClp = totalClp - totalInvClp;
    return {
      r,
      accionesClp,
      fondosClp,
      afpClp,
      manualesClp,
      totalClp,
      accionesGainClp,
      accionesInvClp,
      fondosGainClp,
      fondosInvClp,
      totalGainClp,
      totalInvClp,
    };
  }, [portfolio, holdings, fintualGoals]);

  const valorTotalPieSlices = useMemo(() => {
    if (!valorTotalClpBreakdown) return [];
    const { accionesClp, fondosClp, afpClp, manualesClp } = valorTotalClpBreakdown;
    return (
      [
        { key: "acciones" as const, name: "Acciones", value: accionesClp, fill: "#a855f7" },
        { key: "fondos" as const, name: "Fondos", value: fondosClp, fill: "#22c55e" },
        { key: "afp" as const, name: "AFP", value: afpClp, fill: "#f472b6" },
        { key: "manuales" as const, name: "Activos manuales", value: manualesClp, fill: "#a78bfa" },
      ] as const
    ).filter((x) => x.value > 0);
  }, [valorTotalClpBreakdown]);

  const donutData = useMemo(
    () => valorTotalPieSlices.filter((s) => !pieCategoryHidden[s.key]),
    [valorTotalPieSlices, pieCategoryHidden],
  );

  /** Suma CLP solo de categorías visibles en la torta (para % de participación). */
  const valorTotalPieActiveClp = useMemo(
    () => donutData.reduce((sum, s) => sum + s.value, 0),
    [donutData],
  );

  const valorTotalDisplay = useMemo(() => {
    if (!valorTotalClpBreakdown) return null;
    const b = valorTotalClpBreakdown;
    let total = 0;
    let inv = 0;
    for (const s of valorTotalPieSlices) {
      if (pieCategoryHidden[s.key]) continue;
      total += s.value;
      switch (s.key) {
        case "acciones":
          inv += b.accionesInvClp;
          break;
        case "fondos":
          inv += b.fondosInvClp;
          break;
        case "afp":
          inv += b.afpClp;
          break;
        case "manuales":
          inv += b.manualesClp;
          break;
        default:
          break;
      }
    }
    const gain = total - inv;
    const pct = inv > 0 ? (gain / inv) * 100 : 0;
    return { total, gain, inv, pct };
  }, [valorTotalClpBreakdown, valorTotalPieSlices, pieCategoryHidden]);

  const accionesScrollRef = useRef<HTMLDivElement>(null);
  const [accionesScrollHints, setAccionesScrollHints] = useState({ left: false, right: false });

  useEffect(() => {
    const el = accionesScrollRef.current;
    if (!el) return;
    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      const eps = 8;
      const overflow = scrollWidth > clientWidth + eps;
      setAccionesScrollHints({
        left: overflow && scrollLeft > eps,
        right: overflow && scrollLeft < scrollWidth - clientWidth - eps,
      });
    };
    update();
    const raf = requestAnimationFrame(update);
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", update);
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [holdingsSorted.length]);

  /**
   * Encabezado del gráfico: en CLP usamos el mismo desglose que «Valor Total» (precios/FX del snapshot
   * actual del dashboard). El último punto de la serie histórica puede diferir unos pesos por precios
   * al cierre del último día cacheado vs cotización actual.
   */
  const headline = useMemo(() => {
    if (!portfolio) return null;
    const rate = portfolio.exchange_rate_usd_clp;
    const toClp = (usd: number) => (rate != null && rate > 0 ? usd * rate : usd);

    const valorClp = (r: ChartRow) => r.total_valor_clp ?? toClp(r.total_valor);
    const invertidoClp = (r: ChartRow) => r.total_invertido_clp ?? toClp(r.total_invertido);

    if (chartCurrency === "CLP" && valorTotalClpBreakdown) {
      const total = valorTotalClpBreakdown.totalClp;
      const inv = valorTotalClpBreakdown.totalInvClp;
      const gain = total - inv;
      const pct = inv > 0 ? (gain / inv) * 100 : 0;
      return { total, inv, gain, pct };
    }

    if (chart.length >= 1 && lastChart) {
      if (chartCurrency === "USD") {
        const total = lastChart.total_valor;
        const inv = lastChart.total_invertido;
        const gain = total - inv;
        const pct = inv > 0 ? (gain / inv) * 100 : 0;
        return { total, inv, gain, pct };
      }
      const total = valorClp(lastChart);
      const inv = invertidoClp(lastChart);
      const gain = total - inv;
      const pct = inv > 0 ? (gain / inv) * 100 : 0;
      return { total, inv, gain, pct };
    }
    if (chartCurrency === "USD") {
      return {
        total: portfolio.total_value,
        inv: portfolio.total_invested,
        gain: portfolio.total_gain,
        pct: portfolio.total_gain_pct,
      };
    }
    return {
      total: toClp(portfolio.total_value),
      inv: toClp(portfolio.total_invested),
      gain: toClp(portfolio.total_gain),
      pct: portfolio.total_gain_pct,
    };
  }, [portfolio, chart, lastChart, chartCurrency, valorTotalClpBreakdown]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-6 p-4 pb-28 md:p-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
        {/* Main chart: altura del gráfico sigue a la columna Valor Total (lg: items-stretch + flex-1). */}
        <div
          className="flex min-h-0 flex-[1.7] flex-col rounded-xl border border-[#30363d] bg-[#161b22] p-5"
          style={{ borderRadius: 12 }}
        >
          <div className="mb-4 shrink-0 flex flex-col gap-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <h2 className="text-base font-bold uppercase tracking-[0.12em] text-white">
                Valor del portafolio
              </h2>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <div className="flex flex-wrap gap-0.5 rounded-lg bg-[#121417] p-1 ring-1 ring-inset ring-[#21262d]">
                  {(["CLP", "USD"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c === "CLP" ? "Ver montos en pesos chilenos (CLP)" : "Ver montos en dólares (USD)"}
                      onClick={() => onChartCurrency(c)}
                      className={`rounded-md px-3 py-1.5 text-xs transition ${
                        chartCurrency === c
                          ? "bg-[#3d444d] font-semibold text-white shadow-sm"
                          : "font-medium text-[#6b7280] hover:bg-[#1a1d23] hover:text-[#e6edf3]"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-0.5 rounded-lg bg-[#121417] p-1 ring-1 ring-inset ring-[#21262d]">
                  {periods.map((p) => (
                    <button
                      key={p}
                      type="button"
                      title={periodTooltip[p]}
                      onClick={() => onPeriod(p)}
                      className={`rounded-md px-3 py-1.5 text-xs transition ${
                        period === p
                          ? "bg-[#3d444d] font-semibold text-white shadow-sm"
                          : "font-medium text-[#6b7280] hover:bg-[#1a1d23] hover:text-[#e6edf3]"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {headline && (
              <div className="max-w-full">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="text-[1.65rem] font-bold leading-none tracking-tight text-white tabular-nums sm:text-[1.85rem]">
                    {chartCurrency === "CLP" ? formatClpDots(headline.total) : formatMoney(headline.total)}
                  </span>
                  <span
                    className={`text-base font-semibold tabular-nums sm:text-lg ${
                      headline.gain >= 0 ? "text-[#4ade80]" : "text-[#f87171]"
                    }`}
                    title="Resultado = valor − invertido; % sobre el invertido. En CLP coincide con Valor Total (mismo snapshot)."
                  >
                    {chartCurrency === "CLP" ? formatClpSigned(headline.gain) : formatUsdSignedGain(headline.gain)} (
                    {formatPct(headline.pct)})
                  </span>
                </div>
                <p className="mt-1.5 text-xs font-normal leading-snug text-[#8b949e]/80 sm:text-[13px]">
                  Invertido:{" "}
                  {chartCurrency === "CLP" ? formatClpDots(headline.inv) : formatMoney(headline.inv)}
                </p>
              </div>
            )}
          </div>

          <div className="flex min-h-[260px] flex-1 flex-col lg:min-h-0">
            <PortfolioChart
              chart={chart}
              period={period}
              currency={chartCurrency}
              loading={chartLoading}
              fillHeight
            />
          </div>
        </div>

        {/* Columna derecha: referencia de altura en lg (stretch); la torta/leyenda definen el alto mínimo. */}
        <div className="flex w-full flex-col lg:w-[22%] lg:min-w-0 lg:max-w-[260px] lg:flex-initial lg:shrink lg:self-stretch">
          <div
            className="flex h-full min-h-0 flex-col rounded-xl border border-[#30363d] bg-[#161b22] p-4"
            style={{ borderRadius: 12 }}
          >
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-white">Valor Total</h2>
            {portfolio && valorTotalDisplay && valorTotalClpBreakdown && (
              <>
                <p className="mt-1.5 text-xl font-bold tabular-nums text-white">
                  {formatClpDots(valorTotalDisplay.total)}
                </p>
                <p
                  className={`mt-0.5 text-sm font-semibold tabular-nums ${
                    valorTotalDisplay.gain >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
                  }`}
                >
                  {formatClpSigned(valorTotalDisplay.gain)} ({formatPct(valorTotalDisplay.pct)})
                </p>
                <p className="text-xs text-[#8b949e]">
                  Depositado: {formatClpDots(valorTotalDisplay.inv)}
                </p>
                <div className="mx-auto mt-3 h-[156px] w-[156px] max-w-full">
                  {donutData.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center rounded-full border border-dashed border-[#30363d] px-3 text-center">
                      <p className="text-[11px] leading-snug text-[#6e7681]">Ningún segmento visible</p>
                      <button
                        type="button"
                        onClick={clearPieCategoryHidden}
                        className="mt-2 text-xs font-medium text-[#2dd4bf] hover:underline"
                      >
                        Restablecer
                      </button>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData as { name: string; value: number; fill: string; key: ValorTotalPieKey }[]}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={46}
                          outerRadius={72}
                          paddingAngle={2}
                          cursor="pointer"
                          onClick={(d: unknown) => {
                            const o = d as { key?: ValorTotalPieKey; payload?: { key?: ValorTotalPieKey } };
                            const k = o?.key ?? o?.payload?.key;
                            if (k !== "acciones" && k !== "fondos" && k !== "afp" && k !== "manuales") return;
                            togglePieCategory(k);
                          }}
                        >
                          {donutData.map((entry, i) => (
                            <Cell key={`${entry.name}-${i}`} fill={entry.fill} stroke="#161b22" />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="mt-2 space-y-2.5 text-xs">
                  {valorTotalPieSlices.some((s) => s.key === "acciones") && (
                    <button
                      type="button"
                      aria-pressed={!pieCategoryHidden.acciones}
                      title={
                        pieCategoryHidden.acciones
                          ? "Clic para volver a mostrar en el gráfico"
                          : "Clic para ocultar del gráfico"
                      }
                      onClick={() => togglePieCategory("acciones")}
                      className={`w-full rounded-lg border px-2 py-2 text-left transition ${
                        pieCategoryHidden.acciones
                          ? "border-transparent opacity-[0.48]"
                          : "border-transparent hover:bg-[#21262d]/80"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full bg-[#a855f7] ${pieCategoryHidden.acciones ? "opacity-60" : ""}`}
                            aria-hidden
                          />
                          <span
                            className={`font-medium ${pieCategoryHidden.acciones ? "text-[#6e7681]" : "text-[#e6edf3]"}`}
                          >
                            Acciones
                          </span>
                        </div>
                        <span
                          className={`shrink-0 text-xs tabular-nums ${pieCategoryHidden.acciones ? "text-[#6e7681]" : "text-[#8b949e]"}`}
                        >
                          {pieCategoryHidden.acciones
                            ? "—"
                            : valorTotalPieActiveClp > 0
                              ? `${((valorTotalClpBreakdown.accionesClp / valorTotalPieActiveClp) * 100).toFixed(1)}%`
                              : "0%"}
                        </span>
                      </div>
                      <p
                        className={`mt-1 pl-3 text-[13px] tabular-nums ${pieCategoryHidden.acciones ? "text-[#6e7681]" : "text-white"}`}
                      >
                        {formatClpDots(valorTotalClpBreakdown.accionesClp)}
                      </p>
                      <p
                        className={`mt-0.5 pl-3 text-[11px] tabular-nums ${pieCategoryHidden.acciones ? "text-[#6e7681]" : "text-[#8b949e]"}`}
                      >
                        ~{formatMoneyUSDLabel(portfolio.acciones_value)}
                      </p>
                      <p
                        className={`mt-0.5 pl-3 text-[11px] font-medium tabular-nums ${
                          pieCategoryHidden.acciones
                            ? "text-[#6e7681]"
                            : valorTotalClpBreakdown.accionesGainClp >= 0
                              ? "text-[#22c55e]"
                              : "text-[#ef4444]"
                        }`}
                      >
                        {formatClpSigned(valorTotalClpBreakdown.accionesGainClp)} (
                        {formatPct(
                          valorTotalClpBreakdown.accionesInvClp > 0
                            ? (valorTotalClpBreakdown.accionesGainClp / valorTotalClpBreakdown.accionesInvClp) * 100
                            : 0,
                        )}
                        )
                      </p>
                    </button>
                  )}

                  {valorTotalPieSlices.some((s) => s.key === "fondos") && (
                    <button
                      type="button"
                      aria-pressed={!pieCategoryHidden.fondos}
                      title={
                        pieCategoryHidden.fondos
                          ? "Clic para volver a mostrar en el gráfico"
                          : "Clic para ocultar del gráfico"
                      }
                      onClick={() => togglePieCategory("fondos")}
                      className={`w-full rounded-lg border px-2 py-2 text-left transition ${
                        pieCategoryHidden.fondos
                          ? "border-transparent opacity-[0.48]"
                          : "border-transparent hover:bg-[#21262d]/80"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full bg-[#22c55e] ${pieCategoryHidden.fondos ? "opacity-60" : ""}`}
                            aria-hidden
                          />
                          <span
                            className={`font-medium ${pieCategoryHidden.fondos ? "text-[#6e7681]" : "text-[#e6edf3]"}`}
                          >
                            Fondos
                          </span>
                        </div>
                        <span
                          className={`shrink-0 text-xs tabular-nums ${pieCategoryHidden.fondos ? "text-[#6e7681]" : "text-[#8b949e]"}`}
                        >
                          {pieCategoryHidden.fondos
                            ? "—"
                            : valorTotalPieActiveClp > 0
                              ? `${((valorTotalClpBreakdown.fondosClp / valorTotalPieActiveClp) * 100).toFixed(1)}%`
                              : "0%"}
                        </span>
                      </div>
                      <p
                        className={`mt-1 pl-3 text-[13px] tabular-nums ${pieCategoryHidden.fondos ? "text-[#6e7681]" : "text-white"}`}
                      >
                        {formatClpDots(valorTotalClpBreakdown.fondosClp)}
                      </p>
                      <p
                        className={`mt-0.5 pl-3 text-[11px] font-medium tabular-nums ${
                          pieCategoryHidden.fondos
                            ? "text-[#6e7681]"
                            : valorTotalClpBreakdown.fondosGainClp >= 0
                              ? "text-[#22c55e]"
                              : "text-[#ef4444]"
                        }`}
                      >
                        {formatClpSigned(valorTotalClpBreakdown.fondosGainClp)} (
                        {formatPct(
                          valorTotalClpBreakdown.fondosInvClp > 0
                            ? (valorTotalClpBreakdown.fondosGainClp / valorTotalClpBreakdown.fondosInvClp) * 100
                            : 0,
                        )}
                        )
                      </p>
                    </button>
                  )}

                  {valorTotalPieSlices.some((s) => s.key === "afp") && (
                    <button
                      type="button"
                      aria-pressed={!pieCategoryHidden.afp}
                      title={
                        pieCategoryHidden.afp
                          ? "Clic para volver a mostrar en el gráfico"
                          : "Clic para ocultar del gráfico"
                      }
                      onClick={() => togglePieCategory("afp")}
                      className={`w-full rounded-lg border px-2 py-2 text-left transition ${
                        pieCategoryHidden.afp
                          ? "border-transparent opacity-[0.48]"
                          : "border-transparent hover:bg-[#21262d]/80"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full bg-[#f472b6] ${pieCategoryHidden.afp ? "opacity-60" : ""}`}
                            aria-hidden
                          />
                          <span
                            className={`font-medium ${pieCategoryHidden.afp ? "text-[#6e7681]" : "text-[#e6edf3]"}`}
                          >
                            AFP
                          </span>
                        </div>
                        <span
                          className={`shrink-0 text-xs tabular-nums ${pieCategoryHidden.afp ? "text-[#6e7681]" : "text-[#8b949e]"}`}
                        >
                          {pieCategoryHidden.afp
                            ? "—"
                            : valorTotalPieActiveClp > 0
                              ? `${((valorTotalClpBreakdown.afpClp / valorTotalPieActiveClp) * 100).toFixed(1)}%`
                              : "0%"}
                        </span>
                      </div>
                      <p
                        className={`mt-1 pl-3 text-[13px] tabular-nums ${pieCategoryHidden.afp ? "text-[#6e7681]" : "text-white"}`}
                      >
                        {formatClpDots(valorTotalClpBreakdown.afpClp)}
                      </p>
                    </button>
                  )}

                  {valorTotalPieSlices.some((s) => s.key === "manuales") && (
                    <button
                      type="button"
                      aria-pressed={!pieCategoryHidden.manuales}
                      title={
                        pieCategoryHidden.manuales
                          ? "Clic para volver a mostrar en el gráfico"
                          : "Clic para ocultar del gráfico"
                      }
                      onClick={() => togglePieCategory("manuales")}
                      className={`w-full rounded-lg border px-2 py-2 text-left transition ${
                        pieCategoryHidden.manuales
                          ? "border-transparent opacity-[0.48]"
                          : "border-transparent hover:bg-[#21262d]/80"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full bg-[#a78bfa] ${pieCategoryHidden.manuales ? "opacity-60" : ""}`}
                            aria-hidden
                          />
                          <span
                            className={`font-medium ${pieCategoryHidden.manuales ? "text-[#6e7681]" : "text-[#e6edf3]"}`}
                          >
                            Activos manuales
                          </span>
                        </div>
                        <span
                          className={`shrink-0 text-xs tabular-nums ${pieCategoryHidden.manuales ? "text-[#6e7681]" : "text-[#8b949e]"}`}
                        >
                          {pieCategoryHidden.manuales
                            ? "—"
                            : valorTotalPieActiveClp > 0
                              ? `${((valorTotalClpBreakdown.manualesClp / valorTotalPieActiveClp) * 100).toFixed(1)}%`
                              : "0%"}
                        </span>
                      </div>
                      <p
                        className={`mt-1 pl-3 text-[13px] tabular-nums ${pieCategoryHidden.manuales ? "text-[#6e7681]" : "text-white"}`}
                      >
                        {formatClpDots(valorTotalClpBreakdown.manualesClp)}
                      </p>
                    </button>
                  )}

                  {manualAssets.map((m) => (
                    <div key={m.id} className="border-t border-[#21262d] pt-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-medium text-[#e6edf3]">{m.nombre}</span>
                          <span className="ml-2 rounded bg-[#21262d] px-1.5 py-0.5 text-[10px] uppercase text-[#8b949e]">
                            Manual
                          </span>
                        </div>
                        <span className="text-[#8b949e]">
                          {portfolio.total_value > 0 && m.ultimo_valor != null
                            ? `${((m.ultimo_valor / portfolio.total_value) * 100).toFixed(1)}%`
                            : "—"}
                        </span>
                      </div>
                      <p className="text-white">
                        {m.ultimo_valor == null
                          ? "—"
                          : m.moneda === "CLP"
                            ? `${formatMoneyCLP(m.ultimo_valor)} (~${formatMoneyUSDLabel(m.ultimo_valor / (rate ?? 1))})`
                            : formatMoney(m.ultimo_valor)}
                      </p>
                      <p className="text-xs text-[#8b949e]">
                        Última actualización:{" "}
                        {m.ultima_fecha
                          ? new Date(m.ultima_fecha + "T12:00:00").toLocaleDateString("es")
                          : "—"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => onManualSnapshot(m)}
                          className="text-xs font-medium text-[#2dd4bf] hover:underline"
                        >
                          Actualizar valor
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteManual(m)}
                          className="text-xs font-medium text-[#f85149] hover:underline"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-bold uppercase tracking-[0.12em] text-white">
              Acciones ({holdingsSorted.length})
            </h2>
          </div>
          {portfolio != null && (
            <div className="shrink-0 text-right sm:pl-4">
              <span className="text-sm font-semibold tabular-nums tracking-tight text-white">
                {formatMoneyUSDLabel(portfolio.acciones_value)}
              </span>
              {rate != null && (
                <span className="text-sm tabular-nums text-[#8b949e]">
                  {" "}
                  ({formatClpDots(portfolio.acciones_value * rate)})
                </span>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch lg:gap-6">
          <div className="flex min-h-0 min-w-0 flex-col lg:h-full">
            <div className="relative flex min-h-0 flex-1 flex-col lg:min-h-[1px]">
              <div
                ref={accionesScrollRef}
                className="acciones-scroll-x-hidden -mx-1 flex min-h-0 flex-1 flex-col overflow-x-auto overflow-y-hidden px-1 pb-2 sm:mx-0 sm:px-0 lg:pb-0"
                role="region"
                aria-label="Lista de posiciones en acciones"
              >
                <div
                  className="grid h-full min-h-0 w-max min-w-full auto-cols-[min(100%,248px)] grid-flow-col grid-rows-2 gap-x-2.5 gap-y-2.5 pb-1 sm:auto-cols-[236px] sm:gap-3 lg:pb-0"
                >
                  {holdingsSorted.map((h) => (
                    <HoldingCard
                      key={h.ticker}
                      h={h}
                      compact
                      splitPair
                      onSelect={() => setStockMovementsHolding(h)}
                    />
                  ))}
                </div>
              </div>
              {accionesScrollHints.left && (
                <div className="pointer-events-none absolute bottom-0 left-0 top-0 z-10 flex w-11 items-center justify-start bg-gradient-to-r from-[#0d1117] from-40% via-[#0d1117]/70 to-transparent pl-0.5 sm:w-12">
                  <button
                    type="button"
                    onClick={() =>
                      accionesScrollRef.current?.scrollBy({
                        left: -Math.round(accionesScrollRef.current.clientWidth * 0.85),
                        behavior: "smooth",
                      })
                    }
                    aria-label="Ver acciones anteriores"
                    className="pointer-events-auto inline-flex rounded-full border border-[#30363d] bg-[#161b22]/90 p-1 text-[#8b949e] shadow-sm transition hover:border-[#6e7681] hover:text-white"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                </div>
              )}
              {accionesScrollHints.right && (
                <div className="pointer-events-none absolute bottom-0 right-0 top-0 z-10 flex w-11 items-center justify-end bg-gradient-to-l from-[#0d1117] from-40% via-[#0d1117]/70 to-transparent pr-0.5 sm:w-12">
                  <button
                    type="button"
                    onClick={() =>
                      accionesScrollRef.current?.scrollBy({
                        left: Math.round(accionesScrollRef.current.clientWidth * 0.85),
                        behavior: "smooth",
                      })
                    }
                    aria-label="Ver más acciones"
                    className="pointer-events-auto inline-flex rounded-full border border-[#30363d] bg-[#161b22]/90 p-1 text-[#8b949e] shadow-sm transition hover:border-[#6e7681] hover:text-white"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex min-h-0 w-full min-w-0 flex-col lg:h-full lg:w-auto lg:justify-self-start">
            <div
              className="flex h-full min-h-0 w-full max-w-full flex-col rounded-xl border border-[#30363d] bg-[#161b22] px-3 pb-3 pt-3 sm:px-4 sm:pb-3.5 sm:pt-3.5 lg:w-fit lg:max-w-[min(100%,34rem)]"
              style={{ borderRadius: 12 }}
            >
              <h3 className="mb-2 shrink-0 text-center text-[9px] font-bold uppercase tracking-[0.18em] text-white sm:text-[10px]">
                Distribución por sector
              </h3>

              {sectors.length === 0 ? (
                <p className="py-6 text-center text-xs text-[#8b949e]">Sin datos de sectores</p>
              ) : (
                <>
                  <div className="flex shrink-0 justify-center">
                    <div className="h-[168px] w-[168px] shrink-0 sm:h-[188px] sm:w-[188px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                          <Pie
                            data={sectors}
                            dataKey="value"
                            nameKey="sector"
                            cx="50%"
                            cy="50%"
                            innerRadius="70%"
                            outerRadius="92%"
                            paddingAngle={2}
                            isAnimationActive
                          >
                            {sectors.map((_, i) => (
                              <Cell
                                key={i}
                                fill={SECTOR_COLORS[i % SECTOR_COLORS.length]}
                                stroke="#0d1117"
                                strokeWidth={1.5}
                              />
                            ))}
                          </Pie>
                          <Tooltip
                            cursor={false}
                            wrapperStyle={{ outline: "none", zIndex: 20 }}
                            content={<SectorPieTooltip />}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="mt-3.5 flex w-full justify-center">
                    <div className="grid w-max max-w-full grid-cols-2 gap-x-3 sm:gap-x-5">
                    {sectorColumns.map((col, colIdx) => (
                      <ul key={colIdx} className="space-y-3 text-[11px] leading-snug">
                        {col.map((s, rowIdx) => {
                          const i = colIdx === 0 ? rowIdx : rowIdx + Math.ceil(sectors.length / 2);
                          const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
                          const detailLine = [
                            formatUsdDotsTwoDecimals(s.value),
                            s.tickers.length > 0 ? s.tickers.join(", ") : "",
                          ]
                            .filter(Boolean)
                            .join(" · ");
                          return (
                            <li key={s.sector} className="min-w-0">
                              <div className="flex gap-2">
                                <span
                                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: color }}
                                  aria-hidden
                                />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                                    <span className="font-semibold text-[#e6edf3]">{s.sector}</span>
                                    <span className="shrink-0 tabular-nums text-[11px] font-semibold" style={{ color }}>
                                      {s.pct.toFixed(1)}%
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[10px] leading-snug tracking-tight text-[#8b949e]">{detailLine}</p>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <ActiveInvestmentsSection goals={fintualGoalsActive} onSelectGoal={(g) => setGoalMovementsGoal(g)} />

      <ActivitySection
        dataVersion={dataVersion}
        onEdit={onEditTransaction}
        onToast={(msg) => onToast(msg)}
        onMutate={onMutate}
      />

      <InactiveInvestmentsSection goals={fintualGoalsInactive} onSelectGoal={(g) => setGoalMovementsGoal(g)} />

      <StockMovementsModal
        holding={stockMovementsHolding}
        onClose={() => setStockMovementsHolding(null)}
        dataVersion={dataVersion}
      />
      <GoalMovementsModal
        goal={goalMovementsGoal}
        onClose={() => setGoalMovementsGoal(null)}
        dataVersion={dataVersion}
      />
    </div>
  );
}

function SectorPieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: SectorSlice; color?: string }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const slice = item.payload as SectorSlice;
  const color = item.color ?? "#e6edf3";

  return (
    <div className="pointer-events-none max-w-[min(100vw-2rem,16rem)] rounded-xl border border-[#30363d] bg-[#0d1117] px-3 py-2.5 shadow-xl">
      <p className="text-[13px] font-bold leading-tight" style={{ color }}>
        {slice.sector} · {slice.pct.toFixed(1)}%
      </p>
      <p className="mt-1.5 text-[14px] font-semibold tabular-nums tracking-tight text-white">
        {formatUsdDotsTwoDecimals(slice.value)}
      </p>
      {slice.tickers.length > 0 && (
        <p className="mt-2.5 border-t border-[#21262d] pt-2.5 text-[11px] font-semibold leading-snug tracking-tight text-[#e6edf3]">
          {slice.tickers.join(", ")}
        </p>
      )}
    </div>
  );
}

function GainRow({
  compact,
  label,
  amount,
  pct,
  showPct,
  unavailable,
}: {
  compact?: boolean;
  label: string;
  amount: number;
  pct: number | null;
  showPct: boolean;
  unavailable: boolean;
}) {
  const pos = amount >= 0;
  const value = unavailable ? "—" : formatUsdSignedGain(amount);
  const colorClass = unavailable
    ? "text-[#8b949e]"
    : pos
      ? "text-[#22c55e]"
      : "text-[#ef4444]";
  return (
    <div className={`flex justify-between ${compact ? "gap-2" : "gap-3"}`}>
      <dt className={`shrink-0 text-[#8b949e] ${compact ? "text-[10px]" : ""}`}>{label}</dt>
      <dd
        className={`text-right font-medium tabular-nums ${compact ? "text-[10px] leading-tight" : ""} ${colorClass}`}
      >
        {value}
        {showPct && pct != null && !unavailable && (
          <span className="ml-1 font-normal text-[#8b949e]">({formatPct(pct)})</span>
        )}
      </dd>
    </div>
  );
}

function HoldingCard({
  h,
  compact,
  splitPair,
  onSelect,
}: {
  h: Holding;
  compact?: boolean;
  splitPair?: boolean;
  onSelect?: () => void;
}) {
  const gainPct = h.rentabilidad_total_pct ?? 0;
  const totalGain = h.ganancia_total;
  const gainPositive = totalGain >= 0;
  const c = compact === true;
  const split = c && splitPair === true;
  const logoSize = c ? "md" : "lg";
  const unrealUnavailable = h.price_unavailable === true;

  return (
    <div
      className={`rounded-xl border border-[#30363d] bg-[#161b22] shadow-sm ${c ? "rounded-lg p-3" : "p-5"} ${split ? "flex min-h-0 flex-1 flex-col" : ""} ${
        onSelect ? "cursor-pointer transition hover:border-[#484f58] hover:bg-[#1c2128]/90" : ""
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (!onSelect) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
    >
      <div className={`flex shrink-0 items-center ${c ? "gap-2" : "gap-3"}`}>
        <StockLogoImg symbol={h.ticker} size={logoSize} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="min-w-0">
              <p
                className={`font-bold leading-tight tracking-tight text-white ${c ? "text-[13px]" : "text-[15px]"}`}
              >
                {h.ticker}
              </p>
              <p
                className={`truncate leading-snug text-[#8b949e] ${c ? "mt-0.5 text-[10px]" : "mt-0.5 text-[11px]"}`}
              >
                {h.nombre || "—"}
              </p>
              {h.price_unavailable && (
                <p className={`font-medium text-[#fdba74] ${c ? "mt-0.5 text-[9px]" : "mt-1 text-[10px]"}`}>
                  Precio no disponible
                </p>
              )}
            </div>
            <span
              className={`shrink-0 rounded-full font-semibold tabular-nums ${
                c ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
              } ${gainPct >= 0 ? "bg-[#22c55e]/15 text-[#22c55e]" : "bg-[#ef4444]/15 text-[#ef4444]"}`}
            >
              {formatPct(gainPct)}
            </span>
          </div>
        </div>
      </div>

      <dl
        className={`leading-snug ${c ? "mt-2.5 space-y-1 text-[10px]" : "mt-5 space-y-2.5 text-[12px]"} ${split ? "min-h-0 flex-1" : ""}`}
      >
        <Row compact={c} label="Acciones" value={formatSharesCard(h.total_shares)} />
        <Row
          compact={c}
          label="Costo actual"
          value={h.price_unavailable ? "—" : `${formatMoney(h.current_price)} c/u`}
        />
        <Row compact={c} label="Costo prom." value={`${formatMoney(h.avg_buy_price)} c/u`} />
        <Row compact={c} label="Valor" value={formatMoney(h.current_value)} />
        <Row compact={c} label="Peso" value={`${h.peso_portafolio_pct.toFixed(1)}%`} />
        <GainRow
          compact={c}
          label={c ? "No realizada" : "Ganancia no realizada"}
          amount={h.ganancia_no_realizada}
          pct={h.rentabilidad_no_realizada_pct}
          showPct
          unavailable={unrealUnavailable}
        />
        <GainRow
          compact={c}
          label={c ? "Realizada" : "Ganancia realizada"}
          amount={h.ganancia_realizada}
          pct={null}
          showPct={false}
          unavailable={false}
        />
        {Math.abs(h.dividendos) > 1e-6 && (
          <GainRow
            compact={c}
            label="Dividendos"
            amount={h.dividendos}
            pct={null}
            showPct={false}
            unavailable={false}
          />
        )}
      </dl>

      <div
        className={`flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-t border-[#21262d] ${
          c ? "mt-2.5 pt-2" : "mt-5 gap-x-3 gap-y-1 pt-4"
        } ${split ? "mt-auto shrink-0" : ""}`}
      >
        <span
          className={`font-bold leading-none tracking-tight text-white tabular-nums ${c ? "text-[16px]" : "text-[22px]"}`}
        >
          {formatMoney(h.capital_invertido)}
        </span>
        <span
          className={`font-semibold tabular-nums ${c ? "text-xs" : "text-sm"} ${gainPositive ? "text-[#22c55e]" : "text-[#ef4444]"}`}
        >
          {gainPositive ? "+" : ""}
          {formatMoney(totalGain)}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`flex justify-between ${compact ? "gap-2" : "gap-3"}`}>
      <dt className={`shrink-0 text-[#8b949e] ${compact ? "text-[10px]" : ""}`}>{label}</dt>
      <dd
        className={`text-right font-medium tabular-nums text-white ${compact ? "text-[10px] leading-tight" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
