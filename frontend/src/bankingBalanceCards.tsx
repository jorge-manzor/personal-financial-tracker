/** Tarjetas de saldo y controles de privacidad (extraídos de BankingTransactionsPage). */

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatClpDots } from "./format";
import { maskBankingBalanceText } from "./bankingTxHelpers";
import type { BankingAccountRow } from "./types";
import { bankingAccountAtBank, bankingProductBadgeLabel } from "./bankingTxShared";
import { IconEyeOutline, IconEyeSlashOutline } from "./bankingTxIcons";

export const BANKING_BALANCE_SCOPE_HELP =
  "Al estar activo, los saldos incluyen los meses contables futuros. Si está desactivado, los saldos contemplan hasta el mes contable actual.";

/**
 * Ayuda del interruptor «Actual» — el portal a `body` con `position: fixed` y z-index alto evita
 * recortes por `overflow` de la tarjeta o que el fondo de la página quede encima.
 */
export function BankingBalanceScopeHelpButton() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 300 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updatePos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 20);
    const left = Math.max(10, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 10));
    setPos({ top: r.bottom + 8, left, width: w });
  }, []);

  const show = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    updatePos();
    setOpen(true);
  }, [updatePos]);

  const hideAfterDelay = useCallback(() => {
    leaveTimerRef.current = setTimeout(() => setOpen(false), 180);
  }, []);

  const cancelHide = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onMove = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      const w = Math.min(320, window.innerWidth - 20);
      const left = Math.max(10, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 10));
      setPos((p) => ({ ...p, top: r.bottom + 8, left, width: w }));
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hideAfterDelay}
        onFocus={show}
        onBlur={hideAfterDelay}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-400/45 banking-dark:text-zinc-500 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-300 banking-dark:focus:ring-amber-500/35"
        aria-label="Qué hace la opción Actual (saldos de las tarjetas)"
        aria-describedby={open ? "banking-actual-saldos-help" : undefined}
      >
        <span className="text-[10px] font-bold leading-none" aria-hidden>
          ?
        </span>
      </button>
      {open
        ? createPortal(
            <div
              id="banking-actual-saldos-help"
              role="tooltip"
              onMouseEnter={cancelHide}
              onMouseLeave={() => setOpen(false)}
              className="pointer-events-auto fixed z-[99999] rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-[11px] font-normal leading-snug text-slate-700 shadow-2xl banking-dark:border-zinc-600 banking-dark:bg-zinc-800 banking-dark:text-zinc-200"
              style={{ top: pos.top, left: pos.left, width: pos.width, maxWidth: "calc(100vw - 20px)" }}
            >
              {BANKING_BALANCE_SCOPE_HELP}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export const bankingBalancePrivacyEyeTitleIconClass = "h-4 w-4 shrink-0";

export const bankingBalancePrivacyEyeBtnClass =
  "inline-flex shrink-0 items-center justify-center self-start rounded p-0 pt-px text-slate-600 ring-offset-2 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/45 active:opacity-85 banking-dark:text-zinc-400 banking-dark:hover:text-amber-200 banking-dark:focus-visible:ring-amber-500/35 banking-dark:ring-offset-zinc-950";

export function BankingBalancePrivacyEye({
  strictMode,
  amountsVisible,
  onPeekStart,
  onPeekEnd,
  onToggleSelfHidden,
  iconClassName = bankingBalancePrivacyEyeTitleIconClass,
}: {
  strictMode: boolean;
  amountsVisible: boolean;
  onPeekStart: () => void;
  onPeekEnd: () => void;
  onToggleSelfHidden: () => void;
  iconClassName?: string;
}) {
  return (
    <button
      type="button"
      className={`${bankingBalancePrivacyEyeBtnClass} ${strictMode ? "touch-none" : ""}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (!strictMode) return;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        onPeekStart();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (!strictMode) return;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        onPeekEnd();
      }}
      onPointerCancel={(e) => {
        e.stopPropagation();
        if (strictMode) onPeekEnd();
      }}
      onPointerLeave={(e) => {
        e.stopPropagation();
        if (strictMode) onPeekEnd();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!strictMode) onToggleSelfHidden();
      }}
      title={
        strictMode
          ? "Mantén pulsado para ver los montos de esta tarjeta"
          : amountsVisible
            ? "Ocultar montos en esta tarjeta"
            : "Mostrar montos en esta tarjeta"
      }
      aria-label={
        strictMode
          ? "Mantén pulsado para ver temporalmente los montos de esta tarjeta"
          : amountsVisible
            ? "Ocultar montos en esta tarjeta"
            : "Mostrar montos en esta tarjeta"
      }
      aria-pressed={strictMode ? undefined : !amountsVisible}
    >
      {amountsVisible ? (
        <IconEyeOutline className={iconClassName} />
      ) : (
        <IconEyeSlashOutline className={iconClassName} />
      )}
    </button>
  );
}

export function BankingBalanceMaskedAmount({
  text,
  visible,
  className,
  title: titleAttr,
}: {
  text: string;
  visible: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span className={className} title={titleAttr}>
      {visible ? text : maskBankingBalanceText(text)}
    </span>
  );
}

/** Tarjeta de saldo (estilo alineado con Fondos en inversiones). */
export function BankingAccountBalanceCard({
  account: a,
  creditCardUnpaidAllocatedClp = 0,
  privacyKey,
  strictPrivacy,
  amountsVisible,
  onPeekStart,
  onPeekEnd,
  onToggleCardHidden,
}: {
  account: BankingAccountRow;
  /** Solo cuentas líquidas con TC asociadas: cargos TC no pagados enlazados a esta cuenta corriente. */
  creditCardUnpaidAllocatedClp?: number;
  privacyKey: string;
  strictPrivacy: boolean;
  amountsVisible: boolean;
  onPeekStart: (key: string) => void;
  onPeekEnd: () => void;
  onToggleCardHidden: (key: string) => void;
}) {
  const liquid = a.product_type !== "tarjeta_credito";
  const unpaidCut = liquid ? Math.max(0, creditCardUnpaidAllocatedClp) : 0;
  const saldoReal = liquid ? a.balance - unpaidCut : a.balance;

  const inactive = Math.abs(a.balance) < 1e-9;
  const prov = a.provision_net_sum ?? 0;
  const atBank =
    a.balance_at_bank !== undefined ? a.balance_at_bank : a.balance - prov;

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col rounded-2xl border border-slate-300/95 bg-gradient-to-br from-slate-50/95 via-white to-sky-50/35 p-3.5 shadow-[0_6px_24px_-10px_rgba(15,23,42,0.07)] ring-1 ring-slate-300/50 banking-dark:border-zinc-600 banking-dark:bg-gradient-to-br banking-dark:from-zinc-950 banking-dark:via-zinc-900 banking-dark:to-zinc-950 banking-dark:shadow-[0_8px_32px_-14px_rgba(0,0,0,0.65)] banking-dark:ring-amber-900/35 ${
        inactive ? "opacity-[0.88]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-200/95 ring-1 ring-slate-300/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] banking-dark:bg-zinc-800 banking-dark:ring-zinc-500/80 banking-dark:shadow-none"
          aria-hidden
        >
          <svg className="h-4 w-4 text-slate-700 banking-dark:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 10h18M5 10V8a2 2 0 012-2h10a2 2 0 012 2v2M5 10v10h14V10M9 14h6"
            />
          </svg>
        </div>
        <span className="max-w-[58%] shrink-0 truncate rounded-full bg-slate-200/95 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide leading-none text-slate-700 ring-1 ring-slate-300/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] banking-dark:bg-zinc-800 banking-dark:text-amber-300 banking-dark:ring-amber-800/45">
          {bankingProductBadgeLabel(a.product_type)}
        </span>
      </div>

      <div className="mt-2 flex min-h-[2rem] items-start gap-2">
        <p className="min-w-0 flex-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-700 banking-dark:text-zinc-100">{a.name}</p>
        <BankingBalancePrivacyEye
          strictMode={strictPrivacy}
          amountsVisible={amountsVisible}
          onPeekStart={() => onPeekStart(privacyKey)}
          onPeekEnd={onPeekEnd}
          onToggleSelfHidden={() => onToggleCardHidden(privacyKey)}
        />
      </div>

      <BankingBalanceMaskedAmount
        text={formatClpDots(saldoReal)}
        visible={amountsVisible}
        className="mt-1.5 block text-lg font-semibold tabular-nums tracking-tight text-slate-800 banking-dark:text-zinc-50"
        title={
          liquid
            ? `Saldo real (libro): incluye provisiones en el saldo libro; menos cargos en TC no pagados asociados a esta cuenta (${formatClpDots(unpaidCut)}).`
            : "Saldo libro en la cuenta tarjeta (egresos no pagados siguen pendientes hasta marcarlos o pagar)."
        }
      />
      <div className="mt-1 border-t border-slate-300 pt-1 banking-dark:border-zinc-600/90">
        <div
          className={`grid gap-x-2 gap-y-0 leading-none ${unpaidCut > 0 ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500 banking-dark:text-zinc-400">Saldo actual</p>
            <BankingBalanceMaskedAmount
              text={formatClpDots(atBank)}
              visible={amountsVisible}
              className="mt-0.5 block truncate text-[12px] font-semibold tabular-nums leading-tight text-slate-600 banking-dark:text-zinc-100"
              title="Efectivo en cuenta (libro menos neto de Provisiones)."
            />
          </div>
          {unpaidCut > 0 ? (
            <div className="min-w-0 text-right">
              <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500 banking-dark:text-zinc-400">Deuda TC</p>
              <BankingBalanceMaskedAmount
                text={formatClpDots(unpaidCut)}
                visible={amountsVisible}
                className="mt-0.5 block truncate text-[12px] font-semibold tabular-nums leading-tight text-rose-700/90 banking-dark:text-rose-400"
                title="Cargos en tarjeta(s) asociada(s) a esta cuenta marcados como no pagados."
              />
            </div>
          ) : null}
          <div className="min-w-0 text-right">
            <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500 banking-dark:text-zinc-400">Provisiones</p>
            <BankingBalanceMaskedAmount
              text={formatClpDots(Math.abs(prov))}
              visible={amountsVisible}
              className="mt-0.5 block truncate text-[12px] font-semibold tabular-nums leading-tight text-rose-700/90 banking-dark:text-rose-400"
              title="Monto neto en categoría Provisiones (reversas netean)."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Saldo real (libro neto TC): suma saldos libro de cuentas líquidas **incluidas en total**
 * menos deuda TC solo de tarjetas cuya cuenta corriente enlazada está incluida.
 * Saldo actual: suma saldos «en banco» en esas mismas cuentas.
 */
export function BankingNonCreditTotalBalanceCard({
  liquidAccounts,
  creditCardUnpaidLinkedTotalClp,
  privacyKey,
  strictPrivacy,
  amountsVisible,
  onPeekStart,
  onPeekEnd,
  onToggleCardHidden,
}: {
  liquidAccounts: BankingAccountRow[];
  creditCardUnpaidLinkedTotalClp: number;
  privacyKey: string;
  strictPrivacy: boolean;
  amountsVisible: boolean;
  onPeekStart: (key: string) => void;
  onPeekEnd: () => void;
  onToggleCardHidden: (key: string) => void;
}) {
  const liquidBook = liquidAccounts.reduce((s, a) => s + a.balance, 0);
  const liquidAtBank = liquidAccounts.reduce((s, a) => s + bankingAccountAtBank(a), 0);
  const unpaidLinked = Math.max(0, creditCardUnpaidLinkedTotalClp);
  const totalReal = liquidBook - unpaidLinked;
  const totalAtBank = liquidAtBank;
  const provisionSumDisplay = liquidAccounts.reduce((s, a) => s + Math.abs(a.provision_net_sum ?? 0), 0);
  const inactive = Math.abs(totalReal) < 1e-9;

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col rounded-2xl border border-emerald-300/85 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/50 p-3.5 shadow-[0_6px_24px_-10px_rgba(15,23,42,0.07)] ring-1 ring-emerald-200/65 banking-dark:border-zinc-600 banking-dark:bg-gradient-to-br banking-dark:from-zinc-950 banking-dark:via-zinc-900 banking-dark:to-amber-950/[0.14] banking-dark:shadow-[0_8px_32px_-14px_rgba(0,0,0,0.65)] banking-dark:ring-amber-900/35 ${
        inactive ? "opacity-[0.88]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-200/90 ring-1 ring-emerald-300/65 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] banking-dark:bg-zinc-800 banking-dark:ring-amber-800/45 banking-dark:shadow-none"
          aria-hidden
        >
          <svg className="h-4 w-4 text-emerald-800/90 banking-dark:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <span className="max-w-[58%] shrink-0 truncate rounded-full bg-emerald-200/95 px-2 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-emerald-900/85 ring-1 ring-emerald-300/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] banking-dark:bg-zinc-800 banking-dark:text-amber-300 banking-dark:ring-amber-800/45">
          Total
        </span>
      </div>

      <div className="mt-2 flex min-h-[2rem] items-start gap-2">
        <p className="min-w-0 flex-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-700 banking-dark:text-zinc-100">Saldo real</p>
        <BankingBalancePrivacyEye
          strictMode={strictPrivacy}
          amountsVisible={amountsVisible}
          onPeekStart={() => onPeekStart(privacyKey)}
          onPeekEnd={onPeekEnd}
          onToggleSelfHidden={() => onToggleCardHidden(privacyKey)}
        />
      </div>

      <BankingBalanceMaskedAmount
        text={formatClpDots(totalReal)}
        visible={amountsVisible}
        className="mt-1.5 block text-lg font-semibold tabular-nums tracking-tight text-slate-800 banking-dark:text-zinc-50"
        title="Suma de saldos libro (provisiones incluidas) solo en cuentas líquidas marcadas «incluir en saldo total» en Configuración; menos cargos TC no pagados asociados a cuentas corrientes igualmente incluidas."
      />
      <div className="mt-1 border-t border-emerald-400/75 pt-1 banking-dark:border-zinc-600/90">
        <div
          className={`grid gap-x-2 gap-y-0 leading-none ${unpaidLinked > 0 ? "grid-cols-3" : "grid-cols-2"}`}
        >
          <div className="min-w-0">
            <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500 banking-dark:text-zinc-400">Saldo actual</p>
            <BankingBalanceMaskedAmount
              text={formatClpDots(totalAtBank)}
              visible={amountsVisible}
              className="mt-0.5 block truncate text-[12px] font-semibold tabular-nums leading-tight text-slate-700 banking-dark:text-zinc-100"
              title="Suma de saldos «en banco» solo en cuentas incluidas en el total (sin efecto neto de Provisiones)."
            />
          </div>
          {unpaidLinked > 0 ? (
            <div className="min-w-0 text-right">
              <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500 banking-dark:text-zinc-400">Deuda TC</p>
              <BankingBalanceMaskedAmount
                text={formatClpDots(unpaidLinked)}
                visible={amountsVisible}
                className="mt-0.5 block truncate text-[12px] font-semibold tabular-nums leading-tight text-rose-700/90 banking-dark:text-rose-400"
                title="Suma de cargos TC no pagados solo si la cuenta corriente de liquidación está incluida en el total (Configuración)."
              />
            </div>
          ) : null}
          <div className="min-w-0 text-right">
            <p className="text-[9px] font-medium uppercase tracking-wide text-slate-500 banking-dark:text-zinc-400">Provisiones</p>
            <BankingBalanceMaskedAmount
              text={formatClpDots(provisionSumDisplay)}
              visible={amountsVisible}
              className="mt-0.5 block truncate text-[12px] font-semibold tabular-nums leading-tight text-rose-700/90 banking-dark:text-rose-400"
              title="Suma del valor absoluto del neto en Provisiones solo en cuentas incluidas en el total."
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Deuda pago compartido — gradiente violeta muy suave, alineado al resto de tarjetas de saldo. */
export const BANKING_SHARED_DEBT_CARD_CLASS =
  "flex h-full min-h-0 w-full min-w-0 flex-col rounded-2xl border border-slate-300/95 bg-gradient-to-br from-slate-50/95 via-white to-violet-50/40 p-3.5 shadow-[0_6px_24px_-10px_rgba(15,23,42,0.07)] ring-1 ring-slate-300/50 backdrop-blur-sm banking-dark:border-zinc-600 banking-dark:bg-gradient-to-br banking-dark:from-zinc-950 banking-dark:via-zinc-900 banking-dark:to-amber-950/[0.1] banking-dark:shadow-[0_8px_32px_-14px_rgba(0,0,0,0.65)] banking-dark:ring-amber-900/35";

/** Gastos compartidos sin liquidar: neto por persona (devoluciones positivas restan del total). */
export function BankingSharedUnsettledDebtCard({
  amountClp,
  privacyKey,
  strictPrivacy,
  amountsVisible,
  onPeekStart,
  onPeekEnd,
  onToggleCardHidden,
}: {
  amountClp: number;
  privacyKey: string;
  strictPrivacy: boolean;
  amountsVisible: boolean;
  onPeekStart: (key: string) => void;
  onPeekEnd: () => void;
  onToggleCardHidden: (key: string) => void;
}) {
  const inactive = Math.abs(amountClp) < 1e-9;
  return (
    <div className={`${BANKING_SHARED_DEBT_CARD_CLASS} ${inactive ? "opacity-[0.88]" : ""}`}>
      <div className="flex items-start justify-between gap-1.5">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-200/90 ring-1 ring-violet-300/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] banking-dark:bg-zinc-800 banking-dark:ring-amber-800/45 banking-dark:shadow-none"
          aria-hidden
        >
          <svg className="h-4 w-4 text-violet-900/80 banking-dark:text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"
            />
          </svg>
        </div>
        <span className="max-w-[58%] shrink-0 truncate rounded-full bg-violet-200/95 px-2 py-0.5 text-[9px] font-semibold uppercase leading-none tracking-wide text-violet-900/85 ring-1 ring-violet-300/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] banking-dark:bg-zinc-800 banking-dark:text-amber-300 banking-dark:ring-amber-800/45">
          Compartido
        </span>
      </div>
      <div className="mt-2 flex min-h-[2rem] items-start gap-2">
        <p className="min-w-0 flex-1 line-clamp-2 text-sm font-semibold leading-snug text-slate-700 banking-dark:text-zinc-100">Deuda Pago Compartido</p>
        <BankingBalancePrivacyEye
          strictMode={strictPrivacy}
          amountsVisible={amountsVisible}
          onPeekStart={() => onPeekStart(privacyKey)}
          onPeekEnd={onPeekEnd}
          onToggleSelfHidden={() => onToggleCardHidden(privacyKey)}
        />
      </div>
      <BankingBalanceMaskedAmount
        text={formatClpDots(amountClp)}
        visible={amountsVisible}
        className="mt-1.5 block text-lg font-semibold tabular-nums tracking-tight text-slate-800 banking-dark:text-zinc-50"
        title="Neto en cuotas por persona: egresos suman, ingresos y devoluciones restan (mismo criterio que monto ÷ participantes con signo)."
      />
      <p className="mt-1 line-clamp-3 text-[11px] italic leading-snug text-slate-500 banking-dark:text-zinc-400">
        Cuota neta por persona; las devoluciones compartidas reducen este total.
      </p>
    </div>
  );
}

export function SortableBankingBalanceCard({
  account,
  creditCardUnpaidAllocatedClp = 0,
  privacyKey,
  strictPrivacy,
  amountsVisible,
  onPeekStart,
  onPeekEnd,
  onToggleCardHidden,
}: {
  account: BankingAccountRow;
  creditCardUnpaidAllocatedClp?: number;
  privacyKey: string;
  strictPrivacy: boolean;
  amountsVisible: boolean;
  onPeekStart: (key: string) => void;
  onPeekEnd: () => void;
  onToggleCardHidden: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
    transition: { duration: 200, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`h-full min-h-0 touch-none select-none ${isDragging ? "relative z-20 cursor-grabbing" : "cursor-grab"}`}
      {...attributes}
      {...listeners}
      title={`Arrastra para cambiar el orden · ${account.name}`}
    >
      <BankingAccountBalanceCard
        account={account}
        creditCardUnpaidAllocatedClp={creditCardUnpaidAllocatedClp}
        privacyKey={privacyKey}
        strictPrivacy={strictPrivacy}
        amountsVisible={amountsVisible}
        onPeekStart={onPeekStart}
        onPeekEnd={onPeekEnd}
        onToggleCardHidden={onToggleCardHidden}
      />
    </div>
  );
}

