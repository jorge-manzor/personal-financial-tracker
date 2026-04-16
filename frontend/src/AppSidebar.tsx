import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

function IconDashboard({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconTransactions({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="22"
      height="22"
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
        className="flex h-11 w-full items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#3b82f6]"
      >
        {({ isActive }) => (
          <span
            className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
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

export function AppSidebar() {
  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-screen w-14 flex-col items-center overflow-visible border-r border-[#1a1f2e] bg-[#0b0e14] py-4"
      aria-label="Navegación principal"
    >
      <div className="group relative mb-5 flex justify-center">
        <Link
          to="/"
          className="flex h-10 w-10 items-center justify-center rounded-xl transition-opacity hover:opacity-90"
          aria-label="Inicio — Monitro"
        >
          <span className="text-[26px] font-black leading-none tracking-tight text-[#22d3ee]">M</span>
        </Link>
        <SidebarTooltip label="Inicio" />
      </div>

      <nav className="flex w-full flex-col items-stretch gap-1 overflow-visible" role="navigation">
        <SidebarNavLink to="/" end label="Panel">
          <IconDashboard className="shrink-0" />
        </SidebarNavLink>
        <SidebarNavLink to="/transactions" label="Transacciones">
          <IconTransactions className="shrink-0" />
        </SidebarNavLink>
      </nav>
    </aside>
  );
}
