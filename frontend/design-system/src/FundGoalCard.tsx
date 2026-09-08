import type { FintualGoalCard } from "./types";
import { formatClpDots, formatPct } from "./format";

interface Props {
  goal: FintualGoalCard;
  onSelect: (g: FintualGoalCard) => void;
  /** Metas con saldo $0 — estilo algo más apagado */
  inactive?: boolean;
  isDark: boolean;
}

export function FundGoalCard({ goal: g, onSelect, inactive, isDark }: Props) {
  const cardBg = isDark
    ? "bg-gradient-to-br from-[#231d35] via-[#1a1628] to-[#161b22]"
    : "bg-gradient-to-br from-white via-[#FBF6EE] to-[#F5EFE0]";
  const cardBorder = isDark
    ? inactive
      ? "border-[#30363d]/70 opacity-[0.92]"
      : "border-[#2d2640]"
    : inactive
      ? "border-[#E8E1D4]/80 opacity-[0.92]"
      : "border-[#E8E1D4]";
  const iconBg = isDark ? "bg-[#2d1f4a] ring-1 ring-[#4c3d6a]" : "bg-[#F0E9FB] ring-1 ring-[#D9C7F0]";
  const iconColor = isDark ? "text-[#f472b6]" : "text-[#a5497d]";
  const badgeClass = isDark
    ? "bg-[#2d2640] text-[#e9d5ff]"
    : "bg-[#F0E9FB] text-[#6b3f94]";
  const textPrimary = isDark ? "text-white" : "text-[#2B2620]";
  const divider = isDark ? "border-[#30363d]" : "border-[#E8E1D4]";
  const textMuted = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const valueClass = isDark ? "text-[#e6edf3]" : "text-[#2B2620]";
  const gainClass = g.profit_clp >= 0 ? (isDark ? "text-emerald-400" : "text-emerald-600") : isDark ? "text-rose-400" : "text-rose-600";

  return (
    <button
      type="button"
      onClick={() => onSelect(g)}
      className={`group flex min-h-0 w-full min-w-0 flex-col rounded-xl border p-4 text-left shadow-md transition hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa] focus-visible:ring-offset-2 ${cardBg} ${cardBorder} ${
        isDark
          ? "hover:border-[#4c3d6a] focus-visible:ring-offset-[#0d1117]"
          : "hover:border-[#c9a8e6] focus-visible:ring-offset-[#FAF7F1]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg}`} aria-hidden>
          <svg className={`h-5 w-5 ${iconColor}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 16l4-4 4 4 6-6" />
          </svg>
        </div>
        <span className={`max-w-[58%] truncate rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${badgeClass}`}>
          {g.badge_label}
        </span>
      </div>

      <p className={`mt-3 line-clamp-2 min-h-[2.5rem] text-[15px] font-bold leading-snug ${textPrimary}`}>{g.name}</p>
      <p
        className={`mt-2 text-2xl font-bold tabular-nums tracking-tight ${textPrimary}`}
        title="Valor de cuotas al último punto del gráfico de balance (alineado con fintual.cl)."
      >
        {formatClpDots(g.nav_clp)}
      </p>

      <div className={`mt-4 border-t ${divider} pt-3`}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p
              className={`text-[11px] ${textMuted}`}
              title="Costo de cuotas del saldo actual (capital neto tras depósitos y retiros), misma base que usa Fintual para la rentabilidad."
            >
              Depositado
            </p>
            <p className={`mt-0.5 text-sm font-semibold tabular-nums ${valueClass}`}>{formatClpDots(g.deposited_clp)}</p>
          </div>
          <div className="text-right">
            <p
              className={`text-[11px] ${textMuted}`}
              title="Valor de cuotas − costo de cuotas en el último punto del gráfico (rentabilidad sobre el capital que sigue invertido)."
            >
              Ganancia
            </p>
            <p className={`mt-0.5 text-sm font-semibold tabular-nums ${gainClass}`}>
              {g.profit_clp >= 0 ? "+" : ""}
              {formatClpDots(g.profit_clp)} ({formatPct(g.profit_pct)})
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}
