import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";

const STORAGE_KEY = "banking-ui-dark";

type BankingThemeContextValue = {
  isDark: boolean;
  toggleDark: () => void;
};

const BankingThemeContext = createContext<BankingThemeContextValue | null>(null);

export function BankingThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, isDark ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [isDark]);

  const toggleDark = useCallback(() => setIsDark((v) => !v), []);

  const value = useMemo(() => ({ isDark, toggleDark }), [isDark, toggleDark]);

  return <BankingThemeContext.Provider value={value}>{children}</BankingThemeContext.Provider>;
}

export function useBankingTheme(): BankingThemeContextValue {
  const ctx = useContext(BankingThemeContext);
  if (!ctx) throw new Error("useBankingTheme debe usarse dentro de BankingThemeProvider");
  return ctx;
}

/** Activa `body.banking-dark` en rutas `/banking/*` para que portales (modales) hereden `banking-dark:*`. */
export function BankingBodyClassSync() {
  const { isDark } = useBankingTheme();
  const { pathname } = useLocation();

  useEffect(() => {
    const onBanking = pathname.startsWith("/banking");
    if (onBanking && isDark) document.body.classList.add("banking-dark");
    else document.body.classList.remove("banking-dark");
    return () => document.body.classList.remove("banking-dark");
  }, [pathname, isDark]);

  return null;
}

function IconSun({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconMoon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Conmuta modo oscuro solo en vistas Banking (persistido en localStorage). */
export function BankingThemeToggle({ className = "" }: { className?: string }) {
  const { isDark, toggleDark } = useBankingTheme();

  return (
    <button
      type="button"
      onClick={toggleDark}
      aria-pressed={isDark}
      title={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${className} ${
        isDark
          ? "border-zinc-600 bg-zinc-900 text-amber-200/90 hover:border-amber-900/60 hover:bg-zinc-800"
          : "border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50"
      }`}
    >
      {isDark ? (
        <>
          <IconSun className="h-4 w-4 shrink-0 text-amber-300/90" />
          Claro
        </>
      ) : (
        <>
          <IconMoon className="h-4 w-4 shrink-0 text-slate-500" />
          Oscuro
        </>
      )}
    </button>
  );
}
