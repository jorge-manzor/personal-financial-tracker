import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

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

function IconTransactions({ className }: { className?: string }) {
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
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
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

function IconBankSettings({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  );
}

function IconPersonalOrder({ className }: { className?: string }) {
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
}: {
  onLogout: () => void;
  investmentsEnabled: boolean;
  bankingEnabled: boolean;
}) {
  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-screen w-16 flex-col items-center overflow-visible border-r border-[#1a1f2e] bg-[#0b0e14] py-4"
      aria-label="Navegación principal"
    >
      <div className="group relative mb-5 flex justify-center">
        <Link
          to="/"
          className="flex h-11 w-11 items-center justify-center rounded-xl transition-opacity hover:opacity-90"
          aria-label="Inicio — Zendo Finance"
        >
          <span className="text-[28px] font-black leading-none tracking-tight text-[#3b82f6]">Z</span>
        </Link>
        <SidebarTooltip label="Inicio" />
      </div>

      <nav className="flex w-full flex-col items-stretch gap-1 overflow-visible" role="navigation">
        {investmentsEnabled && (
          <>
            <SidebarNavLink to="/" end label="Panel">
              <IconDashboard className="shrink-0" />
            </SidebarNavLink>
            <SidebarNavLink to="/transactions" label="Transacciones">
              <IconTransactions className="shrink-0" />
            </SidebarNavLink>
          </>
        )}
        {bankingEnabled && (
          <>
            <SidebarNavLink to="/banking/transactions" label="Movimientos bancarios">
              <IconBanking className="shrink-0" />
            </SidebarNavLink>
            <SidebarNavLink to="/banking/personal-order" label="Orden personal">
              <IconPersonalOrder className="shrink-0" />
            </SidebarNavLink>
            <SidebarNavLink to="/banking/settings" label="Cuentas bancarias">
              <IconBankSettings className="shrink-0" />
            </SidebarNavLink>
          </>
        )}
      </nav>

      <div className="mt-auto flex w-full flex-col items-center gap-1 pt-4">
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
