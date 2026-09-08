import { useCallback, useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatAxisClp,
  formatAxisMoney,
  chartDateLabel,
  chartTooltipDateLabel,
  formatMonthlyTooltipValue,
  formatPct,
} from "./format";
import type { ChartCurrency, ChartRow, Period } from "./types";

/** Misma paleta que la torta «Valor Total» (Dashboard): Acciones #a855f7, Fondos #22c55e. */
const ACCIONES_LINE = "#a855f7";
/** Invertido acciones: violeta más oscuro (contraste con la línea sólida). */
const ACCIONES_INV_LINE = "#9333ea";

const FONDOS_LINE = "#22c55e";
/** Invertido fondos: verde claro de la misma familia que la torta (#22c55e). */
const FONDOS_INV_LINE = "#4ade80";
/** Total (Acciones + Fondos): ámbar como las líneas «Acciones» antes del violeta de la torta. */
const TOTAL_AF_LINE = "#fbbf24";
const TOTAL_AF_INV_LINE = "#f59e0b";

/** USD→CLP del día: usa `fx_usd_clp` del API si viene; si no, ratio de totales (más inestable). */
function rowClpPerUsd(r: ChartRow): number {
  const fx = r.fx_usd_clp;
  if (fx != null && fx > 0 && Number.isFinite(fx)) return fx;
  const tv = r.total_valor;
  const tclp = r.total_valor_clp;
  if (tv > 1e-12 && tclp != null && tclp > 0) return tclp / tv;
  return 1;
}

function rowValor(r: ChartRow, currency: ChartCurrency): number {
  if (currency === "USD") return r.total_valor;
  return r.total_valor_clp ?? 0;
}

function rowInvertido(r: ChartRow, currency: ChartCurrency): number {
  if (currency === "USD") return r.total_invertido;
  return r.total_invertido_clp ?? 0;
}

function rowFondosValor(r: ChartRow, currency: ChartCurrency): number {
  if (currency === "USD") return r.fondos_valor;
  return r.fondos_valor * rowClpPerUsd(r);
}

function rowFondosInvertido(r: ChartRow, currency: ChartCurrency): number {
  if (currency === "USD") return r.fondos_invertido;
  return r.fondos_invertido * rowClpPerUsd(r);
}

function rowAccionesValor(r: ChartRow, currency: ChartCurrency): number {
  if (currency === "USD") return r.acciones_valor;
  return r.acciones_valor * rowClpPerUsd(r);
}

function rowAccionesInvertido(r: ChartRow, currency: ChartCurrency): number {
  if (currency === "USD") return r.acciones_invertido;
  return r.acciones_invertido * rowClpPerUsd(r);
}

export function PortfolioChart({
  chart,
  period,
  currency,
  loading,
  /** Si true, el área del gráfico crece con el contenedor (p. ej. alineado a la tarjeta Valor Total). */
  fillHeight = false,
  isDark,
}: {
  chart: ChartRow[];
  period: Period;
  currency: ChartCurrency;
  loading?: boolean;
  fillHeight?: boolean;
  isDark: boolean;
}) {
  const gridStroke = isDark ? "#2d333b" : "#F0EAE0";
  const axisStroke = isDark ? "#30363d" : "#DCD3C2";
  const axisTickFill = isDark ? "#8b949e" : "#8A8072";
  const tooltipCardClass = isDark
    ? "border-[#30363d] bg-[#161b22]"
    : "border-[#E8E1D4] bg-white";
  const tooltipTitleClass = isDark ? "text-[#e6edf3]" : "text-[#2B2620]";
  const tooltipValueClass = isDark ? "text-white" : "text-[#2B2620]";
  const tooltipMutedClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const tooltipDividerClass = isDark ? "border-[#21262d]" : "border-[#F0EAE0]";
  const legendDividerClass = isDark ? "border-[#21262d]" : "border-[#F0EAE0]";
  const legendTextClass = isDark ? "text-[#e6edf3]" : "text-[#2B2620]";
  const legendMutedClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const emptyBorderClass = isDark ? "border-[#30363d]" : "border-[#DCD3C2]";
  const emptyTextClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const emptySubTextClass = isDark ? "text-[#6e7681]" : "text-[#9A9284]";
  const loadingBgClass = isDark ? "bg-[#21262d]/80" : "bg-[#F5F1E8]";
  const data = useMemo(
    () =>
      chart.map((r) => {
        const fv = rowFondosValor(r, currency);
        const fi = rowFondosInvertido(r, currency);
        const av = rowAccionesValor(r, currency);
        const ai = rowAccionesInvertido(r, currency);
        return {
          ...r,
          /** Solo acciones US — coincide con la leyenda «Acciones» / «Acciones Inv.». */
          _acciones_valor: av,
          _acciones_inv: ai,
          /** Portafolio completo (tooltip cabecera): acciones + fondos + AFP + manuales. */
          _ptf_valor: rowValor(r, currency),
          _ptf_inv: rowInvertido(r, currency),
          _fondos_valor: fv,
          _fondos_inv: fi,
          _total_af_valor: av + fv,
          _total_af_inv: ai + fi,
        };
      }),
    [chart, currency],
  );

  const tooltipContent = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: any) => {
      const { active, payload } = props;
      if (!active || !payload?.length) return null;
      const row = payload[0].payload as ChartRow & {
        _acciones_valor: number;
        _acciones_inv: number;
        _ptf_valor: number;
        _ptf_inv: number;
        _fondos_valor: number;
        _fondos_inv: number;
      };
      const dateStr = chartTooltipDateLabel(String(row.date), period);
      const ptfV = row._ptf_valor;
      const ptfInv = row._ptf_inv;
      const ptfGain = ptfV - ptfInv;
      const ptfPct = ptfInv > 0 ? ((ptfV - ptfInv) / ptfInv) * 100 : 0;
      const ptfPos = ptfGain >= 0;
      const cur = currency === "USD" ? "USD" : "CLP";
      const av = row._acciones_valor;
      const ai = row._acciones_inv;
      const fv = row._fondos_valor;
      const fi = row._fondos_inv;

      return (
        <div className={`max-w-xs rounded-lg border ${tooltipCardClass} px-3 py-2 text-xs shadow-xl`}>
          <p className={`mb-2 font-medium ${tooltipTitleClass}`}>{dateStr}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#fbbf24]">Valor total</p>
          <p className="mt-0.5 font-semibold text-[#fbbf24]">
            Valor: {formatMonthlyTooltipValue(ptfV, cur)}
          </p>
          <p className="mt-1 text-[#f59e0b]">Invertido: {formatMonthlyTooltipValue(ptfInv, cur)}</p>
          <p className={`mt-1 font-medium ${ptfPos ? (isDark ? "text-emerald-400" : "text-emerald-600") : isDark ? "text-rose-400" : "text-rose-600"}`}>
            Resultado: {ptfPos ? "+" : ""}
            {formatMonthlyTooltipValue(ptfGain, cur)} ({formatPct(ptfPct)})
          </p>
          <div className={`mt-2 border-t ${tooltipDividerClass} pt-2`}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#a855f7]">Acciones (US)</p>
            <p className={`mt-0.5 ${tooltipValueClass}`}>Valor: {formatMonthlyTooltipValue(av, cur)}</p>
            <p className={`mt-0.5 ${tooltipMutedClass}`}>Invertido: {formatMonthlyTooltipValue(ai, cur)}</p>
          </div>
          <div className={`mt-2 border-t ${tooltipDividerClass} pt-2`}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#4ade80]">Fondos</p>
            <p className={`mt-0.5 ${tooltipValueClass}`}>
              Valor: {formatMonthlyTooltipValue(fv, cur)}
            </p>
            <p className={`mt-0.5 ${tooltipMutedClass}`}>Invertido: {formatMonthlyTooltipValue(fi, cur)}</p>
          </div>
        </div>
      );
    },
    [period, currency, isDark, tooltipCardClass, tooltipTitleClass, tooltipValueClass, tooltipMutedClass, tooltipDividerClass],
  );

  const plotShell = fillHeight
    ? "flex min-h-[200px] flex-1 flex-col"
    : "h-[320px] w-full shrink-0";

  if (loading) {
    return (
      <div
        className={
          fillHeight
            ? `flex min-h-[200px] flex-1 animate-pulse rounded-lg ${loadingBgClass}`
            : `h-[320px] w-full shrink-0 animate-pulse rounded-lg ${loadingBgClass}`
        }
        aria-busy="true"
        aria-label="Cargando gráfico"
      />
    );
  }

  if (chart.length === 0) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed ${emptyBorderClass} px-4 text-center text-sm ${emptyTextClass} ${
          fillHeight ? "min-h-[200px] flex-1" : "min-h-[240px]"
        }`}
      >
        <p>No hay datos en este periodo.</p>
        <p className={`max-w-md text-xs ${emptySubTextClass}`}>
          Agrega movimientos o sincroniza precios para ver el historial del portafolio.
        </p>
      </div>
    );
  }

  const axisFmt = currency === "USD" ? formatAxisMoney : formatAxisClp;

  return (
    <div className={`flex min-h-0 flex-col ${fillHeight ? "h-full flex-1" : "space-y-4"}`}>
      <div className={`w-full ${plotShell}`}>
        <div className={fillHeight ? "h-full min-h-0 w-full flex-1" : "h-full w-full"}>
          <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id="valorAreaGlow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCIONES_LINE} stopOpacity={0.28} />
                <stop offset="40%" stopColor={ACCIONES_INV_LINE} stopOpacity={0.1} />
                <stop offset="100%" stopColor={ACCIONES_LINE} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={gridStroke} strokeDasharray="4 4" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: axisTickFill, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: axisStroke }}
              tickFormatter={(v) => chartDateLabel(String(v), period)}
              minTickGap={24}
            />
            <YAxis
              domain={[0, "auto"]}
              tick={{ fill: axisTickFill, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: axisStroke }}
              tickFormatter={(v) => axisFmt(Number(v))}
              width={64}
            />
            <Tooltip content={tooltipContent} />

            <Line
              type="monotone"
              dataKey="_acciones_inv"
              name="Acciones Inv."
              stroke={ACCIONES_INV_LINE}
              strokeOpacity={0.45}
              strokeWidth={1.35}
              strokeDasharray="6 5"
              dot={false}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="_acciones_valor"
              name="Acciones (relleno)"
              stroke="none"
              fill="url(#valorAreaGlow)"
              fillOpacity={1}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="_acciones_valor"
              name="Acciones"
              stroke={ACCIONES_LINE}
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="_fondos_inv"
              name="Fondos Inv."
              stroke={FONDOS_INV_LINE}
              strokeOpacity={0.75}
              strokeWidth={1.35}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="_fondos_valor"
              name="Fondos"
              stroke={FONDOS_LINE}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="_total_af_inv"
              name="Total Inv."
              stroke={TOTAL_AF_INV_LINE}
              strokeOpacity={0.85}
              strokeWidth={1.4}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="_total_af_valor"
              name="Total"
              stroke={TOTAL_AF_LINE}
              strokeWidth={2.35}
              strokeOpacity={0.98}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
        </div>
      </div>

      <div
        className={`flex shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t ${legendDividerClass} text-[11px] ${legendMutedClass} ${
          fillHeight ? "mt-3 pt-3" : "pt-4"
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-6 rounded-full bg-[#a855f7]" aria-hidden />
          <span className={legendTextClass}>Acciones</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block w-6 border-t-2 border-dashed border-[#9333ea]/85"
            style={{ opacity: 0.92 }}
            aria-hidden
          />
          <span className={legendTextClass}>Acciones Inv.</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-6 rounded-full bg-[#22c55e]" aria-hidden />
          <span className={legendTextClass}>Fondos</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block w-6 border-t-2 border-dashed border-[#4ade80]/90"
            style={{ opacity: 0.92 }}
            aria-hidden
          />
          <span className={legendTextClass}>Fondos Inv.</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-6 rounded-full bg-[#fbbf24]" aria-hidden />
          <span className={legendTextClass}>Total</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block w-6 border-t-2 border-dashed border-[#f59e0b]/85"
            style={{ opacity: 0.92 }}
            aria-hidden
          />
          <span className={legendTextClass}>Total Inv.</span>
        </span>
      </div>
    </div>
  );
}
