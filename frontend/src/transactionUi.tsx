import { useState } from "react";
import { API_BASE } from "./config";
import type { TransactionRow } from "./types";

export function isReinversionCompra(tx: TransactionRow): boolean {
  if (tx.tipo === "reinversion") return true;
  if (tx.tipo !== "compra") return false;
  const n = (tx.nombre_activo || "").toLowerCase();
  return n.includes("reinversión") || n.includes("reinversion");
}

export function badgeStyleForTx(tx: TransactionRow): string {
  if (isReinversionCompra(tx)) return "bg-[#312e81] text-[#a5b4fc]";
  const t = tx.tipo;
  switch (t) {
    case "reinversion":
      return "bg-[#312e81] text-[#a5b4fc]";
    case "compra":
      return "bg-[#2d2b55] text-[#a599e9]";
    case "venta":
      return "bg-[#5c1f0d] text-[#fdba74]";
    case "dividendo":
      return "bg-[#453008] text-[#e2b340]";
    case "division_accion":
      return "bg-[#134e4a] text-[#5eead4]";
    case "deposito":
      return "bg-[#064e3b] text-[#34d399]";
    case "interes_caja":
      return "bg-[#0e3c46] text-[#40c4ff]";
    case "retiro":
      return "bg-[#5c1f0d] text-[#fca5a5]";
    case "compensacion":
      return "bg-[#3f3f46] text-[#d4d4d8]";
    case "fusion_caja":
      return "bg-[#422006] text-[#fcd34d]";
    case "desinversion":
      return "bg-[#14532d] text-[#86efac]";
    case "acat_ingreso":
      return "bg-[#134e4a] text-[#5eead4]";
    case "acat_comision":
    case "acat_egreso":
      return "bg-[#4c0519] text-[#fda4af]";
    case "warrant_comision":
    case "warrant_costo":
      return "bg-[#3b0764] text-[#d8b4fe]";
    default:
      return "bg-[#3f3f46] text-[#e4e4e7]";
  }
}

/** Etiqueta del badge en lista y modal. */
export function badgeLabel(tx: TransactionRow): string {
  if (isReinversionCompra(tx)) return "REINVERSIÓN";
  const cat = tx.categoria || "Acciones";
  if (tx.tipo === "compra" && (cat === "Fondos" || cat === "AFP" || cat === "Wallet USD")) return cat.toUpperCase();
  const labels: Record<string, string> = {
    compra: "COMPRA",
    reinversion: "REINVERSIÓN",
    venta: "VENTA",
    dividendo: "DIVIDENDO",
    deposito: "DEPÓSITO",
    retiro: "RETIRO",
    interes_caja: "INTERÉS",
    compensacion: "COMPENSACIÓN",
    fusion_caja: "FUSIÓN CAJA",
    desinversion: "DESINVERSIÓN",
    acat_ingreso: "ACAT INGRESO",
    acat_comision: "ACAT COMISIÓN",
    acat_egreso: "ACAT EGRESO",
    warrant_comision: "WARRANT COMISIÓN",
    warrant_costo: "WARRANT COSTO",
    division_accion: "DIVISIÓN ACCIÓN",
  };
  return labels[tx.tipo] ?? tx.tipo.replace(/_/g, " ").toUpperCase();
}

/** Badge en modal: depósito como en diseño. */
export function detailBadgeLabel(tx: TransactionRow): string {
  if (tx.tipo === "deposito") return "DEPÓSITO USD";
  return badgeLabel(tx);
}

export const TICKER_LIKE = /^[A-Z][A-Z0-9.\-]{0,9}$/i;

const STOCK_USD_CATEGORIES = new Set(["Acciones", "División Acción"]);

export function StockLogoImg({ symbol, size = "md" }: { symbol: string; size?: "md" | "lg" }) {
  const [failed, setFailed] = useState(false);
  const sym = symbol.toUpperCase();
  const url = `${API_BASE}/stock-logos/${sym}.png`;
  const box = size === "lg" ? "h-12 w-12 text-[12px]" : "h-9 w-9 text-[10px]";
  if (failed) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#30363d] font-bold text-white ${box}`}
      >
        {sym.slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className={`shrink-0 rounded-full bg-[#141414] object-contain ring-0 ${box}`}
      onError={() => setFailed(true)}
    />
  );
}

export function TxAvatar({ tx, size = "md" }: { tx: TransactionRow; size?: "md" | "lg" }) {
  const cat = tx.categoria || "Acciones";
  const raw = (tx.activo || "").trim();
  const sym = raw.toUpperCase();
  const wCls = size === "lg" ? "h-12 w-12 text-[15px]" : "h-9 w-9 text-[13px]";

  if (
    sym === "WALLET" ||
    (tx.source === "wallet" && (cat === "Wallet USD" || cat === "Fondos") && !TICKER_LIKE.test(raw))
  ) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#ea580c] font-bold text-white ${wCls}`}
      >
        W
      </span>
    );
  }

  if (STOCK_USD_CATEGORIES.has(cat) && TICKER_LIKE.test(raw)) {
    return <StockLogoImg symbol={raw} size={size} />;
  }

  const label = tx.nombre_activo?.trim() || raw;
  const initial = label.replace(/[^\p{L}0-9]/gu, "").slice(0, 1).toUpperCase() || "?";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-indigo-600 font-bold text-white ${wCls}`}
    >
      {initial}
    </span>
  );
}

function isPlaceholderStockName(n: string): boolean {
  const lower = n.toLowerCase().trim();
  if (!lower) return true;
  if (lower === "reinversión de dividendo" || lower === "reinversion de dividendo") return true;
  if (lower === "dividendo en efectivo") return true;
  if (/^fintual\s·/i.test(n)) return true;
  // Etiqueta de movimiento de billetera (evita tratarla como `asset.name`)
  if (/^dividend\s+/i.test(n)) return true;
  return false;
}

/** Ticker en mayúsculas si la fila es Acciones con símbolo tipo acción; si no, null. */
export function stockTickerFromTx(tx: TransactionRow): string | null {
  const raw = (tx.activo || "").trim();
  const cat = tx.categoria || "Acciones";
  if (!STOCK_USD_CATEGORIES.has(cat) || !TICKER_LIKE.test(raw)) return null;
  return raw.toUpperCase();
}

/**
 * Nombre del activo según Fintual (`asset.name` → `nombre_activo` tras sync), solo para acciones con ticker.
 */
export function stockAssetNameFromTx(tx: TransactionRow): string | null {
  if ((tx.tipo || "").toLowerCase() === "division_accion") return null;
  const sym = stockTickerFromTx(tx);
  if (!sym) return null;
  const n = tx.nombre_activo?.trim();
  if (!n || isPlaceholderStockName(n)) return null;
  if (n.toUpperCase() === sym) return null;
  return n;
}

export function txDisplayName(tx: TransactionRow): string {
  const raw = (tx.activo || "").trim();
  if (raw.toUpperCase() === "WALLET") return "Wallet USD";
  const sym = stockTickerFromTx(tx);
  if (sym) return sym;
  const asset = stockAssetNameFromTx(tx);
  if (asset) return asset;
  return tx.nombre_activo?.trim() || raw;
}

