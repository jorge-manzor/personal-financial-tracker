import { GainRow } from "@zendo/design-system";

export function Positive() {
  return (
    <dl
      style={{ maxWidth: 280 }}
      className="space-y-2.5 rounded-xl border border-[#E8E1D4] bg-white p-4 text-[12px]"
    >
      <GainRow
        label="Ganancia no realizada"
        amount={740.38}
        pct={35.19}
        showPct
        unavailable={false}
        isDark={false}
      />
    </dl>
  );
}

export function Negative() {
  return (
    <dl
      style={{ maxWidth: 280 }}
      className="space-y-2.5 rounded-xl border border-[#E8E1D4] bg-white p-4 text-[12px]"
    >
      <GainRow
        label="Ganancia no realizada"
        amount={-283.74}
        pct={-18.09}
        showPct
        unavailable={false}
        isDark={false}
      />
    </dl>
  );
}

export function Unavailable() {
  return (
    <dl
      style={{ maxWidth: 280 }}
      className="space-y-2.5 rounded-xl border border-[#E8E1D4] bg-white p-4 text-[12px]"
    >
      <GainRow label="Ganancia no realizada" amount={0} pct={null} showPct unavailable isDark={false} />
    </dl>
  );
}

export function CompactDark() {
  return (
    <dl
      style={{ maxWidth: 220, background: "#161b22" }}
      className="space-y-1 rounded-lg border border-[#30363d] p-3 text-[10px]"
    >
      <GainRow compact label="No realizada" amount={84.2} pct={null} showPct={false} unavailable={false} isDark />
      <GainRow compact label="Dividendos" amount={18.6} pct={null} showPct={false} unavailable={false} isDark />
    </dl>
  );
}
