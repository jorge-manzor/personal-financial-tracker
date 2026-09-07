import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatUsdDotsTwoDecimals } from "./format";
import type { SectorSlice } from "./types";

/** Paleta vibrante tipo dashboard de sectores (anillo + % en leyenda) — igual en claro/oscuro (categórica). */
export const SECTOR_COLORS = [
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

function SectorPieTooltip({
  active,
  payload,
  isDark,
}: {
  active?: boolean;
  payload?: Array<{ payload: SectorSlice; color?: string }>;
  isDark: boolean;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const slice = item.payload as SectorSlice;
  const color = item.color ?? (isDark ? "#e6edf3" : "#2B2620");

  return (
    <div
      className={`pointer-events-none max-w-[min(100vw-2rem,16rem)] rounded-xl border px-3 py-2.5 shadow-xl ${
        isDark ? "border-[#30363d] bg-[#0d1117]" : "border-[#E8E1D4] bg-white"
      }`}
    >
      <p className="text-[13px] font-bold leading-tight" style={{ color }}>
        {slice.sector} · {slice.pct.toFixed(1)}%
      </p>
      <p className={`mt-1.5 text-[14px] font-semibold tabular-nums tracking-tight ${isDark ? "text-white" : "text-[#2B2620]"}`}>
        {formatUsdDotsTwoDecimals(slice.value)}
      </p>
      {slice.tickers.length > 0 && (
        <p
          className={`mt-2.5 border-t pt-2.5 text-[11px] font-semibold leading-snug tracking-tight ${
            isDark ? "border-[#21262d] text-[#e6edf3]" : "border-[#F0EAE0] text-[#2B2620]"
          }`}
        >
          {slice.tickers.join(", ")}
        </p>
      )}
    </div>
  );
}

export function PanelSectoresTab({ sectors, isDark }: { sectors: SectorSlice[]; isDark: boolean }) {
  const cardBg = isDark ? "bg-[#161b22]" : "bg-white";
  const cardBorder = isDark ? "border-[#30363d]" : "border-[#E8E1D4]";
  const titleClass = isDark ? "text-white" : "text-[#2B2620]";
  const mutedClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const strokeColor = isDark ? "#0d1117" : "#FFFFFF";

  return (
    <div className={`rounded-xl border ${cardBorder} ${cardBg} p-6`} style={{ borderRadius: 12 }}>
      <h2 className={`text-center text-sm font-bold uppercase tracking-[0.18em] ${titleClass}`}>
        Distribución por sector
      </h2>

      {sectors.length === 0 ? (
        <p className={`py-8 text-center text-sm ${mutedClass}`}>Sin datos de sectores</p>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-8 sm:flex-row sm:justify-center">
          <div className="h-[220px] w-[220px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Pie
                  data={sectors}
                  dataKey="value"
                  nameKey="sector"
                  cx="50%"
                  cy="50%"
                  innerRadius="66%"
                  outerRadius="92%"
                  paddingAngle={2}
                  isAnimationActive
                >
                  {sectors.map((_, i) => (
                    <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} stroke={strokeColor} strokeWidth={1.5} />
                  ))}
                </Pie>
                <Tooltip
                  cursor={false}
                  wrapperStyle={{ outline: "none", zIndex: 20 }}
                  content={<SectorPieTooltip isDark={isDark} />}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid w-full max-w-md grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {sectors.map((s, i) => {
              const color = SECTOR_COLORS[i % SECTOR_COLORS.length];
              const detailLine = [
                formatUsdDotsTwoDecimals(s.value),
                s.tickers.length > 0 ? s.tickers.join(", ") : "",
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <div key={s.sector} className="flex min-w-0 gap-2.5">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className={`font-semibold ${titleClass}`}>{s.sector}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color }}>
                        {s.pct.toFixed(1)}%
                      </span>
                    </div>
                    <p className={`mt-1 text-xs leading-snug tracking-tight ${mutedClass}`}>{detailLine}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
