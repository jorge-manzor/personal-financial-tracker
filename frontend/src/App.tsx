import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { apiFetch, fetchJson } from "./api";
import { clearToken, getToken } from "./auth";
import { Login } from "./Login";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";
import { ActivitySection } from "./ActivitySection";
import { ManualSnapshotModal } from "./ManualModals";
import { FintualConnectModal } from "./FintualConnectModal";
import { NoServicesPage } from "./NoServicesPage";
import { BankingBodyClassSync, BankingThemeProvider } from "./BankingThemeContext";
import { runSync, SyncOverlay, type TickerUiState } from "./SyncOverlay";
import { TransactionModal } from "./TransactionModal";
import {
  hasAnyActiveService,
  normalizeUserMe,
  type ChartCurrency,
  type ChartRow,
  type FintualGoalCard,
  type Holding,
  type ManualAsset,
  type Period,
  type Portfolio,
  type SectorSlice,
  type SyncStatus,
  type TransactionRow,
  type UserMe,
} from "./types";

const Dashboard = lazy(() => import("./Dashboard").then((m) => ({ default: m.Dashboard })));
const Profile = lazy(() => import("./Profile").then((m) => ({ default: m.Profile })));
const BankingTransactionsPage = lazy(() =>
  import("./BankingTransactionsPage").then((m) => ({ default: m.BankingTransactionsPage })),
);
const BankingSettingsPage = lazy(() =>
  import("./BankingSettingsPage").then((m) => ({ default: m.BankingSettingsPage })),
);

function RoutePageFallback() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className="h-10 w-10 animate-spin rounded-full border-2 border-[#30363d] border-t-[#22c55e]"
        aria-hidden
      />
    </div>
  );
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
          Cargamos tu portafolio y datos almacenados. Para alinear con Fintual (metas y precios vivos) usa
          &quot;Actualizar&quot; o conecta/actualiza la cookie en Perfil.
        </p>
        <p className="mt-3 break-all font-mono text-[10px] text-[#484f58]">
          {import.meta.env.VITE_API_BASE ?? "http://localhost:8000"}
        </p>
        <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-[#21262d]">
          <div className="boot-bar h-full w-1/3 rounded-full bg-[#22c55e]" />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken());
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [headerSync, setHeaderSync] = useState(false);
  const [headerSyncStartedAt, setHeaderSyncStartedAt] = useState<number | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [syncDetailMessage, setSyncDetailMessage] = useState<string | null>(null);
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
  const apiBaseHint = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
  const [bootRetry, setBootRetry] = useState(0);
  const [fxRefreshNonce, setFxRefreshNonce] = useState(0);
  const [me, setMe] = useState<UserMe | null>(null);
  const [fintualModalFromProfile, setFintualModalFromProfile] = useState(false);
  /** Si el usuario cierra el modal sin conectar Fintual, no volver a bloquear hasta que abra de nuevo desde Perfil o recargue. */
  const [fintualSetupSkipped, setFintualSetupSkipped] = useState(false);

  const loadAll = useCallback(async (opts?: { fintualLive?: boolean }) => {
    const fintualLive = opts?.fintualLive !== false;
    const path = fintualLive ? "/dashboard-initial" : "/dashboard-initial?fintual_live=false";
    const d = await fetchJson<{
      portfolio: Portfolio;
      holdings: Holding[];
      sectors: { slices: SectorSlice[] };
      manual_assets: ManualAsset[];
      fintual_goals: FintualGoalCard[];
    }>(path);
    setPortfolio(d.portfolio);
    setHoldings(d.holdings);
    setSectors(d.sectors.slices);
    setManualAssets(d.manual_assets);
    setFintualGoals(d.fintual_goals ?? []);
    setReady(true);
    setDataVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!ready || !me?.services.investments) return;
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
  }, [period, ready, dataVersion, me?.services.investments]);

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
      setSyncDetailMessage(null);
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
          if (typeof data.message === "string" && data.message.trim()) {
            setSyncDetailMessage(data.message.trim());
          }
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
          await loadAll({ fintualLive: true });
          setFxRefreshNonce((n) => n + 1);
        },
        () => {
          if (fullScreen) setOverlay(false);
          else {
            setHeaderSync(false);
            setHeaderSyncStartedAt(null);
          }
        },
        async () => {
          if (fullScreen) setOverlay(false);
          else {
            setHeaderSync(false);
            setHeaderSyncStartedAt(null);
          }
          try {
            const raw = await fetchJson<{
              id: number;
              email: string;
              services: Record<string, boolean>;
              fintual_needs_setup?: boolean;
              fintual_reconnect_required?: boolean;
            }>("/auth/me");
            setMe(normalizeUserMe(raw));
            setToast("Tu sesión con Fintual expiró o dejó de ser válida. Actualiza la cookie en el panel de conexión.");
          } catch {
            setToast("No se pudo verificar el perfil. Revisa la cookie de Fintual en Perfil.");
          }
        },
      );
    });
  }, [loadAll]);

  const handleProfileUpdated = useCallback((next: UserMe) => {
    setMe(normalizeUserMe(next));
    if (next.services?.investments) {
      setReady(false);
      setInitError(null);
      setBootRetry((n) => n + 1);
    } else {
      setPortfolio(null);
      setHoldings([]);
      setChart([]);
      setSectors([]);
      setManualAssets([]);
      setFintualGoals([]);
      setSyncStatus(null);
      setOverlay(false);
      setHeaderSync(false);
      setReady(true);
    }
  }, []);

  const handleFintualConnected = useCallback(
    (next: UserMe) => {
      setFintualModalFromProfile(false);
      setFintualSetupSkipped(false);
      setMe(normalizeUserMe(next));
      setInitError(null);
      setReady(false);
      void (async () => {
        setBootHint("Cargando datos con Fintual…");
        try {
          const st = await fetchJson<SyncStatus>("/sync-status");
          setSyncStatus(st);
          await loadAll({ fintualLive: true });
        } catch (e) {
          console.error(e);
          setInitError(
            `No se pudo cargar el portafolio (${apiBaseHint}). Reintenta o comprueba el servidor.`,
          );
          setReady(true);
        }
      })();
    },
    [apiBaseHint, loadAll],
  );

  const dismissFintualModal = useCallback(() => {
    setFintualModalFromProfile(false);
    setFintualSetupSkipped(true);
  }, []);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    setInitError(null);
    setReady(false);
    setBootHint("Conectando con el servidor…");
    void (async () => {
      try {
        const raw = await fetchJson<{
          id: number;
          email: string;
          services: Record<string, boolean>;
          fintual_needs_setup?: boolean;
        }>("/auth/me");
        if (cancelled) return;
        const profile = normalizeUserMe(raw);
        setMe(profile);
        if (!profile.services.investments) {
          setReady(true);
          return;
        }
        if (profile.fintual_needs_setup) {
          setReady(true);
          return;
        }
        const st = await fetchJson<SyncStatus>("/sync-status");
        if (cancelled) return;
        setSyncStatus(st);
        setBootHint("Cargando datos del portafolio (cache)…");
        await loadAll({ fintualLive: false });
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setInitError(
            `Sin respuesta del servidor (${apiBaseHint}). Tras reiniciar el backend puede tardar unos segundos; reintenta o comprueba que uvicorn esté en marcha.`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed, bootRetry, loadAll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  const showMain = ready && !overlay && !initError && me !== null;
  const syncBusy = overlay || headerSync;
  const investmentsOn = !!me?.services.investments;
  const bankingOn = !!me?.services.banking;
  const needsFintualConnection = investmentsOn && !!me?.fintual_needs_setup;
  const showFintualSetupModal =
    showMain &&
    (fintualModalFromProfile || (needsFintualConnection && !fintualSetupSkipped));

  return (
    <div className="min-h-full bg-[#0d1117]">
      <AppSidebar
        onLogout={() => {
          clearToken();
          window.location.reload();
        }}
        investmentsEnabled={investmentsOn}
        bankingEnabled={bankingOn}
      />
      <AppHeader
        onRefreshPrices={() => beginSync(true, false)}
        headerSyncing={headerSync}
        headerSyncStartedAt={headerSync ? headerSyncStartedAt : null}
        syncDisabled={syncBusy || needsFintualConnection}
        fxRefreshNonce={fxRefreshNonce}
        investmentsEnabled={investmentsOn}
      />

      {syncStatus && overlay && (
        <SyncOverlay
          status={syncStatus}
          progressPct={progressPct}
          tickerStates={tickerStates}
          order={syncStatus.tickers}
          detailMessage={syncDetailMessage}
        />
      )}

      <main className="pt-14 pl-16">
        {showMain ? (
          <Suspense fallback={<RoutePageFallback />}>
            <BankingThemeProvider>
              <BankingBodyClassSync />
            <Routes>
              <Route
                path="/profile"
                element={
                  <Profile
                    me={me!}
                    onUpdated={handleProfileUpdated}
                    onRequestFintualConnect={() => setFintualModalFromProfile(true)}
                  />
                }
              />
              <Route
                path="/"
                element={
                  !hasAnyActiveService(me!.services) ? (
                    <NoServicesPage />
                  ) : investmentsOn ? (
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
                          const r = await apiFetch(`/manual-assets/${m.id}`, {
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
                  ) : bankingOn ? (
                    <Navigate to="/banking/transactions" replace />
                  ) : (
                    <NoServicesPage />
                  )
                }
              />
              <Route
                path="/transactions"
                element={
                  investmentsOn ? (
                    <TransactionsRoute
                      dataVersion={dataVersion}
                      onEdit={(tx) => {
                        setEditingTx(tx);
                        setTxOpen(true);
                      }}
                      onToast={setToast}
                      onMutate={loadAll}
                    />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="/banking/transactions"
                element={
                  bankingOn ? (
                    <BankingTransactionsPage onToast={setToast} />
                  ) : (
                    <Navigate to="/" replace />
                  )
                }
              />
              <Route
                path="/banking/settings"
                element={
                  bankingOn ? <BankingSettingsPage onToast={setToast} /> : <Navigate to="/" replace />
                }
              />
            </Routes>
            </BankingThemeProvider>
          </Suspense>
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

      <TransactionModalLayer
        showMain={showMain}
        investmentsEnabled={investmentsOn}
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
        <div className="fixed bottom-8 left-1/2 z-[70] -translate-x-1/2 rounded-lg border border-[#30363d] bg-[#161b22] px-4 py-2 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}

      {showFintualSetupModal && (
        <FintualConnectModal
          onConnected={handleFintualConnected}
          onDismiss={dismissFintualModal}
          reconnectMode={!!me?.fintual_reconnect_required}
        />
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

/** Modal de transacción solo para editar filas existentes (altas vienen de Fintual/sync). */
function TransactionModalLayer({
  showMain,
  investmentsEnabled,
  txOpen,
  setTxOpen,
  editingTx,
  setEditingTx,
  loadAll,
  setToast,
}: {
  showMain: boolean;
  investmentsEnabled: boolean;
  txOpen: boolean;
  setTxOpen: (v: boolean) => void;
  editingTx: TransactionRow | null;
  setEditingTx: (v: TransactionRow | null) => void;
  loadAll: () => Promise<void>;
  setToast: (s: string | null) => void;
}) {
  if (!showMain || !investmentsEnabled) return null;

  return (
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
  );
}
