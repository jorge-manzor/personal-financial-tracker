import { PanelSectoresTab } from "@zendo/design-system";
import type { SectorSlice } from "@zendo/design-system";

const SECTORS: SectorSlice[] = [
  { sector: "Tecnología", pct: 38.4, value: 7580.2, tickers: ["AAPL", "MSFT", "NVDA"] },
  { sector: "Consumo discrecional", pct: 21.1, value: 4165.5, tickers: ["AMZN", "TSLA"] },
  { sector: "Servicios financieros", pct: 15.6, value: 3078.9, tickers: ["V", "JPM"] },
  { sector: "Salud", pct: 12.3, value: 2428.7, tickers: ["UNH", "LLY"] },
  { sector: "Energía", pct: 7.2, value: 1421.6, tickers: ["XOM"] },
  { sector: "Otros", pct: 5.4, value: 1066.1, tickers: ["KO", "PG"] },
];

export function Default() {
  return (
    <div style={{ maxWidth: 640 }}>
      <PanelSectoresTab sectors={SECTORS} isDark={false} />
    </div>
  );
}

export function Empty() {
  return (
    <div style={{ maxWidth: 640 }}>
      <PanelSectoresTab sectors={[]} isDark={false} />
    </div>
  );
}

export function Dark() {
  return (
    <div style={{ maxWidth: 640, background: "#0d1117", padding: 16, borderRadius: 12 }}>
      <PanelSectoresTab sectors={SECTORS} isDark />
    </div>
  );
}
