import { useEffect, useState } from "react";
import {
  formatClpDots,
  formatDateLongEs,
  formatExecutedAt,
  formatFxRateClpPerUsd,
  formatMoney,
  formatSharesExact,
  formatTxSignedAmount,
  txDirectionLabel,
} from "./format";
import { apiFetch } from "./api";
import type { TransactionRow } from "./types";
import {
  TxAvatar,
  badgeStyleForTx,
  detailBadgeLabel,
  stockAssetNameFromTx,
  stockTickerFromTx,
  txDisplayName,
} from "./transactionUi";

/** Nombre largo por ticker (sesión); evita parpadeo al reabrir el mismo símbolo. */
const stockLongNameCache = new Map<string, string>();

function DetailRow({
  label,
  value,
  valueClass,
  isDark,
}: {
  label: string;
  value: string;
  valueClass?: string;
  isDark: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className={`shrink-0 ${isDark ? "text-[#8e94a5]" : "text-[#8A8072]"}`}>{label}</span>
      <span className={`text-right font-medium ${valueClass ?? (isDark ? "text-[#F3F1EC]" : "text-[#2B2620]")}`}>
        {value}
      </span>
    </div>
  );
}

interface Props {
  tx: TransactionRow | null;
  onClose: () => void;
  isDark: boolean;
}

export function TransactionDetailModal({ tx, onClose, isDark }: Props) {
  const [fetchedLongName, setFetchedLongName] = useState<string | null>(null);

  useEffect(() => {
    if (!tx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tx, onClose]);

  useEffect(() => {
    if (!tx) {
      setFetchedLongName(null);
      return;
    }
    const sym = stockTickerFromTx(tx);
    const fromDb = stockAssetNameFromTx(tx);
    if (!sym || fromDb) {
      setFetchedLongName(null);
      return;
    }
    if (stockLongNameCache.has(sym)) {
      return;
    }
    let cancelled = false;
    apiFetch(`/stocks/${encodeURIComponent(sym)}/display`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { name?: string | null } | null) => {
        if (cancelled || !d?.name?.trim()) return;
        const n = d.name.trim();
        if (n.toUpperCase() === sym) return;
        stockLongNameCache.set(sym, n);
        setFetchedLongName(n);
      })
      .catch(() => {
        if (!cancelled) setFetchedLongName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tx]);

  if (!tx) return null;

  const isDivision = (tx.tipo || "").toLowerCase() === "division_accion";
  const mutedClass = isDark ? "text-[#8b949e]" : "text-[#8A8072]";
  const { text: amountText, signClass: amountClass } = isDivision
    ? { text: "Sin flujo de caja (USD)", signClass: mutedClass }
    : formatTxSignedAmount(tx.monto_total, tx.currency, tx.tipo, isDark);
  const dir = txDirectionLabel(tx.tipo);
  const dirClass =
    dir === "Egreso"
      ? isDark
        ? "text-rose-400"
        : "text-rose-600"
      : dir === "Sin flujo de efectivo"
        ? mutedClass
        : isDark
          ? "text-emerald-400"
          : "text-emerald-600";

  const fechaLong = formatDateLongEs(tx.fecha);
  const executed = formatExecutedAt(tx.occurred_at ?? null) ?? fechaLong;

  const showShares =
    ((tx.tipo === "compra" ||
      tx.tipo === "reinversion" ||
      tx.tipo === "venta" ||
      tx.tipo === "dividendo") &&
      tx.acciones > 1e-12) ||
    (isDivision && (tx.acciones > 1e-18 || tx.precio_unitario > 1e-18));
  const showPrice =
    (tx.tipo === "compra" || tx.tipo === "reinversion" || tx.tipo === "venta") &&
    tx.acciones > 1e-12 &&
    tx.precio_unitario > 0;

  const clp = tx.amount_clp;
  const fx = tx.exchange_rate;
  const sym = stockTickerFromTx(tx);
  const longName =
    sym != null
      ? (stockAssetNameFromTx(tx) ?? stockLongNameCache.get(sym) ?? fetchedLongName)
      : null;
  const detailTitle = sym != null ? sym : txDisplayName(tx);
  const stockSubtitle =
    longName != null && longName.toUpperCase() !== sym?.toUpperCase() ? longName : null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-detail-title"
      onClick={onClose}
    >
      <div
        className={`max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border shadow-2xl ${
          isDark ? "border-[#30363d] bg-[#12121e]" : "border-[#E8E1D4] bg-white"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`border-b px-5 pb-4 pt-5 ${isDark ? "border-[#2a2a2a]" : "border-[#F0EAE0]"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <TxAvatar tx={tx} size="lg" isDark={isDark} />
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2 sm:gap-3">
                <div className="min-w-0 flex flex-col gap-1.5">
                  <h2
                    id="tx-detail-title"
                    className={`text-lg font-bold leading-tight tracking-tight ${isDark ? "text-[#F3F1EC]" : "text-[#2B2620]"}`}
                  >
                    {detailTitle}
                  </h2>
                  {stockSubtitle && <p className={`text-[11px] leading-snug ${mutedClass}`}>{stockSubtitle}</p>}
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-wide ${badgeStyleForTx(tx, isDark)}`}
                >
                  {detailBadgeLabel(tx)}
                </span>
              </div>
            </div>
            <button
              type="button"
              className={`shrink-0 self-start rounded-lg p-1.5 transition ${
                isDark
                  ? "text-[#8b949e] hover:bg-[#30363d] hover:text-[#F3F1EC]"
                  : "text-[#8A8072] hover:bg-[#F5F1E8] hover:text-[#2B2620]"
              }`}
              aria-label="Cerrar"
              onClick={onClose}
            >
              <span className="text-xl leading-none">×</span>
            </button>
          </div>
        </div>

        <div className={`border-b px-5 py-6 text-center ${isDark ? "border-[#2a2a2a]" : "border-[#F0EAE0]"}`}>
          <p className={`text-2xl font-semibold tabular-nums sm:text-3xl ${amountClass}`}>{amountText}</p>
        </div>

        <div className="px-5 pb-6 pt-1">
          <DetailRow label="Fecha" value={fechaLong} isDark={isDark} />
          <DetailRow label="Ejecutado" value={executed} isDark={isDark} />

          {showShares && !isDivision && (
            <DetailRow label="Acciones" value={formatSharesExact(tx.acciones)} isDark={isDark} />
          )}

          {isDivision && (
            <>
              <DetailRow label="Acciones antes" value={formatSharesExact(tx.precio_unitario)} isDark={isDark} />
              <DetailRow label="Acciones después" value={formatSharesExact(tx.acciones)} isDark={isDark} />
              {tx.nombre_activo?.trim() ? (
                <DetailRow label="Detalle" value={tx.nombre_activo.trim()} isDark={isDark} />
              ) : null}
            </>
          )}

          {showPrice && (
            <DetailRow label="Precio por acción" value={formatMoney(tx.precio_unitario)} isDark={isDark} />
          )}

          <DetailRow label="Moneda" value={(tx.currency || "USD").toUpperCase()} isDark={isDark} />

          {tx.source === "wallet" && clp != null && clp > 0 && (
            <DetailRow label="Monto CLP" value={formatClpDots(clp)} isDark={isDark} />
          )}

          {tx.source === "wallet" && fx != null && fx > 0 && (
            <DetailRow label="Tipo de cambio" value={formatFxRateClpPerUsd(fx)} isDark={isDark} />
          )}

          <DetailRow label="Dirección" value={dir} valueClass={dirClass} isDark={isDark} />
        </div>
      </div>
    </div>
  );
}
