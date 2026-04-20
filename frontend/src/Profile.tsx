import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { patchJson, postJson } from "./api";
import type { UserMe } from "./types";

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
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:ring-offset-2 focus-visible:ring-offset-[#161b22] disabled:cursor-not-allowed disabled:opacity-50 ${
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

function FintualConnectionBadge({ me }: { me: UserMe }) {
  const hasCookie = !!(me.fintual_session_cookie && me.fintual_session_cookie.length > 0);

  if (me.fintual_reconnect_required) {
    return (
      <span className="inline-flex rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-0.5 text-[11px] font-medium text-[#f85149]">
        Reconexión necesaria
      </span>
    );
  }
  if (!hasCookie || me.fintual_needs_setup) {
    return (
      <span className="inline-flex rounded-full border border-amber-500/35 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-[#d29922]">
        Pendiente de conectar
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-[#3fb950]">
      Sincronizado
    </span>
  );
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

export function Profile({
  me,
  onUpdated,
  onRequestFintualConnect,
}: {
  me: UserMe;
  onUpdated: (next: UserMe) => void;
  /** Abre el modal de credenciales Fintual (p. ej. para rotar la cookie). */
  onRequestFintualConnect?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const [revealFintualSecrets, setRevealFintualSecrets] = useState(false);

  const inv = me.services.investments;
  const bank = me.services.banking;

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
    <div className="mx-auto max-w-[640px] space-y-8 p-4 pb-28 md:p-6">
      <div>
        <h2 className="text-lg font-semibold text-white">Perfil</h2>
        <p className="mt-1 text-sm text-[#8b949e]">Servicios que puedes activar u omitir según lo que uses.</p>
      </div>

      <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-[#6e7681]">Cuenta</p>
        <p className="mt-2 text-sm text-[#e6edf3]">{me.email}</p>
      </div>

      <form
        className="rounded-xl border border-[#30363d] bg-[#161b22] p-5"
        onSubmit={(e) => void onChangePassword(e)}
      >
        <h3 className="text-sm font-semibold text-white">Contraseña</h3>
        <p className="mt-1 text-sm text-[#8b949e]">Cambia tu contraseña de acceso a Monitro.</p>

        <label className="mt-4 block">
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
          className="mt-4 rounded-lg border border-[#30363d] bg-[#21262d] px-4 py-2 text-sm font-medium text-white hover:bg-[#30363d] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pwSaving ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </form>

      <div className="rounded-xl border border-[#30363d] bg-[#161b22] p-5">
        <h3 className="text-sm font-semibold text-white">Servicios</h3>
        <p className="mt-1 text-sm text-[#8b949e]">
          Activa solo lo que uses. El portafolio de inversiones se conecta a Fintual para movimientos y precios.
        </p>

        <div className="mt-5 space-y-4">
          <div className="rounded-xl border border-[#21262d] bg-[#0d1117] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#e6edf3]">Portafolio de inversiones</p>
                <p className="mt-1 text-xs leading-relaxed text-[#8b949e]">
                  Panel, transacciones, sincronización y activos manuales ligados al portafolio.
                </p>
              </div>
              <ServiceToggle
                on={inv}
                disabled={saving}
                ariaLabel="Activar portafolio de inversiones"
                onToggle={() => void setInvestments(!inv)}
              />
            </div>

            {inv && (
              <div className="mt-5 space-y-4 border-t border-[#21262d] pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-[#8b949e]">Estado Fintual</span>
                  <FintualConnectionBadge me={me} />
                </div>

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
                  Por defecto los valores se muestran ocultos. Solo puedes verlos con la sesión iniciada en Monitro.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#21262d] bg-[#0d1117] p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[#e6edf3]">Cuentas y movimientos</p>
                <p className="mt-1 text-xs leading-relaxed text-[#8b949e]">
                  Registra cuentas (efectivo, banco) y movimientos con categorías. Independiente del portafolio Fintual.
                </p>
              </div>
              <ServiceToggle
                on={bank}
                disabled={saving}
                ariaLabel="Activar cuentas y movimientos"
                onToggle={() => void setBanking(!bank)}
              />
            </div>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-[#f85149]">{error}</p>}
      </div>

      <p className="text-center text-xs text-[#6e7681]">
        <Link to="/" className="text-[#58a6ff] hover:underline">
          Volver al inicio
        </Link>
      </p>
    </div>
  );
}
