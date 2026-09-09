import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchJson } from "./api";
import { useBankingTheme } from "./BankingThemeContext";
import { cardClass } from "./bankingPersonalOrderShared";
import { formatClpDots, formatClpSigned } from "./format";
import type { BankingAnalyticsCategorySummary, BankingAnalyticsMonthlyTrend } from "./types";

const MESES_LARGO = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthKey(year: number, monthIndex0: number): string {
  return `${year}-${pad2(monthIndex0 + 1)}`;
}

function shiftMonth(year: number, monthIndex0: number, delta: number): [number, number] {
  const total = year * 12 + monthIndex0 + delta;
  return [Math.floor(total / 12), ((total % 12) + 12) % 12];
}

function formatPctEs(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(1).replace(".", ",")}%`;
}

type DistView = "dona" | "barras";
type EvoView = "barras" | "lineas";
type Rango = 6 | 12;

function pillClass(active: boolean): string {
  return active
    ? "rounded-md bg-[#8FBFA6] px-2.5 py-1 text-xs font-semibold text-[#14261e]"
    : "rounded-md px-2.5 py-1 text-xs font-semibold text-[#8A8072] hover:text-[#2B2620] banking-dark:text-[#8b949e] banking-dark:hover:text-[#F3F1EC]";
}

function ChartTooltip({ isDark }: { isDark: boolean }) {
  return {
    contentStyle: {
      backgroundColor: isDark ? "#12161d" : "#fff",
      border: isDark ? "1px solid #1e242e" : "1px solid #E8E1D4",
      borderRadius: "8px",
      fontSize: "12px",
      color: isDark ? "#F3F1EC" : "#2B2620",
    },
  };
}

function CategoryDonut({
  summary,
  isDark,
}: {
  summary: BankingAnalyticsCategorySummary;
  isDark: boolean;
}) {
  const data = summary.segments;
  const tooltipStyle = ChartTooltip({ isDark });
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-[190px] w-[190px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="monto"
              nameKey="nombre"
              innerRadius={62}
              outerRadius={90}
              paddingAngle={data.length > 1 ? 1.5 : 0}
              stroke="none"
            >
              {data.map((s) => (
                <Cell key={s.category_id} fill={s.color} />
              ))}
            </Pie>
            <Tooltip
              {...tooltipStyle}
              formatter={(value, _name, item) => [
                formatClpDots(Number(value)),
                (item?.payload as { nombre?: string } | undefined)?.nombre ?? "",
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <span className="text-[11px] text-[#8A8072] banking-dark:text-[#8b949e]">Total gastado</span>
          <span className="text-[17px] font-semibold tabular-nums text-[#2B2620] banking-dark:text-[#F3F1EC]">
            {formatClpDots(summary.total_egresos)}
          </span>
        </div>
      </div>
      <div className="flex min-w-[200px] flex-1 flex-col gap-2.5">
        {data.map((s) => (
          <div key={s.category_id} className="flex items-center gap-2.5 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-[#2B2620] banking-dark:text-[#F3F1EC]">{s.nombre}</span>
            <span className="tabular-nums text-[#8A8072] banking-dark:text-[#8b949e]">
              {s.pct.toFixed(1).replace(".", ",")}%
            </span>
            <span className="min-w-[78px] text-right font-semibold tabular-nums text-[#2B2620] banking-dark:text-[#F3F1EC]">
              {formatClpDots(s.monto)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryBars({ summary }: { summary: BankingAnalyticsCategorySummary }) {
  const max = summary.segments[0]?.monto || 1;
  return (
    <div className="flex flex-col gap-3.5 pt-0.5">
      {summary.segments.map((s) => (
        <div key={s.category_id} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2.5 text-sm text-[#2B2620] banking-dark:text-[#F3F1EC]">
            <span>{s.nombre}</span>
            <span className="font-semibold tabular-nums">
              {formatClpDots(s.monto)}
              <span className="font-normal text-[#8A8072] banking-dark:text-[#8b949e]">
                {" "}
                &middot; {s.pct.toFixed(1).replace(".", ",")}%
              </span>
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-[#F5F1E8] banking-dark:bg-[#12161d]">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, (s.monto / max) * 100).toFixed(1)}%`, background: s.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function TopCategoriesPanel({ summary }: { summary: BankingAnalyticsCategorySummary }) {
  const max = summary.top_categorias[0]?.monto || 1;
  return (
    <div className={cardClass}>
      <div>
        <h2 className="mb-1 text-base font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">Top 5 categorías</h2>
        <p className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">
          {summary.tiene_historial_previo
            ? "Variación vs. el mes anterior"
            : "Aún no hay suficiente historial para comparar con el mes anterior."}
        </p>
      </div>
      <div className="mt-3.5 flex flex-col">
        {summary.top_categorias.map((t) => (
          <div
            key={t.category_id}
            className="flex items-center gap-3 border-t border-[#F0EAE0] py-2.5 banking-dark:border-[#1a1f2e]"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[#F5F1E8] text-[11px] font-bold text-[#8A8072] banking-dark:bg-[#12161d] banking-dark:text-[#8b949e]">
              {t.rank}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-sm font-medium text-[#2B2620] banking-dark:text-[#F3F1EC]">
                {t.nombre}
              </span>
              <div className="h-[5px] overflow-hidden rounded-full bg-[#F5F1E8] banking-dark:bg-[#12161d]">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, (t.monto / max) * 100).toFixed(1)}%`, background: t.color }}
                />
              </div>
            </div>
            <span className="text-sm font-semibold tabular-nums text-[#2B2620] banking-dark:text-[#F3F1EC]">
              {formatClpDots(t.monto)}
            </span>
            {t.es_nueva ? (
              <span className="min-w-[68px] rounded-full bg-[#8A8072]/12 px-2.5 py-1 text-center text-xs font-semibold text-[#8A8072] banking-dark:bg-[#8b949e]/12 banking-dark:text-[#8b949e]">
                Nueva
              </span>
            ) : t.variacion_pct === null ? (
              <span className="min-w-[68px] rounded-full bg-[#8A8072]/12 px-2.5 py-1 text-center text-xs font-semibold text-[#8A8072] banking-dark:bg-[#8b949e]/12 banking-dark:text-[#8b949e]">
                &mdash;
              </span>
            ) : (
              <span
                className={
                  "min-w-[68px] rounded-full px-2.5 py-1 text-center text-xs font-semibold tabular-nums " +
                  (t.variacion_pct > 0
                    ? "bg-rose-50 text-rose-600 banking-dark:bg-rose-500/15 banking-dark:text-rose-300"
                    : t.variacion_pct < 0
                      ? "bg-emerald-50 text-emerald-600 banking-dark:bg-emerald-500/15 banking-dark:text-emerald-300"
                      : "bg-[#8A8072]/12 text-[#8A8072] banking-dark:bg-[#8b949e]/12 banking-dark:text-[#8b949e]")
                }
              >
                {t.variacion_pct === 0 ? "=" : (t.variacion_pct > 0 ? "▲ " : "▼ ") + formatPctEs(t.variacion_pct).replace(/^[+−]/, "")}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-2.5 border-t border-[#F0EAE0] pt-2.5 text-[11px] text-[#8A8072] banking-dark:border-[#1a1f2e] banking-dark:text-[#8b949e]">
        Verde = gastaste menos que el mes anterior. Rojo = gastaste más.
      </div>
    </div>
  );
}

function EvolutionBarsChart({
  trend,
  isDark,
}: {
  trend: BankingAnalyticsMonthlyTrend;
  isDark: boolean;
}) {
  const axisColor = isDark ? "#8b949e" : "#8A8072";
  const gridColor = isDark ? "#1e242e" : "#E8E1D4";
  const tooltipStyle = ChartTooltip({ isDark });
  return (
    <div className="h-[230px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={trend.meses} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={4}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
          <YAxis
            tick={{ fill: axisColor, fontSize: 10 }}
            tickFormatter={(v: number) => formatClpDots(Number(v)).replace("$", "")}
            width={64}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip {...tooltipStyle} formatter={(value) => formatClpDots(Number(value))} />
          <Bar dataKey="ingresos" name="Ingresos" fill="var(--zn-pos, #059669)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="egresos" name="Egresos" fill="var(--zn-neg, #e11d48)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EvolutionLinesChart({
  trend,
  isDark,
}: {
  trend: BankingAnalyticsMonthlyTrend;
  isDark: boolean;
}) {
  const axisColor = isDark ? "#8b949e" : "#8A8072";
  const gridColor = isDark ? "#1e242e" : "#E8E1D4";
  const tooltipStyle = ChartTooltip({ isDark });
  const pos = isDark ? "#34d399" : "#059669";
  const neg = isDark ? "#fb7185" : "#e11d48";
  return (
    <div className="h-[230px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={trend.meses} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: axisColor, fontSize: 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
          <YAxis
            tick={{ fill: axisColor, fontSize: 10 }}
            tickFormatter={(v: number) => formatClpDots(Number(v)).replace("$", "")}
            width={64}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip {...tooltipStyle} formatter={(value) => formatClpDots(Number(value))} />
          <Line type="monotone" dataKey="ingresos" name="Ingresos" stroke={pos} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="egresos" name="Egresos" stroke={neg} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BankingAnalyticsPage({ onToast }: { onToast: (msg: string | null) => void }) {
  const { isDark } = useBankingTheme();

  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getFullYear());
  const [monthIndex, setMonthIndex] = useState(today.getMonth());
  const [dist, setDist] = useState<DistView>("dona");
  const [rango, setRango] = useState<Rango>(6);
  const [evo, setEvo] = useState<EvoView>("barras");

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<BankingAnalyticsCategorySummary | null>(null);
  const [trend, setTrend] = useState<BankingAnalyticsMonthlyTrend | null>(null);

  const load = useCallback(async () => {
    const mk = monthKey(year, monthIndex);
    const [s, t] = await Promise.all([
      fetchJson<BankingAnalyticsCategorySummary>(`/banking/analytics/category-summary?month=${mk}`),
      fetchJson<BankingAnalyticsMonthlyTrend>(`/banking/analytics/monthly-trend?month=${mk}&meses=${rango}`),
    ]);
    setSummary(s);
    setTrend(t);
  }, [year, monthIndex, rango]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load()
      .catch((e) => {
        console.error(e);
        if (!cancelled) onToast("No se pudo cargar la Analítica de Banking.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, onToast]);

  const goToday = () => {
    setYear(today.getFullYear());
    setMonthIndex(today.getMonth());
  };
  const shift = (delta: number) => {
    const [y, m] = shiftMonth(year, monthIndex, delta);
    setYear(y);
    setMonthIndex(m);
  };

  const mesAnteriorLabel = MESES_LARGO[(monthIndex + 11) % 12];

  const pageShell =
    "banking-theme w-full min-h-[calc(100dvh-3.5rem)] bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(199,154,86,0.09),transparent_52%),linear-gradient(to_bottom,#FAF7F1,#F5F1E8)] text-[#4A453C] banking-dark:bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(143,191,166,0.06),transparent_52%),linear-gradient(to_bottom,#0d1117,#0a0d12)] banking-dark:text-[#c9d1d9]";
  const innerClass = "mx-auto max-w-[1120px] space-y-[18px] p-4 pb-28 md:p-6";

  if (loading || !summary || !trend) {
    return (
      <div className={pageShell}>
        <div className={innerClass}>
          <p className="text-sm text-[#8A8072] banking-dark:text-[#8b949e]">Cargando…</p>
        </div>
      </div>
    );
  }

  const balanceIsPositive = summary.balance_neto >= 0;
  const lastDayOfSelectedMonth = new Date(year, monthIndex + 1, 0).getDate();
  let balanceNota: string;
  if (summary.total_ingresos > 0) {
    const pctIngreso = Math.abs((summary.balance_neto / summary.total_ingresos) * 100).toFixed(0);
    balanceNota =
      `Al ${lastDayOfSelectedMonth} de ${MESES_LARGO[monthIndex].toLowerCase()} · ` +
      `${balanceIsPositive ? "ahorro" : "déficit"} del ${pctIngreso}% del ingreso`;
  } else if (summary.total_egresos > 0) {
    balanceNota = "Déficit del mes — aún sin ingresos registrados";
  } else {
    balanceNota = "Aún sin movimientos suficientes";
  }

  return (
    <div className={pageShell}>
      <div className={innerClass}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[28px] font-semibold tracking-tight text-[#2B2620] banking-dark:text-[#F3F1EC]">
              Vista general
            </h1>
            <p className="text-sm text-[#8A8072] banking-dark:text-[#8b949e]">
              Cómo se movieron tus ingresos y gastos este mes.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-[#DCD3C2] bg-white p-[5px] banking-dark:border-[#30363d] banking-dark:bg-[#161b22]">
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="Mes anterior"
              className="grid h-8 w-8 place-items-center rounded-lg text-[#8A8072] hover:bg-[#F5F1E8] hover:text-[#2B2620] banking-dark:text-[#8b949e] banking-dark:hover:bg-[#1c222b] banking-dark:hover:text-[#F3F1EC]"
            >
              &lsaquo;
            </button>
            <div className="flex min-w-[170px] items-center justify-center gap-1.5">
              <span className="text-sm font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                {MESES_LARGO[monthIndex]}
              </span>
              <span className="text-sm text-[#8A8072] banking-dark:text-[#8b949e]">{year}</span>
            </div>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="Mes siguiente"
              className="grid h-8 w-8 place-items-center rounded-lg text-[#8A8072] hover:bg-[#F5F1E8] hover:text-[#2B2620] banking-dark:text-[#8b949e] banking-dark:hover:bg-[#1c222b] banking-dark:hover:text-[#F3F1EC]"
            >
              &rsaquo;
            </button>
            <div className="h-5 w-px bg-[#DCD3C2] banking-dark:bg-[#30363d]" />
            <button
              type="button"
              onClick={goToday}
              className="px-2.5 text-[13px] font-semibold text-[#8FBFA6] hover:text-[#7FB097]"
            >
              Hoy
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          <div className={cardClass + " flex flex-col gap-2"}>
            <div className="flex items-center gap-2 text-[13px] text-[#8A8072] banking-dark:text-[#8b949e]">
              <span className="h-2 w-2 rounded-full bg-emerald-600 banking-dark:bg-emerald-400" />
              Ingresos del mes
            </div>
            <div className="text-[26px] font-semibold tracking-tight tabular-nums text-[#2B2620] banking-dark:text-[#F3F1EC]">
              {formatClpDots(summary.total_ingresos)}
            </div>
            <div className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">
              {summary.ingresos_var_pct === null
                ? "Sin datos del mes anterior"
                : `${formatPctEs(summary.ingresos_var_pct)} vs. mes anterior`}
            </div>
          </div>
          <div className={cardClass + " flex flex-col gap-2"}>
            <div className="flex items-center gap-2 text-[13px] text-[#8A8072] banking-dark:text-[#8b949e]">
              <span className="h-2 w-2 rounded-full bg-rose-600 banking-dark:bg-rose-400" />
              Egresos del mes
            </div>
            <div className="text-[26px] font-semibold tracking-tight tabular-nums text-[#2B2620] banking-dark:text-[#F3F1EC]">
              {formatClpDots(summary.total_egresos)}
            </div>
            <div className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">
              {summary.egresos_var_pct === null
                ? "Sin datos del mes anterior"
                : `${formatPctEs(summary.egresos_var_pct)} vs. mes anterior`}
            </div>
          </div>
          <div className="relative overflow-hidden rounded-2xl border border-[#8FBFA6] bg-white p-[18px_20px] shadow-[0_1px_0_rgba(143,191,166,0.25)] banking-dark:bg-[#12161d]">
            <div className="pointer-events-none absolute inset-0 bg-[rgba(143,191,166,0.14)] banking-dark:bg-[rgba(143,191,166,0.18)]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#8FBFA6] to-[#C79A56]" />
            <div className="relative flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-[#8A8072] banking-dark:text-[#8b949e]">Balance neto acumulado</span>
                <span className="rounded-full border border-[#C79A56] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#C79A56]">
                  Mes en curso
                </span>
              </div>
              <div
                className={
                  "text-[30px] font-bold tracking-tight tabular-nums " +
                  (balanceIsPositive
                    ? "text-emerald-600 banking-dark:text-emerald-400"
                    : "text-rose-600 banking-dark:text-rose-400")
                }
              >
                {formatClpSigned(summary.balance_neto)}
              </div>
              <div className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">{balanceNota}</div>
            </div>
          </div>
        </div>

        {summary.empty ? (
          <div className="flex flex-col items-center gap-3.5 rounded-2xl border border-dashed border-[#DCD3C2] bg-white p-[56px_28px] text-center banking-dark:border-[#30363d] banking-dark:bg-[#161b22]">
            <div className="grid h-[88px] w-[88px] place-items-center rounded-full bg-[rgba(143,191,166,0.14)] banking-dark:bg-[rgba(143,191,166,0.18)]">
              <div className="h-11 w-11 rounded-full border-[3px] border-[#8FBFA6] border-r-[#C79A56] border-b-transparent" />
            </div>
            <h2 className="text-[19px] font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
              Aún no hay suficientes movimientos
            </h2>
            <p className="max-w-[440px] text-sm leading-relaxed text-[#8A8072] banking-dark:text-[#8b949e]">
              Necesitamos al menos un mes con movimientos categorizados para calcular tu distribución de gasto y las
              comparaciones mes a mes.
            </p>
            <Link
              to="/banking/transactions"
              className="mt-1 inline-block rounded-[10px] bg-[#8FBFA6] px-5 py-[11px] text-sm font-semibold text-[#14261e] hover:bg-[#7FB097]"
            >
              Ir a Movimientos
            </Link>
          </div>
        ) : (
          <>
            <div className="grid items-stretch gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
              <div className={cardClass + " flex flex-col gap-4"}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="mb-1 text-base font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                      Gasto por categoría
                    </h2>
                    <p className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">
                      {MESES_LARGO[monthIndex]} {year} &middot; {formatClpDots(summary.total_egresos)} en total
                    </p>
                  </div>
                  <div className="flex gap-0.5 rounded-[9px] border border-[#DCD3C2] bg-[#F5F1E8] p-[3px] banking-dark:border-[#30363d] banking-dark:bg-[#12161d]">
                    <button type="button" onClick={() => setDist("dona")} className={pillClass(dist === "dona")}>
                      Dona
                    </button>
                    <button type="button" onClick={() => setDist("barras")} className={pillClass(dist === "barras")}>
                      Barras
                    </button>
                  </div>
                </div>
                {summary.segments.length === 0 ? (
                  <p className="text-sm text-[#8A8072] banking-dark:text-[#8b949e]">
                    Sin gastos categorizados este mes.
                  </p>
                ) : dist === "dona" ? (
                  <CategoryDonut summary={summary} isDark={isDark} />
                ) : (
                  <CategoryBars summary={summary} />
                )}
              </div>

              {summary.top_categorias.length > 0 ? (
                <TopCategoriesPanel summary={summary} />
              ) : (
                <div className={cardClass}>
                  <h2 className="mb-1 text-base font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                    Top 5 categorías
                  </h2>
                  <p className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">
                    Variación vs. {mesAnteriorLabel}
                  </p>
                  <p className="mt-3.5 text-sm text-[#8A8072] banking-dark:text-[#8b949e]">
                    Sin gastos categorizados este mes.
                  </p>
                </div>
              )}
            </div>

            <div className={cardClass + " flex flex-col gap-4"}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="mb-1 text-base font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                    Ingresos vs. egresos
                  </h2>
                  <p className="text-xs text-[#8A8072] banking-dark:text-[#8b949e]">
                    Últimos {trend.meses.length} meses &middot; pesos chilenos
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3.5">
                  <div className="flex items-center gap-3.5 text-xs text-[#8A8072] banking-dark:text-[#8b949e]">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600 banking-dark:bg-emerald-400" />
                      Ingresos
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-rose-600 banking-dark:bg-rose-400" />
                      Egresos
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 rounded-[9px] border border-[#DCD3C2] bg-[#F5F1E8] p-[3px] banking-dark:border-[#30363d] banking-dark:bg-[#12161d]">
                    <button type="button" onClick={() => setRango(6)} className={pillClass(rango === 6)}>
                      6M
                    </button>
                    <button type="button" onClick={() => setRango(12)} className={pillClass(rango === 12)}>
                      12M
                    </button>
                    <div className="mx-[3px] h-[18px] w-px self-center bg-[#DCD3C2] banking-dark:bg-[#30363d]" />
                    <button type="button" onClick={() => setEvo("barras")} className={pillClass(evo === "barras")}>
                      Barras
                    </button>
                    <button type="button" onClick={() => setEvo("lineas")} className={pillClass(evo === "lineas")}>
                      Líneas
                    </button>
                  </div>
                </div>
              </div>

              {trend.empty || trend.meses.length === 0 ? (
                <p className="text-sm text-[#8A8072] banking-dark:text-[#8b949e]">
                  Aún no hay historial suficiente para graficar la evolución mensual.
                </p>
              ) : evo === "barras" ? (
                <EvolutionBarsChart trend={trend} isDark={isDark} />
              ) : (
                <EvolutionLinesChart trend={trend} isDark={isDark} />
              )}

              <div className="flex flex-wrap gap-[22px] border-t border-[#F0EAE0] pt-3.5 banking-dark:border-[#1a1f2e]">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-[#8A8072] banking-dark:text-[#8b949e]">Ingreso promedio</span>
                  <span className="text-[15px] font-semibold tabular-nums text-[#2B2620] banking-dark:text-[#F3F1EC]">
                    {formatClpDots(trend.ingreso_promedio)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-[#8A8072] banking-dark:text-[#8b949e]">Egreso promedio</span>
                  <span className="text-[15px] font-semibold tabular-nums text-[#2B2620] banking-dark:text-[#F3F1EC]">
                    {formatClpDots(trend.egreso_promedio)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-[#8A8072] banking-dark:text-[#8b949e]">Ahorro promedio</span>
                  <span className="text-[15px] font-semibold tabular-nums text-emerald-600 banking-dark:text-emerald-400">
                    {formatClpDots(trend.ahorro_promedio)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] text-[#8A8072] banking-dark:text-[#8b949e]">Mejor mes</span>
                  <span className="text-[15px] font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                    {trend.mejor_mes ?? "—"}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        <p className="mt-0.5 text-[11px] text-[#8A8072] banking-dark:text-[#8b949e]">
          Los montos consideran solo cuentas incluidas en el saldo. Excluye traspasos entre cuentas propias y pagos de
          tarjeta de crédito.
        </p>
      </div>
    </div>
  );
}
