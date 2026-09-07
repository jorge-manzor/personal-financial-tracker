import { HoldingCard } from "./HoldingCard";
import { formatClpDots, formatMoneyUSDLabel } from "./format";
import type { Holding, Portfolio } from "./types";

interface Props {
  holdingsSorted: Holding[];
  portfolio: Portfolio | null;
  rate: number | null | undefined;
  onSelectHolding: (h: Holding) => void;
  isDark: boolean;
}

export function PanelAccionesTab({ holdingsSorted, portfolio, rate, onSelectHolding, isDark }: Props) {
  const titleClass = isDark ? "text-white" : "text-[#2B2620]";
  const mutedClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 className={`text-base font-bold uppercase tracking-[0.12em] ${titleClass}`}>
          Acciones ({holdingsSorted.length})
        </h2>
        {portfolio != null && (
          <div className="shrink-0 text-right sm:pl-4">
            <span className={`text-sm font-semibold tabular-nums tracking-tight ${titleClass}`}>
              {formatMoneyUSDLabel(portfolio.acciones_value)}
            </span>
            {rate != null && (
              <span className={`text-sm tabular-nums ${mutedClass}`}> ({formatClpDots(portfolio.acciones_value * rate)})</span>
            )}
          </div>
        )}
      </div>

      {holdingsSorted.length === 0 ? (
        <p className={`py-8 text-center text-sm ${mutedClass}`}>Sin posiciones en acciones.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {holdingsSorted.map((h) => (
            <HoldingCard key={h.ticker} h={h} onSelect={() => onSelectHolding(h)} isDark={isDark} />
          ))}
        </div>
      )}
    </div>
  );
}
