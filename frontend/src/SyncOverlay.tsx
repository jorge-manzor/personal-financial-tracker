import { API_BASE } from "./config";
import type { SyncStatus } from "./types";

export type TickerUiState = "pending" | "downloading" | "done";

export function runSync(
  force: boolean,
  onProgress: (pct: number, payload: Record<string, unknown>) => void,
  onComplete: () => void,
  onError: (e: Error) => void,
) {
  const es = new EventSource(`${API_BASE}/sync?force=${force}`);
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as Record<string, unknown>;
      if (typeof data.progress_pct === "number") {
        onProgress(data.progress_pct as number, data);
      }
      if (data.status === "complete") {
        es.close();
        onComplete();
      }
    } catch {
      onError(new Error("Respuesta inválida del servidor"));
    }
  };
  es.onerror = () => {
    es.close();
    onError(new Error("Error de conexión SSE"));
  };
}

interface SyncOverlayProps {
  status: SyncStatus;
  progressPct: number;
  tickerStates: Record<string, TickerUiState>;
  order: string[];
}

export function SyncOverlay({ status, progressPct, tickerStates, order }: SyncOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0d1117] px-6">
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#30363d] bg-[#161b22] text-2xl">
          📈
        </div>
        <h1 className="text-xl font-semibold text-white">
          <span className="text-[#3b82f6]">Moni</span>
          <span className="text-white">tro</span>
        </h1>
        <p className="text-sm text-[#8b949e]">Actualizando tu portafolio...</p>
      </div>

      <div className="mb-8 h-2 w-full max-w-md overflow-hidden rounded-full bg-[#21262d]">
        <div
          className="h-full rounded-full bg-[#22c55e] transition-[width] duration-300"
          style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
        />
      </div>

      <div className="max-h-48 w-full max-w-md overflow-y-auto rounded-xl border border-[#30363d] bg-[#161b22] p-3 text-sm">
        {order.map((t) => {
          const st = tickerStates[t] ?? "pending";
          const icon = st === "done" ? "✅" : st === "downloading" ? "🔄" : "⏳";
          const label =
            st === "done" ? "listo" : st === "downloading" ? "descargando..." : "en cola";
          return (
            <div key={t} className="flex justify-between gap-4 border-b border-[#21262d] py-2 last:border-0">
              <span className="font-medium text-[#e6edf3]">
                {icon} {t}
              </span>
              <span className="text-[#8b949e]">{label}</span>
            </div>
          );
        })}
        {order.length === 0 && (
          <p className="text-center text-[#8b949e]">Preparando datos...</p>
        )}
      </div>

      <p className="mt-8 text-xs text-[#8b949e]">
        Última actualización:{" "}
        {status.last_updated
          ? new Date(status.last_updated + "T12:00:00").toLocaleDateString("es")
          : "—"}
      </p>
    </div>
  );
}
