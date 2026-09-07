import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { FundGoalCard } from "./FundGoalCard";
import { PortfolioChart } from "./PortfolioChart";
import {
  formatClpDots,
  formatClpSigned,
  formatMoney,
  formatMoneyCLP,
  formatMoneyUSDLabel,
  formatPct,
  formatSharesCard,
} from "./format";
import { StockLogoImg } from "./transactionUi";
import type { PanelTabId } from "./PanelTabs";
import type {
  ChartCurrency,
  ChartRow,
  FintualGoalCard,
  Holding,
  ManualAsset,
  Period,
  Portfolio,
} from "./types";

export type ValorTotalPieKey = "acciones" | "fondos" | "afp" | "manuales";

export interface ValorTotalBreakdown {
  r: number;
  accionesClp: number;
  fondosClp: number;
  afpClp: number;
  manualesClp: number;
  totalClp: number;
  accionesGainClp: number;
  accionesInvClp: number;
  fondosGainClp: number;
  fondosInvClp: number;
  totalGainClp: number;
  totalInvClp: number;
}

export interface ValorTotalPieSlice {
  key: ValorTotalPieKey;
  name: string;
  value: number;
  fill: string;
}

interface Props {
  chart: ChartRow[];
  period: Period;
  chartCurrency: ChartCurrency;
  chartLoading: boolean;
  valorTotalClpBreakdown: ValorTotalBreakdown | null;
  valorTotalPieSlices: ValorTotalPieSlice[];
  donutData: ValorTotalPieSlice[];
  pieCategoryHidden: Partial<Record<ValorTotalPieKey, boolean>>;
  togglePieCategory: (key: ValorTotalPieKey) => void;
  clearPieCategoryHidden: () => void;
  valorTotalPieActiveClp: number;
  valorTotalDisplay: { total: number; gain: number; inv: number; pct: number } | null;
  portfolio: Portfolio | null;
  manualAssets: ManualAsset[];
  onManualSnapshot: (a: ManualAsset) => void;
  onDeleteManual: (m: ManualAsset) => void;
  rate: number | null | undefined;
  holdingsSorted: Holding[];
  onSelectHolding: (h: Holding) => void;
  goalsActive: FintualGoalCard[];
  onSelectGoal: (g: FintualGoalCard) => void;
  onViewTab: (tab: PanelTabId) => void;
  isDark: boolean;
}

function MiniHoldingRow({ h, isDark }: { h: Holding; isDark: boolean }) {
  const gainPct = h.rentabilidad_total_pct ?? 0;
  const pos = gainPct >= 0;
  const rowBorder = isDark ? "border-[#21262d]" : "border-[#F0EAE0]";
  const titleClass = isDark ? "text-[#F3F1EC]" : "text-[#2B2620]";
  const mutedClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const gainClass = pos ? (isDark ? "text-emerald-400" : "text-emerald-600") : isDark ? "text-rose-400" : "text-rose-600";
  return (
    <div className={`flex items-center gap-2.5 border-b py-2.5 last:border-b-0 ${rowBorder}`}>
      <StockLogoImg symbol={h.ticker} size="md" isDark={isDark} />
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-bold ${titleClass}`}>{h.ticker}</p>
        <p className={`text-[11px] ${mutedClass}`}>{formatSharesCard(h.total_shares)} acciones</p>
      </div>
      <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${titleClass}`}>{formatMoney(h.current_value)}</span>
      <span className={`w-[52px] shrink-0 text-right text-xs font-semibold tabular-nums ${gainClass}`}>
        {formatPct(gainPct)}
      </span>
    </div>
  );
}

export function PanelResumenTab({
  chart,
  period,
  chartCurrency,
  chartLoading,
  valorTotalClpBreakdown,
  valorTotalPieSlices,
  donutData,
  pieCategoryHidden,
  togglePieCategory,
  clearPieCategoryHidden,
  valorTotalPieActiveClp,
  valorTotalDisplay,
  portfolio,
  manualAssets,
  onManualSnapshot,
  onDeleteManual,
  rate,
  holdingsSorted,
  onSelectHolding,
  goalsActive,
  onSelectGoal,
  onViewTab,
  isDark,
}: Props) {
  const cardBg = isDark ? "bg-[#161b22]" : "bg-white";
  const cardBorder = isDark ? "border-[#30363d]" : "border-[#E8E1D4]";
  const titleClass = isDark ? "text-white" : "text-[#2B2620]";
  const mutedClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const linkClass = isDark ? "text-[#8FBFA6] hover:underline" : "text-[#5C7F6C] hover:underline";
  const rowHover = isDark ? "hover:bg-[#21262d]/80" : "hover:bg-[#F5F1E8]";
  const dividerClass = isDark ? "border-[#21262d]" : "border-[#F0EAE0]";

  const { best, worst } = useMemo(() => {
    const sorted = [...holdingsSorted].sort(
      (a, b) => (b.rentabilidad_total_pct ?? 0) - (a.rentabilidad_total_pct ?? 0),
    );
    return {
      best: sorted.slice(0, 3),
      worst: [...sorted].reverse().slice(0, 3),
    };
  }, [holdingsSorted]);

  return (
    <div className="flex flex-col gap-6">
      {/* Origen de los fondos: invertido vs. actual */}
      <div className={`rounded-xl border ${cardBorder} ${cardBg} p-5`} style={{ borderRadius: 12 }}>
        <h2 className={`text-sm font-bold uppercase tracking-[0.12em] ${titleClass}`}>
          Origen de los fondos · invertido vs. actual
        </h2>
        <div className="mt-4 h-[280px]">
          <PortfolioChart chart={chart} period={period} currency={chartCurrency} loading={chartLoading} isDark={isDark} fillHeight />
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        {/* Asignación */}
        <div className={`flex flex-col rounded-xl border ${cardBorder} ${cardBg} p-4 lg:flex-[1]`} style={{ borderRadius: 12 }}>
          <h3 className={`text-xs font-bold uppercase tracking-[0.12em] ${titleClass}`}>Asignación</h3>
          {portfolio && valorTotalDisplay && valorTotalClpBreakdown && (
            <>
              <p className={`mt-1.5 text-lg font-bold tabular-nums ${titleClass}`}>{formatClpDots(valorTotalDisplay.total)}</p>
              <p className={`mt-0.5 text-xs font-semibold tabular-nums ${valorTotalDisplay.gain >= 0 ? (isDark ? "text-emerald-400" : "text-emerald-600") : isDark ? "text-rose-400" : "text-rose-600"}`}>
                {formatClpSigned(valorTotalDisplay.gain)} ({formatPct(valorTotalDisplay.pct)})
              </p>
              <div className="mx-auto mt-3 h-[132px] w-[132px] max-w-full">
                {donutData.length === 0 ? (
                  <div className={`flex h-full flex-col items-center justify-center rounded-full border border-dashed px-3 text-center ${isDark ? "border-[#30363d]" : "border-[#DCD3C2]"}`}>
                    <p className={`text-[11px] leading-snug ${mutedClass}`}>Ningún segmento visible</p>
                    <button type="button" onClick={clearPieCategoryHidden} className={`mt-2 text-xs font-medium ${linkClass}`}>
                      Restablecer
                    </button>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={38}
                        outerRadius={62}
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
                          <Cell key={`${entry.name}-${i}`} fill={entry.fill} stroke={isDark ? "#161b22" : "#FFFFFF"} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                {(["acciones", "fondos", "afp", "manuales"] as const).map((key) => {
                  if (!valorTotalPieSlices.some((s) => s.key === key)) return null;
                  const slice = valorTotalPieSlices.find((s) => s.key === key)!;
                  const hidden = !!pieCategoryHidden[key];
                  const label = { acciones: "Acciones", fondos: "Fondos", afp: "AFP", manuales: "Activos manuales" }[key];
                  const pctText = hidden
                    ? "—"
                    : valorTotalPieActiveClp > 0
                      ? `${((slice.value / valorTotalPieActiveClp) * 100).toFixed(1)}%`
                      : "0%";
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={!hidden}
                      onClick={() => togglePieCategory(key)}
                      className={`w-full rounded-lg border border-transparent px-2 py-1.5 text-left transition ${hidden ? "opacity-50" : rowHover}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: slice.fill }} />
                          <span className={hidden ? mutedClass : titleClass}>{label}</span>
                        </span>
                        <span className={mutedClass}>{pctText}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Mejores posiciones */}
        <div className={`flex flex-col rounded-xl border ${cardBorder} ${cardBg} p-4 lg:flex-[1.3]`} style={{ borderRadius: 12 }}>
          <div className="flex items-baseline justify-between">
            <h3 className={`text-xs font-bold uppercase tracking-[0.12em] ${titleClass}`}>Mejores posiciones</h3>
            <button type="button" onClick={() => onViewTab("acciones")} className={`text-xs font-semibold ${linkClass}`}>
              Ver todas →
            </button>
          </div>
          <div className="mt-2">
            {best.length === 0 ? (
              <p className={`py-4 text-center text-xs ${mutedClass}`}>Sin posiciones.</p>
            ) : (
              best.map((h) => (
                <button key={h.ticker} type="button" className="block w-full text-left" onClick={() => onSelectHolding(h)}>
                  <MiniHoldingRow h={h} isDark={isDark} />
                </button>
              ))
            )}
          </div>
        </div>

        {/* Peores posiciones */}
        <div className={`flex flex-col rounded-xl border ${cardBorder} ${cardBg} p-4 lg:flex-[1.3]`} style={{ borderRadius: 12 }}>
          <div className="flex items-baseline justify-between">
            <h3 className={`text-xs font-bold uppercase tracking-[0.12em] ${titleClass}`}>Peores posiciones</h3>
            <button type="button" onClick={() => onViewTab("acciones")} className={`text-xs font-semibold ${linkClass}`}>
              Ver todas →
            </button>
          </div>
          <div className="mt-2">
            {worst.length === 0 ? (
              <p className={`py-4 text-center text-xs ${mutedClass}`}>Sin posiciones.</p>
            ) : (
              worst.map((h) => (
                <button key={h.ticker} type="button" className="block w-full text-left" onClick={() => onSelectHolding(h)}>
                  <MiniHoldingRow h={h} isDark={isDark} />
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Metas activas (preview) */}
      {goalsActive.length > 0 && (
        <div className={`rounded-xl border ${cardBorder} ${cardBg} p-4`} style={{ borderRadius: 12 }}>
          <div className="flex items-baseline justify-between">
            <h3 className={`text-xs font-bold uppercase tracking-[0.12em] ${titleClass}`}>Metas activas</h3>
            <button type="button" onClick={() => onViewTab("fondos")} className={`text-xs font-semibold ${linkClass}`}>
              Ver todas ({goalsActive.length}) →
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {goalsActive.slice(0, 2).map((g) => (
              <FundGoalCard key={g.id} goal={g} onSelect={onSelectGoal} isDark={isDark} />
            ))}
          </div>
        </div>
      )}

      {/* Activos manuales */}
      {manualAssets.length > 0 && (
        <div className={`rounded-xl border ${cardBorder} ${cardBg} p-4`} style={{ borderRadius: 12 }}>
          <h3 className={`text-xs font-bold uppercase tracking-[0.12em] ${titleClass}`}>Activos manuales</h3>
          <div className="mt-3 space-y-2.5 text-xs">
            {manualAssets.map((m) => (
              <div key={m.id} className={`border-t pt-2.5 first:border-t-0 first:pt-0 ${dividerClass}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className={`font-medium ${titleClass}`}>{m.nombre}</span>
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] uppercase ${isDark ? "bg-[#21262d] text-[#8b949e]" : "bg-[#F5F1E8] text-[#8A8072]"}`}>
                      Manual
                    </span>
                  </div>
                  <span className={mutedClass}>
                    {portfolio && portfolio.total_value > 0 && m.ultimo_valor != null
                      ? `${((m.ultimo_valor / portfolio.total_value) * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                </div>
                <p className={titleClass}>
                  {m.ultimo_valor == null
                    ? "—"
                    : m.moneda === "CLP"
                      ? `${formatMoneyCLP(m.ultimo_valor)} (~${formatMoneyUSDLabel(m.ultimo_valor / (rate ?? 1))})`
                      : formatMoney(m.ultimo_valor)}
                </p>
                <p className={`text-xs ${mutedClass}`}>
                  Última actualización:{" "}
                  {m.ultima_fecha ? new Date(m.ultima_fecha + "T12:00:00").toLocaleDateString("es") : "—"}
                </p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <button type="button" onClick={() => onManualSnapshot(m)} className={`text-xs font-medium ${linkClass}`}>
                    Actualizar valor
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteManual(m)}
                    className={`text-xs font-medium ${isDark ? "text-rose-400 hover:underline" : "text-rose-600 hover:underline"}`}
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
