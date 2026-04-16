from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

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


class PasswordChange(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6)


class FintualCredentialsIn(BaseModel):
    """Valores copiados de las cookies del navegador en fintual.cl (DevTools → Application → Cookies)."""

    session_cookie: str = Field(..., min_length=1, description="Valor de _fintual_session_cookie")
    uid: str | None = Field(None, description="Valor de la cookie uid (recomendado)")
