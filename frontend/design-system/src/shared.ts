/**
 * Shared Tailwind class-string constants, copied from `frontend/src/bankingTxShared.ts` (only the
 * subset used by components in this package).
 */

export const bankingModalCategoryTriggerClass =
  "flex w-full items-center justify-between gap-2 overflow-hidden rounded-xl border border-[#DCD3C2] bg-white py-2 pl-3 pr-3 text-left text-sm outline-none shadow-sm transition hover:border-[#8FBFA6] focus:border-[#8FBFA6] focus:ring-2 focus:ring-[#8FBFA6]/25 disabled:cursor-not-allowed disabled:opacity-40 [color-scheme:light] banking-dark:border-[#30363d] banking-dark:bg-[#0d1117] banking-dark:text-[#F3F1EC] banking-dark:hover:border-[#8FBFA6]/60 banking-dark:focus:border-[#8FBFA6] banking-dark:focus:ring-[#8FBFA6]/25";

/** Lista del panel (el padre debe llevar `.banking-theme` para scrollbar claro en portales). */
export const bankingPickerListScrollClass =
  "tx-scroll max-h-[min(55vh,22rem)] min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-py-1 [-webkit-overflow-scrolling:touch]";

/** Fondo del track del switch — verde si `on`, hueso/gris si no. */
export function bankingSwitchTrackClass(on: boolean): string {
  return `relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8FBFA6]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 banking-dark:focus-visible:ring-[#8FBFA6]/40 banking-dark:focus-visible:ring-offset-[#0d1117] ${
    on ? "bg-[#8FBFA6]" : "bg-[#EDE7D9] banking-dark:bg-[#21262d]"
  }`;
}

/** Thumb del toggle: círculo blanco con sombra que se desliza según el estado `on`. */
export function bankingSwitchThumbClass(on: boolean): string {
  return `pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-1 ring-slate-900/5 transition-transform banking-dark:ring-white/10 ${
    on ? "translate-x-[22px]" : "translate-x-0.5"
  }`;
}

const BANKING_PRODUCT_BADGE_LABEL: Record<string, string> = {
  cuenta_corriente: "Cuenta corriente",
  cuenta_vista: "Cuenta vista",
  cuenta_prepago: "Cuenta prepago",
  tarjeta_credito: "Tarjeta de crédito",
};

export function bankingProductBadgeLabel(t: string | null): string {
  if (t != null && BANKING_PRODUCT_BADGE_LABEL[t]) return BANKING_PRODUCT_BADGE_LABEL[t];
  return "Cuenta";
}

const BANKING_BALANCE_MASK_STAR_COUNT = 4;

/**
 * Monto tapado por privacidad. Original en `bankingTxHelpers.ts` recibe el texto formateado pero
 * ignora su contenido (siempre imprime el mismo número de asteriscos) — se conserva el mismo
 * comportamiento aquí.
 */
export function maskBankingBalanceText(_formatted?: string): string {
  void _formatted;
  return `$${"*".repeat(BANKING_BALANCE_MASK_STAR_COUNT)}`;
}
