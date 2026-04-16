import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { API_BASE } from "./config";
import type { ExchangeRateInfo } from "./types";

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}

async function postExchangeRefresh(): Promise<ExchangeRateInfo> {
  const r = await fetch(`${API_BASE}/exchange-rate/refresh`, { method: "POST" });
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
}

function headerSubtitle(pathname: string): string {
  if (pathname.startsWith("/transactions")) return "Movimientos y actividad";
  return "Resumen del portafolio";
}

export function AppHeader({
  onRefreshPrices,
  headerSyncing,
  headerSyncStartedAt,
  syncDisabled,
  fxRefreshNonce,
}: AppHeaderProps) {
  const { pathname } = useLocation();
  const [ex, setEx] = useState<ExchangeRateInfo | null>(null);

  useEffect(() => {
    postExchangeRefresh()
      .then(setEx)
      .catch(() => setEx(null));
  }, []);

  useEffect(() => {
    if (fxRefreshNonce === 0) return;
    fetchJson<ExchangeRateInfo>("/exchange-rate")
      .then(setEx)
      .catch(() => setEx(null));
  }, [fxRefreshNonce]);

  const rateText =
    ex != null
      ? `$${ex.rate.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "—";

  return (
    <header
      className="fixed left-14 right-0 top-0 z-[45] flex h-14 items-center border-b border-[#30363d] bg-[#0d0f14] px-3 md:px-5"
      style={{ height: 56 }}
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col justify-center gap-0.5 py-0.5">
          <h1 className="truncate text-lg font-bold leading-tight tracking-tight md:text-xl">
            <span className="text-[#3b82f6]">Moni</span>
            <span className="text-white">tro</span>
          </h1>
          <p className="truncate text-[11px] font-medium text-[#8b949e] md:text-xs">{headerSubtitle(pathname)}</p>
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-3 md:gap-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-[#8b949e]">USD/CLP</span>
            <span className="text-sm font-semibold tabular-nums text-white">{rateText}</span>
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
        </div>
      </div>
    </header>
  );
}
