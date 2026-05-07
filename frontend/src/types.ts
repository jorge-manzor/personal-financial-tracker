/** Preferencias de servicios (extensible: nuevas claves en el futuro). */
export interface UserServices {
  investments: boolean;
  banking: boolean;
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
  const bank = raw.services && "banking" in raw.services ? raw.services.banking : undefined;
  return {
    id: raw.id,
    email: raw.email,
    services: { investments: inv ?? false, banking: bank ?? false },
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
  /** Origen: `fintual` (GraphQL), `dolarapi`, `cmf_*`, etc. */
  source?: string | null;
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

/** Tipos de producto bancario (coinciden con el backend). */
export type BankingProductType =
  | "cuenta_corriente"
  | "cuenta_vista"
  | "cuenta_prepago"
  | "tarjeta_credito";

export interface BankingAccountRow {
  id: number;
  name: string;
  currency: string;
  balance: number;
  /** Suma de montos en categoría Provisiones (plantilla 21); reverso netea. */
  provision_net_sum?: number;
  /** Equivalente al efectivo en cuenta (~lo que muestra el banco): balance − provision_net_sum */
  balance_at_bank?: number;
  product_type: BankingProductType | null;
  /** Código SBIF (bancos_chile.json). */
  bank_sbif: string | null;
  bank_name: string | null;
  /** Solo tarjeta_credito: cuenta corriente del mismo banco para liquidar pagos. */
  linked_checking_account_id: number | null;
  linked_checking_account_name: string | null;
  /** Si aparece en el selector de cuenta al crear movimientos. */
  enabled: boolean;
  /**
   * Si la cuenta líquida suma en la tarjeta «Saldo real» (total) del resumen en Movimientos.
   * Tarjeta de crédito no aplica al total líquido; el valor puede ignorarse en UI.
   */
  include_in_total_balance?: boolean;
  /** Si tiene movimientos registrados no se puede eliminar (solo desactivar). */
  has_transactions?: boolean;
}

/** Respuesta GET /banking/debt-totals */
export interface BankingDebtTotalsOut {
  /** Neto sum(-monto) en TC no pagados; devoluciones positivas restan. */
  credit_card_unpaid_clp: number;
  /**
   * Neto compartido sin liquidar: -sum(monto/participantes); egresos suben el valor,
   * devoluciones/ingresos positivos lo bajan (alineado al backend).
   */
  shared_unsettled_clp: number;
}

export interface BankingBankRow {
  sbif: string;
  name: string;
}

export interface BankingSubcategoryRow {
  id: number;
  category_id: number;
  name: string;
  enabled: boolean;
  /** Orden dentro de la categoría (selectores en movimientos siguen este orden). */
  sort_order: number;
  /** Si hay movimientos con esta subcategoría, no se puede desactivar. */
  has_transactions: boolean;
  /** Id en plantilla seed (p. ej. 1901 Entre cuentas propias). */
  template_sub_id?: number | null;
}

export interface BankingCategoryRow {
  id: number;
  name: string;
  sort_order: number;
  /** Id en plantilla seed (p. ej. 19 Transferencia). */
  template_cat_id?: number | null;
  /** Hex #rrggbb (asignado en servidor si falta). */
  color: string;
  /** Si true, nombre y subcategorías vienen de la plantilla (solo color y orden editables). */
  names_locked?: boolean;
  enabled: boolean;
  /** Plantilla reservada (uso interno): siempre activa; sin interruptor en ajustes. */
  internal_reserved?: boolean;
  has_transactions: boolean;
  subcategories: BankingSubcategoryRow[];
}

/** `amount` con signo: positivo = ingreso, negativo = egreso. */
export interface BankingTransactionRow {
  id: number;
  account_id: number;
  account_name: string;
  fecha: string;
  amount: number;
  description: string | null;
  category_id: number;
  category_name: string;
  /** Id plantilla categoría (21 = Provisiones); opcional hasta backend actualizado. */
  category_template_cat_id?: number | null;
  category_color: string;
  subcategory_id: number;
  subcategory_name: string;
  created_at: string;
  is_shared: boolean;
  split_participants: number | null;
  shared_expense_settled: boolean;
  credit_card_charge_paid: boolean | null;
  accounting_month: string | null;
  /** Si is_shared: amount/split_participants con signo (devolución positiva resta en totales). */
  amount_per_person?: number | null;
  /** Movimiento gemelo (transferencia entre cuentas propias). */
  peer_transaction_id?: number | null;
  /** Pago TC en cuenta corriente (vinculado al cargo); el monto suele ser editable pese al peer. */
  cc_payment_mirror?: boolean;
  /** Reversa generada por la app; no editable, solo eliminar. */
  is_provision_reversal?: boolean;
  counterpart_account_id?: number | null;
  counterpart_account_name?: string | null;
}

/** GET /banking/credit-card/unpaid-grouped */
export interface BankingCreditCardUnpaidGroup {
  account_id: number;
  account_name: string;
  items: BankingTransactionRow[];
}

/** GET /banking/shared/unsettled-grouped — misma forma que cargos TC pendientes */
export type BankingSharedUnsettledGroup = BankingCreditCardUnpaidGroup;
