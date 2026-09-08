/**
 * Local, minimal prop-shape types for this package's components — captures only the fields each
 * component actually reads. Not imported from the app's `frontend/src/types.ts` (decoupling rule).
 */

export type Period = "1M" | "3M" | "6M" | "1Y" | "3Y" | "YTD" | "ALL";

/** Moneda de visualización del gráfico principal del portafolio. */
export type ChartCurrency = "CLP" | "USD";

export interface Holding {
  ticker: string;
  nombre: string;
  total_shares: number;
  avg_buy_price: number;
  capital_invertido: number;
  current_price: number;
  current_value: number;
  ganancia_realizada: number;
  ganancia_no_realizada: number;
  dividendos: number;
  ganancia_total: number;
  rentabilidad_no_realizada_pct: number | null;
  rentabilidad_total_pct: number | null;
  peso_portafolio_pct: number;
  price_unavailable?: boolean;
}

/** Meta/fondo Fintual activo (API goals). */
export interface FintualGoalCard {
  id: string;
  name: string;
  nav_clp: number;
  deposited_clp: number;
  profit_clp: number;
  profit_pct: number;
  badge_label: string;
}

export interface ChartRow {
  date: string;
  acciones_valor: number;
  acciones_invertido: number;
  fondos_valor: number;
  fondos_invertido: number;
  total_valor: number;
  total_invertido: number;
  /** Totales en CLP (tipo de cambio de cada fecha). */
  total_valor_clp?: number;
  total_invertido_clp?: number;
  /** USD→CLP del día (histórico); preferir a derivar desde totales. */
  fx_usd_clp?: number;
}

export interface SectorSlice {
  sector: string;
  pct: number;
  value: number;
  tickers: string[];
}

export interface SyncStatus {
  last_updated: string | null;
}

export type BankingProductType = "cuenta_corriente" | "cuenta_vista" | "cuenta_prepago" | "tarjeta_credito";

export interface BankingAccountRow {
  id: number;
  name: string;
  balance: number;
  /** Suma de montos en categoría Provisiones (plantilla 21); reverso netea. */
  provision_net_sum?: number;
  /** Equivalente al efectivo en cuenta (~lo que muestra el banco): balance − provision_net_sum */
  balance_at_bank?: number;
  product_type: BankingProductType | null;
}
