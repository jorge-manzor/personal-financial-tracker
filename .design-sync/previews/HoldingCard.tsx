import { HoldingCard } from "@zendo/design-system";
import type { Holding } from "@zendo/design-system";

const aapl: Holding = {
  ticker: "AAPL",
  nombre: "Apple Inc.",
  total_shares: 12.5,
  avg_buy_price: 168.32,
  capital_invertido: 2104.0,
  current_price: 227.55,
  current_value: 2844.38,
  ganancia_realizada: 84.2,
  ganancia_no_realizada: 740.38,
  dividendos: 18.6,
  ganancia_total: 843.18,
  rentabilidad_no_realizada_pct: 35.19,
  rentabilidad_total_pct: 40.07,
  peso_portafolio_pct: 22.4,
};

const tsla: Holding = {
  ticker: "TSLA",
  nombre: "Tesla, Inc.",
  total_shares: 6,
  avg_buy_price: 261.4,
  capital_invertido: 1568.4,
  current_price: 214.11,
  current_value: 1284.66,
  ganancia_realizada: 0,
  ganancia_no_realizada: -283.74,
  dividendos: 0,
  ganancia_total: -283.74,
  rentabilidad_no_realizada_pct: -18.09,
  rentabilidad_total_pct: -18.09,
  peso_portafolio_pct: 10.1,
};

const msftUnavailable: Holding = {
  ticker: "MSFT",
  nombre: "Microsoft Corporation",
  total_shares: 9,
  avg_buy_price: 305.1,
  capital_invertido: 2745.9,
  current_price: 0,
  current_value: 2745.9,
  ganancia_realizada: 42.1,
  ganancia_no_realizada: 0,
  dividendos: 27.9,
  ganancia_total: 70.0,
  rentabilidad_no_realizada_pct: null,
  rentabilidad_total_pct: 2.55,
  peso_portafolio_pct: 21.6,
  price_unavailable: true,
};

export function Default() {
  return (
    <div style={{ maxWidth: 340 }}>
      <HoldingCard h={aapl} isDark={false} onSelect={() => {}} />
    </div>
  );
}

export function Dark() {
  return (
    <div style={{ maxWidth: 340, background: "#0d1117", padding: 16, borderRadius: 12 }}>
      <HoldingCard h={aapl} isDark />
    </div>
  );
}

export function Compact() {
  return (
    <div style={{ maxWidth: 220 }}>
      <HoldingCard h={tsla} compact isDark={false} />
    </div>
  );
}

export function PriceUnavailable() {
  return (
    <div style={{ maxWidth: 340 }}>
      <HoldingCard h={msftUnavailable} isDark={false} />
    </div>
  );
}

export function Loss() {
  return (
    <div style={{ maxWidth: 340 }}>
      <HoldingCard h={tsla} isDark={false} />
    </div>
  );
}
