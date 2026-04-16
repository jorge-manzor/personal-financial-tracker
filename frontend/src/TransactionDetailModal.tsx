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
  valueClass = "text-white",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="shrink-0 text-[#8e94a5]">{label}</span>
      <span className={`text-right font-medium ${valueClass}`}>{value}</span>
    </div>
  );
}

interface Props {
  tx: TransactionRow | null;
  onClose: () => void;
}

export function TransactionDetailModal({ tx, onClose }: Props) {
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
  const { text: amountText, signClass: amountClass } = isDivision
    ? { text: "Sin flujo de caja (USD)", signClass: "text-[#8b949e]" }
    : formatTxSignedAmount(tx.monto_total, tx.currency, tx.tipo);
  const dir = txDirectionLabel(tx.tipo);
  const dirClass =
    dir === "Egreso" ? "text-[#f87171]" : dir === "Sin flujo de efectivo" ? "text-[#8b949e]" : "text-[#4ade80]";

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
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#30363d] bg-[#12121e] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#2a2a2a] px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <TxAvatar tx={tx} size="lg" />
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2 sm:gap-3">
                <div className="min-w-0 flex flex-col gap-1.5">
                  <h2 id="tx-detail-title" className="text-lg font-bold leading-tight tracking-tight text-white">
                    {detailTitle}
                  </h2>
                  {stockSubtitle && (
                    <p className="text-[11px] leading-snug text-[#8b949e]">{stockSubtitle}</p>
                  )}
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase leading-none tracking-wide ${badgeStyleForTx(tx)}`}
                >
                  {detailBadgeLabel(tx)}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 self-start rounded-lg p-1.5 text-[#8b949e] transition hover:bg-[#30363d] hover:text-white"
              aria-label="Cerrar"
              onClick={onClose}
            >
              <span className="text-xl leading-none">×</span>
            </button>
          </div>
        </div>

        <div className="border-b border-[#2a2a2a] px-5 py-6 text-center">
          <p className={`text-2xl font-semibold tabular-nums sm:text-3xl ${amountClass}`}>{amountText}</p>
        </div>

        <div className="px-5 pb-6 pt-1">
          <DetailRow label="Fecha" value={fechaLong} />
          <DetailRow label="Ejecutado" value={executed} />

          {showShares && !isDivision && (
            <DetailRow label="Acciones" value={formatSharesExact(tx.acciones)} />
          )}

          {isDivision && (
            <>
              <DetailRow label="Acciones antes" value={formatSharesExact(tx.precio_unitario)} />
              <DetailRow label="Acciones después" value={formatSharesExact(tx.acciones)} />
              {tx.nombre_activo?.trim() ? (
                <DetailRow label="Detalle" value={tx.nombre_activo.trim()} />
              ) : null}
            </>
          )}

          {showPrice && (
            <DetailRow label="Precio por acción" value={formatMoney(tx.precio_unitario)} />
          )}

          <DetailRow label="Moneda" value={(tx.currency || "USD").toUpperCase()} />

          {tx.source === "wallet" && clp != null && clp > 0 && (
            <DetailRow label="Monto CLP" value={formatClpDots(clp)} />
          )}

          {tx.source === "wallet" && fx != null && fx > 0 && (
            <DetailRow label="Tipo de cambio" value={formatFxRateClpPerUsd(fx)} />
          )}

          <DetailRow label="Dirección" value={dir} valueClass={dirClass} />
        </div>
      </div>
    </div>
  );
}
