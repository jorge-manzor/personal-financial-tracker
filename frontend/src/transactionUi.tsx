import { useState } from "react";
import { API_BASE } from "./config";
import type { TransactionRow } from "./types";

export function isReinversionCompra(tx: TransactionRow): boolean {
  if (tx.tipo === "reinversion") return true;
  if (tx.tipo !== "compra") return false;
  const n = (tx.nombre_activo || "").toLowerCase();
  return n.includes("reinversión") || n.includes("reinversion");
}

/**
 * Paleta por tipo de movimiento — mismo ciclo de 12 tonos pastel que las categorías bancarias
 * (docs/design-colors.md), + dorado fijo para Dividendo y salvia fijo para Depósito.
 * Clases completas y literales (Tailwind no puede generar clases arbitrarias interpoladas).
 */
export function badgeStyleForTx(tx: TransactionRow, isDark: boolean): string {
  const tipo = isReinversionCompra(tx) ? "reinversion" : tx.tipo;
  if (isDark) {
    switch (tipo) {
      case "compra":
        return "bg-[#998ecc]/18 text-[#c4b8ed]";
      case "reinversion":
        return "bg-[#bd8ecc]/18 text-[#d9b8e6]";
      case "venta":
        return "bg-[#cc8e9e]/20 text-[#e7b4c0]";
      case "dividendo":
        return "bg-[#C79A56]/18 text-[#E9CB9B]";
      case "deposito":
        return "bg-[#8FBFA6]/20 text-[#8FBFA6]";
      case "retiro":
        return "bg-[#cc998e]/20 text-[#e7c3b6]";
      case "interes_caja":
        return "bg-[#8ec2cc]/20 text-[#b6dfe7]";
      case "fusion_caja":
        return "bg-[#ccc78e]/18 text-[#e6dfa0]";
      case "desinversion":
        return "bg-[#a8cc8e]/18 text-[#b9e6a0]";
      case "acat_ingreso":
      case "division_accion":
        return "bg-[#8eccbd]/18 text-[#a0e6d4]";
      case "acat_comision":
      case "acat_egreso":
        return "bg-[#cc8eb8]/18 text-[#e6a8d4]";
      case "warrant_comision":
      case "warrant_costo":
        return "bg-[#8ea8cc]/18 text-[#a8bfe6]";
      default:
        return "bg-[#21262d] text-[#9ca3af]";
    }
  }
  switch (tipo) {
    case "compra":
      return "bg-[#998ecc]/18 text-[#5f549e]";
    case "reinversion":
      return "bg-[#bd8ecc]/18 text-[#8a5a9e]";
    case "venta":
      return "bg-[#cc8e9e]/20 text-[#A65568]";
    case "dividendo":
      return "bg-[#C79A56]/18 text-[#8A6631]";
    case "deposito":
      return "bg-[#8FBFA6]/20 text-[#3F6B52]";
    case "retiro":
      return "bg-[#cc998e]/20 text-[#a3705f]";
    case "interes_caja":
      return "bg-[#8ec2cc]/20 text-[#4a7d8c]";
    case "fusion_caja":
      return "bg-[#ccc78e]/18 text-[#8a8250]";
    case "desinversion":
      return "bg-[#a8cc8e]/18 text-[#5f8a4a]";
    case "acat_ingreso":
    case "division_accion":
      return "bg-[#8eccbd]/18 text-[#4a8a76]";
    case "acat_comision":
    case "acat_egreso":
      return "bg-[#cc8eb8]/18 text-[#8a4a72]";
    case "warrant_comision":
    case "warrant_costo":
      return "bg-[#8ea8cc]/18 text-[#4a5f8a]";
    default:
      return "bg-[#F5F1E8] text-[#8A8072]";
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

export const TICKER_LIKE = /^[A-Z][A-Z0-9.-]{0,9}$/i;

const STOCK_USD_CATEGORIES = new Set(["Acciones", "División Acción"]);

export function StockLogoImg({
  symbol,
  size = "md",
  isDark,
}: {
  symbol: string;
  size?: "md" | "lg";
  isDark: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const sym = symbol.toUpperCase();
  const url = `${API_BASE}/stock-logos/${sym}.png`;
  const box = size === "lg" ? "h-12 w-12 text-[12px]" : "h-9 w-9 text-[10px]";
  if (failed) {
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full font-bold ${box} ${
          isDark ? "bg-[#30363d] text-[#F3F1EC]" : "bg-[#E8E1D4] text-[#2B2620]"
        }`}
      >
        {sym.slice(0, 2)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className={`shrink-0 rounded-full object-contain ring-0 ${box} ${isDark ? "bg-[#141414]" : "bg-[#F5F1E8]"}`}
      onError={() => setFailed(true)}
    />
  );
}

export function TxAvatar({ tx, size = "md", isDark }: { tx: TransactionRow; size?: "md" | "lg"; isDark: boolean }) {
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
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#C79A56] font-bold text-[#4A3419] ${wCls}`}
      >
        W
      </span>
    );
  }

  if (STOCK_USD_CATEGORIES.has(cat) && TICKER_LIKE.test(raw)) {
    return <StockLogoImg symbol={raw} size={size} isDark={isDark} />;
  }

  const label = tx.nombre_activo?.trim() || raw;
  const initial = label.replace(/[^\p{L}0-9]/gu, "").slice(0, 1).toUpperCase() || "?";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-[#C79A56] font-bold text-[#4A3419] ${wCls}`}
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
