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

/**
 * Activa `body.banking-dark` en rutas `/banking/*`, `/profile` y el Panel de inversiones
 * (`/`, `/portfolio`) — todas usan clases `banking-dark:*` o CSS de scrollbar condicionado a esa
 * clase (ver `.tx-scroll` / `.filter-pills-scroll` en index.css) para que portales (modales, menús)
 * hereden el tema correcto.
 */
export function BankingBodyClassSync() {
  const { isDark } = useBankingTheme();
  const { pathname } = useLocation();

  useEffect(() => {
    const onBanking =
      pathname.startsWith("/banking") ||
      pathname === "/profile" ||
      pathname === "/" ||
      pathname === "/portfolio";
    if (onBanking && isDark) document.body.classList.add("banking-dark");
    else document.body.classList.remove("banking-dark");
    return () => document.body.classList.remove("banking-dark");
  }, [pathname, isDark]);

  return null;
}

export function IconSun({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

export function IconMoon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
