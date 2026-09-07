import { useState } from "react";
import type { FintualGoalCard } from "./types";

interface Props {
  goals: FintualGoalCard[];
  onSelectGoal: (g: FintualGoalCard) => void;
  isDark: boolean;
}

/** Etiqueta tipo “Corto plazo” a partir de RESERVA / LARGO PLAZO / … */
function badgeSentenceCase(label: string): string {
  const s = label.trim();
  if (!s) return "—";
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function InactiveInvestmentsSection({ goals, onSelectGoal, isDark }: Props) {
  const [open, setOpen] = useState(true);
  const n = goals.length;

  if (n === 0) return null;

  const mutedClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const textPrimary = isDark ? "text-white" : "text-[#2B2620]";
  const cardBorder = isDark ? "border-[#30363d]" : "border-[#E8E1D4]";
  const cardBg = isDark ? "bg-[#161b22]" : "bg-white";
  const cardHover = isDark ? "hover:border-[#484f58] hover:bg-[#1c2128]" : "hover:border-[#DCD3C2] hover:bg-[#FBFAF7]";
  const ringOffset = isDark ? "focus-visible:ring-offset-[#0d1117]" : "focus-visible:ring-offset-[#FAF7F1]";

  return (
    <div className="flex w-full min-w-0 flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-2 text-left transition hover:opacity-90"
        aria-expanded={open}
      >
        <svg
          className={`h-4 w-4 shrink-0 ${mutedClass} transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
        <h2 className={`min-w-0 flex-1 text-[13px] font-bold tracking-[0.14em] ${textPrimary}`}>
          <span className="uppercase">Metas vacías</span>{" "}
          <span className={`tabular-nums tracking-normal ${isDark ? "text-[#c9d1d9]" : "text-[#4A453C]"}`}>({n})</span>
        </h2>
      </button>

      {open && (
        <ul className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
          {goals.map((g) => (
            <li key={g.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelectGoal(g)}
                className={`flex h-full min-h-[3.5rem] w-full min-w-0 flex-col items-stretch justify-center gap-1 rounded-xl border ${cardBorder} ${cardBg} px-3 py-2.5 text-left transition ${cardHover} focus:outline-none focus-visible:ring-2 focus-visible:ring-[#a78bfa] focus-visible:ring-offset-2 ${ringOffset} sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-4 sm:py-3`}
              >
                <span className={`min-w-0 truncate text-[13px] font-medium leading-snug ${textPrimary} sm:text-[14px]`}>
                  {g.name}
                </span>
                <span className={`shrink-0 truncate text-[11px] font-medium ${isDark ? "text-[#c9d1d9]" : "text-[#4A453C]"} sm:text-[12px]`}>
                  {badgeSentenceCase(g.badge_label)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
