import { useState, type FormEvent } from "react";
import { postJson } from "./api";
import { setToken } from "./auth";

type Mode = "login" | "register";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setPassword2("");
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "register") {
      if (password.length < 6) {
        setError("La contraseña debe tener al menos 6 caracteres.");
        return;
      }
      if (password !== password2) {
        setError("Las contraseñas no coinciden.");
        return;
      }
    }
    setLoading(true);
    try {
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const data = await postJson<{ access_token: string }>(path, {
        email: email.trim(),
        password,
      });
      setToken(data.access_token);
      onSuccess();
    } catch (err) {
      if (err instanceof Error && err.message === "401") {
        setError("Credenciales inválidas");
      } else {
        setError(err instanceof Error ? err.message : "Algo salió mal");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0d1117] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[#30363d] bg-[#161b22] p-8 shadow-xl">
        <h1 className="mb-1 text-center text-xl font-semibold text-white">
          <span className="text-[#3b82f6]">Moni</span>
          <span>tro</span>
        </h1>
        <p className="mb-5 text-center text-sm text-[#8b949e]">
          {mode === "login" ? "Inicia sesión para ver tu portafolio" : "Crea tu cuenta para empezar"}
        </p>

        <div className="mb-6 flex rounded-lg border border-[#30363d] bg-[#0d1117] p-0.5">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === "login" ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-[#c9d1d9]"
            }`}
          >
            Iniciar sesión
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
              mode === "register" ? "bg-[#21262d] text-white" : "text-[#8b949e] hover:text-[#c9d1d9]"
            }`}
          >
            Crear cuenta
          </button>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium text-[#8b949e]">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white placeholder-[#484f58] focus:border-[#388bfd] focus:outline-none"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-[#8b949e]">
              Contraseña
              {mode === "register" && (
                <span className="font-normal text-[#6e7681]"> (mín. 6 caracteres)</span>
              )}
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white placeholder-[#484f58] focus:border-[#388bfd] focus:outline-none"
              required
              minLength={mode === "register" ? 6 : undefined}
            />
          </div>
          {mode === "register" && (
            <div>
              <label htmlFor="password2" className="mb-1 block text-xs font-medium text-[#8b949e]">
                Confirmar contraseña
              </label>
              <input
                id="password2"
                type="password"
                autoComplete="new-password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                className="w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-white placeholder-[#484f58] focus:border-[#388bfd] focus:outline-none"
                required
                minLength={6}
              />
            </div>
          )}
          {error && <p className="text-center text-sm text-[#f85149]">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-[#22c55e] py-2.5 text-sm font-medium text-[#0d1117] hover:brightness-110 disabled:opacity-50"
          >
            {loading ? (mode === "login" ? "Entrando…" : "Creando cuenta…") : mode === "login" ? "Entrar" : "Crear cuenta"}
          </button>
        </form>
      </div>
    </div>
  );
}
