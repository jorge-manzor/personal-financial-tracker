from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

TransactionType = Literal["compra", "venta", "dividendo"]
CategoriaType = Literal["Acciones", "Fondos", "AFP"]
CurrencyType = Literal["USD", "CLP"]


class TransactionCreate(BaseModel):
    fecha: date
    tipo: TransactionType
    activo: str = Field(..., min_length=1)
    acciones: float = Field(..., gt=0)
    precio_unitario: float = Field(..., gt=0)
    monto_total: float = Field(..., gt=0)
    categoria: CategoriaType = "Acciones"
    currency: CurrencyType = "USD"
    nombre_activo: str | None = None


class TransactionUpdate(TransactionCreate):
    """Same fields as create — used for PUT /transactions/{id}."""


class TransactionOut(BaseModel):
    id: int
    fecha: date
    tipo: str
    activo: str
    acciones: float
    precio_unitario: float
    monto_total: float
    categoria: str
    currency: str
    nombre_activo: str | None
    source: str | None = None
    occurred_at: datetime | None = None
    # Solo movimientos `source=wallet` (GraphQL): depósito CLP, tipo de cambio, tipo crudo Fintual.
    wallet_event_type: str | None = None
    amount_clp: float | None = None
    exchange_rate: float | None = None

    class Config:
        from_attributes = True


class TransactionListOut(BaseModel):
    items: list[TransactionOut]
    total: int
    page: int
    page_size: int


class DistinctTiposOut(BaseModel):
    tipos: list[str]


class ManualAssetCreate(BaseModel):
    nombre: str
    categoria: str
    moneda: str = "USD"
    descripcion: str | None = None


class ManualSnapshotCreate(BaseModel):
    fecha: date
    valor: float = Field(..., gt=0)


class ManualAssetOut(BaseModel):
    id: int
    nombre: str
    categoria: str
    moneda: str
    descripcion: str | None
    ultimo_valor: float | None
    ultima_fecha: date | None

    class Config:
        from_attributes = True


class SyncStatus(BaseModel):
    needs_sync: bool
    last_updated: date | None
    tickers: list[str]


class PortfolioOut(BaseModel):
    total_value: float
    total_invested: float
    total_gain: float
    total_gain_pct: float
    total_realized: float
    total_unrealized: float
    total_dividends: float
    acciones_value: float
    manuales_value: float
    fondos_clp: float = 0.0
    fondos_usd_equiv: float = 0.0
    afp_clp: float = 0.0
    afp_usd_equiv: float = 0.0
    exchange_rate_usd_clp: float | None = None


class HoldingOut(BaseModel):
    ticker: str
    nombre: str
    total_shares: float
    avg_buy_price: float
    capital_invertido: float
    capital_inicial_total: float
    current_price: float
    current_value: float
    ganancia_realizada: float
    ganancia_no_realizada: float
    dividendos: float
    ganancia_total: float
    rentabilidad_realizada_pct: float | None
    rentabilidad_no_realizada_pct: float | None
    rentabilidad_total_pct: float | None
    peso_portafolio_pct: float
    sector: str | None
    price_unavailable: bool = False
    logo_url: str | None = None


class ChartRow(BaseModel):
    date: date
    acciones_valor: float
    acciones_invertido: float
    fondos_valor: float
    fondos_invertido: float
    afp_valor: float
    afp_invertido: float
    manuales_valor: float = 0.0
    total_valor: float
    total_invertido: float
    # Totales en CLP al tipo USD/CLP de cada fecha (gráfico principal)
    total_valor_clp: float = 0.0
    total_invertido_clp: float = 0.0
    """Tipo USD→CLP del día (histórico); evita derivar FX desde total_valor/total_valor_clp en el cliente."""
    fx_usd_clp: float = 0.0


class SectorSlice(BaseModel):
    sector: str
    pct: float
    value: float
    tickers: list[str]


class SectorDistributionOut(BaseModel):
    slices: list[SectorSlice]


class FintualGoalCardOut(BaseModel):
    """Meta/fondo activo (API goals Fintual) para tarjetas del dashboard."""

    id: str
    name: str
    nav_clp: float
    deposited_clp: float
    profit_clp: float
    profit_pct: float
    badge_label: str


class DashboardInitialOut(BaseModel):
    """Single response for initial UI load — one shared price fetch."""

    portfolio: PortfolioOut
    holdings: list[HoldingOut]
    sectors: SectorDistributionOut
    manual_assets: list[ManualAssetOut]
    fintual_goals: list[FintualGoalCardOut] = Field(default_factory=list)


class ExchangeRateOut(BaseModel):
    rate: float
    updated_at: datetime | None
    source: str | None = None
    previous_rate: float | None = None


class ExchangeRateHistoryRow(BaseModel):
    date: date
    rate: float
    source: str


class MonthlyMovementRow(BaseModel):
    year: int
    month: int
    label: str
    ingresos: float
    egresos: float
    net: float
    currency: str
    wallet_ingresos: float = 0.0
    wallet_egresos: float = 0.0
    acciones_compras: float = 0.0
    acciones_ventas: float = 0.0
    fondos_depositos: float = 0.0
    fondos_retiros: float = 0.0


class MarketIndicatorsOut(BaseModel):
    sp500_change_pct: float | None


class UserRegister(BaseModel):
    email: str = Field(..., min_length=3)
    password: str = Field(..., min_length=6)


class UserLogin(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    services: dict[str, bool]
    fintual_needs_setup: bool = Field(
        default=False,
        description="True si hay que abrir el panel de Fintual: sin cookie, o sesión inválida/expirada.",
    )
    fintual_reconnect_required: bool = Field(
        default=False,
        description="True si la última sync detectó sesión Fintual inválida (p. ej. cookie caducada ~30 días).",
    )
    fintual_session_cookie: str | None = Field(
        default=None,
        description="Valor guardado de _fintual_session_cookie (solo el dueño autenticado).",
    )
    fintual_uid: str | None = Field(
        default=None,
        description="Valor guardado de la cookie uid en Fintual, si existe.",
    )


class UserProfilePatch(BaseModel):
    """Actualización parcial de preferencias; solo se aplican campos enviados."""

    investments: bool | None = None
    banking: bool | None = None


class PasswordChange(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6)


class FintualCredentialsIn(BaseModel):
    """Valores copiados de las cookies del navegador en fintual.cl (DevTools → Application → Cookies)."""

    session_cookie: str = Field(..., min_length=1, description="Valor de _fintual_session_cookie")
    uid: str | None = Field(None, description="Valor de la cookie uid (recomendado)")


BankingProductType = Literal["cuenta_corriente", "cuenta_vista", "cuenta_prepago", "tarjeta_credito"]


class BankingAccountOut(BaseModel):
    id: int
    name: str
    currency: str
    balance: float
    provision_net_sum: float = Field(
        0.0,
        description="Suma de montos en categoría Provisiones (plantilla 21); las reversas netean.",
    )
    balance_at_bank: float = Field(
        ...,
        description="Equivalente al saldo en el banco: balance del libro menos neto de provisiones.",
    )
    product_type: BankingProductType | None = None
    bank_sbif: str | None = None
    bank_name: str | None = None
    linked_checking_account_id: int | None = None
    linked_checking_account_name: str | None = None
    enabled: bool = True
    include_in_total_balance: bool = Field(
        True,
        description="Si suma en el total «Saldo real» del resumen (cuentas líquidas).",
    )
    has_transactions: bool = False

    class Config:
        from_attributes = True


class BankingDebtTotalsOut(BaseModel):
    """Totales para resumen de deudas (no ligados a paginación de movimientos)."""

    credit_card_unpaid_clp: float = Field(
        ...,
        description="Suma de cargos en cuentas tarjeta de crédito marcados como no pagados (egresos).",
    )
    shared_unsettled_clp: float = Field(
        ...,
        description=(
            "Suma de (|monto| / participantes) en gastos compartidos sin liquidar: "
            "equivalente a sumar lo que corresponde por persona en cada movimiento."
        ),
    )


class BankingAccountCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    initial_balance: float = 0.0
    product_type: BankingProductType
    bank_sbif: str = Field(..., min_length=1, max_length=8)
    linked_checking_account_id: int | None = None
    enabled: bool = True
    include_in_total_balance: bool = True

    @model_validator(mode="after")
    def tarjeta_credito_requiere_cuenta(self) -> "BankingAccountCreate":
        if self.product_type == "tarjeta_credito":
            if self.linked_checking_account_id is None:
                raise ValueError("Selecciona la cuenta corriente asociada a esta tarjeta.")
            return self
        return self.model_copy(update={"linked_checking_account_id": None})


class BankingAccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    currency: str | None = Field(default=None, max_length=8)
    # Ajusta el saldo mostrado; el backend fija `opening_balance` para que coincida con la suma de movimientos.
    balance: float | None = None
    product_type: BankingProductType | None = None
    bank_sbif: str | None = Field(default=None, min_length=1, max_length=8)
    linked_checking_account_id: int | None = None
    enabled: bool | None = None
    include_in_total_balance: bool | None = None


class BankingBankOut(BaseModel):
    sbif: str
    name: str


class BankingSubcategoryOut(BaseModel):
    id: int
    category_id: int
    name: str
    enabled: bool = True
    sort_order: int = 0
    has_transactions: bool = False
    template_sub_id: int | None = Field(
        default=None,
        description="Id en plantilla seed; null en subcategorías creadas por el usuario.",
    )

    class Config:
        from_attributes = True


class BankingCategoryOut(BaseModel):
    id: int
    name: str
    sort_order: int
    color: str
    names_locked: bool = True
    enabled: bool = True
    internal_reserved: bool = Field(
        default=False,
        description="Categoría de uso interno (plantilla reservada): siempre activa en la UI, sin interruptor.",
    )
    has_transactions: bool = False
    subcategories: list[BankingSubcategoryOut] = Field(default_factory=list)

    class Config:
        from_attributes = True


class BankingCategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    sort_order: int | None = None
    color: str | None = Field(default=None, max_length=16)
    enabled: bool | None = None


class BankingCategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    color: str | None = Field(default=None, max_length=16)


class BankingSubcategoryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class BankingCategoriesReorderBody(BaseModel):
    """Orden deseado: el primer id queda con sort_order 0, etc."""

    category_ids: list[int] = Field(..., min_length=1)


class BankingSubcategoriesReorderBody(BaseModel):
    """Orden de subcategorías dentro de una categoría (primer id → sort_order 0)."""

    subcategory_ids: list[int] = Field(..., min_length=1)


class BankingSubcategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    category_id: int | None = None
    enabled: bool | None = None


class BankingTransactionCreate(BaseModel):
    account_id: int
    fecha: date
    amount: float = Field(..., description="Positivo = ingreso, negativo = egreso.")
    description: str | None = None
    category_id: int
    subcategory_id: int
    transfer_destination_account_id: int | None = Field(
        default=None,
        description="Solo Transferencia → Entre cuentas propias: id del producto destino (no tarjeta).",
    )
    is_shared: bool = False
    split_participants: int | None = Field(
        default=None,
        ge=1,
        description="Personas entre las que se divide el monto (solo si is_shared). Por defecto 2.",
    )
    shared_expense_settled: bool = Field(
        default=False,
        description="Si el gasto compartido ya fue pagado/cerrado entre participantes.",
    )
    credit_card_charge_paid: bool | None = Field(
        default=None,
        description="Solo tarjeta de crédito: si el cargo ya fue pagado en el estado de cuenta.",
    )
    accounting_month: date | None = Field(
        default=None,
        description="Mes contable (primer día del mes); por defecto el mes de fecha.",
    )

    @field_validator("amount")
    @classmethod
    def amount_nonzero(cls, v: float) -> float:
        if v == 0:
            raise ValueError("El monto no puede ser cero")
        return v

    @model_validator(mode="after")
    def validate_shared_split(self):
        if self.is_shared:
            if self.split_participants is None:
                object.__setattr__(self, "split_participants", 2)
            elif self.split_participants < 1:
                raise ValueError("split_participants debe ser >= 1")
        else:
            object.__setattr__(self, "split_participants", None)
            object.__setattr__(self, "shared_expense_settled", False)
        return self


class BankingTransactionPatch(BaseModel):
    account_id: int | None = None
    fecha: date | None = None
    amount: float | None = None
    description: str | None = None
    category_id: int | None = None
    subcategory_id: int | None = None
    is_shared: bool | None = None
    split_participants: int | None = Field(default=None, ge=1)
    shared_expense_settled: bool | None = None
    credit_card_charge_paid: bool | None = None
    accounting_month: date | None = None

    @field_validator("amount")
    @classmethod
    def amount_nonzero_if_set(cls, v: float | None) -> float | None:
        if v is not None and v == 0:
            raise ValueError("El monto no puede ser cero")
        return v


class BankingTransactionOut(BaseModel):
    id: int
    account_id: int
    account_name: str
    fecha: date
    amount: float
    description: str | None = None
    category_id: int
    category_name: str
    category_template_cat_id: int | None = Field(
        default=None,
        description="Id plantilla categoría (p. ej. 21 = Provisiones); solo UI.",
    )
    category_color: str
    subcategory_id: int
    subcategory_name: str
    created_at: datetime
    is_shared: bool = False
    split_participants: int | None = None
    shared_expense_settled: bool = False
    credit_card_charge_paid: bool | None = None
    accounting_month: date | None = None
    amount_per_person: float | None = Field(
        default=None,
        description="abs(amount)/split_participants cuando is_shared.",
    )
    peer_transaction_id: int | None = None
    is_provision_reversal: bool = Field(
        default=False,
        description="True si es reversa automática de provisión (solo lectura / borrar).",
    )
    counterpart_account_id: int | None = None
    counterpart_account_name: str | None = None

    class Config:
        from_attributes = True


class BankingTransactionListOut(BaseModel):
    items: list[BankingTransactionOut]
    total: int
    page: int
    page_size: int


class BankingCreditCardUnpaidGroupOut(BaseModel):
    """Cargos en una cuenta TC sin marcar como pagados."""

    account_id: int
    account_name: str
    items: list[BankingTransactionOut]


class BankingCreditCardUnpaidGroupedResponse(BaseModel):
    groups: list[BankingCreditCardUnpaidGroupOut]


class BankingSharedUnsettledGroupedResponse(BaseModel):
    """Misma forma que cargos TC pendientes: lista de grupos (uno para compartidos sin liquidar)."""

    groups: list[BankingCreditCardUnpaidGroupOut]


class BankingBulkSharedSettledBody(BaseModel):
    transaction_ids: list[int] = Field(..., min_length=1)


class BankingBulkSharedSettledOut(BaseModel):
    updated: int


class BankingBulkReverseProvisionBody(BaseModel):
    transaction_ids: list[int] = Field(..., min_length=1)


class BankingBulkReverseProvisionOut(BaseModel):
    created: int


class PersonalProvisionItemOut(BaseModel):
    id: int
    description: str
    account_id: int | None = None
    account_name: str | None = None
    category_label: str | None = Field(None, description="Etiqueta libre del usuario (no es categoría bancaria).")
    amount_clp: float | None = Field(None, description="Monto orientativo en CLP (solo orden personal).")
    paid: bool
    sort_order: int


class PersonalProvisionItemCreate(BaseModel):
    description: str = Field(..., min_length=1, max_length=4000)
    account_id: int | None = None
    category_label: str | None = Field(None, max_length=255, description="Texto libre para agrupar o filtrar.")
    amount_clp: float | None = Field(None, description="Monto orientativo en CLP (opcional).")


class PersonalProvisionItemPatch(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=4000)
    account_id: int | None = None
    category_label: str | None = Field(None, max_length=255)
    amount_clp: float | None = None
    paid: bool | None = None
    sort_order: int | None = None


class PersonalProvisionReorderBody(BaseModel):
    item_ids: list[int] = Field(..., min_length=1, description="Orden deseado: primer id = primero en la lista.")


class PersonalProvisionRegisterMovementsBody(BaseModel):
    accounting_month: date = Field(..., description="Mes contable (día 1 del mes, ej. 2026-04-01).")
    item_ids: list[int] = Field(..., min_length=1)


class PersonalProvisionRegisterMovementsOut(BaseModel):
    created: int
    skipped: int
    messages: list[str] = Field(default_factory=list)


class PersonalSavingsGoalOut(BaseModel):
    id: int
    title: str
    account_id: int
    account_name: str
    balance_clp: float
    target_amount_clp: float | None = None


class PersonalSavingsGoalCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=512)
    account_id: int = Field(..., ge=1)
    initial_balance_clp: float = Field(0.0, description="Saldo inicial al crear la meta.")
    target_amount_clp: float | None = Field(
        default=None,
        description="Monto objetivo CLP; omitir o null = solo seguimiento de saldo (sin %).",
    )

    @field_validator("target_amount_clp", mode="after")
    @classmethod
    def target_must_be_positive(cls, v: float | None) -> float | None:
        if v is None:
            return None
        if v <= 0:
            raise ValueError("El objetivo debe ser mayor que 0")
        return v


class PersonalSavingsGoalPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=512)
    account_id: int | None = Field(default=None, ge=1)
    target_amount_clp: float | None = Field(
        default=None,
        description="Nuevo objetivo CLP; null explícito quita el objetivo.",
    )

    @field_validator("target_amount_clp", mode="after")
    @classmethod
    def patch_target_positive(cls, v: float | None) -> float | None:
        if v is None:
            return None
        if v <= 0:
            raise ValueError("El objetivo debe ser mayor que 0")
        return v


class PersonalSavingsAdjustBody(BaseModel):
    amount: float = Field(..., description="Suma al saldo seguido (puede ser negativo).")


class PersonalSavingsAdjustmentOut(BaseModel):
    """Línea de historial: ingreso/egreso al saldo seguido (incluye saldo inicial al crear la meta)."""

    id: int
    goal_id: int
    amount: float
    created_at: datetime


SavingsCalculatorMode = Literal["end_date", "target_amount"]


class SavingsCalculatorChartPoint(BaseModel):
    period_index: int
    period_label: str
    cumulative_clp: float


class SavingsCalculatorPlanOut(BaseModel):
    id: int
    name: str
    mode: SavingsCalculatorMode
    start_date: date
    end_date: date | None = None
    monthly_amount_clp: float
    initial_balance_clp: float = Field(0.0, description="Saldo al inicio del primer mes (antes del primer aporte).")
    target_amount_clp: float | None = None
    months_count: int | None = Field(None, description="Meses entre inicio y fin (modo por fecha).")
    total_projected_clp: float | None = Field(None, description="Ahorro acumulado al cierre (modo por fecha).")
    months_needed: int | None = Field(None, description="Meses necesarios para la meta en $ (modo meta).")
    total_at_goal_clp: float | None = Field(None, description="Ahorro total tras esos meses (≥ meta).")
    chart: list[SavingsCalculatorChartPoint]


class SavingsCalculatorPlanCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    mode: SavingsCalculatorMode
    start_date: date
    end_date: date | None = None
    monthly_amount_clp: float = Field(..., gt=0)
    initial_balance_clp: float = Field(0.0, ge=0, description="Saldo inicial antes del primer aporte mensual.")
    target_amount_clp: float | None = Field(None, gt=0)

    @model_validator(mode="after")
    def validate_mode_fields(self) -> SavingsCalculatorPlanCreate:
        if self.mode == "end_date":
            if self.end_date is None:
                raise ValueError("En modo por fecha fin, debes indicar la fecha final.")
            if self.end_date < self.start_date:
                raise ValueError("La fecha fin no puede ser anterior al inicio.")
        elif self.mode == "target_amount":
            if self.target_amount_clp is None:
                raise ValueError("En modo meta en pesos, debes indicar el monto objetivo.")
            if self.end_date is not None:
                raise ValueError("En modo meta en pesos no uses fecha fin (déjala vacía).")
        return self


class SavingsCalculatorPlanPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    mode: SavingsCalculatorMode | None = None
    start_date: date | None = None
    end_date: date | None = None
    monthly_amount_clp: float | None = Field(default=None, gt=0)
    initial_balance_clp: float | None = Field(default=None, ge=0)
    target_amount_clp: float | None = Field(default=None, gt=0)
