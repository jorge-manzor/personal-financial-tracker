"""
Migración SQLite: tabla users + user_id en tablas de portafolio.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from auth import hash_password

logger = logging.getLogger(__name__)


def _table_cols(engine: Engine, table: str) -> set[str]:
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def _migration_flag(conn, key: str) -> bool:
    conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS _migration_flags (k TEXT PRIMARY KEY, v TEXT NOT NULL DEFAULT '1')"
        )
    )
    r = conn.execute(text("SELECT 1 FROM _migration_flags WHERE k=:k"), {"k": key}).first()
    return r is not None


def _set_migration_flag(conn, key: str) -> None:
    conn.execute(text("INSERT OR REPLACE INTO _migration_flags (k, v) VALUES (:k, '1')"), {"k": key})


def run_multiuser_migration(engine: Engine) -> None:
    """Idempotente: añade users + user_id y usuario legado."""
    insp = inspect(engine)
    tables = set(insp.get_table_names())

    with engine.connect() as conn:
        if "users" not in tables:
            conn.execute(
                text(
                    """
                    CREATE TABLE users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email VARCHAR(255) NOT NULL UNIQUE,
                        password_hash VARCHAR(255) NOT NULL,
                        created_at DATETIME NOT NULL,
                        fintual_session TEXT,
                        fintual_uid VARCHAR(64),
                        services_json TEXT,
                        fintual_reconnect_required INTEGER NOT NULL DEFAULT 0
                    )
                    """
                )
            )
            conn.commit()
            logger.info("Created table users")

    with engine.connect() as conn:
        r = conn.execute(text("SELECT COUNT(*) FROM users"))
        n_users = r.scalar() or 0
        if n_users == 0:
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            pw = hash_password("changeme")
            conn.execute(
                text(
                    "INSERT INTO users (id, email, password_hash, created_at, services_json) "
                    "VALUES (1, :email, :ph, :ca, :sj)"
                ),
                {
                    "email": "local@portfolio.local",
                    "ph": pw,
                    "ca": now,
                    "sj": '{"investments": true}',
                },
            )
            conn.commit()
            logger.warning(
                "Usuario inicial: local@portfolio.local / changeme — cambiá la contraseña cuando puedas."
            )

    if "users" in inspect(engine).get_table_names() and "services_json" not in _table_cols(engine, "users"):
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN services_json TEXT"))
            conn.commit()
            conn.execute(
                text("UPDATE users SET services_json = :j WHERE services_json IS NULL"),
                {"j": '{"investments": true}'},
            )
            conn.commit()
            logger.info("Columna services_json en users; usuarios existentes: investments activo por defecto")

    if "users" in inspect(engine).get_table_names() and "fintual_reconnect_required" not in _table_cols(
        engine, "users"
    ):
        with engine.connect() as conn:
            conn.execute(
                text("ALTER TABLE users ADD COLUMN fintual_reconnect_required INTEGER NOT NULL DEFAULT 0")
            )
            conn.commit()
            logger.info("Columna fintual_reconnect_required en users")

    uid_tables = (
        "transactions",
        "manual_assets",
        "portfolio_value_cache",
        "fintual_positions",
        "wallet_movements",
        "stock_splits",
    )
    for t in uid_tables:
        if t not in inspect(engine).get_table_names():
            continue
        if "user_id" in _table_cols(engine, t):
            continue
        with engine.connect() as conn:
            conn.execute(text(f"ALTER TABLE {t} ADD COLUMN user_id INTEGER REFERENCES users(id) DEFAULT 1"))
            conn.commit()
            conn.execute(text(f"UPDATE {t} SET user_id = 1 WHERE user_id IS NULL"))
            conn.commit()
            logger.info("Added user_id column to %s", t)

    # Rebuild fintual_positions: UNIQUE(user_id, symbol)
    if (
        "fintual_positions" in inspect(engine).get_table_names()
        and "user_id" in _table_cols(engine, "fintual_positions")
    ):
        with engine.connect() as conn:
            if _migration_flag(conn, "fintual_positions_user_scoped"):
                pass
            else:
                sql = conn.execute(
                    text("SELECT sql FROM sqlite_master WHERE type='table' AND name='fintual_positions'")
                ).scalar()
                compact = (sql or "").replace(" ", "").lower()
                if "user_id" in compact and "unique(user_id,symbol)" in compact:
                    _set_migration_flag(conn, "fintual_positions_user_scoped")
                    conn.commit()
                else:
                    conn.execute(
                        text(
                            """
                            CREATE TABLE fintual_positions_new (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                user_id INTEGER NOT NULL REFERENCES users(id),
                                symbol VARCHAR(32) NOT NULL,
                                name TEXT,
                                fintual_asset_id VARCHAR(64),
                                shares FLOAT NOT NULL,
                                sector TEXT,
                                industry TEXT,
                                updated_at DATETIME NOT NULL,
                                UNIQUE(user_id, symbol)
                            )
                            """
                        )
                    )
                    conn.execute(
                        text(
                            """
                            INSERT INTO fintual_positions_new
                            (id, user_id, symbol, name, fintual_asset_id, shares, sector, industry, updated_at)
                            SELECT id, COALESCE(user_id, 1), symbol, name, fintual_asset_id, shares, sector, industry, updated_at
                            FROM fintual_positions
                            """
                        )
                    )
                    conn.execute(text("DROP TABLE fintual_positions"))
                    conn.execute(text("ALTER TABLE fintual_positions_new RENAME TO fintual_positions"))
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_fintual_positions_user_id ON fintual_positions(user_id)"
                        )
                    )
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_fintual_positions_symbol ON fintual_positions(symbol)"
                        )
                    )
                    _set_migration_flag(conn, "fintual_positions_user_scoped")
                    conn.commit()
                    logger.info("Rebuilt fintual_positions (user_id + symbol unique)")

    # Rebuild wallet_movements: UNIQUE(user_id, external_key)
    if (
        "wallet_movements" in inspect(engine).get_table_names()
        and "user_id" in _table_cols(engine, "wallet_movements")
    ):
        with engine.connect() as conn:
            if _migration_flag(conn, "wallet_movements_user_scoped"):
                pass
            else:
                sql_wm = conn.execute(
                    text("SELECT sql FROM sqlite_master WHERE type='table' AND name='wallet_movements'")
                ).scalar()
                cw = (sql_wm or "").replace(" ", "").lower()
                if "user_id" in cw and "unique(user_id,external_key)" in cw:
                    _set_migration_flag(conn, "wallet_movements_user_scoped")
                    conn.commit()
                else:
                    conn.execute(
                        text(
                            """
                            CREATE TABLE wallet_movements_new (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                user_id INTEGER NOT NULL REFERENCES users(id),
                                external_key VARCHAR(160) NOT NULL,
                                event_type VARCHAR(32) NOT NULL,
                                occurred_at DATETIME NOT NULL,
                                symbol VARCHAR(32),
                                amount_usd FLOAT,
                                amount_clp FLOAT,
                                exchange_rate FLOAT,
                                updated_at DATETIME NOT NULL,
                                UNIQUE(user_id, external_key)
                            )
                            """
                        )
                    )
                    conn.execute(
                        text(
                            """
                            INSERT INTO wallet_movements_new
                            (id, user_id, external_key, event_type, occurred_at, symbol, amount_usd, amount_clp, exchange_rate, updated_at)
                            SELECT id, COALESCE(user_id, 1), external_key, event_type, occurred_at, symbol,
                                   amount_usd, amount_clp, exchange_rate, updated_at
                            FROM wallet_movements
                            """
                        )
                    )
                    conn.execute(text("DROP TABLE wallet_movements"))
                    conn.execute(text("ALTER TABLE wallet_movements_new RENAME TO wallet_movements"))
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_wallet_movements_user_id ON wallet_movements(user_id)"
                        )
                    )
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_wallet_movements_external_key ON wallet_movements(external_key)"
                        )
                    )
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_wallet_movements_event_type ON wallet_movements(event_type)"
                        )
                    )
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_wallet_movements_occurred_at ON wallet_movements(occurred_at)"
                        )
                    )
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_wallet_movements_symbol ON wallet_movements(symbol)"
                        )
                    )
                    _set_migration_flag(conn, "wallet_movements_user_scoped")
                    conn.commit()
                    logger.info("Rebuilt wallet_movements (user_id + external_key unique)")
