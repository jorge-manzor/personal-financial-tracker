import { useCallback, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { API_BASE } from "./config";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";
import { ActivitySection } from "./ActivitySection";
import { Dashboard } from "./Dashboard";
import { ManualSnapshotModal } from "./ManualModals";
import { runSync, SyncOverlay, type TickerUiState } from "./SyncOverlay";
import { TransactionModal } from "./TransactionModal";
import type {
  ChartCurrency,
  ChartRow,
  FintualGoalCard,
  Holding,
  ManualAsset,
  Period,
  Portfolio,
  SectorSlice,
  SyncStatus,
  TransactionRow,
} from "./types";

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json() as Promise<T>;
}

function BootLoader({ message }: { message: string }) {
  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center px-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-md text-center">
        <div
          className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-2 border-[#30363d] border-t-[#22c55e]"
          aria-hidden
        />
        <p className="text-base font-medium text-white">{message}</p>
        <p className="mt-2 text-xs leading-relaxed text-[#6e7681]">
          Conectamos con el servidor y, si hace falta, con Fintual para posiciones, movimientos y precios. La primera
          sincronización puede tardar un poco más.
        </p>
        <p className="mt-3 break-all font-mono text-[10px] text-[#484f58]">{API_BASE}</p>
        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-[#21262d]">
          <div className="boot-bar h-full w-1/3 rounded-full bg-[#22c55e]" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [headerSync, setHeaderSync] = useState(false);
  const [headerSyncStartedAt, setHeaderSyncStartedAt] = useState<number | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [tickerStates, setTickerStates] = useState<Record<string, TickerUiState>>({});
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [chart, setChart] = useState<ChartRow[]>([]);
  const [sectors, setSectors] = useState<SectorSlice[]>([]);
  const [manualAssets, setManualAssets] = useState<ManualAsset[]>([]);
  const [fintualGoals, setFintualGoals] = useState<FintualGoalCard[]>([]);
  const [period, setPeriod] = useState<Period>("ALL");
  const [chartCurrency, setChartCurrency] = useState<ChartCurrency>("CLP");
  const [chartLoading, setChartLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [txOpen, setTxOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<TransactionRow | null>(null);
  const [snapshotAsset, setSnapshotAsset] = useState<ManualAsset | null>(null);
  const [ready, setReady] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [bootHint, setBootHint] = useState("Conectando con el servidor…");
  const [initError, setInitError] = useState<string | null>(null);
  const [bootRetry, setBootRetry] = useState(0);
  const [fxRefreshNonce, setFxRefreshNonce] = useState(0);

  const loadAll = useCallback(async () => {
    const d = await fetchJson<{
      portfolio: Portfolio;
      holdings: Holding[];
      sectors: { slices: SectorSlice[] };
      manual_assets: ManualAsset[];
      fintual_goals: FintualGoalCard[];
    }>("/dashboard-initial");
    setPortfolio(d.portfolio);
    setHoldings(d.holdings);
    setSectors(d.sectors.slices);
    setManualAssets(d.manual_assets);
    setFintualGoals(d.fintual_goals ?? []);
    setReady(true);
    setDataVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setChartLoading(true);
    fetchJson<ChartRow[]>(`/chart-data?period=${period}`)
      .then((rows) => {
        if (!cancelled) setChart(rows);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, ready, dataVersion]);

  const beginSync = useCallback((force: boolean, fullScreen = true) => {
    fetchJson<SyncStatus>("/sync-status").then((st) => {
      setSyncStatus(st);
      const order = st.tickers;
      const init: Record<string, TickerUiState> = {};
      order.forEach((t) => {
        init[t] = "pending";
      });
      setTickerStates(init);
      setProgressPct(0);
      if (fullScreen) {
        setOverlay(true);
      } else {
        setHeaderSync(true);
        setHeaderSyncStartedAt(Date.now());
      }

      runSync(
        force,
        (pct, data) => {
          setProgressPct(pct);
          const t = data.ticker as string | undefined;
          const stt = data.status as string | undefined;
          if (t && stt === "downloading") {
            setTickerStates((s) => ({ ...s, [t]: "downloading" }));
          }
          if (t && stt === "done") {
            setTickerStates((s) => ({ ...s, [t]: "done" }));
          }
        },
        async () => {
          if (fullScreen) setOverlay(false);
          else {
            setHeaderSync(false);
            setHeaderSyncStartedAt(null);
          }
          const st2 = await fetchJson<SyncStatus>("/sync-status");
          setSyncStatus(st2);
          await loadAll();
          setFxRefreshNonce((n) => n + 1);
        },
        () => {
          if (fullScreen) setOverlay(false);
          else {
            setHeaderSync(false);
            setHeaderSyncStartedAt(null);
          }
        },
      );
    });
  }, [loadAll]);

  useEffect(() => {
    let cancelled = false;
    setInitError(null);
    setReady(false);
    setBootHint("Conectando con el servidor…");
    void (async () => {
      try {
        const st = await fetchJson<SyncStatus>("/sync-status");
        if (cancelled) return;
        setSyncStatus(st);
        if (st.needs_sync) {
          setBootHint("Sincronizando con Fintual (posiciones, movimientos y precios)…");
          beginSync(false, true);
        } else {
          setBootHint("Cargando datos del portafolio…");
          await loadAll();
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setInitError(
            `Sin respuesta del servidor (${API_BASE}). Tras reiniciar el backend puede tardar unos segundos; reintentá o comprobá que uvicorn esté en marcha.`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootRetry, beginSync, loadAll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const showMain = ready && !overlay && !initError;
  const syncBusy = overlay || headerSync;

  return (
    <div className="min-h-full bg-[#0d1117]">
      <AppSidebar />
      <AppHeader
        onRefreshPrices={() => beginSync(true, false)}
        headerSyncing={headerSync}
        headerSyncStartedAt={headerSync ? headerSyncStartedAt : null}
        syncDisabled={syncBusy}
        fxRefreshNonce={fxRefreshNonce}
      />

      {syncStatus && overlay && (
        <SyncOverlay
          status={syncStatus}
          progressPct={progressPct}
          tickerStates={tickerStates}
          order={syncStatus.tickers}
        />
      )}

      <main className="pt-14 pl-14">
        {showMain ? (
          <Routes>
            <Route
              path="/"
              element={
                <Dashboard
                  portfolio={portfolio}
                  holdings={holdings}
                  chart={chart}
                  chartLoading={chartLoading}
                  period={period}
                  onPeriod={setPeriod}
                  chartCurrency={chartCurrency}
                  onChartCurrency={setChartCurrency}
                  sectors={sectors}
                  manualAssets={manualAssets}
                  fintualGoals={fintualGoals}
                  onManualSnapshot={(a) => setSnapshotAsset(a)}
                  onDeleteManual={async (m) => {
                    if (
                      !confirm(
                        `¿Eliminar "${m.nombre}"? Se borrarán también sus valores históricos. Esta acción no se puede deshacer.`,
                      )
                    ) {
                      return;
                    }
                    try {
                      const r = await fetch(`${API_BASE}/manual-assets/${m.id}`, {
                        method: "DELETE",
                      });
                      if (!r.ok) {
                        setToast("No se pudo eliminar el activo");
                        return;
                      }
                      setToast("Activo eliminado");
                      await loadAll();
                    } catch {
                      setToast("No se pudo eliminar el activo");
                    }
                  }}
                  dataVersion={dataVersion}
                  onEditTransaction={(tx) => {
                    setEditingTx(tx);
                    setTxOpen(true);
                  }}
                  onToast={setToast}
                  onMutate={loadAll}
                />
              }
            />
            <Route
              path="/transactions"
              element={
                <TransactionsRoute
                  dataVersion={dataVersion}
                  onEdit={(tx) => {
                    setEditingTx(tx);
                    setTxOpen(true);
                  }}
                  onToast={setToast}
                  onMutate={loadAll}
                />
              }
            />
          </Routes>
        ) : initError ? (
          <div className="flex min-h-[50vh] flex-col items-center justify-center gap-5 px-6 text-center">
            <p className="max-w-lg text-sm text-[#f85149]">{initError}</p>
            <button
              type="button"
              onClick={() => setBootRetry((n) => n + 1)}
              className="rounded-lg border border-[#30363d] bg-[#21262d] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#30363d]"
            >
              Reintentar
            </button>
          </div>
        ) : overlay ? null : (
          <BootLoader message={bootHint} />
        )}
      </main>

      <FabAndModal
        showMain={showMain}
        txOpen={txOpen}
        setTxOpen={setTxOpen}
        editingTx={editingTx}
        setEditingTx={setEditingTx}
        loadAll={loadAll}
        setToast={setToast}
      />

      <ManualSnapshotModal
        asset={snapshotAsset}
        open={snapshotAsset != null}
        onClose={() => setSnapshotAsset(null)}
        onSaved={() => {
          setToast("Valor actualizado ✅");
          void loadAll();
        }}
      />
      {toast && (
        <div className="fixed bottom-24 left-1/2 z-[70] -translate-x-1/2 rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-2 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function TransactionsRoute({
  dataVersion,
  onEdit,
  onToast,
  onMutate,
}: {
  dataVersion: number;
  onEdit: (tx: TransactionRow) => void;
  onToast: (msg: string | null) => void;
  onMutate: () => void;
}) {
  return (
    <div className="mx-auto max-w-[1200px] space-y-4 p-4 pb-28 md:p-6">
      <ActivitySection
        dataVersion={dataVersion}
        onEdit={onEdit}
        onToast={(msg) => onToast(msg)}
        onMutate={onMutate}
        showMonthly={false}
      />
    </div>
  );
}

function FabAndModal({
  showMain,
  txOpen,
  setTxOpen,
  editingTx,
  setEditingTx,
  loadAll,
  setToast,
}: {
  showMain: boolean;
  txOpen: boolean;
  setTxOpen: (v: boolean) => void;
  editingTx: TransactionRow | null;
  setEditingTx: (v: TransactionRow | null) => void;
  loadAll: () => Promise<void>;
  setToast: (s: string | null) => void;
}) {
  const location = useLocation();
  const showFab = showMain && location.pathname === "/";

  return (
    <>
      {showFab && (
        <button
          type="button"
          onClick={() => {
            setEditingTx(null);
            setTxOpen(true);
          }}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#22c55e] text-3xl font-light text-[#0d1117] shadow-lg hover:brightness-110"
          aria-label="Añadir transacción"
        >
          +
        </button>
      )}

      <TransactionModal
        open={txOpen}
        editing={editingTx}
        onClose={() => {
          setTxOpen(false);
          setEditingTx(null);
        }}
        onSaved={() => {
          const wasEdit = editingTx != null;
          setToast(wasEdit ? "Transacción actualizada ✅" : "Transacción guardada ✅");
          void loadAll();
        }}
      />
    </>
  );
}
