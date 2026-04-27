import { useEffect, useRef } from "react";

/** Casilla circular (movimientos bancarios — provisiones, TC, compartidos): borde → marcado con ✓; parcial = guión. */
export function BankingAuxRoundCheckbox({
  checked,
  indeterminate,
  onChange,
  title,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  title?: string;
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
          "peer-focus-visible:ring-2 peer-focus-visible:ring-teal-400/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white banking-dark:peer-focus-visible:ring-amber-500/35 banking-dark:peer-focus-visible:ring-offset-zinc-950",
          partial
            ? "border-amber-300 bg-amber-50 shadow-sm banking-dark:border-amber-700/70 banking-dark:bg-amber-950/45 banking-dark:shadow-none"
            : checked
              ? "border-teal-500 bg-teal-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.5)] banking-dark:border-amber-600 banking-dark:bg-amber-600/92 banking-dark:shadow-[inset_0_1px_0_0_rgba(254,243,199,0.12)]"
              : "border-slate-300 bg-white hover:border-teal-300 hover:bg-teal-50/50 banking-dark:border-zinc-500 banking-dark:bg-zinc-900 banking-dark:hover:border-amber-700/55 banking-dark:hover:bg-amber-950/40",
        ].join(" ")}
        aria-hidden
      >
        {partial ? (
          <span className="h-0.5 w-2 rounded-full bg-amber-100/95 banking-dark:bg-amber-400/80" />
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
