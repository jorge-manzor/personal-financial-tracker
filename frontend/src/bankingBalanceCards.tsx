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
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#9A9284] transition hover:bg-[#F5F1E8] hover:text-[#4A453C] focus:outline-none focus:ring-2 focus:ring-[#8FBFA6]/45 banking-dark:text-[#6b7280] banking-dark:hover:bg-[#161b22] banking-dark:hover:text-[#c9d1d9] banking-dark:focus:ring-[#8FBFA6]/35"
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
              className="pointer-events-auto fixed z-[99999] rounded-lg border border-[#E8E1D4] bg-white px-2.5 py-2 text-left text-[11px] font-normal leading-snug text-[#4A453C] shadow-2xl banking-dark:border-[#30363d] banking-dark:bg-[#161b22] banking-dark:text-[#c9d1d9]"
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
  "inline-flex shrink-0 items-center justify-center self-start rounded p-0 pt-px text-[#4A453C] ring-offset-2 transition hover:text-[#2B2620] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8FBFA6]/45 active:opacity-85 banking-dark:text-[#c9d1d9] banking-dark:hover:text-[#8FBFA6] banking-dark:focus-visible:ring-[#8FBFA6]/35 banking-dark:ring-offset-[#0d1117]";

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
      className={`flex h-full min-h-0 w-full min-w-0 flex-col rounded-2xl border border-[#E8E1D4] bg-white p-4 shadow-sm transition hover:shadow-md banking-dark:border-[#1e242e] banking-dark:bg-[#12161d] banking-dark:hover:shadow-none ${
        inactive ? "opacity-[0.88]" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F5F1E8] banking-dark:bg-[#161b22]"
          aria-hidden
        >
          <svg className="h-4 w-4 text-[#4A453C] banking-dark:text-[#c9d1d9]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 10h18M5 10V8a2 2 0 012-2h10a2 2 0 012 2v2M5 10v10h14V10M9 14h6"
            />
          </svg>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="max-w-full truncate rounded-full bg-[#C79A56]/16 px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-wide text-[#8A6631] banking-dark:bg-[#C79A56]/15 banking-dark:text-[#C79A56]">
            {bankingProductBadgeLabel(a.product_type)}
          </span>
          {dragHandle}
        </div>
      </div>

      <div className="mt-3 min-h-[1.5rem]">
        <p className="min-w-0 truncate text-[13px] font-medium leading-snug text-[#8A8072] banking-dark:text-[#8b949e]">{a.name}</p>
      </div>

      <BankingBalanceMaskedAmount
        text={formatClpDots(saldoReal)}
        visible={amountsVisible}
        className="mt-1 block text-[22px] font-bold tabular-nums tracking-tight text-[#2B2620] banking-dark:text-[#F3F1EC]"
        title={
          liquid
            ? `Saldo real (libro): incluye provisiones en el saldo libro; menos cargos en TC no pagados asociados a esta cuenta (${formatClpDots(unpaidCut)}).`
            : "Saldo libro en la cuenta tarjeta (egresos no pagados siguen pendientes hasta marcarlos o pagar)."
        }
      />
      <div className={`mt-3 grid gap-2 ${showTcChip && showProvChip ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="min-w-0 rounded-lg bg-[#F5F1E8] px-2.5 py-1.5 banking-dark:bg-[#161b22]">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-[#9A9284] banking-dark:text-[#6b7280]">
            Saldo actual
          </p>
          <BankingBalanceMaskedAmount
            text={formatClpDots(atBank)}
            visible={amountsVisible}
            className="mt-0.5 block truncate text-[11.5px] font-bold tabular-nums leading-tight text-[#4A453C] banking-dark:text-[#c9d1d9]"
            title="Efectivo en cuenta (libro menos neto de Provisiones)."
          />
        </div>
        {showTcChip ? (
          <div className="min-w-0 rounded-lg bg-[#cc8e9e]/14 px-2.5 py-1.5 banking-dark:bg-[#cc8e9e]/10">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-[#c48a97] banking-dark:text-[#a56d7a]">
              Deuda TC
            </p>
            <BankingBalanceMaskedAmount
              text={formatClpDots(unpaidCut)}
              visible={amountsVisible}
              className="mt-0.5 block truncate text-[11.5px] font-bold tabular-nums leading-tight text-[#A65568] banking-dark:text-[#cc8e9e]"
              title="Cargos en tarjeta(s) asociada(s) a esta cuenta marcados como no pagados."
            />
          </div>
        ) : null}
        {showProvChip ? (
          <div className="min-w-0 rounded-lg bg-[#cc8e9e]/14 px-2.5 py-1.5 banking-dark:bg-[#cc8e9e]/10">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-[#c48a97] banking-dark:text-[#a56d7a]">
              Provisiones
            </p>
            <BankingBalanceMaskedAmount
              text={formatClpDots(Math.abs(prov))}
              visible={amountsVisible}
              className="mt-0.5 block truncate text-[11.5px] font-bold tabular-nums leading-tight text-[#A65568] banking-dark:text-[#cc8e9e]"
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
      className={`relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#16211a_0%,#1b2b21_55%,#203327_100%)] p-4 shadow-[0_8px_32px_-14px_rgba(20,30,24,0.45)] ring-1 ring-white/[0.06] banking-dark:bg-[linear-gradient(135deg,#0f1a14_0%,#152219_55%,#182a1f_100%)] banking-dark:shadow-[0_8px_32px_-14px_rgba(0,0,0,0.6)] ${
        inactive ? "opacity-[0.88]" : ""
      }`}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(143,191,166,0.30),transparent_70%)] banking-dark:bg-[radial-gradient(circle,rgba(143,191,166,0.22),transparent_70%)]"
        aria-hidden
      />
      <div className="relative flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10" aria-hidden>
            <svg className="h-4 w-4 text-[#E9CB9B] banking-dark:text-[#C79A56]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="min-w-0 truncate text-[13px] font-medium leading-snug text-[#E9E5DB]/75 banking-dark:text-[#c9d1d9]/80">Saldo real disponible</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="truncate rounded-full bg-[#C79A56]/22 px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-wide text-[#E9CB9B] banking-dark:bg-[#C79A56]/20 banking-dark:text-[#C79A56]">
            Total
          </span>
          <BankingBalancePrivacyEye
            amountsVisible={amountsVisible}
            onToggle={onToggleAmountsVisible}
            iconClassName="h-4 w-4 shrink-0 text-[#E9E5DB]/60 banking-dark:text-[#c9d1d9]/60"
          />
        </div>
      </div>

      <BankingBalanceMaskedAmount
        text={formatClpDots(totalReal)}
        visible={amountsVisible}
        className="relative mt-3 block text-[32px] font-bold tabular-nums tracking-tight text-[#F3F1EC]"
        title="Suma de saldos libro (provisiones incluidas) solo en cuentas líquidas marcadas «incluir en saldo total» en Configuración; menos cargos TC no pagados asociados a cuentas corrientes igualmente incluidas."
      />
      <div className={`relative mt-4 grid gap-2 ${statCount === 4 ? "grid-cols-4" : "grid-cols-3"}`}>
        <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2 banking-dark:bg-white/[0.04]">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-[#8FBFA6]/85 banking-dark:text-[#8FBFA6]">Saldo actual</p>
          <BankingBalanceMaskedAmount
            text={formatClpDots(totalAtBank)}
            visible={amountsVisible}
            className="mt-1 block truncate text-[15px] font-bold tabular-nums leading-tight text-[#F3F1EC]"
            title="Suma de saldos «en banco» solo en cuentas incluidas en el total (sin efecto neto de Provisiones)."
          />
        </div>
        {unpaidLinked > 0 ? (
          <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2 banking-dark:bg-white/[0.04]">
            <p className="text-[9.5px] font-semibold uppercase tracking-wide text-[#8FBFA6]/85 banking-dark:text-[#8FBFA6]">Deuda TC</p>
            <BankingBalanceMaskedAmount
              text={formatClpDots(unpaidLinked)}
              visible={amountsVisible}
              className="mt-1 block truncate text-[15px] font-bold tabular-nums leading-tight text-[#e8a9b7] banking-dark:text-[#cc8e9e]"
              title="Suma de cargos TC no pagados solo si la cuenta corriente de liquidación está incluida en el total (Configuración)."
            />
          </div>
        ) : null}
        <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2 banking-dark:bg-white/[0.04]">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-[#8FBFA6]/85 banking-dark:text-[#8FBFA6]">Provisiones</p>
          <BankingBalanceMaskedAmount
            text={formatClpDots(provisionSumDisplay)}
            visible={amountsVisible}
            className="mt-1 block truncate text-[15px] font-bold tabular-nums leading-tight text-[#e8a9b7] banking-dark:text-[#cc8e9e]"
            title="Suma del valor absoluto del neto en Provisiones solo en cuentas incluidas en el total."
          />
        </div>
        <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.07] px-3 py-2 banking-dark:bg-white/[0.04]">
          <p className="text-[9.5px] font-semibold uppercase tracking-wide text-[#8FBFA6]/85 banking-dark:text-[#8FBFA6]">Compartido</p>
          <BankingBalanceMaskedAmount
            text={formatClpDots(sharedUnsettledClp)}
            visible={amountsVisible}
            className="mt-1 block truncate text-[15px] font-bold tabular-nums leading-tight text-[#F3F1EC]"
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
            className={`inline-flex h-6 w-6 shrink-0 touch-none items-center justify-center rounded-md text-[#9A9284] outline-none transition hover:bg-[#F5F1E8] hover:text-[#4A453C] focus-visible:ring-2 focus-visible:ring-[#8FBFA6]/40 banking-dark:text-[#6b7280] banking-dark:hover:bg-[#161b22] banking-dark:hover:text-[#c9d1d9] ${
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

