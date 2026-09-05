import { type FormEvent, lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { patchJson, postJson } from "./api";
import type { UserMe } from "./types";

/** Carga diferida: solo pesa el bundle cuando alguien realmente abre esta pestaña. */
const BankingSettingsSection = lazy(() =>
  import("./BankingSettingsPage").then((m) => ({ default: m.BankingSettingsSection })),
);

type Tab = "cuenta" | "seguridad" | "servicios" | "banking";

function IconEye({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function IconUserCircle({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

function IconShield({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function IconGrid({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconChartUp({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C79A56" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3,17 9,11 13,15 21,5" />
      <circle cx="21" cy="5" r="1.6" fill="#C79A56" stroke="none" />
    </svg>
  );
}

function IconBank({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8FBFA6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 10 L12 4 L21 10 M4 10 V19 M20 10 V19 M8 10 V19 M16 10 V19 M2 19 H22" />
    </svg>
  );
}

function IconFlag({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 3 V21 M5 4 H17 L14 8 L17 12 H5" />
    </svg>
  );
}

function maskWithAsterisks(value: string): string {
  if (!value) return "—";
  const n = Math.min(value.length, 96);
  return "*".repeat(n) + (value.length > 96 ? "…" : "");
}

function ServiceToggle({
  on,
  disabled,
  onToggle,
  ariaLabel,
}: {
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#12161d] disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "border-[#166534] bg-[#22c55e]/90" : "border-[#30363d] bg-[#21262d]"
      }`}
    >
      <span
        className={`pointer-events-none absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function StatusPill({ tone, children }: { tone: "green" | "amber" | "red"; children: React.ReactNode }) {
  const styles =
    tone === "green"
      ? "bg-[#3fb950]/12 text-[#3fb950]"
      : tone === "amber"
        ? "bg-[#d29922]/12 text-[#d29922]"
        : "bg-[#f85149]/12 text-[#f85149]";
  return (
    <span className={`mt-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ${styles}`}>
      {children}
    </span>
  );
}

function FintualStatusPill({ me }: { me: UserMe }) {
  if (me.fintual_reconnect_required) return <StatusPill tone="red">Reconexión necesaria</StatusPill>;
  const hasCookie = !!(me.fintual_session_cookie && me.fintual_session_cookie.length > 0);
  if (!hasCookie || me.fintual_needs_setup) return <StatusPill tone="amber">Pendiente de conectar</StatusPill>;
  return <StatusPill tone="green">Sincronizado</StatusPill>;
}

function FintualCredentialsBlock({
  me,
  reveal,
  onToggleReveal,
}: {
  me: UserMe;
  reveal: boolean;
  onToggleReveal: () => void;
}) {
  const cookie = me.fintual_session_cookie ?? "";
  const uid = me.fintual_uid ?? "";

  const showCookie = !cookie ? "—" : reveal ? cookie : maskWithAsterisks(cookie);
  const showUid = !uid ? "—" : reveal ? uid : maskWithAsterisks(uid);

  const hasAny = cookie.length > 0 || uid.length > 0;

  return (
    <div className="relative rounded-lg border border-[#21262d] bg-[#0d1117] p-3 pr-12">
      <button
        type="button"
        onClick={onToggleReveal}
        className="absolute right-2 top-2 rounded-md p-1.5 text-[#8b949e] outline-none hover:bg-[#21262d] hover:text-[#e6edf3] focus-visible:ring-2 focus-visible:ring-[#58a6ff]"
        aria-pressed={reveal}
        aria-label={reveal ? "Ocultar credenciales" : "Mostrar credenciales"}
        title={reveal ? "Ocultar" : "Mostrar"}
      >
        {reveal ? <IconEyeOff className="h-5 w-5" /> : <IconEye className="h-5 w-5" />}
      </button>

      <div className="space-y-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#6e7681]">Cookie _fintual_session_cookie</p>
          <p className="mt-1 break-all font-mono text-xs leading-relaxed text-[#e6edf3]">{showCookie}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#6e7681]">UID</p>
          <p className="mt-1 break-all font-mono text-xs leading-relaxed text-[#e6edf3]">{showUid}</p>
        </div>
      </div>

      {!hasAny && (
        <p className="mt-2 text-xs text-[#8b949e]">Aún no hay credenciales guardadas. Conecta Fintual cuando la app te lo indique o con el botón de abajo.</p>
      )}
    </div>
  );
}

const NAV_ITEMS: { id: Tab; label: string; icon: (p: { className?: string }) => React.ReactElement }[] = [
  { id: "cuenta", label: "Cuenta", icon: IconUserCircle },
  { id: "seguridad", label: "Seguridad", icon: IconShield },
  { id: "servicios", label: "Servicios", icon: IconGrid },
];

export function Profile({
  me,
  onUpdated,
  onRequestFintualConnect,
  onToast,
}: {
  me: UserMe;
  onUpdated: (next: UserMe) => void;
  /** Abre el modal de credenciales Fintual (p. ej. para rotar la cookie). */
  onRequestFintualConnect?: () => void;
  /** Toasts de la sección Banking embebida (ver BankingSettingsSection). */
  onToast: (msg: string | null) => void;
}) {
  const [tab, setTab] = useState<Tab>("cuenta");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const [revealFintualSecrets, setRevealFintualSecrets] = useState(false);

  useEffect(() => {
    if (window.location.hash === "#servicios") setTab("servicios");
    else if (window.location.hash === "#banking") setTab("banking");
  }, []);

  const inv = me.services.investments;
  const bank = me.services.banking;
  const proy = me.services.proyectos;
  const initial = me.email.trim().charAt(0).toUpperCase() || "?";

  const navItems = bank ? [...NAV_ITEMS, { id: "banking" as const, label: "Banking", icon: IconBank }] : NAV_ITEMS;

  async function setInvestments(next: boolean) {
    if (next === inv) return;
    setSaving(true);
    setError(null);
    try {
      const u = await patchJson<UserMe>("/auth/me", { investments: next });
      onUpdated(u);
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function setBanking(next: boolean) {
    if (next === bank) return;
    setSaving(true);
    setError(null);
    try {
      const u = await patchJson<UserMe>("/auth/me", { banking: next });
      onUpdated(u);
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function setProyectos(next: boolean) {
    if (next === proy) return;
    setSaving(true);
    setError(null);
    try {
      const u = await patchJson<UserMe>("/auth/me", { proyectos: next });
      onUpdated(u);
    } catch {
      setError("No se pudo guardar. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwOk(false);
    if (newPw.length < 6) {
      setPwError("La nueva contraseña debe tener al menos 6 caracteres.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("La confirmación no coincide con la nueva contraseña.");
      return;
    }
    setPwSaving(true);
    try {
      await postJson<{ status: string }>("/auth/change-password", {
        current_password: currentPw,
        new_password: newPw,
      });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setPwOk(true);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "No se pudo cambiar la contraseña.");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[940px] gap-10 p-4 pb-28 md:p-6">
      <nav className="w-[190px] shrink-0">
        <h2 className="mb-5 text-xl font-semibold tracking-tight text-white">Perfil</h2>
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
              tab === id ? "bg-[#8FBFA6]/10 text-[#8FBFA6]" : "text-[#8b949e] hover:text-[#c9d1d9]"
            }`}
          >
            <Icon className="shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1">
        {tab === "cuenta" && (
          <div>
            <div className="mb-5">
              <h3 className="text-base font-semibold text-white">Cuenta</h3>
              <p className="mt-1 text-[13px] text-[#8b949e]">Tu identidad en Zendo Finance.</p>
            </div>
            <div className="flex items-center gap-4 rounded-2xl border border-[#21262d] bg-[#12161d] p-6">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-semibold text-[#0d1117]"
                style={{ background: "linear-gradient(135deg, #8FBFA6, #C79A56)" }}
                aria-hidden
              >
                {initial}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-[#F3F1EC]">{me.email}</p>
                <p className="mt-0.5 text-xs text-[#6b7280]">Cuenta Zendo Finance</p>
              </div>
            </div>
          </div>
        )}

        {tab === "seguridad" && (
          <div>
            <div className="mb-5">
              <h3 className="text-base font-semibold text-white">Seguridad</h3>
              <p className="mt-1 text-[13px] text-[#8b949e]">Cambia tu contraseña de acceso a Zendo Finance.</p>
            </div>
            <form
              className="rounded-2xl border border-[#21262d] bg-[#12161d] p-6"
              onSubmit={(e) => void onChangePassword(e)}
            >
              <label className="block">
                <span className="text-xs text-[#8b949e]">Contraseña actual</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPw}
                  onChange={(e) => {
                    setCurrentPw(e.target.value);
                    setPwOk(false);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white outline-none focus:border-[#58a6ff]"
                  disabled={pwSaving}
                />
              </label>
              <label className="mt-3 block">
                <span className="text-xs text-[#8b949e]">Nueva contraseña (mín. 6 caracteres)</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => {
                    setNewPw(e.target.value);
                    setPwOk(false);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white outline-none focus:border-[#58a6ff]"
                  disabled={pwSaving}
                />
              </label>
              <label className="mt-3 block">
                <span className="text-xs text-[#8b949e]">Confirmar nueva contraseña</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPw}
                  onChange={(e) => {
                    setConfirmPw(e.target.value);
                    setPwOk(false);
                  }}
                  className="mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white outline-none focus:border-[#58a6ff]"
                  disabled={pwSaving}
                />
              </label>

              {pwError && <p className="mt-3 text-sm text-[#f85149]">{pwError}</p>}
              {pwOk && <p className="mt-3 text-sm text-[#3fb950]">Contraseña actualizada correctamente.</p>}

              <button
                type="submit"
                disabled={pwSaving || !currentPw || !newPw || !confirmPw}
                className="mt-4 rounded-lg border border-[#333a47] bg-[#262c37] px-4 py-2 text-sm font-medium text-white hover:bg-[#30363d] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pwSaving ? "Guardando…" : "Cambiar contraseña"}
              </button>
            </form>
          </div>
        )}

        {tab === "servicios" && (
          <div>
            <div className="mb-5">
              <h3 className="text-base font-semibold text-white">Servicios</h3>
              <p className="mt-1 text-[13px] text-[#8b949e]">Activa solo lo que uses.</p>
            </div>

            <div className="space-y-3.5">
              <div className="rounded-2xl border border-[#1e242e] bg-[#12161d] p-5">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-[#8FBFA6]/14">
                    <IconBank />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#F3F1EC]">Cuentas y movimientos</p>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-[#8b949e]">
                      Registra cuentas (efectivo, banco) y movimientos con categorías, en pesos chilenos.
                      Independiente del portafolio Fintual.
                    </p>
                    <StatusPill tone={bank ? "green" : "amber"}>{bank ? "Activo" : "Inactivo"}</StatusPill>
                  </div>
                  <ServiceToggle
                    on={bank}
                    disabled={saving}
                    ariaLabel="Activar cuentas y movimientos"
                    onToggle={() => void setBanking(!bank)}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-[#1e242e] bg-[#12161d] p-5">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-[#2dd4bf]/14">
                    <IconFlag />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#F3F1EC]">Proyectos y presupuestos</p>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-[#8b949e]">
                      Organiza proyectos (matrimonio, muebles, etc.) con aportes, ítems y abonos. Independiente
                      del portafolio y de cuentas bancarias.
                    </p>
                    <StatusPill tone={proy ? "green" : "amber"}>{proy ? "Activo" : "Inactivo"}</StatusPill>
                  </div>
                  <ServiceToggle
                    on={proy}
                    disabled={saving}
                    ariaLabel="Activar proyectos y presupuestos"
                    onToggle={() => void setProyectos(!proy)}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-[#1e242e] bg-[#12161d] p-5">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-[#C79A56]/14">
                    <IconChartUp />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#F3F1EC]">Portafolio de inversiones</p>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-[#8b949e]">
                      Panel, transacciones, sincronización y activos manuales ligados al portafolio Fintual.
                    </p>
                    {inv && <FintualStatusPill me={me} />}
                  </div>
                  <ServiceToggle
                    on={inv}
                    disabled={saving}
                    ariaLabel="Activar portafolio de inversiones"
                    onToggle={() => void setInvestments(!inv)}
                  />
                </div>

                {inv && (
                  <div className="mt-5 space-y-4 border-t border-[#1e242e] pt-5">
                    <FintualCredentialsBlock
                      me={me}
                      reveal={revealFintualSecrets}
                      onToggleReveal={() => setRevealFintualSecrets((v) => !v)}
                    />

                    {onRequestFintualConnect && (
                      <button
                        type="button"
                        onClick={onRequestFintualConnect}
                        className="w-full rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2.5 text-sm font-medium text-[#e6edf3] transition-colors hover:border-[#58a6ff] hover:bg-[#262c36]"
                      >
                        Actualizar cookie / UID de Fintual
                      </button>
                    )}

                    <p className="text-xs leading-relaxed text-[#6e7681]">
                      Por defecto los valores se muestran ocultos. Solo puedes verlos con la sesión iniciada en Zendo Finance.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-[#f85149]">{error}</p>}
          </div>
        )}

        {tab === "banking" && bank && (
          <div>
            <div className="mb-5">
              <h3 className="text-base font-semibold text-white">Banking</h3>
              <p className="mt-1 text-[13px] text-[#8b949e]">Productos y categorías de cuentas y movimientos.</p>
            </div>
            <Suspense fallback={<p className="text-sm text-[#8b949e]">Cargando…</p>}>
              <BankingSettingsSection onToast={onToast} />
            </Suspense>
          </div>
        )}

        <p className="mt-10 text-xs text-[#6e7681]">
          <Link to="/" className="text-[#8FBFA6] hover:underline">
            ← Volver al inicio
          </Link>
        </p>
      </div>
    </div>
  );
}
