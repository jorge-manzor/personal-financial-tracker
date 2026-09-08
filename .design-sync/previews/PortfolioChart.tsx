import { PortfolioChart } from "@zendo/design-system";
import type { ChartRow } from "@zendo/design-system";

const CHART: ChartRow[] = [
  { date: "2026-01-31", acciones_valor: 9800, acciones_invertido: 8500, fondos_valor: 5200, fondos_invertido: 4600, total_valor: 15000, total_invertido: 13100, total_valor_clp: 14_250_000, total_invertido_clp: 12_445_000, fx_usd_clp: 950 },
  { date: "2026-02-28", acciones_valor: 10250, acciones_invertido: 8700, fondos_valor: 5400, fondos_invertido: 4700, total_valor: 15650, total_invertido: 13400, total_valor_clp: 15_022_000, total_invertido_clp: 12_864_000, fx_usd_clp: 960 },
  { date: "2026-03-31", acciones_valor: 10900, acciones_invertido: 9100, fondos_valor: 5650, fondos_invertido: 4800, total_valor: 16550, total_invertido: 13900, total_valor_clp: 16_053_500, total_invertido_clp: 13_483_000, fx_usd_clp: 970 },
  { date: "2026-04-30", acciones_valor: 10400, acciones_invertido: 9200, fondos_valor: 5800, fondos_invertido: 4900, total_valor: 16200, total_invertido: 14100, total_valor_clp: 15_714_000, total_invertido_clp: 13_677_000, fx_usd_clp: 969 },
  { date: "2026-05-31", acciones_valor: 11200, acciones_invertido: 9400, fondos_valor: 6050, fondos_invertido: 5000, total_valor: 17250, total_invertido: 14400, total_valor_clp: 16_852_500, total_invertido_clp: 14_068_800, fx_usd_clp: 977 },
  { date: "2026-06-30", acciones_valor: 11800, acciones_invertido: 9600, fondos_valor: 6300, fondos_invertido: 5100, total_valor: 18100, total_invertido: 14700, total_valor_clp: 17_918_600, total_invertido_clp: 14_553_300, fx_usd_clp: 990 },
  { date: "2026-07-31", acciones_valor: 12450, acciones_invertido: 9800, fondos_valor: 6550, fondos_invertido: 5200, total_valor: 19000, total_invertido: 15000, total_valor_clp: 19_000_000, total_invertido_clp: 15_000_000, fx_usd_clp: 1000 },
  { date: "2026-08-31", acciones_valor: 12100, acciones_invertido: 9950, fondos_valor: 6700, fondos_invertido: 5300, total_valor: 18800, total_invertido: 15250, total_valor_clp: 18_988_000, total_invertido_clp: 15_402_500, fx_usd_clp: 1010 },
  { date: "2026-09-06", acciones_valor: 12844, acciones_invertido: 10050, fondos_valor: 6890, fondos_invertido: 5400, total_valor: 19734, total_invertido: 15450, total_valor_clp: 20_128_680, total_invertido_clp: 15_759_000, fx_usd_clp: 1020 },
];

export function Default() {
  return (
    <div style={{ maxWidth: 760 }} className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <PortfolioChart chart={CHART} period="6M" currency="USD" isDark={false} />
    </div>
  );
}

export function ClpCurrency() {
  return (
    <div style={{ maxWidth: 760 }} className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <PortfolioChart chart={CHART} period="1Y" currency="CLP" isDark={false} />
    </div>
  );
}

export function Loading() {
  return (
    <div style={{ maxWidth: 760 }} className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <PortfolioChart chart={CHART} period="6M" currency="USD" loading isDark={false} />
    </div>
  );
}

export function Empty() {
  return (
    <div style={{ maxWidth: 760 }} className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <PortfolioChart chart={[]} period="1M" currency="USD" isDark={false} />
    </div>
  );
}

export function Dark() {
  return (
    <div style={{ maxWidth: 760, background: "#0d1117" }} className="rounded-xl border border-[#30363d] p-4">
      <PortfolioChart chart={CHART} period="6M" currency="USD" isDark />
    </div>
  );
}
