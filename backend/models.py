from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from database import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
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
    external_id = Column(String(128), nullable=True, unique=True, index=True)
    # Fintual: fulfilledAt / fecha de dividendo; manual: mediodía en fecha contable (orden estable).
    occurred_at = Column(DateTime, nullable=True, index=True)


class ManualAsset(Base):
    __tablename__ = "manual_assets"

    id = Column(Integer, primary_key=True, autoincrement=True)
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

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(32), nullable=False, unique=True, index=True)
    name = Column(Text, nullable=True)
    fintual_asset_id = Column(String(64), nullable=True)
    shares = Column(Float, nullable=False)
    sector = Column(Text, nullable=True)
    industry = Column(Text, nullable=True)
    updated_at = Column(DateTime, nullable=False)


class WalletMovement(Base):
    """Movimientos billetera acciones Fintual (GraphQL)."""

    __tablename__ = "wallet_movements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    external_key = Column(String(160), nullable=False, unique=True, index=True)
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

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String(32), nullable=False, index=True)
    split_date = Column(Date, nullable=False, index=True)
    rate = Column(Float, nullable=False)
    fintual_id = Column(String(64), nullable=False)
