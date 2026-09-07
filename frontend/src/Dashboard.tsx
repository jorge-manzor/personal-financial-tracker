import { useMemo, useState } from "react";
import { useBankingTheme } from "./BankingThemeContext";
import { GoalMovementsModal } from "./GoalMovementsModal";
import { PanelActividadTab } from "./PanelActividadTab";
import { PanelAccionesTab } from "./PanelAccionesTab";
import { PanelFondosTab } from "./PanelFondosTab";
import { PanelHero } from "./PanelHero";
import { PanelResumenTab, type ValorTotalBreakdown, type ValorTotalPieKey, type ValorTotalPieSlice } from "./PanelResumenTab";
import { PanelSectoresTab } from "./PanelSectoresTab";
import { PanelTabs, type PanelTabId } from "./PanelTabs";
import { StockMovementsModal } from "./StockMovementsModal";
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
  const { isDark } = useBankingTheme();
  const [activeTab, setActiveTab] = useState<PanelTabId>("resumen");

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

  /** NAV ~0 → inactivas; el resto en Inversiones activas. */
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
  /** Categorías excluidas del gráfico de torta (clic = toggle); no afecta al resto del panel. */
  const [pieCategoryHidden, setPieCategoryHidden] = useState<Partial<Record<ValorTotalPieKey, boolean>>>({});

  const togglePieCategory = (key: ValorTotalPieKey) => {
    setPieCategoryHidden((p) => ({ ...p, [key]: !p[key] }));
  };

  const clearPieCategoryHidden = () => setPieCategoryHidden({});

  const rate = portfolio?.exchange_rate_usd_clp;

  /** Desglose en CLP para torta y leyenda (misma base que la suma del portafolio). */
  const valorTotalClpBreakdown: ValorTotalBreakdown | null = useMemo(() => {
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

  const valorTotalPieSlices: ValorTotalPieSlice[] = useMemo(() => {
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

  /**
   * Encabezado del hero: en CLP usamos el mismo desglose que «Valor Total» (precios/FX del snapshot
   * actual del panel). El último punto de la serie histórica puede diferir unos pesos por precios
   * al cierre del último día cacheado vs cotización actual.
   */
  const headline = useMemo(() => {
    if (!portfolio) return null;
    const rate2 = portfolio.exchange_rate_usd_clp;
    const toClp = (usd: number) => (rate2 != null && rate2 > 0 ? usd * rate2 : usd);

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

  const pageShell = `banking-theme min-h-full w-full ${
    isDark
      ? "bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(143,191,166,0.06),transparent_52%),linear-gradient(to_bottom,#0d1117,#0a0d12)]"
      : "bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(199,154,86,0.09),transparent_52%),linear-gradient(to_bottom,#FAF7F1,#F5F1E8)]"
  }`;

  return (
    <div className={pageShell}>
      <div className="mx-auto max-w-[1200px] space-y-5 p-4 pb-28 md:p-6">
        <PanelHero
          headline={headline}
          chart={chart}
          chartCurrency={chartCurrency}
          onChartCurrency={onChartCurrency}
          period={period}
          onPeriod={onPeriod}
          periods={periods}
          periodTooltip={periodTooltip}
          isDark={isDark}
        />

        <PanelTabs
          activeTab={activeTab}
          onChange={setActiveTab}
          accionesCount={holdingsSorted.length}
          fondosCount={fintualGoalsActive.length}
          isDark={isDark}
        />

        {activeTab === "resumen" && (
          <PanelResumenTab
            chart={chart}
            period={period}
            chartCurrency={chartCurrency}
            chartLoading={chartLoading}
            valorTotalClpBreakdown={valorTotalClpBreakdown}
            valorTotalPieSlices={valorTotalPieSlices}
            donutData={donutData}
            pieCategoryHidden={pieCategoryHidden}
            togglePieCategory={togglePieCategory}
            clearPieCategoryHidden={clearPieCategoryHidden}
            valorTotalPieActiveClp={valorTotalPieActiveClp}
            valorTotalDisplay={valorTotalDisplay}
            portfolio={portfolio}
            manualAssets={manualAssets}
            onManualSnapshot={onManualSnapshot}
            onDeleteManual={onDeleteManual}
            rate={rate}
            holdingsSorted={holdingsSorted}
            onSelectHolding={(h) => setStockMovementsHolding(h)}
            goalsActive={fintualGoalsActive}
            onSelectGoal={(g) => setGoalMovementsGoal(g)}
            onViewTab={setActiveTab}
            isDark={isDark}
          />
        )}

        {activeTab === "acciones" && (
          <PanelAccionesTab
            holdingsSorted={holdingsSorted}
            portfolio={portfolio}
            rate={rate}
            onSelectHolding={(h) => setStockMovementsHolding(h)}
            isDark={isDark}
          />
        )}

        {activeTab === "fondos" && (
          <PanelFondosTab
            goalsActive={fintualGoalsActive}
            goalsInactive={fintualGoalsInactive}
            onSelectGoal={(g) => setGoalMovementsGoal(g)}
            isDark={isDark}
          />
        )}

        {activeTab === "sectores" && <PanelSectoresTab sectors={sectors} isDark={isDark} />}

        {activeTab === "actividad" && (
          <PanelActividadTab
            dataVersion={dataVersion}
            onEdit={onEditTransaction}
            onToast={onToast}
            onMutate={onMutate}
            isDark={isDark}
          />
        )}

        <StockMovementsModal
          holding={stockMovementsHolding}
          onClose={() => setStockMovementsHolding(null)}
          dataVersion={dataVersion}
          isDark={isDark}
        />
        <GoalMovementsModal
          goal={goalMovementsGoal}
          onClose={() => setGoalMovementsGoal(null)}
          dataVersion={dataVersion}
          isDark={isDark}
        />
      </div>
    </div>
  );
}
