from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from database import Base


def _naive_utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, nullable=False)
    # Credenciales Fintual por usuario; si son null, se usa FINTUAL_* del entorno.
    fintual_session = Column(Text, nullable=True)
    fintual_uid = Column(String(64), nullable=True)
    # JSON: {"investments": bool, ...} — funcionalidades opt-in por usuario.
    services_json = Column(Text, nullable=True)
    # True si la última llamada a Fintual indicó sesión inválida (p. ej. cookie expirada).
    fintual_reconnect_required = Column(Boolean, nullable=False, default=False)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("user_id", "external_id", name="uq_transactions_user_external"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    fecha = Column(Date, nullable=False, index=True)
    tipo = Column(String(20), nullable=False)
    activo = Column(String(32), nullable=False)
    acciones = Column(Float, nullable=False)
    precio_unitario = Column(Float, nullable=False)
    monto_total = Column(Float, nullable=False)
    categoria = Column(String(32), nullable=False, default="Acciones")
    currency = Column(String(8), nullable=False, default="USD")
    nombre_activo = Column(Text, nullable=True)
    source = Column(String(16), nullable=False, default="manual")
    external_id = Column(String(128), nullable=True, index=True)
    # Fintual: fulfilledAt / fecha de dividendo; manual: mediodía en fecha contable (orden estable).
    occurred_at = Column(DateTime, nullable=True, index=True)


class ManualAsset(Base):
    __tablename__ = "manual_assets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    nombre = Column(Text, nullable=False)
    categoria = Column(Text, nullable=False)
    moneda = Column(String(8), nullable=False, default="USD")
    descripcion = Column(Text, nullable=True)

    history = relationship(
        "ManualAssetHistory",
        back_populates="asset",
        cascade="all, delete-orphan",
    )


class ManualAssetHistory(Base):
    __tablename__ = "manual_asset_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    asset_id = Column(Integer, ForeignKey("manual_assets.id"), nullable=False, index=True)
    fecha = Column(Date, nullable=False, index=True)
    valor = Column(Float, nullable=False)

    asset = relationship("ManualAsset", back_populates="history")


class PortfolioValueCache(Base):
    __tablename__ = "portfolio_value_cache"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    fecha = Column(Date, nullable=False, index=True)
    categoria = Column(String(32), nullable=False)
    valor = Column(Float, nullable=False)
    invertido = Column(Float, nullable=False, default=0.0)
    last_computed = Column(DateTime, nullable=False)


class ExchangeRateHistory(Base):
    __tablename__ = "exchange_rate_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False, unique=True, index=True)
    usd_to_clp = Column(Float, nullable=False)
    source = Column(String(64), nullable=False, default="")
    updated_at = Column(DateTime, nullable=False)


class PriceCache(Base):
    """Precios diarios (USD) por ticker — rellenados desde Fintual."""

    __tablename__ = "price_cache"

    ticker = Column(String(32), primary_key=True)
    date = Column(Date, primary_key=True, index=True)
    close_price = Column(Float, nullable=False)
    fetched_at = Column(DateTime, nullable=False)


class FintualPosition(Base):
    """Posición acciones US en Fintual."""

    __tablename__ = "fintual_positions"
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_fintual_positions_user_symbol"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    symbol = Column(String(32), nullable=False, index=True)
    name = Column(Text, nullable=True)
    fintual_asset_id = Column(String(64), nullable=True)
    shares = Column(Float, nullable=False)
    sector = Column(Text, nullable=True)
    industry = Column(Text, nullable=True)
    updated_at = Column(DateTime, nullable=False)


class WalletMovement(Base):
    """Movimientos billetera acciones Fintual (GraphQL)."""

    __tablename__ = "wallet_movements"
    __table_args__ = (UniqueConstraint("user_id", "external_key", name="uq_wallet_movements_user_ext"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    external_key = Column(String(160), nullable=False, index=True)
    event_type = Column(String(32), nullable=False, index=True)
    occurred_at = Column(DateTime, nullable=False, index=True)
    symbol = Column(String(32), nullable=True, index=True)
    amount_usd = Column(Float, nullable=True)
    amount_clp = Column(Float, nullable=True)
    exchange_rate = Column(Float, nullable=True)
    updated_at = Column(DateTime, nullable=False)


class UnsupportedTicker(Base):
    """Tickers Alpha Vantage rejects — skip repeated API calls."""

    __tablename__ = "unsupported_tickers"

    ticker = Column(String(32), primary_key=True)
    flagged_at = Column(DateTime, nullable=False)


class StockAsset(Base):
    """
    Nombre legible por ticker (Fintual `stocksAsset.name`), persistido entre syncs.
    Incluye históricos aunque ya no haya posición — a diferencia de `fintual_positions`.
    """

    __tablename__ = "stock_assets"

    symbol = Column(String(32), primary_key=True)
    name = Column(Text, nullable=False)
    fintual_asset_id = Column(String(64), nullable=True)
    updated_at = Column(DateTime, nullable=False)


class StockSplit(Base):
    """Splits desde Fintual (`stocksAssetMovements.splits`) — replay: shares ×= rate; cost basis USD sin cambio."""

    __tablename__ = "stock_splits"
    __table_args__ = (UniqueConstraint("user_id", "fintual_id", name="uq_stock_splits_user_fintual_id"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    symbol = Column(String(32), nullable=False, index=True)
    split_date = Column(Date, nullable=False, index=True)
    rate = Column(Float, nullable=False)
    fintual_id = Column(String(64), nullable=False)


class BankingAccount(Base):
    """Cuenta bancaria / efectivo del usuario (saldo mantenido con movimientos)."""

    __tablename__ = "banking_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    currency = Column(String(8), nullable=False, default="CLP")
    # cuenta_corriente | cuenta_vista | cuenta_prepago | tarjeta_credito
    product_type = Column(String(32), nullable=True)
    # Código SBIF (bancos_chile.json)
    bank_sbif = Column(String(8), nullable=True)
    # Solo tarjeta_credito: cuenta corriente del mismo banco con la que se liquida el pago.
    linked_checking_account_id = Column(Integer, ForeignKey("banking_accounts.id"), nullable=True, index=True)
    # Si False, no aparece en selectores de nuevos movimientos (el saldo sigue en backend).
    enabled = Column(Boolean, nullable=False, default=True)
    # Saldo del libro: opening_balance + sum(movimientos). Se recalcula tras cada movimiento.
    opening_balance = Column(Float, nullable=False, default=0.0)
    balance = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, nullable=False)


class BankingCategory(Base):
    """
    Categoría de presupuesto por usuario (p. ej. «Vivienda», «Alimentacion»).
    Se relaciona 1:N con `BankingSubcategory` y con `BankingTransaction.category_id`.
    """

    __tablename__ = "banking_categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # Id de la categoría en `categorias_banking_default.json` (sincronización).
    template_cat_id = Column(Integer, nullable=True, index=True)
    name = Column(String(255), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    # Hex UI (#RRGGBB); null = asignar desde paleta en API.
    color = Column(String(16), nullable=True)
    # Nombres y subcategorías fijados por la plantilla; el usuario solo puede cambiar color (y orden vía API).
    names_locked = Column(Boolean, nullable=False, default=True)
    # Si False, la categoría no aparece para nuevos movimientos (salvo que ya tenga movimientos).
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=_naive_utc_now)


class BankingSubcategory(Base):
    """
    Subcategoría bajo una `BankingCategory`. `template_sub_id` conserva el id del JSON de seed (opcional).
    """

    __tablename__ = "banking_subcategories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    category_id = Column(Integer, ForeignKey("banking_categories.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    template_sub_id = Column(Integer, nullable=True, index=True)
    enabled = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=_naive_utc_now)


class BankingTransaction(Base):
    """Monto con signo: positivo = ingreso, negativo = egreso (respecto de la cuenta)."""

    __tablename__ = "banking_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    account_id = Column(Integer, ForeignKey("banking_accounts.id"), nullable=False, index=True)
    fecha = Column(Date, nullable=False, index=True)
    amount = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    category_id = Column(Integer, ForeignKey("banking_categories.id"), nullable=False)
    subcategory_id = Column(Integer, ForeignKey("banking_subcategories.id"), nullable=False)
    created_at = Column(DateTime, nullable=False)
    # Estado en libro / UI (p. ej. posted); debe coincidir con columnas SQLite existentes.
    status = Column(String(32), nullable=False, default="posted")
    # Movimiento personal vs compartido (divide monto entre N personas para reportes futuros).
    is_shared = Column(Boolean, nullable=False, default=False)
    split_participants = Column(Integer, nullable=True)
    shared_expense_settled = Column(Boolean, nullable=False, default=False)
    # Solo cuenta tarjeta_credito: si el cargo ya fue pagado en el estado de cuenta.
    credit_card_charge_paid = Column(Boolean, nullable=True)
    # Primer día del mes contable (filtros / gráficos futuros).
    accounting_month = Column(Date, nullable=True, index=True)
    # Movimiento gemelo (transferencia entre cuentas propias): id del otro apunte.
    peer_transaction_id = Column(Integer, nullable=True, index=True)
