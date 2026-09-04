import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { postJson } from "./api";
import { setToken } from "./auth";

type Mode = "login" | "register";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const navigate = useNavigate();
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
      if (mode === "register") {
        navigate("/profile#servicios", { replace: true });
      }
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
    <div className="flex min-h-screen bg-[#0d1117]">
      <div
        className="relative hidden w-[54%] flex-col justify-between overflow-hidden border-r border-[#1c232d] p-16 lg:flex"
        style={{ background: "linear-gradient(150deg, #0d1117 0%, #111925 55%, #14201a 100%)" }}
      >
        <svg
          className="pointer-events-none absolute -right-36 -top-32 opacity-10"
          width="420"
          height="420"
          viewBox="0 0 100 100"
          aria-hidden
        >
          <path
            d="M70.08,47.01 A27,27 0 1 0 55.41,78.47"
            fill="none"
            stroke="#8FBFA6"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M55.41,78.47 C59.64,76.5 60.57,63.25 63,62 C65.43,60.76 67.5,73 70,71 C72.5,69 75.33,56.17 78,50 C80.67,43.83 83.87,38.27 86,34"
            fill="none"
            stroke="#C79A56"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="flex flex-1 flex-col justify-center">
          <div className="flex items-center gap-3.5">
            <svg viewBox="0 0 100 100" className="h-12 w-12 shrink-0" aria-hidden>
              <path
                d="M70.08,47.01 A27,27 0 1 0 55.41,78.47"
                fill="none"
                stroke="#8FBFA6"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d="M55.41,78.47 C59.64,76.5 60.57,63.25 63,62 C65.43,60.76 67.5,73 70,71 C72.5,69 75.33,56.17 78,50 C80.67,43.83 83.87,38.27 86,34"
                fill="none"
                stroke="#C79A56"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="86" cy="34" r="7" fill="#C79A56" />
            </svg>
            <div className="flex flex-col leading-none">
              <span className="text-2xl font-semibold tracking-tight text-[#F3F1EC]">
                <span className="text-[#8FBFA6]">Zendo</span> Finance
              </span>
              <span className="mt-1.5 text-xs font-medium tracking-[0.16em] text-[#9AA3AE]">
                PERSONAL FINANCE
              </span>
            </div>
          </div>
          <h2 className="mt-11 max-w-[480px] text-[42px] font-semibold leading-[1.14] tracking-tight text-[#F3F1EC]">
            Tu dinero, en calma.
          </h2>
          <p className="mt-4 max-w-[430px] text-base leading-relaxed text-[#9aa3ae]">
            Controla tus cuentas y movimientos bancarios en pesos chilenos — categorías, presupuestos y
            orden personal, todo en un solo lugar.
          </p>
          <div className="mt-10 flex flex-col gap-4">
            <div className="flex items-center gap-3 text-[14.5px] text-[#c9d1d9]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#C79A56]" />
              Cuentas y movimientos bancarios en CLP
            </div>
            <div className="flex items-center gap-3 text-[14.5px] text-[#c9d1d9]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#C79A56]" />
              Categorías, presupuestos y proyectos personales
            </div>
            <div className="flex items-center gap-3 text-[14.5px] text-[#c9d1d9]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#C79A56]" />
              Multiusuario, con tus datos privados
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <svg width="360" height="46" viewBox="0 0 360 46" aria-hidden>
            <path
              d="M4,36 C40,30 50,10 80,18 C110,26 120,4 150,10 C180,16 195,32 220,24 C250,14 265,2 300,8 C325,12 340,20 356,6"
              fill="none"
              stroke="#C79A56"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-xs text-[#6b7280]">Orden financiero, sin ruido.</span>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3.5 lg:hidden">
            <svg viewBox="0 0 100 100" className="h-11 w-11 shrink-0" aria-hidden>
              <path
                d="M70.08,47.01 A27,27 0 1 0 55.41,78.47"
                fill="none"
                stroke="#8FBFA6"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d="M55.41,78.47 C59.64,76.5 60.57,63.25 63,62 C65.43,60.76 67.5,73 70,71 C72.5,69 75.33,56.17 78,50 C80.67,43.83 83.87,38.27 86,34"
                fill="none"
                stroke="#C79A56"
                strokeWidth="7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="86" cy="34" r="7" fill="#C79A56" />
            </svg>
            <div className="flex flex-col leading-none">
              <span className="text-xl font-semibold tracking-tight text-white">
                <span className="text-[#8FBFA6]">Zendo</span> Finance
              </span>
              <span className="mt-1.5 text-xs font-medium tracking-[0.16em] text-[#9AA3AE]">
                PERSONAL FINANCE
              </span>
            </div>
          </div>

          <h1 className="mb-1 text-xl font-semibold text-white">
            {mode === "login" ? "Bienvenido de vuelta" : "Crea tu cuenta"}
          </h1>
          <p className="mb-6 text-sm text-[#8b949e]">
            {mode === "login" ? "Inicia sesión para continuar" : "Empieza a ordenar tus movimientos"}
          </p>

          <div className="mb-6 flex rounded-lg border border-[#30363d] bg-[#161b22] p-0.5">
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
                className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-white placeholder-[#484f58] focus:border-[#388bfd] focus:outline-none"
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
                className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-white placeholder-[#484f58] focus:border-[#388bfd] focus:outline-none"
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
                  className="w-full rounded-lg border border-[#30363d] bg-[#161b22] px-3 py-2 text-sm text-white placeholder-[#484f58] focus:border-[#388bfd] focus:outline-none"
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
    </div>
  );
}
