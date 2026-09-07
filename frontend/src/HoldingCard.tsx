import { formatMoney, formatPct, formatSharesCard, formatUsdSignedGain } from "./format";
import { StockLogoImg } from "./transactionUi";
import type { Holding } from "./types";

export function GainRow({
  compact,
  label,
  amount,
  pct,
  showPct,
  unavailable,
  isDark,
}: {
  compact?: boolean;
  label: string;
  amount: number;
  pct: number | null;
  showPct: boolean;
  unavailable: boolean;
  isDark: boolean;
}) {
  const pos = amount >= 0;
  const value = unavailable ? "—" : formatUsdSignedGain(amount);
  const mutedClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const colorClass = unavailable
    ? mutedClass
    : pos
      ? isDark
        ? "text-emerald-400"
        : "text-emerald-600"
      : isDark
        ? "text-rose-400"
        : "text-rose-600";
  return (
    <div className={`flex justify-between ${compact ? "gap-2" : "gap-3"}`}>
      <dt className={`shrink-0 ${mutedClass} ${compact ? "text-[10px]" : ""}`}>{label}</dt>
      <dd
        className={`text-right font-medium tabular-nums ${compact ? "text-[10px] leading-tight" : ""} ${colorClass}`}
      >
        {value}
        {showPct && pct != null && !unavailable && (
          <span className={`ml-1 font-normal ${mutedClass}`}>({formatPct(pct)})</span>
        )}
      </dd>
    </div>
  );
}

export function Row({
  label,
  value,
  compact,
  isDark,
}: {
  label: string;
  value: string;
  compact?: boolean;
  isDark: boolean;
}) {
  return (
    <div className={`flex justify-between ${compact ? "gap-2" : "gap-3"}`}>
      <dt className={`shrink-0 ${isDark ? "text-[#8b949e]" : "text-[#8A8072]"} ${compact ? "text-[10px]" : ""}`}>
        {label}
      </dt>
      <dd
        className={`text-right font-medium tabular-nums ${isDark ? "text-[#F3F1EC]" : "text-[#2B2620]"} ${compact ? "text-[10px] leading-tight" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function HoldingCard({
  h,
  compact,
  splitPair,
  onSelect,
  isDark,
}: {
  h: Holding;
  compact?: boolean;
  splitPair?: boolean;
  onSelect?: () => void;
  isDark: boolean;
}) {
  const gainPct = h.rentabilidad_total_pct ?? 0;
  const totalGain = h.ganancia_total;
  const gainPositive = totalGain >= 0;
  const c = compact === true;
  const split = c && splitPair === true;
  const logoSize = c ? "md" : "lg";
  const unrealUnavailable = h.price_unavailable === true;

  const cardBg = isDark ? "bg-[#161b22]" : "bg-white";
  const cardBorder = isDark ? "border-[#30363d]" : "border-[#E8E1D4]";
  const textPrimary = isDark ? "text-[#F3F1EC]" : "text-[#2B2620]";
  const textMuted = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const divider = isDark ? "border-[#21262d]" : "border-[#F0EAE0]";
  const gainBadge = gainPct >= 0
    ? isDark
      ? "bg-emerald-500/15 text-emerald-400"
      : "bg-emerald-50 text-emerald-600"
    : isDark
      ? "bg-rose-500/15 text-rose-400"
      : "bg-rose-50 text-rose-600";
  const gainTotalClass = gainPositive
    ? isDark
      ? "text-emerald-400"
      : "text-emerald-600"
    : isDark
      ? "text-rose-400"
      : "text-rose-600";

  return (
    <div
      className={`rounded-xl border ${cardBorder} ${cardBg} shadow-sm ${c ? "rounded-lg p-3" : "p-5"} ${split ? "flex min-h-0 flex-1 flex-col" : ""} ${
        onSelect
          ? isDark
            ? "cursor-pointer transition hover:border-[#484f58] hover:bg-[#1c2128]/90"
            : "cursor-pointer transition hover:border-[#DCD3C2] hover:bg-[#FBFAF7]"
          : ""
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
        <StockLogoImg symbol={h.ticker} size={logoSize} isDark={isDark} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="min-w-0">
              <p className={`font-bold leading-tight tracking-tight ${textPrimary} ${c ? "text-[13px]" : "text-[15px]"}`}>
                {h.ticker}
              </p>
              <p className={`truncate leading-snug ${textMuted} ${c ? "mt-0.5 text-[10px]" : "mt-0.5 text-[11px]"}`}>
                {h.nombre || "—"}
              </p>
              {h.price_unavailable && (
                <p className={`font-medium ${isDark ? "text-[#fdba74]" : "text-[#b45309]"} ${c ? "mt-0.5 text-[9px]" : "mt-1 text-[10px]"}`}>
                  Precio no disponible
                </p>
              )}
            </div>
            <span
              className={`shrink-0 rounded-full font-semibold tabular-nums ${
                c ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]"
              } ${gainBadge}`}
            >
              {formatPct(gainPct)}
            </span>
          </div>
        </div>
      </div>

      <dl
        className={`leading-snug ${c ? "mt-2.5 space-y-1 text-[10px]" : "mt-5 space-y-2.5 text-[12px]"} ${split ? "min-h-0 flex-1" : ""}`}
      >
        <Row compact={c} label="Acciones" value={formatSharesCard(h.total_shares)} isDark={isDark} />
        <Row
          compact={c}
          label="Costo actual"
          value={h.price_unavailable ? "—" : `${formatMoney(h.current_price)} c/u`}
          isDark={isDark}
        />
        <Row compact={c} label="Costo prom." value={`${formatMoney(h.avg_buy_price)} c/u`} isDark={isDark} />
        <Row compact={c} label="Valor" value={formatMoney(h.current_value)} isDark={isDark} />
        <Row compact={c} label="Peso" value={`${h.peso_portafolio_pct.toFixed(1)}%`} isDark={isDark} />
        <GainRow
          compact={c}
          label={c ? "No realizada" : "Ganancia no realizada"}
          amount={h.ganancia_no_realizada}
          pct={h.rentabilidad_no_realizada_pct}
          showPct
          unavailable={unrealUnavailable}
          isDark={isDark}
        />
        <GainRow
          compact={c}
          label={c ? "Realizada" : "Ganancia realizada"}
          amount={h.ganancia_realizada}
          pct={null}
          showPct={false}
          unavailable={false}
          isDark={isDark}
        />
        {Math.abs(h.dividendos) > 1e-6 && (
          <GainRow
            compact={c}
            label="Dividendos"
            amount={h.dividendos}
            pct={null}
            showPct={false}
            unavailable={false}
            isDark={isDark}
          />
        )}
      </dl>

      <div
        className={`flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-t ${divider} ${
          c ? "mt-2.5 pt-2" : "mt-5 gap-x-3 gap-y-1 pt-4"
        } ${split ? "mt-auto shrink-0" : ""}`}
      >
        <span className={`font-bold leading-none tracking-tight ${textPrimary} tabular-nums ${c ? "text-[16px]" : "text-[22px]"}`}>
          {formatMoney(h.capital_invertido)}
        </span>
        <span className={`font-semibold tabular-nums ${c ? "text-xs" : "text-sm"} ${gainTotalClass}`}>
          {gainPositive ? "+" : ""}
          {formatMoney(totalGain)}
        </span>
      </div>
    </div>
  );
}
