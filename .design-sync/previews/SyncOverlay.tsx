import { SyncOverlay } from "@zendo/design-system";
import type { TickerUiState } from "@zendo/design-system";

export function Downloading() {
  const order = ["AAPL", "TSLA", "MSFT", "NVDA", "AMZN"];
  const tickerStates: Record<string, TickerUiState> = {
    AAPL: "done",
    TSLA: "done",
    MSFT: "downloading",
    NVDA: "pending",
    AMZN: "pending",
  };
  return (
    <div style={{ position: "relative", height: 480 }}>
      <SyncOverlay
        status={{ last_updated: "2026-09-06" }}
        progressPct={46}
        tickerStates={tickerStates}
        order={order}
        detailMessage="Descargando precios de mercado (Fintual)…"
      />
    </div>
  );
}

export function Starting() {
  return (
    <div style={{ position: "relative", height: 480 }}>
      <SyncOverlay status={{ last_updated: null }} progressPct={2} tickerStates={{}} order={[]} />
    </div>
  );
}

export function AlmostDone() {
  const order = ["AAPL", "TSLA", "MSFT"];
  const tickerStates: Record<string, TickerUiState> = { AAPL: "done", TSLA: "done", MSFT: "done" };
  return (
    <div style={{ position: "relative", height: 480 }}>
      <SyncOverlay
        status={{ last_updated: "2026-09-07" }}
        progressPct={98}
        tickerStates={tickerStates}
        order={order}
        detailMessage="Consolidando historial del portafolio…"
      />
    </div>
  );
}
