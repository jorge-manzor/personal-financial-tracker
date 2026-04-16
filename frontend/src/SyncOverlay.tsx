import { API_BASE } from "./config";
import { getToken } from "./auth";
import type { SyncStatus } from "./types";

export type TickerUiState = "pending" | "downloading" | "done";

export function runSync(
  force: boolean,
  onProgress: (pct: number, payload: Record<string, unknown>) => void,
  onComplete: () => void,
  onError: (e: Error) => void,
  /** Si el servidor detecta sesión Fintual inválida/expirada (p. ej. cookie de ~30 días). */
  onFintualSessionInvalid?: () => void | Promise<void>,
) {
  const params = new URLSearchParams();
  params.set("force", String(force));
  const t = getToken();
  if (t) params.set("access_token", t);
  const es = new EventSource(`${API_BASE}/sync?${params.toString()}`);
  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as Record<string, unknown>;
      if (data.status === "fintual_auth_error") {
        es.close();
        void Promise.resolve(onFintualSessionInvalid?.()).catch(() => {});
        return;
      }
      if (data.status === "sync_error") {
        es.close();
        onError(new Error(String(data.message || "No se pudo sincronizar")));
        return;
      }
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
  /** Detalle enviado por el servidor (SSE), p. ej. etapa de sincronización Fintual. */
  detailMessage?: string | null;
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export function SyncOverlay({
  status,
  progressPct,
  tickerStates,
  order,
  detailMessage,
}: SyncOverlayProps) {
  /** Hasta el primer avance real del SSE la barra fija en 0% se ve “muerta”; mostramos barrido. */
  const indeterminate = progressPct < 8;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0d1117] px-6">
      <div className="mb-8 flex flex-col items-center gap-4">
        <div className="flex items-end justify-center gap-0">
          <div className="flex flex-col items-center">
            <div
              className="mb-1.5 flex h-12 w-12 items-center justify-center rounded-xl border border-[#30363d] bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset]"
              aria-hidden
            >
              <svg viewBox="0 0 32 32" className="h-7 w-7">
                <path
                  d="M4 22 L11 15 L17 17 L28 6"
                  stroke="#dc2626"
                  strokeWidth="2.4"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="text-xl font-semibold leading-none text-[#3b82f6]">Moni</span>
          </div>
          <span className="text-xl font-semibold leading-none text-white">tro</span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-[#8b949e]">
            <Spinner className="h-4 w-4 shrink-0 animate-spin text-[#22c55e]" />
            <span>Actualizando tu portafolio...</span>
          </div>
          {(detailMessage || order.length === 0) && (
            <p className="max-w-md text-center text-xs leading-relaxed text-[#6e7681]">
              {detailMessage ||
                "Obteniendo lista de activos y preparando descargas. Esto puede tardar unos segundos."}
            </p>
          )}
        </div>
      </div>

      <div className="mb-8 h-2 w-full max-w-md overflow-hidden rounded-full bg-[#21262d]">
        {indeterminate ? (
          <div className="boot-bar h-full w-1/3 rounded-full bg-[#22c55e]" />
        ) : (
          <div
            className="h-full rounded-full bg-[#22c55e] transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        )}
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
          <div className="flex items-center justify-center gap-2 py-1 text-[#8b949e]">
            <Spinner className="h-3.5 w-3.5 shrink-0 animate-spin text-[#22c55e]" />
            <span>Preparando datos...</span>
          </div>
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
