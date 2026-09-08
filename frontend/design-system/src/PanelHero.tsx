import { useMemo } from "react";
import {
  formatClpDots,
  formatClpSigned,
  formatMoney,
  formatPct,
  formatUsdSignedGain,
} from "./format";
import type { ChartCurrency, ChartRow, Period } from "./types";

interface Headline {
  total: number;
  inv: number;
  gain: number;
  pct: number;
}

interface Props {
  headline: Headline | null;
  chart: ChartRow[];
  chartCurrency: ChartCurrency;
  onChartCurrency: (c: ChartCurrency) => void;
  period: Period;
  onPeriod: (p: Period) => void;
  periods: Period[];
  periodTooltip: Record<Period, string>;
  isDark: boolean;
}

/** Serie simple de valor total (sin ejes/leyenda) para el sparkline del hero. */
function sparklinePoints(chart: ChartRow[], currency: ChartCurrency): string {
  if (chart.length === 0) return "";
  const values = chart.map((r) => (currency === "USD" ? r.total_valor : (r.total_valor_clp ?? r.total_valor)));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 1000;
  const h = 100;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = Math.round(i * step);
      const y = Math.round(h - ((v - min) / range) * (h - 10) - 5);
      return `${x},${y}`;
    })
    .join(" ");
}

export function PanelHero({
  headline,
  chart,
  chartCurrency,
  onChartCurrency,
  period,
  onPeriod,
  periods,
  periodTooltip,
  isDark,
}: Props) {
  const points = useMemo(() => sparklinePoints(chart, chartCurrency), [chart, chartCurrency]);
  const areaPath = points ? `M${points.split(" ")[0]} L${points} L1000,100 L0,100 Z` : "";

  const heroBg = isDark
    ? "linear-gradient(160deg,#12161d 0%,#151a22 55%,#171c24 100%)"
    : "linear-gradient(160deg,#FFFFFF 0%,#FBF7EE 60%,#F6F0E2 100%)";
  const cardBorder = isDark ? "border-[#1e242e]" : "border-[#E8E1D4]";
  const labelClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const valueClass = isDark ? "text-[#F3F1EC]" : "text-[#2B2620]";
  const gainClass = headline && headline.gain >= 0 ? (isDark ? "text-emerald-400" : "text-emerald-600") : isDark ? "text-rose-400" : "text-rose-600";
  const sparkStroke = isDark ? "#8FBFA6" : "#6FA588";
  const sparkFill = "#8FBFA6";

  const pillGroupBg = isDark ? "bg-[#161b22]" : "bg-[#F5F1E8]";
  const pillGroupBorder = isDark ? "border-[#30363d]" : "border-[#DCD3C2]";
  const pillIdle = isDark ? "text-[#8b949e] hover:bg-[#1c2129] hover:text-[#F3F1EC]" : "text-[#8A8072] hover:bg-[#ECE5D6] hover:text-[#2B2620]";
  const pillActive = "bg-[#8FBFA6] text-[#1F2E25] font-semibold";

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border ${cardBorder} p-6 pb-0 sm:p-7 sm:pb-0`}
      style={{ background: heroBg }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className={`text-[10px] font-bold uppercase tracking-[0.18em] ${labelClass}`}>
            Panel de inversiones
          </span>
          {headline && (
            <>
              <p className={`mt-1.5 text-[2rem] font-extrabold leading-none tracking-tight tabular-nums sm:text-[2.4rem] ${valueClass}`}>
                {chartCurrency === "CLP" ? formatClpDots(headline.total) : formatMoney(headline.total)}
              </p>
              <p className={`mt-1.5 text-sm font-semibold tabular-nums ${gainClass}`}>
                {chartCurrency === "CLP" ? formatClpSigned(headline.gain) : formatUsdSignedGain(headline.gain)} (
                {formatPct(headline.pct)})
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className={`flex gap-0.5 rounded-lg border ${pillGroupBorder} ${pillGroupBg} p-1`}>
            {(["CLP", "USD"] as const).map((c) => (
              <button
                key={c}
                type="button"
                title={c === "CLP" ? "Ver montos en pesos chilenos (CLP)" : "Ver montos en dólares (USD)"}
                onClick={() => onChartCurrency(c)}
                className={`rounded-md px-3 py-1.5 text-xs transition ${chartCurrency === c ? pillActive : pillIdle}`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className={`flex flex-wrap gap-0.5 rounded-lg border ${pillGroupBorder} ${pillGroupBg} p-1`}>
            {periods.map((p) => (
              <button
                key={p}
                type="button"
                title={periodTooltip[p]}
                onClick={() => onPeriod(p)}
                className={`rounded-md px-2.5 py-1.5 text-xs transition ${period === p ? pillActive : pillIdle}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 h-[70px] sm:h-[88px]">
        {points && (
          <svg viewBox="0 0 1000 100" className="h-full w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="panelHeroFade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={sparkFill} stopOpacity={isDark ? 0.32 : 0.28} />
                <stop offset="100%" stopColor={sparkFill} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#panelHeroFade)" />
            <polyline
              points={points}
              fill="none"
              stroke={sparkStroke}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
