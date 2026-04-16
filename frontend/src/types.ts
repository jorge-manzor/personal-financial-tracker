/** Preferencias de servicios (extensible: nuevas claves en el futuro). */
export interface UserServices {
  investments: boolean;
}

export interface UserMe {
  id: number;
  email: string;
  services: UserServices;
  /** True si falta cookie guardada o hay que reconectar Fintual. */
  fintual_needs_setup: boolean;
  /** True si una sync falló por sesión inválida (p. ej. cookie caducada ~30 días). */
  fintual_reconnect_required: boolean;
  /** Credenciales Fintual guardadas (mostrar enmascaradas en Perfil). */
  fintual_session_cookie: string | null;
  fintual_uid: string | null;
}

export function normalizeUserMe(raw: {
  id: number;
  email: string;
  services?: Record<string, boolean> | UserServices;
  fintual_needs_setup?: boolean;
  fintual_reconnect_required?: boolean;
  fintual_session_cookie?: string | null;
  fintual_uid?: string | null;
}): UserMe {
  const inv = raw.services && "investments" in raw.services ? raw.services.investments : undefined;
  return {
    id: raw.id,
    email: raw.email,
    services: { investments: inv ?? false },
    fintual_needs_setup: raw.fintual_needs_setup ?? false,
    fintual_reconnect_required: raw.fintual_reconnect_required ?? false,
    fintual_session_cookie: raw.fintual_session_cookie ?? null,
    fintual_uid: raw.fintual_uid ?? null,
  };
}

export function hasAnyActiveService(services: UserServices): boolean {
  return Object.values(services).some(Boolean);
}

export type Period = "1M" | "3M" | "6M" | "1Y" | "3Y" | "YTD" | "ALL";

/** Moneda de visualización del gráfico principal del portafolio. */
export type ChartCurrency = "CLP" | "USD";

/** Incluye tipos Fintual (deposito, retiro, …) y compra/venta/dividendo manual. */
export type TransactionType = string;
export type CategoriaType = "Acciones" | "Fondos" | "AFP" | "Wallet USD";
export type CurrencyType = "USD" | "CLP";

export interface TransactionRow {
  id: number;
  fecha: string;
  tipo: TransactionType;
  activo: string;
  acciones: number;
  precio_unitario: number;
  monto_total: number;
  categoria: string;
  currency: string;
  nombre_activo: string | null;
  /** manual | fintual (acciones) | wallet (movimientos USD) */
  source?: string | null;
  /** Instantáneo de orden (API Fintual / billetera); la UI sigue mostrando solo `fecha`. */
  occurred_at?: string | null;
  /** Solo `source === "wallet"`: tipo crudo GraphQL (p. ej. DEPOSIT). */
  wallet_event_type?: string | null;
  amount_clp?: number | null;
  exchange_rate?: number | null;
}

export interface TransactionListResponse {
  items: TransactionRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface SyncStatus {
  needs_sync: boolean;
  last_updated: string | null;
  tickers: string[];
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

export interface Portfolio {
  total_value: number;
  total_invested: number;
  total_gain: number;
  total_gain_pct: number;
  total_realized: number;
  total_unrealized: number;
  total_dividends: number;
  acciones_value: number;
  manuales_value: number;
  fondos_clp: number;
  fondos_usd_equiv: number;
  afp_clp: number;
  afp_usd_equiv: number;
  exchange_rate_usd_clp: number | null;
}

export interface Holding {
  ticker: string;
  nombre: string;
  total_shares: number;
  avg_buy_price: number;
  capital_invertido: number;
  capital_inicial_total: number;
  current_price: number;
  current_value: number;
  ganancia_realizada: number;
  ganancia_no_realizada: number;
  dividendos: number;
  ganancia_total: number;
  rentabilidad_realizada_pct: number | null;
  rentabilidad_no_realizada_pct: number | null;
  rentabilidad_total_pct: number | null;
  peso_portafolio_pct: number;
  sector: string | null;
  price_unavailable?: boolean;
  logo_url?: string | null;
}

export interface ChartRow {
  date: string;
  acciones_valor: number;
  acciones_invertido: number;
  fondos_valor: number;
  fondos_invertido: number;
  afp_valor: number;
  afp_invertido: number;
  manuales_valor: number;
  total_valor: number;
  total_invertido: number;
  /** Totales en CLP (tipo de cambio de cada fecha). */
  total_valor_clp?: number;
  total_invertido_clp?: number;
  /** USD→CLP del día (histórico); preferir a derivar desde totales. */
  fx_usd_clp?: number;
}

export interface ManualAsset {
  id: number;
  nombre: string;
  categoria: string;
  moneda: string;
  descripcion: string | null;
  ultimo_valor: number | null;
  ultima_fecha: string | null;
}

export interface SectorSlice {
  sector: string;
  pct: number;
  value: number;
  tickers: string[];
}

export interface ExchangeRateInfo {
  rate: number;
  updated_at: string | null;
  previous_rate: number | null;
}

export interface MonthlyMovementRow {
  year: number;
  month: number;
  label: string;
  ingresos: number;
  egresos: number;
  net: number;
  currency: string;
  /** Entradas a la billetera USD (depósito, div. en wallet, intereses, etc.). */
  wallet_ingresos?: number;
  /** Retiros USD a cuenta bancaria. */
  wallet_egresos?: number;
  /** Efectivo usado en compras de acciones (Fintual). */
  acciones_compras?: number;
  /** Efectivo por ventas de acciones (Fintual). */
  acciones_ventas?: number;
  /** Depósitos a fondos/metas (CLP). */
  fondos_depositos?: number;
  /** Retiros desde fondos/metas (CLP). */
  fondos_retiros?: number;
}

/** Punto del gráfico mensual: barras verde/roja siempre alineadas a la leyenda (evita invertir compra/venta). */
export type MonthlyChartPoint = MonthlyMovementRow & {
  barGreen: number;
  barRed: number;
};
