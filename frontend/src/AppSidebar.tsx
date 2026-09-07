import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { IconMoon, IconSun, useBankingTheme } from "./BankingThemeContext";

function IconDashboard({ className }: { className?: string }) {
  return (
    <svg className={className} width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconProfile({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function IconBanking({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <path d="M6 15h.01M10 15h4" />
    </svg>
  );
}

function IconProvisions({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <path d="M12 12h.01M12 16h.01M16 12h.01M16 16h.01M9 12h1M9 16h7" />
      <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v0z" />
    </svg>
  );
}

function IconSavingsGoal({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconSavingsCalc({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h5M8 15h8" />
      <path d="M16 7h2M17 6v2" />
    </svg>
  );
}

function IconProjects({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M12 12v5M9.5 14.5h5" />
    </svg>
  );
}

/** Tooltip al hover: el `title` nativo es poco fiable en enlaces con hijos complejos (React Router). */
function SidebarTooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none invisible absolute left-full top-1/2 z-[60] ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-[#30363d] bg-[#161b22] px-2.5 py-1.5 text-xs font-medium text-[#e6edf3] opacity-0 shadow-xl ring-1 ring-black/20 transition-opacity duration-150 group-hover:visible group-hover:opacity-100"
    >
      {label}
    </span>
  );
}

function SidebarNavLink({
  to,
  end,
  label,
  children,
}: {
  to: string;
  end?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="group relative flex w-full justify-center">
      <NavLink
        to={to}
        end={end}
        aria-label={label}
        className="flex h-[52px] w-full items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6]"
      >
        {({ isActive }) => (
          <span
            className={`relative flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
              isActive
                ? "overflow-hidden bg-[#131820] text-[#3b82f6] before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-[3px] before:bg-[#3b82f6]"
                : "text-[#6e7681] hover:bg-[#12161f] hover:text-[#9ca3af]"
            }`}
          >
            {children}
          </span>
        )}
      </NavLink>
      <SidebarTooltip label={label} />
    </div>
  );
}

export function AppSidebar({
  onLogout,
  investmentsEnabled,
  bankingEnabled,
  proyectosEnabled,
}: {
  onLogout: () => void;
  investmentsEnabled: boolean;
  bankingEnabled: boolean;
  proyectosEnabled: boolean;
}) {
  const { isDark, toggleDark } = useBankingTheme();

  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-screen w-16 flex-col items-center overflow-visible border-r border-[#1a1f2e] bg-[#0b0e14] py-4"
      aria-label="Navegación principal"
    >
      <div className="group relative mb-5 flex justify-center">
        <Link
          to="/"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F7F5F1] transition-opacity hover:opacity-90"
          aria-label="Inicio — Zendo Finance"
        >
          <svg viewBox="0 0 100 100" className="h-6 w-6" aria-hidden>
            <path
              d="M70.08,47.01 A27,27 0 1 0 55.41,78.47"
              fill="none"
              stroke="#4B7B63"
              strokeWidth="11"
              strokeLinecap="round"
            />
            <path
              d="M55.41,78.47 C59.64,76.5 60.57,63.25 63,62 C65.43,60.76 67.5,73 70,71 C72.5,69 75.33,56.17 78,50 C80.67,43.83 83.87,38.27 86,34"
              fill="none"
              stroke="#C79A56"
              strokeWidth="8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="86" cy="34" r="8" fill="#C79A56" />
          </svg>
        </Link>
        <SidebarTooltip label="Inicio" />
      </div>

      <nav className="flex w-full flex-col items-stretch gap-1 overflow-visible" role="navigation">
        {bankingEnabled && (
          <>
            <SidebarNavLink to="/banking/transactions" label="Movimientos bancarios">
              <IconBanking className="shrink-0" />
            </SidebarNavLink>
            <SidebarNavLink to="/banking/provisiones" label="Provisiones">
              <IconProvisions className="shrink-0" />
            </SidebarNavLink>
            <SidebarNavLink to="/banking/ahorro-objetivo" label="Ahorro por objetivo">
              <IconSavingsGoal className="shrink-0" />
            </SidebarNavLink>
            <SidebarNavLink to="/banking/savings-calculator" label="Calculadora ahorros">
              <IconSavingsCalc className="shrink-0" />
            </SidebarNavLink>
          </>
        )}
        {bankingEnabled && proyectosEnabled && (
          <div className="my-2 h-px w-8 self-center bg-[#1a1f2e]" aria-hidden />
        )}
        {proyectosEnabled && (
          <SidebarNavLink to="/proyectos" label="Proyectos y presupuestos">
            <IconProjects className="shrink-0" />
          </SidebarNavLink>
        )}
        {(bankingEnabled || proyectosEnabled) && investmentsEnabled && (
          <div className="my-2 h-px w-8 self-center bg-[#1a1f2e]" aria-hidden />
        )}
        {investmentsEnabled && (
          <SidebarNavLink to="/portfolio" label="Panel">
            <IconDashboard className="shrink-0" />
          </SidebarNavLink>
        )}
      </nav>

      <div className="mt-auto flex w-full flex-col items-center gap-1 pt-4">
        {(bankingEnabled || proyectosEnabled || investmentsEnabled) && (
          <div className="group relative flex w-full justify-center">
            <button
              type="button"
              onClick={toggleDark}
              aria-pressed={isDark}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[#6e7681] outline-none hover:bg-[#12161f] hover:text-[#9ca3af] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6]"
              aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            >
              {isDark ? <IconSun className="h-[22px] w-[22px] shrink-0" /> : <IconMoon className="h-[22px] w-[22px] shrink-0" />}
            </button>
            <SidebarTooltip label={isDark ? "Modo claro" : "Modo oscuro"} />
          </div>
        )}
        <SidebarNavLink to="/profile" label="Perfil">
          <IconProfile className="shrink-0" />
        </SidebarNavLink>
        <div className="group relative flex w-full justify-center">
          <button
            type="button"
            onClick={onLogout}
            className="flex h-11 w-11 items-center justify-center rounded-lg text-[#6e7681] outline-none hover:bg-[#12161f] hover:text-[#f85149] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#f85149]"
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
          <SidebarTooltip label="Cerrar sesión" />
        </div>
      </div>
    </aside>
  );
}
