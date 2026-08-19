/** Tarjetas de saldo y controles de privacidad (extraídos de BankingTransactionsPage). */

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatClpDots } from "./format";
import { maskBankingBalanceText } from "./bankingTxHelpers";
import type { BankingAccountRow } from "./types";
import { bankingAccountAtBank, bankingProductBadgeLabel } from "./bankingTxShared";
import { IconEyeOutline, IconEyeSlashOutline, IconGripVertical } from "./bankingTxIcons";

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

/** Único control de privacidad: vive en la tarjeta Total y oculta/muestra los montos de todas las tarjetas a la vez. */
export function BankingBalancePrivacyEye({
  amountsVisible,
  onToggle,
  iconClassName = bankingBalancePrivacyEyeTitleIconClass,
}: {
  amountsVisible: boolean;
  onToggle: () => void;
  iconClassName?: string;
}) {
  return (
    <button
      type="button"
      className={bankingBalancePrivacyEyeBtnClass}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={amountsVisible ? "Ocultar montos en todas las tarjetas" : "Mostrar montos en todas las tarjetas"}
      aria-label={amountsVisible ? "Ocultar montos en todas las tarjetas" : "Mostrar montos en todas las tarjetas"}
      aria-pressed={!amountsVisible}
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

/** Tarjeta de saldo — Saldo actual siempre visible; Deuda TC / Provisiones solo si son distintas de cero. */
export function BankingAccountBalanceCard({
  account: a,
  creditCardUnpaidAllocatedClp = 0,
  amountsVisible,
  dragHandle,
}: {
  account: BankingAccountRow;
  /** Solo cuentas líquidas con TC asociadas: cargos TC no pagados enlazados a esta cuenta corriente. */
  creditCardUnpaidAllocatedClp?: number;
  amountsVisible: boolean;
  /** Asa de arrastre opcional (solo ahí se activa el drag; el resto de la tarjeta permite seleccionar/copiar texto). */
  dragHandle?: ReactNode;
}) {
  const liquid = a.product_type !== "tarjeta_credito";
  const unpaidCut = liquid ? Math.max(0, creditCardUnpaidAllocatedClp) : 0;
  const saldoReal = liquid ? a.balance - unpaidCut : a.balance;

  const inactive = Math.abs(a.balance) < 1e-9;
  const prov = a.provision_net_sum ?? 0;
  const atBank = a.balance_at_bank !== undefined ? a.balance_at_bank : a.balance - prov;
  const showTcChip = unpaidCut > 0;
  const showProvChip = Math.abs(prov) > 1e-9;

  return (
    <div
      className={`flex h-full min-h-0 w-full min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md banking-dark:border-zinc-800 banking-dark:bg-zinc-900 banking-dark:hover:shadow-none ${
        inactive ? "opacity-[0.88]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 banking-dark:bg-zinc-800"
          aria-hidden
        >
          <svg className="h-4 w-4 text-slate-600 banking-dark:text-zinc-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 10h18M5 10V8a2 2 0 012-2h10a2 2 0 012 2v2M5 10v10h14V10M9 14h6"
            />
          </svg>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="max-w-full truncate rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-wide text-indigo-600 banking-dark:bg-indigo-500/15 banking-dark:text-indigo-300">
            {bankingProductBadgeLabel(a.product_type)}
          </span>
          {dragHandle}
        </div>
      </div>

      <div className="mt-3 min-h-[1.5rem]">
        <p className="min-w-0 truncate text-[13px] font-medium leading-snug text-slate-500 banking-dark:text-zinc-400">{a.name}</p>
      </div>

      <BankingBalanceMaskedAmount
        text={formatClpDots(saldoReal)}
        visible={amountsVisible}
        className="mt-1 block text-[22px] font-bold tabular-nums tracking-tight text-slate-900 banking-dark:text-white"
        title={
          liquid
            ? `Saldo real (libro): incluye provisiones en el saldo libro; menos cargos en TC no pagados asociados a esta cuenta (${formatClpDots(unpaidCut)}).`
            : "Saldo libro en la cuenta tarjeta (egresos no pagados siguen pendientes hasta marcarlos o pagar)."
        }
      />
      <div className={`mt-3 grid gap-2 ${showTcChip && showProvChip ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="min-w-0 rounded-lg bg-slate-50 px-2.5 py-1.5 banking-dark:bg-zinc-800/60">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">
            Saldo actual
          </p>
          <BankingBalanceMaskedAmount
            text={formatClpDots(atBank)}
            visible={amountsVisible}
            className="mt-0.5 block truncate text-[11.5px] font-bold tabular-nums leading-tight text-slate-700 banking-dark:text-zinc-200"
            title="Efectivo en cuenta (libro menos neto de Provisiones)."
          />
        </div>
        {showTcChip ? (
          <div className="min-w-0 rounded-lg bg-rose-50 px-2.5 py-1.5 banking-dark:bg-rose-500/10">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-rose-500/80 banking-dark:text-rose-300/70">
              Deuda TC
            </p>
            <BankingBalanceMaskedAmount
              text={formatClpDots(unpaidCut)}
              visible={amountsVisible}
              className="mt-0.5 block truncate text-[11.5px] font-bold tabular-nums leading-tight text-rose-600 banking-dark:text-rose-300"
              title="Cargos en tarjeta(s) asociada(s) a esta cuenta marcados como no pagados."
            />
          </div>
        ) : null}
        {showProvChip ? (
          <div className="min-w-0 rounded-lg bg-rose-50 px-2.5 py-1.5 banking-dark:bg-rose-500/10">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-rose-500/80 banking-dark:text-rose-300/70">
              Provisiones
            </p>
            <BankingBalanceMaskedAmount
              text={formatClpDots(Math.abs(prov))}
              visible={amountsVisible}
              className="mt-0.5 block truncate text-[11.5px] font-bold tabular-nums leading-tight text-rose-600 banking-dark:text-rose-300"
              title="Monto neto en categoría Provisiones (reversas netean)."
            />
          </div>
        ) : null}
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
  sharedUnsettledClp,
  amountsVisible,
  onToggleAmountsVisible,
}: {
  liquidAccounts: BankingAccountRow[];
  creditCardUnpaidLinkedTotalClp: number;
  /** Deuda neta de gastos compartidos sin liquidar; se muestra como un stat más del hero. */
  sharedUnsettledClp: number;
  amountsVisible: boolean;
  /** Único control de privacidad: oculta/muestra los montos de todas las tarjetas de saldo. */
  onToggleAmountsVisible: () => void;
}) {
  const liquidBook = liquidAccounts.reduce((s, a) => s + a.balance, 0);
  const liquidAtBank = liquidAccounts.reduce((s, a) => s + bankingAccountAtBank(a), 0);
  const unpaidLinked = Math.max(0, creditCardUnpaidLinkedTotalClp);
  const totalReal = liquidBook - unpaidLinked;
  const totalAtBank = liquidAtBank;
  const provisionSumDisplay = liquidAccounts.reduce((s, a) => s + Math.abs(a.provision_net_sum ?? 0), 0);
  const statCount = unpaidLinked > 0 ? 4 : 3;
  const inactive = Math.abs(totalReal) < 1e-9;

  return (
    <div
      className={`relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#14162a_0%,#1c1e3d_55%,#23234f_100%)] p-4 shadow-[0_8px_32px_-14px_rgba(20,22,42,0.55)] ring-1 ring-white/[0.06] ${
        inactive ? "opacity-[0.88]" : ""
      }`}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.35),transparent_70%)]"
        aria-hidden
      />
      <div className="relative flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10" aria-hidden>
            <svg className="h-4 w-4 text-indigo-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="min-w-0 truncate text-[13px] font-medium leading-snug text-indigo-200/80">Saldo real disponible</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="truncate rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-wide text-indigo-200">
            Total
          </span>
          <BankingBalancePrivacyEye
            amountsVisible={amountsVisible}
            onToggle={onToggleAmountsVisible}
            iconClassName="h-4 w-4 shrink-0 text-indigo-200/70"
          />
        </div>
      </div>

      <BankingBalanceMaskedAmount
        text={formatClpDots(totalReal)}
        visible={amountsVisible}
        className="relative mt-3 block text-[32px] font-bold tabular-nums tracking-tight text-white"
        title="Suma de saldos libro (provisiones incluidas) solo en cuentas líquidas marcadas «incluir en saldo total» en Configuración; menos cargos TC no pagados asociados a cuentas corrientes igualmente incluidas."
      />
      <div className={`relative mt-4 grid gap-2 ${statCount === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-indigo-300/70">Saldo actual</p>
          <BankingBalanceMaskedAmount
            text={formatClpDots(totalAtBank)}
            visible={amountsVisible}
            className="mt-1 block truncate text-[15px] font-bold tabular-nums leading-tight text-white"
            title="Suma de saldos «en banco» solo en cuentas incluidas en el total (sin efecto neto de Provisiones)."
          />
        </div>
        {unpaidLinked > 0 ? (
          <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2">
            <p className="text-[9.5px] font-semibold uppercase tracking-wide text-indigo-300/70">Deuda TC</p>
            <BankingBalanceMaskedAmount
              text={formatClpDots(unpaidLinked)}
              visible={amountsVisible}
              className="mt-1 block truncate text-[15px] font-bold tabular-nums leading-tight text-rose-300"
              title="Suma de cargos TC no pagados solo si la cuenta corriente de liquidación está incluida en el total (Configuración)."
            />
          </div>
        ) : null}
        <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-indigo-300/70">Provisiones</p>
          <BankingBalanceMaskedAmount
            text={formatClpDots(provisionSumDisplay)}
            visible={amountsVisible}
            className="mt-1 block truncate text-[15px] font-bold tabular-nums leading-tight text-rose-300"
            title="Suma del valor absoluto del neto en Provisiones solo en cuentas incluidas en el total."
          />
        </div>
        <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-indigo-300/70">Compartido</p>
          <BankingBalanceMaskedAmount
            text={formatClpDots(sharedUnsettledClp)}
            visible={amountsVisible}
            className="mt-1 block truncate text-[15px] font-bold tabular-nums leading-tight text-white"
            title="Cuota neta por persona en gastos compartidos sin liquidar (las devoluciones compartidas reducen este total)."
          />
        </div>
      </div>
    </div>
  );
}

export function SortableBankingBalanceCard({
  account,
  creditCardUnpaidAllocatedClp = 0,
  amountsVisible,
}: {
  account: BankingAccountRow;
  creditCardUnpaidAllocatedClp?: number;
  amountsVisible: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
    transition: { duration: 200, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={`h-full min-h-0 ${isDragging ? "relative z-20" : ""}`}>
      <BankingAccountBalanceCard
        account={account}
        creditCardUnpaidAllocatedClp={creditCardUnpaidAllocatedClp}
        amountsVisible={amountsVisible}
        dragHandle={
          <button
            type="button"
            ref={setActivatorNodeRef}
            className={`inline-flex h-6 w-6 shrink-0 touch-none items-center justify-center rounded-md text-slate-400 outline-none transition hover:bg-slate-100 hover:text-slate-600 focus-visible:ring-2 focus-visible:ring-teal-400/40 banking-dark:text-zinc-500 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-300 ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            aria-label={`Arrastrar para cambiar el orden · ${account.name}`}
            title="Arrastra para cambiar el orden"
            {...attributes}
            {...listeners}
          >
            <IconGripVertical className="h-4 w-4" />
          </button>
        }
      />
    </div>
  );
}

