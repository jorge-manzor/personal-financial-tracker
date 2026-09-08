/** Extraído de `frontend/src/bankingTxFilters.tsx` — solo el toggle de visibilidad de columnas y la píldora Sí/No/—. */

import { bankingSwitchThumbClass, bankingSwitchTrackClass } from "./shared";

export function BankingTxColumnVisibilityToggle({
  on,
  disabled,
  onToggle,
  ariaLabel,
}: {
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      className={bankingSwitchTrackClass(on)}
    >
      <span className={bankingSwitchThumbClass(on)} />
    </button>
  );
}

/** Píldora Sí / No / — para columnas Compartido liquidado y Cargo TC. */
export function BankingTxSiNoDashBadge({ text }: { text: string }) {
  if (text === "—") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-[#F5F1E8] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[#9A9284] banking-dark:bg-[#161b22] banking-dark:text-[#6b7280]">
        —
      </span>
    );
  }
  if (text === "Sí") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-600 banking-dark:bg-emerald-500/15 banking-dark:text-emerald-300">
        Sí
      </span>
    );
  }
  if (text === "No") {
    return (
      <span className="inline-flex min-w-[2rem] justify-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600 banking-dark:bg-rose-500/15 banking-dark:text-rose-300">
        No
      </span>
    );
  }
  return <span className="text-[12px] text-[#8A8072] banking-dark:text-[#8b949e]">{text}</span>;
}
