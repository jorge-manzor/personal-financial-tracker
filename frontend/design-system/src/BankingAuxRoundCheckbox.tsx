import { useEffect, useRef } from "react";

/** Paleta del estado marcado: `teal` (default histórico), `indigo` (acento de la tarjeta de totales) o `sage` (paleta pastel — Provisiones, Ahorro por objetivo). */
export type BankingAuxRoundCheckboxColor = "teal" | "indigo" | "sage";

const CHECKED_CLASS: Record<BankingAuxRoundCheckboxColor, string> = {
  teal: "border-teal-500 bg-teal-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)] banking-dark:border-amber-600 banking-dark:bg-amber-600/92 banking-dark:shadow-[inset_0_1px_0_0_rgba(254,243,199,0.12)]",
  indigo:
    "border-indigo-800 bg-indigo-800 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35)] banking-dark:border-indigo-500/70 banking-dark:bg-indigo-600/95 banking-dark:shadow-[inset_0_1px_0_0_rgba(224,231,255,0.14)]",
  sage: "border-[#6FA588] bg-[#8FBFA6] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35)]",
};
const UNCHECKED_HOVER_CLASS: Record<BankingAuxRoundCheckboxColor, string> = {
  teal: "border-slate-300 bg-white hover:border-teal-300 hover:bg-teal-50/50 banking-dark:border-zinc-500 banking-dark:bg-zinc-900 banking-dark:hover:border-amber-700/55 banking-dark:hover:bg-amber-950/40",
  indigo:
    "border-slate-300 bg-white hover:border-indigo-300 hover:bg-indigo-50/50 banking-dark:border-zinc-500 banking-dark:bg-zinc-900 banking-dark:hover:border-indigo-700/55 banking-dark:hover:bg-indigo-950/40",
  sage: "border-[#DCD3C2] bg-white hover:border-[#8FBFA6] hover:bg-[#8FBFA6]/10 banking-dark:border-[#30363d] banking-dark:bg-[#0d1117] banking-dark:hover:border-[#8FBFA6]/60 banking-dark:hover:bg-[#8FBFA6]/10",
};
const FOCUS_RING_CLASS: Record<BankingAuxRoundCheckboxColor, string> = {
  teal: "peer-focus-visible:ring-teal-400/40 banking-dark:peer-focus-visible:ring-amber-500/35",
  indigo: "peer-focus-visible:ring-indigo-400/40 banking-dark:peer-focus-visible:ring-indigo-500/35",
  sage: "peer-focus-visible:ring-[#8FBFA6]/40 banking-dark:peer-focus-visible:ring-[#8FBFA6]/35",
};
/** Estado parcial (`indeterminate`, «algunos seleccionados»): también sigue la paleta elegida. */
const PARTIAL_CLASS: Record<BankingAuxRoundCheckboxColor, string> = {
  teal: "border-amber-300 bg-amber-50 shadow-sm banking-dark:border-amber-700/70 banking-dark:bg-amber-950/45 banking-dark:shadow-none",
  indigo:
    "border-indigo-300 bg-indigo-50 shadow-sm banking-dark:border-indigo-700/60 banking-dark:bg-indigo-950/40 banking-dark:shadow-none",
  sage: "border-[#8FBFA6] bg-[#8FBFA6]/15 shadow-sm banking-dark:border-[#8FBFA6]/60 banking-dark:bg-[#8FBFA6]/15 banking-dark:shadow-none",
};
const PARTIAL_DASH_CLASS: Record<BankingAuxRoundCheckboxColor, string> = {
  teal: "bg-amber-100/95 banking-dark:bg-amber-400/80",
  indigo: "bg-indigo-700 banking-dark:bg-indigo-300/85",
  sage: "bg-[#5C7F6C] banking-dark:bg-[#8FBFA6]/85",
};

/** Casilla circular (movimientos bancarios — provisiones, TC, compartidos): borde → marcado con ✓; parcial = guión. */
export function BankingAuxRoundCheckbox({
  checked,
  indeterminate,
  onChange,
  title,
  color = "teal",
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  title?: string;
  /** @default "teal" */
  color?: BankingAuxRoundCheckboxColor;
  "aria-label": string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) el.indeterminate = !!indeterminate;
  }, [indeterminate]);

  const partial = !!indeterminate;

  return (
    <label className="inline-flex cursor-pointer select-none items-center justify-center" title={title}>
      <input
        ref={inputRef}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
      />
      <span
        className={[
          "flex h-[1.125rem] w-[1.125rem] shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color,box-shadow] duration-150",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white banking-dark:peer-focus-visible:ring-offset-zinc-950",
          FOCUS_RING_CLASS[color],
          partial
            ? PARTIAL_CLASS[color]
            : checked
              ? CHECKED_CLASS[color]
              : UNCHECKED_HOVER_CLASS[color],
        ].join(" ")}
        aria-hidden
      >
        {partial ? (
          <span className={`h-0.5 w-2 rounded-full ${PARTIAL_DASH_CLASS[color]}`} />
        ) : checked ? (
          <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path
              d="M3.75 8.25L6.75 11.25L12.25 4.75"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        ) : null}
      </span>
    </label>
  );
}
