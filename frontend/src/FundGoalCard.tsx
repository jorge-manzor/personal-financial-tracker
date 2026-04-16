import type { FintualGoalCard } from "./types";
import { formatClpDots, formatPct } from "./format";

interface Props {
  goal: FintualGoalCard;
  onSelect: (g: FintualGoalCard) => void;
  /** Metas con saldo $0 — estilo algo más apagado */
  inactive?: boolean;
}

export function FundGoalCard({ goal: g, onSelect, inactive }: Props) {
  return (
    <button
      type="button"
      onClick={() => onSelect(g)}
      className={`group flex min-h-0 w-full min-w-0 flex-col rounded-xl border bg-gradient-to-br from-[#231d35] via-[#1a1628] to-[#161b22] p-4 text-left shadow-md transition hover:border-[#4c3d6a] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1117] ${
        inactive ? "border-[#30363d]/70 opacity-[0.92]" : "border-[#2d2640]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2d1f4a] ring-1 ring-[#4c3d6a]"
          aria-hidden
        >
          <svg className="h-5 w-5 text-[#f472b6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 16l4-4 4 4 6-6" />
          </svg>
        </div>
        <span className="max-w-[58%] truncate rounded-full bg-[#2d2640] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#e9d5ff]">
          {g.badge_label}
        </span>
      </div>

      <p className="mt-3 line-clamp-2 min-h-[2.5rem] text-[15px] font-bold leading-snug text-white">{g.name}</p>
      <p
        className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-white"
        title="Valor de cuotas al último punto del gráfico de balance (alineado con fintual.cl)."
      >
        {formatClpDots(g.nav_clp)}
      </p>

      <div className="mt-4 border-t border-[#30363d] pt-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p
              className="text-[11px] text-[#8b949e]"
              title="Costo de cuotas del saldo actual (capital neto tras depósitos y retiros), misma base que usa Fintual para la rentabilidad."
            >
              Depositado
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-[#e6edf3]">{formatClpDots(g.deposited_clp)}</p>
          </div>
          <div className="text-right">
            <p
              className="text-[11px] text-[#8b949e]"
              title="Valor de cuotas − costo de cuotas en el último punto del gráfico (rentabilidad sobre el capital que sigue invertido)."
            >
              Ganancia
            </p>
            <p
              className={`mt-0.5 text-sm font-semibold tabular-nums ${
                g.profit_clp >= 0 ? "text-[#22c55e]" : "text-[#f87171]"
              }`}
            >
              {g.profit_clp >= 0 ? "+" : ""}
              {formatClpDots(g.profit_clp)} ({formatPct(g.profit_pct)})
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}
