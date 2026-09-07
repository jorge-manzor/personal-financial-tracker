import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { apiFetch } from "./api";
import type { ExchangeRateInfo } from "./types";

async function postExchangeRefresh(): Promise<ExchangeRateInfo> {
  const r = await apiFetch("/exchange-rate/refresh", { method: "POST" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<ExchangeRateInfo>;
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 3" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 21" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function HeaderSyncElapsed({ startedAt }: { startedAt: number }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const tick = () => setSec(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [startedAt]);
  return (
    <span className="tabular-nums text-[#e6edf3]">
      Actualizando… <span className="font-semibold">{sec}</span> s
    </span>
  );
}

interface AppHeaderProps {
  onRefreshPrices: () => void;
  headerSyncing: boolean;
  /** Solo sync del header (“Actualizar”): inicio del cronómetro en ms; null si no aplica. */
  headerSyncStartedAt: number | null;
  syncDisabled: boolean;
  /** Se incrementa al terminar “Actualizar”; relee el TC ya guardado por el sync. */
  fxRefreshNonce: number;
  /** Si es false, se ocultan tipo de cambio y botón de sincronizar (sin servicio de inversiones). */
  investmentsEnabled: boolean;
}

function headerSubtitle(pathname: string, investmentsEnabled: boolean): string {
  if (pathname.startsWith("/profile")) return "Servicios y preferencias";
  if (!investmentsEnabled && pathname === "/") return "Inicio";
  return "Resumen del portafolio";
}

export function AppHeader({
  onRefreshPrices,
  headerSyncing,
  headerSyncStartedAt,
  syncDisabled,
  fxRefreshNonce,
  investmentsEnabled,
}: AppHeaderProps) {
  const { pathname } = useLocation();
  const [ex, setEx] = useState<ExchangeRateInfo | null>(null);

  useEffect(() => {
    if (!investmentsEnabled) {
      setEx(null);
      return;
    }
    postExchangeRefresh()
      .then(setEx)
      .catch(() => setEx(null));
  }, [investmentsEnabled]);

  useEffect(() => {
    if (!investmentsEnabled) return;
    if (fxRefreshNonce === 0) return;
    postExchangeRefresh()
      .then(setEx)
      .catch(() => setEx(null));
  }, [fxRefreshNonce, investmentsEnabled]);

  const rateText =
    ex != null
      ? `$${ex.rate.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "—";

  const rateTitle =
    ex != null
      ? [
          ex.source === "fintual"
            ? "USD/CLP desde Fintual (getTailormadeExchangeRate)."
            : "USD/CLP de referencia (DolarAPI u otro respaldo si Fintual no está disponible).",
          ex.source != null && ex.source !== "" ? `Fuente: ${ex.source}.` : null,
          ex.updated_at != null ? `Guardado: ${ex.updated_at}.` : null,
        ]
          .filter(Boolean)
          .join(" ")
      : undefined;

  return (
    <header
      className="fixed left-16 right-0 top-0 z-[45] flex h-14 items-center border-b border-[#30363d] bg-[#0d0f14] px-3 md:px-5"
      style={{ height: 56 }}
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5 py-0.5">
          <svg viewBox="0 0 100 100" className="h-6 w-6 shrink-0" aria-hidden>
            <path
              d="M70.08,47.01 A27,27 0 1 0 55.41,78.47"
              fill="none"
              stroke="#8FBFA6"
              strokeWidth="11"
              strokeLinecap="round"
            />
            <path
              d="M55.41,78.47 C59.64,76.5 60.57,63.25 63,62 C65.43,60.76 67.5,73 70,71 C72.5,69 75.33,56.17 78,50 C80.67,43.83 83.87,38.27 86,34"
              fill="none"
              stroke="#C79A56"
              strokeWidth="8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="86" cy="34" r="8" fill="#C79A56" />
          </svg>
          <div className="flex min-w-0 flex-col justify-center gap-0.5">
            <h1 className="truncate text-lg font-bold leading-tight tracking-tight md:text-xl">
              <span className="text-[#8FBFA6]">Zendo</span>
              <span className="text-white"> Finance</span>
            </h1>
            <p className="truncate text-[11px] font-medium text-[#8b949e] md:text-xs">
              {headerSubtitle(pathname, investmentsEnabled)}
            </p>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-3 md:gap-4">
          {investmentsEnabled && (
            <>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs text-[#8b949e]">USD/CLP</span>
                <span
                  className="cursor-help text-sm font-semibold tabular-nums text-white underline decoration-dotted decoration-[#484f58] underline-offset-2"
                  title={rateTitle}
                >
                  {rateText}
                </span>
              </div>

              {headerSyncing ? (
                <div className="flex items-center gap-2 rounded-lg border border-[#30363d] px-3 py-1.5 text-xs text-[#8b949e]">
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#8b949e] border-t-transparent" />
                  {headerSyncStartedAt != null ? (
                    <HeaderSyncElapsed startedAt={headerSyncStartedAt} />
                  ) : (
                    <span className="text-[#e6edf3]">Actualizando…</span>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={syncDisabled}
                  onClick={onRefreshPrices}
                  className="flex items-center gap-2 rounded-lg border border-[#3d444d] bg-transparent px-3 py-1.5 text-sm font-normal text-white transition-colors hover:border-[#6e7681] hover:bg-[#161b22] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshIcon className="shrink-0 text-white" />
                  Actualizar
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
