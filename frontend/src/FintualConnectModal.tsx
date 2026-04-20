import { type FormEvent, useState } from "react";
import { patchJson } from "./api";
import { normalizeUserMe, type UserMe } from "./types";

export function FintualConnectModal({
  onConnected,
  onDismiss,
  allowDismiss = false,
  reconnectMode = false,
}: {
  onConnected: (me: UserMe) => void;
  /** Cerrar sin guardar (solo si `allowDismiss`). */
  onDismiss?: () => void;
  /** Si es true, se puede cerrar el modal sin conectar (p. ej. abierto desde Perfil). */
  allowDismiss?: boolean;
  /** True si la cookie anterior dejó de ser válida (sync falló). */
  reconnectMode?: boolean;
}) {
  const [sessionCookie, setSessionCookie] = useState("");
  const [uid, setUid] = useState("");
  const [instructionsOpen, setInstructionsOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const s = sessionCookie.trim();
    if (!s) {
      setError("Copia el valor de la cookie de sesión.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const u = await patchJson<{
        id: number;
        email: string;
        services: Record<string, boolean>;
        fintual_needs_setup: boolean;
        fintual_session_cookie?: string | null;
        fintual_uid?: string | null;
      }>("/auth/me/fintual", {
        session_cookie: s,
        uid: uid.trim() || null,
      });
      onConnected(normalizeUserMe(u));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fintual-modal-title"
      onClick={() => {
        if (allowDismiss) onDismiss?.();
      }}
    >
      <div
        className="max-h-[min(90vh,720px)] w-full max-w-md overflow-y-auto rounded-2xl border border-[#30363d] bg-[#161b22] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={(e) => void onSubmit(e)} className="p-6">
          {allowDismiss && (
            <div className="mb-2 flex justify-end">
              <button
                type="button"
                onClick={() => onDismiss?.()}
                className="rounded-lg px-2 py-1 text-sm text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
              >
                Cerrar
              </button>
            </div>
          )}
          <h2 id="fintual-modal-title" className="text-lg font-semibold text-white">
            {reconnectMode ? "Reconectar Fintual" : "Conectar Fintual"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[#8b949e]">
            {reconnectMode
              ? "Tu sesión con Fintual expiró o dejó de ser válida (suele ocurrir cada ~30 días). Pega de nuevo la cookie y el uid desde fintual.cl."
              : "Conecta tu cuenta de Fintual para ver todas tus inversiones."}
          </p>

          <label className="mt-6 block">
            <span className="text-xs font-medium text-[#8b949e]">Cookie de sesión</span>
            <input
              type="password"
              autoComplete="off"
              name="fintual_session_cookie"
              placeholder="_fintual_session_cookie"
              value={sessionCookie}
              onChange={(e) => setSessionCookie(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2.5 font-mono text-sm text-[#e6edf3] placeholder:text-[#484f58] outline-none focus:border-[#58a6ff]"
              disabled={saving}
            />
          </label>

          <label className="mt-4 block">
            <span className="text-xs font-medium text-[#8b949e]">UID (opcional)</span>
            <input
              type="text"
              autoComplete="off"
              name="fintual_uid"
              placeholder="uid"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2.5 font-mono text-sm text-[#e6edf3] placeholder:text-[#484f58] outline-none focus:border-[#58a6ff]"
              disabled={saving}
            />
          </label>

          {error && <p className="mt-3 text-sm text-[#f85149]">{error}</p>}

          <button
            type="submit"
            disabled={saving || !sessionCookie.trim()}
            className="mt-6 w-full rounded-xl bg-[#2563eb] py-3 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Conectando…" : "Conectar"}
          </button>
        </form>

        <div className="border-t border-[#30363d] px-6 pb-6">
          <button
            type="button"
            onClick={() => setInstructionsOpen((o) => !o)}
            className="flex w-full items-center justify-between py-3 text-left text-sm font-medium text-[#58a6ff] hover:text-[#79b8ff]"
          >
            {instructionsOpen ? "Ocultar instrucciones" : "Mostrar instrucciones"}
            <span className="text-lg" aria-hidden>
              {instructionsOpen ? "▲" : "▼"}
            </span>
          </button>

          {instructionsOpen && (
            <div className="rounded-xl border border-[#21262d] bg-[#0d1117] p-4 text-sm text-[#c9d1d9]">
              <ol className="list-decimal space-y-2 pl-5">
                <li>Inicia sesión en fintual.cl</li>
                <li>
                  Abre las herramientas de desarrollador con <kbd className="rounded bg-[#21262d] px-1.5 py-0.5 font-mono text-xs">F12</kbd> o{" "}
                  <kbd className="rounded bg-[#21262d] px-1.5 py-0.5 font-mono text-xs">Cmd+Opt+I</kbd> (Mac).
                </li>
                <li>
                  Ve a la pestaña <strong className="text-[#e6edf3]">Application</strong> →{" "}
                  <strong className="text-[#e6edf3]">Cookies</strong> →{" "}
                  <strong className="text-[#e6edf3]">https://fintual.cl</strong>
                </li>
                <li>
                  Busca y copia el valor de:
                  <div className="mt-2 space-y-2 font-mono text-xs text-[#8b949e]">
                    <div className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5">
                      <span className="text-[#79c0ff]">_fintual_session_cookie</span>
                      <span className="text-[#6e7681]"> → Cookie de sesión</span>
                    </div>
                    <div className="rounded border border-[#30363d] bg-[#161b22] px-2 py-1.5">
                      <span className="text-[#79c0ff]">uid</span>
                      <span className="text-[#6e7681]"> → UID (opcional)</span>
                    </div>
                  </div>
                </li>
              </ol>
              <p className="mt-4 text-xs leading-relaxed text-[#6e7681]">
                Las credenciales se guardan en tu cuenta de Monitro y solo se usan en el servidor para consultar Fintual.
                Renueva la cookie en Fintual cuando caduque (suele ser alrededor de 30 días).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
