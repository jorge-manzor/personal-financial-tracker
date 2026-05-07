from __future__ import annotations

import asyncio
from pathlib import Path

import json
import os

from dotenv import load_dotenv

# Load backend/.env when uvicorn cwd is project root or backend/
_env_file = Path(__file__).resolve().parent / ".env"
if _env_file.is_file():
    load_dotenv(_env_file)
else:
    load_dotenv()
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import AsyncGenerator, Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from activity_service import distinct_transaction_tipos, monthly_movements, query_transactions
from chart_goal_fondos import augment_chart_rows_with_fintual_goal_balance
from auth import (
    SERVICE_BANKING,
    SERVICE_INVESTMENTS,
    CurrentUser,
    InvestmentsUser,
    InvestmentsUserSSE,
    create_access_token,
    get_optional_user,
    default_services,
    get_user_by_email,
    hash_password,
    user_services,
    verify_password,
)
from banking_personal_order_routes import router as banking_personal_order_router
from savings_calculator_routes import router as savings_calculator_router
from banking_routes import router as banking_router
from database import Base, SessionLocal, engine, get_db
from exchange_service import (
    ensure_exchange_history,
    get_latest_rate,
    get_previous_rate,
    get_rate_for_date,
    store_today_rate,
)
from fintual_goals_dashboard import fetch_active_goal_cards
from fintual_client import fintual_configured, get_asset_details, use_fintual_credentials
from stock_assets import get_stock_display_from_db, upsert_stock_asset
from history import (
    cache_needs_sync,
    ensure_cache,
    full_recompute,
    get_first_transaction_date,
    get_last_cached_date,
    get_last_trading_day,
    get_tickers_from_transactions,
    recompute_from_transaction_date,
)
from market_data import build_portfolio_history, get_current_prices
from models import (
    BankingAccount,
    BankingCategory,
    BankingSubcategory,
    BankingTransaction,
    ExchangeRateHistory,
    ManualAsset,
    ManualAssetHistory,
    PortfolioValueCache,
    Transaction,
    UnsupportedTicker,
    User,
)
from multiuser_migration import run_multiuser_migration
from portfolio_metrics import (
    get_open_tickers,
    holdings_with_metrics,
    market_price,
    portfolio_summary,
    sector_distribution,
    sp500_change_pct,
)
from schemas import (
    ChartRow,
    DashboardInitialOut,
    DistinctTiposOut,
    FintualCredentialsIn,
    ExchangeRateHistoryRow,
    FintualGoalCardOut,
    ExchangeRateOut,
    HoldingOut,
    ManualAssetCreate,
    ManualAssetOut,
    ManualSnapshotCreate,
    MarketIndicatorsOut,
    MonthlyMovementRow,
    PortfolioOut,
    SectorDistributionOut,
    SectorSlice,
    SyncStatus,
    TokenOut,
    TransactionCreate,
    TransactionListOut,
    TransactionOut,
    TransactionUpdate,
    UserLogin,
    UserOut,
    PasswordChange,
    UserProfilePatch,
    UserRegister,
)
from stock_logos import ensure_logo, is_valid_ticker_for_logo
from transaction_validation import validate_state_after_delete, validate_state_after_update

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _db_is_sqlite() -> bool:
    return engine.dialect.name == "sqlite"


def _postgres_bootstrap_user_if_needed() -> None:
    """
    PostgreSQL: el esquema sale de `Base.metadata.create_all`; las migraciones legacy están pensadas para SQLite.
    Si la tabla `users` está vacía, crear el mismo usuario inicial que inserta `run_multiuser_migration` en SQLite.
    """
    if engine.dialect.name != "postgresql":
        return
    db = SessionLocal()
    try:
        n = db.query(func.count(User.id)).scalar() or 0
        if n == 0:
            db.add(
                User(
                    email="local@portfolio.local",
                    password_hash=hash_password("changeme"),
                    created_at=datetime.now(timezone.utc).replace(tzinfo=None),
                    services_json='{"investments": true}',
                    fintual_reconnect_required=False,
                )
            )
            db.commit()
            logger.warning(
                "Usuario inicial: local@portfolio.local / changeme — cambiá la contraseña cuando puedas."
            )
    finally:
        db.close()


def _fintual_needs_setup(user: User) -> bool:
    """Modal de conexión / reconexión Fintual."""
    if not user_services(user).get(SERVICE_INVESTMENTS, False):
        return False
    if getattr(user, "fintual_reconnect_required", False):
        return True
    if (user.fintual_session or "").strip():
        return False
    return True


def _user_out(user: User) -> UserOut:
    recon = bool(getattr(user, "fintual_reconnect_required", False))
    fs = (user.fintual_session or "").strip()
    fu = (user.fintual_uid or "").strip()
    return UserOut(
        id=user.id,
        email=user.email,
        services=user_services(user),
        fintual_needs_setup=_fintual_needs_setup(user),
        fintual_reconnect_required=recon,
        fintual_session_cookie=fs or None,
        fintual_uid=fu or None,
    )


def _exchange_rate_payload(db: Session) -> ExchangeRateOut:
    row = db.query(ExchangeRateHistory).order_by(ExchangeRateHistory.date.desc()).first()
    prev = get_previous_rate(db)
    if not row:
        r = get_latest_rate(db)
        return ExchangeRateOut(rate=r or 950.0, updated_at=None, source=None, previous_rate=prev)
    return ExchangeRateOut(
        rate=float(row.usd_to_clp),
        updated_at=row.updated_at,
        source=row.source or None,
        previous_rate=prev,
    )


def _migrate_db() -> None:
    with engine.connect() as conn:
        r = conn.execute(text("PRAGMA table_info(transactions)"))
        cols = {row[1] for row in r.fetchall()}
        if "categoria" not in cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN categoria VARCHAR(32) DEFAULT 'Acciones'"))
        if "currency" not in cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN currency VARCHAR(8) DEFAULT 'USD'"))
        if "nombre_activo" not in cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN nombre_activo TEXT"))
        if "source" not in cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN source VARCHAR(16) DEFAULT 'manual'"))
        if "external_id" not in cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN external_id VARCHAR(128)"))
        if "occurred_at" not in cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN occurred_at DATETIME"))
        conn.commit()

    with engine.connect() as conn:
        r = conn.execute(text("PRAGMA table_info(fintual_positions)"))
        fcols = {row[1] for row in r.fetchall()}
        if "sector" not in fcols:
            conn.execute(text("ALTER TABLE fintual_positions ADD COLUMN sector TEXT"))
        if "industry" not in fcols:
            conn.execute(text("ALTER TABLE fintual_positions ADD COLUMN industry TEXT"))
        conn.commit()


def _rebuild_banking_accounts_without_account_type_id(conn) -> None:
    """
    Quita la columna heredada `account_type_id` recreando `banking_accounts`.

    En SQLite, `ALTER TABLE ... DROP COLUMN` puede fallar con FKs inconsistentes en el esquema
    (p. ej. «unknown column in foreign key definition»). Recrear la tabla conserva los `id`
    para no romper `banking_transactions` ni `linked_checking_account_id`.
    """
    r = conn.execute(text("PRAGMA table_info(banking_accounts)"))
    colnames = {row[1] for row in r.fetchall()}
    if "account_type_id" not in colnames:
        return
    final_columns = (
        "id",
        "user_id",
        "name",
        "currency",
        "product_type",
        "bank_sbif",
        "linked_checking_account_id",
        "enabled",
        "opening_balance",
        "balance",
        "created_at",
    )
    required = {"id", "user_id", "name", "currency", "created_at"}
    missing = required - colnames
    if missing:
        raise RuntimeError(f"banking_accounts incompleta: faltan columnas {missing}")

    conn.execute(text("DROP TABLE IF EXISTS banking_accounts_new"))
    conn.execute(text("PRAGMA foreign_keys=OFF"))
    try:
        conn.execute(
            text(
                """
                CREATE TABLE banking_accounts_new (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    name VARCHAR(255) NOT NULL,
                    currency VARCHAR(8) NOT NULL,
                    product_type VARCHAR(32),
                    bank_sbif VARCHAR(8),
                    linked_checking_account_id INTEGER,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    opening_balance FLOAT NOT NULL DEFAULT 0,
                    balance FLOAT NOT NULL DEFAULT 0,
                    created_at DATETIME NOT NULL
                )
                """
            )
        )

        select_exprs: list[str] = []
        for c in final_columns:
            if c in colnames:
                select_exprs.append(c)
            elif c == "product_type":
                select_exprs.append("NULL")
            elif c == "bank_sbif":
                select_exprs.append("NULL")
            elif c == "linked_checking_account_id":
                select_exprs.append("NULL")
            elif c == "enabled":
                select_exprs.append("1")
            elif c in ("opening_balance", "balance"):
                select_exprs.append("0")
            else:
                raise RuntimeError(f"columna sin valor por defecto: {c}")

        ic = ", ".join(final_columns)
        sel = ", ".join(select_exprs)
        conn.execute(text(f"INSERT INTO banking_accounts_new ({ic}) SELECT {sel} FROM banking_accounts"))
        conn.execute(text("DROP TABLE banking_accounts"))
        conn.execute(text("ALTER TABLE banking_accounts_new RENAME TO banking_accounts"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_banking_accounts_user_id ON banking_accounts (user_id)"))
        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_banking_accounts_linked_checking_account_id "
                "ON banking_accounts (linked_checking_account_id)"
            )
        )
        chk = conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence' LIMIT 1")
        )
        if chk.fetchone() is not None:
            mx = conn.execute(text("SELECT COALESCE(MAX(id), 0) FROM banking_accounts")).scalar()
            conn.execute(text("DELETE FROM sqlite_sequence WHERE name = 'banking_accounts'"))
            conn.execute(
                text("INSERT INTO sqlite_sequence (name, seq) VALUES ('banking_accounts', :mx)"),
                {"mx": int(mx)},
            )
    finally:
        conn.execute(text("PRAGMA foreign_keys=ON"))


def _migrate_banking_schema() -> None:
    """SQLite: `create_all` no añade columnas nuevas a tablas ya creadas."""
    with engine.connect() as conn:
        r = conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='banking_accounts' LIMIT 1")
        )
        if r.fetchone() is not None:
            r = conn.execute(text("PRAGMA table_info(banking_accounts)"))
            acols = {row[1] for row in r.fetchall()}
            if "balance" not in acols:
                conn.execute(text("ALTER TABLE banking_accounts ADD COLUMN balance FLOAT NOT NULL DEFAULT 0"))
                logger.info("Migración banking_accounts: columna balance añadida")
            r = conn.execute(text("PRAGMA table_info(banking_accounts)"))
            acols = {row[1] for row in r.fetchall()}
            if "opening_balance" not in acols:
                conn.execute(text("ALTER TABLE banking_accounts ADD COLUMN opening_balance FLOAT NOT NULL DEFAULT 0"))
                conn.execute(
                    text(
                        """
                        UPDATE banking_accounts
                        SET opening_balance = CAST(balance AS REAL) - COALESCE(
                            (
                                SELECT SUM(bt.amount)
                                FROM banking_transactions bt
                                WHERE bt.account_id = banking_accounts.id
                            ),
                            0
                        )
                        """
                    )
                )
                conn.execute(
                    text(
                        """
                        UPDATE banking_accounts
                        SET balance = CAST(opening_balance AS REAL) + COALESCE(
                            (
                                SELECT SUM(bt.amount)
                                FROM banking_transactions bt
                                WHERE bt.account_id = banking_accounts.id
                            ),
                            0
                        )
                        """
                    )
                )
                logger.info(
                    "Migración banking_accounts: opening_balance deducido; saldo alineado con movimientos"
                )
            r = conn.execute(text("PRAGMA table_info(banking_accounts)"))
            acols2 = {row[1] for row in r.fetchall()}
            if "product_type" not in acols2:
                conn.execute(text("ALTER TABLE banking_accounts ADD COLUMN product_type VARCHAR(32)"))
                logger.info("Migración banking_accounts: columna product_type añadida")
            r = conn.execute(text("PRAGMA table_info(banking_accounts)"))
            acols2 = {row[1] for row in r.fetchall()}
            if "bank_sbif" not in acols2:
                conn.execute(text("ALTER TABLE banking_accounts ADD COLUMN bank_sbif VARCHAR(8)"))
                logger.info("Migración banking_accounts: columna bank_sbif añadida")
            r = conn.execute(text("PRAGMA table_info(banking_accounts)"))
            acols2 = {row[1] for row in r.fetchall()}
            if "linked_checking_account_id" not in acols2:
                conn.execute(
                    text(
                        "ALTER TABLE banking_accounts ADD COLUMN linked_checking_account_id "
                        "INTEGER REFERENCES banking_accounts(id)"
                    )
                )
                logger.info("Migración banking_accounts: columna linked_checking_account_id añadida")
            r = conn.execute(text("PRAGMA table_info(banking_accounts)"))
            acols3 = {row[1] for row in r.fetchall()}
            if "enabled" not in acols3:
                conn.execute(
                    text("ALTER TABLE banking_accounts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1")
                )
                logger.info("Migración banking_accounts: columna enabled añadida")
            r = conn.execute(text("PRAGMA table_info(banking_accounts)"))
            acols_tot = {row[1] for row in r.fetchall()}
            if "include_in_total_balance" not in acols_tot:
                conn.execute(
                    text(
                        "ALTER TABLE banking_accounts ADD COLUMN include_in_total_balance "
                        "INTEGER NOT NULL DEFAULT 1"
                    )
                )
                logger.info("Migración banking_accounts: columna include_in_total_balance añadida")
            # Esquema antiguo local: NOT NULL sin valor en INSERT actual (el tipo de producto es product_type).
            r = conn.execute(text("PRAGMA table_info(banking_accounts)"))
            acols_legacy = {row[1] for row in r.fetchall()}
            if "account_type_id" in acols_legacy:
                dropped = False
                try:
                    conn.execute(text("ALTER TABLE banking_accounts DROP COLUMN account_type_id"))
                    logger.info("Migración banking_accounts: eliminada columna obsoleta account_type_id")
                    dropped = True
                except Exception:
                    pass
                if not dropped:
                    try:
                        _rebuild_banking_accounts_without_account_type_id(conn)
                        logger.info("Migración banking_accounts: tabla reconstruida sin account_type_id")
                    except Exception as ex:
                        logger.warning(
                            "Migración banking_accounts: no se pudo eliminar account_type_id (%s). "
                            "Revisa la base o contacta soporte.",
                            ex,
                        )
        r = conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='banking_subcategories' LIMIT 1")
        )
        if r.fetchone() is not None:
            r = conn.execute(text("PRAGMA table_info(banking_subcategories)"))
            scols = {row[1] for row in r.fetchall()}
            if "template_sub_id" not in scols:
                conn.execute(text("ALTER TABLE banking_subcategories ADD COLUMN template_sub_id INTEGER"))
                logger.info("Migración banking_subcategories: columna template_sub_id añadida")
            r = conn.execute(text("PRAGMA table_info(banking_subcategories)"))
            scols = {row[1] for row in r.fetchall()}
            if "enabled" not in scols:
                conn.execute(text("ALTER TABLE banking_subcategories ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1"))
                logger.info("Migración banking_subcategories: columna enabled añadida")
            r = conn.execute(text("PRAGMA table_info(banking_subcategories)"))
            scols = {row[1] for row in r.fetchall()}
            if "user_id" not in scols:
                conn.execute(text("ALTER TABLE banking_subcategories ADD COLUMN user_id INTEGER REFERENCES users(id)"))
                conn.execute(
                    text(
                        """
                        UPDATE banking_subcategories
                        SET user_id = (
                            SELECT bc.user_id FROM banking_categories bc
                            WHERE bc.id = banking_subcategories.category_id
                        )
                        WHERE user_id IS NULL
                        """
                    )
                )
                logger.info("Migración banking_subcategories: columna user_id añadida y rellenada")
            r = conn.execute(text("PRAGMA table_info(banking_subcategories)"))
            scols = {row[1] for row in r.fetchall()}
            if "user_id" in scols:
                conn.execute(
                    text(
                        """
                        UPDATE banking_subcategories
                        SET user_id = (
                            SELECT bc.user_id FROM banking_categories bc
                            WHERE bc.id = banking_subcategories.category_id
                        )
                        WHERE user_id IS NULL
                        """
                    )
                )
            r = conn.execute(text("PRAGMA table_info(banking_subcategories)"))
            scols_created = {row[1] for row in r.fetchall()}
            if "created_at" not in scols_created:
                conn.execute(
                    text(
                        "ALTER TABLE banking_subcategories ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    )
                )
                logger.info("Migración banking_subcategories: columna created_at añadida")
            r = conn.execute(text("PRAGMA table_info(banking_subcategories)"))
            scols_so = {row[1] for row in r.fetchall()}
            if "sort_order" not in scols_so:
                conn.execute(text("ALTER TABLE banking_subcategories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"))
                conn.execute(
                    text(
                        """
                        UPDATE banking_subcategories
                        SET sort_order = (
                            SELECT COUNT(*)
                            FROM banking_subcategories b2
                            WHERE b2.category_id = banking_subcategories.category_id
                            AND b2.id < banking_subcategories.id
                        )
                        """
                    )
                )
                logger.info("Migración banking_subcategories: sort_order inicial por id dentro de cada categoría")
        r = conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='banking_categories' LIMIT 1")
        )
        if r.fetchone() is not None:
            r = conn.execute(text("PRAGMA table_info(banking_categories)"))
            ccols = {row[1] for row in r.fetchall()}
            if "sort_order" not in ccols:
                conn.execute(text("ALTER TABLE banking_categories ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"))
                logger.info("Migración banking_categories: columna sort_order añadida")
            r = conn.execute(text("PRAGMA table_info(banking_categories)"))
            ccols = {row[1] for row in r.fetchall()}
            if "color" not in ccols:
                conn.execute(text("ALTER TABLE banking_categories ADD COLUMN color VARCHAR(16)"))
                logger.info("Migración banking_categories: columna color añadida")
            r = conn.execute(text("PRAGMA table_info(banking_categories)"))
            ccols = {row[1] for row in r.fetchall()}
            if "names_locked" not in ccols:
                conn.execute(
                    text("ALTER TABLE banking_categories ADD COLUMN names_locked INTEGER NOT NULL DEFAULT 1")
                )
                logger.info("Migración banking_categories: columna names_locked añadida")
            r = conn.execute(text("PRAGMA table_info(banking_categories)"))
            ccols = {row[1] for row in r.fetchall()}
            if "created_at" not in ccols:
                conn.execute(
                    text(
                        "ALTER TABLE banking_categories ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
                    )
                )
                logger.info("Migración banking_categories: columna created_at añadida")
            r = conn.execute(text("PRAGMA table_info(banking_categories)"))
            ccols = {row[1] for row in r.fetchall()}
            if "template_cat_id" not in ccols:
                conn.execute(text("ALTER TABLE banking_categories ADD COLUMN template_cat_id INTEGER"))
                logger.info("Migración banking_categories: columna template_cat_id añadida")
            r = conn.execute(text("PRAGMA table_info(banking_categories)"))
            ccols = {row[1] for row in r.fetchall()}
            if "enabled" not in ccols:
                conn.execute(text("ALTER TABLE banking_categories ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1"))
                logger.info("Migración banking_categories: columna enabled añadida")
        r = conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='banking_transactions' LIMIT 1")
        )
        if r.fetchone() is not None:
            r = conn.execute(text("PRAGMA table_info(banking_transactions)"))
            tcols = {row[1] for row in r.fetchall()}
            if "category_id" not in tcols:
                conn.execute(text("ALTER TABLE banking_transactions ADD COLUMN category_id INTEGER"))
                logger.info("Migración banking_transactions: columna category_id añadida")
            if "subcategory_id" not in tcols:
                conn.execute(text("ALTER TABLE banking_transactions ADD COLUMN subcategory_id INTEGER"))
                logger.info("Migración banking_transactions: columna subcategory_id añadida")
            conn.execute(
                text(
                    """
                    UPDATE banking_transactions
                    SET category_id = (
                        SELECT bs.category_id FROM banking_subcategories bs
                        WHERE bs.id = banking_transactions.subcategory_id
                    )
                    WHERE category_id IS NULL AND subcategory_id IS NOT NULL
                    """
                )
            )
            conn.execute(
                text(
                    """
                    UPDATE banking_transactions
                    SET category_id = (
                        SELECT MIN(bc.id) FROM banking_categories bc
                        WHERE bc.user_id = banking_transactions.user_id
                    )
                    WHERE category_id IS NULL
                    """
                )
            )
            conn.execute(
                text(
                    """
                    UPDATE banking_transactions
                    SET subcategory_id = (
                        SELECT MIN(bs.id) FROM banking_subcategories bs
                        WHERE bs.category_id = banking_transactions.category_id
                    )
                    WHERE subcategory_id IS NULL AND category_id IS NOT NULL
                    """
                )
            )
            del_orphans = conn.execute(
                text(
                    "DELETE FROM banking_transactions WHERE category_id IS NULL OR subcategory_id IS NULL"
                )
            )
            if del_orphans.rowcount and del_orphans.rowcount > 0:
                logger.warning(
                    "Migración banking_transactions: eliminadas %s filas sin categoría/subcategoría válida",
                    del_orphans.rowcount,
                )
            # Solo si aún existe `kind` (BDs ya migradas no la tienen).
            if "kind" in tcols:
                conn.execute(
                    text("UPDATE banking_transactions SET kind = 'income' WHERE lower(trim(kind)) = 'ingreso'")
                )
                conn.execute(
                    text("UPDATE banking_transactions SET kind = 'expense' WHERE lower(trim(kind)) = 'egreso'")
                )
                conn.execute(
                    text(
                        "UPDATE banking_transactions SET amount = -ABS(CAST(amount AS REAL)) "
                        "WHERE kind = 'expense'"
                    )
                )
                conn.execute(
                    text(
                        "UPDATE banking_transactions SET amount = ABS(CAST(amount AS REAL)) "
                        "WHERE kind = 'income'"
                    )
                )
                try:
                    conn.execute(text("ALTER TABLE banking_transactions DROP COLUMN kind"))
                    logger.info(
                        "Migración banking_transactions: monto con signo; columna kind eliminada"
                    )
                except Exception as ex:
                    logger.warning("No se pudo DROP COLUMN kind en banking_transactions: %s", ex)
            r2 = conn.execute(text("PRAGMA table_info(banking_transactions)"))
            tcols2 = {row[1] for row in r2.fetchall()}
            if "is_shared" not in tcols2:
                conn.execute(
                    text("ALTER TABLE banking_transactions ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0")
                )
                logger.info("Migración banking_transactions: columna is_shared añadida")
            if "split_participants" not in tcols2:
                conn.execute(text("ALTER TABLE banking_transactions ADD COLUMN split_participants INTEGER"))
                logger.info("Migración banking_transactions: columna split_participants añadida")
            if "shared_expense_settled" not in tcols2:
                conn.execute(
                    text(
                        "ALTER TABLE banking_transactions ADD COLUMN "
                        "shared_expense_settled INTEGER NOT NULL DEFAULT 0"
                    )
                )
                logger.info("Migración banking_transactions: columna shared_expense_settled añadida")
            if "credit_card_charge_paid" not in tcols2:
                conn.execute(text("ALTER TABLE banking_transactions ADD COLUMN credit_card_charge_paid INTEGER"))
                logger.info("Migración banking_transactions: columna credit_card_charge_paid añadida")
            if "accounting_month" not in tcols2:
                conn.execute(text("ALTER TABLE banking_transactions ADD COLUMN accounting_month DATE"))
                logger.info("Migración banking_transactions: columna accounting_month añadida")
                conn.execute(
                    text(
                        """
                        UPDATE banking_transactions
                        SET accounting_month = strftime('%Y-%m-01', fecha)
                        WHERE accounting_month IS NULL AND fecha IS NOT NULL
                        """
                    )
                )
            r_st = conn.execute(text("PRAGMA table_info(banking_transactions)"))
            tcols_st = {row[1] for row in r_st.fetchall()}
            if "status" not in tcols_st:
                conn.execute(
                    text(
                        "ALTER TABLE banking_transactions ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'posted'"
                    )
                )
                logger.info("Migración banking_transactions: columna status añadida")
            r_peer = conn.execute(text("PRAGMA table_info(banking_transactions)"))
            tcols_peer = {row[1] for row in r_peer.fetchall()}
            if "peer_transaction_id" not in tcols_peer:
                conn.execute(text("ALTER TABLE banking_transactions ADD COLUMN peer_transaction_id INTEGER"))
                logger.info("Migración banking_transactions: columna peer_transaction_id añadida")

        for table, idx_name, cols in (
            ("banking_categories", "ix_banking_categories_user_id", "user_id"),
            ("banking_subcategories", "ix_banking_subcategories_user_id", "user_id"),
            ("banking_subcategories", "ix_banking_subcategories_category_id", "category_id"),
            ("banking_subcategories", "ix_banking_subcategories_template_sub_id", "template_sub_id"),
            ("banking_subcategories", "ix_banking_subcategories_category_sort", "category_id, sort_order"),
        ):
            r = conn.execute(
                text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:t LIMIT 1"),
                {"t": table},
            )
            if r.fetchone() is not None:
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({cols})"))
        r = conn.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='banking_transactions' LIMIT 1")
        )
        if r.fetchone() is not None:
            phantom = conn.execute(
                text(
                    """
                    UPDATE banking_accounts
                    SET opening_balance = 0.0, balance = 0.0
                    WHERE CAST(balance AS REAL) < 0
                    AND NOT EXISTS (
                        SELECT 1 FROM banking_transactions bt
                        WHERE bt.account_id = banking_accounts.id
                    )
                    """
                )
            )
            if phantom.rowcount and phantom.rowcount > 0:
                logger.info(
                    "Migración banking_accounts: saldo negativo sin movimientos corregido en %s fila(s)",
                    phantom.rowcount,
                )
        conn.commit()


def _migrate_db_backfill() -> None:
    """Tras `user_id` en tablas: rellena occurred_at y stock_assets (requiere migración multiusuario)."""
    db_backfill = SessionLocal()
    try:
        from models import FintualPosition, StockAsset

        for t in db_backfill.query(Transaction).filter(Transaction.occurred_at.is_(None)).all():
            t.occurred_at = datetime.combine(t.fecha, time(12, 0, 0))

        for p in db_backfill.query(FintualPosition).all():
            if not p.name or not p.name.strip():
                continue
            sym_p = (p.symbol or "").strip().upper()
            na_p = p.name.strip()
            if na_p.upper() == sym_p:
                continue
            if db_backfill.query(StockAsset).filter(StockAsset.symbol == sym_p).first():
                continue
            upsert_stock_asset(db_backfill, sym_p, na_p, fintual_asset_id=p.fintual_asset_id)

        for t in db_backfill.query(Transaction).filter(
            Transaction.source == "fintual",
            Transaction.categoria == "Acciones",
        ).all():
            sym = (t.activo or "").strip().upper()
            if not sym:
                continue
            if db_backfill.query(StockAsset).filter(StockAsset.symbol == sym).first():
                continue
            na = (t.nombre_activo or "").strip()
            if not na or na.upper() == sym:
                continue
            low = na.lower()
            if low.startswith("dividend ") or low in (
                "dividendo en efectivo",
                "reinversión de dividendo",
                "reinversion de dividendo",
            ):
                continue
            if low.startswith("fintual ·"):
                continue
            upsert_stock_asset(db_backfill, sym, na)

        db_backfill.commit()
    finally:
        db_backfill.close()


def _normalize_cors_origin(origin: str) -> str:
    """Origin header never includes a trailing slash; env typos like https://app/ would break CORS."""
    return origin.strip().rstrip("/")


def _cors_allow_origins() -> list[str]:
    """
    Orígenes permitidos: Vite local + lista en CORS_ORIGINS (coma) p. ej. https://tu-app.onrender.com
    """
    base_raw = ["http://localhost:5173", "http://127.0.0.1:5173"]
    base = [_normalize_cors_origin(o) for o in base_raw]
    seen = set(base)
    out = list(base)
    extra = os.environ.get("CORS_ORIGINS", "").strip()
    if not extra:
        return out
    for part in extra.split(","):
        p = _normalize_cors_origin(part)
        if p and p not in seen:
            seen.add(p)
            out.append(p)
    return out


app = FastAPI(title="Zendo Finance API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_allow_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(banking_router, prefix="/banking", tags=["banking"])
app.include_router(banking_personal_order_router, prefix="/banking", tags=["banking"])
app.include_router(savings_calculator_router, prefix="/banking", tags=["banking"])

@app.get("/stock-logos/{symbol}.png")
def stock_logo_png(symbol: str) -> FileResponse:
    """
    Sirve el logo desde caché local (`backend/data/logos`). Si no existe, intenta descargarlo
    (Fintual GCS → FMP → Clearbit); ver `stock_logos.py`.
    """
    sym = symbol.upper().strip()
    if not is_valid_ticker_for_logo(sym):
        raise HTTPException(status_code=404, detail="Invalid symbol")
    path = ensure_logo(sym)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="Logo not found")
    return FileResponse(path, media_type="image/png")


@app.get("/health")
def health() -> dict[str, str]:
    """Lightweight probe — responds as soon as the process is accepting requests."""
    return {"status": "ok"}


@app.get("/")
def root_probe() -> dict[str, str]:
    """Algunos hosts hacen probe HTTP a `/`; misma respuesta que `/health` para evitar 404 en reinicios."""
    return {"status": "ok"}


@app.post("/auth/register", response_model=TokenOut)
def auth_register(body: UserRegister, db: Session = Depends(get_db)) -> TokenOut:
    email = body.email.strip().lower()
    if get_user_by_email(db, email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email ya registrado")
    u = User(
        email=email,
        password_hash=hash_password(body.password),
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
        services_json=json.dumps(default_services()),
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return TokenOut(access_token=create_access_token(user_id=u.id, email=u.email))


@app.post("/auth/login", response_model=TokenOut)
def auth_login(body: UserLogin, db: Session = Depends(get_db)) -> TokenOut:
    u = get_user_by_email(db, body.email.strip().lower())
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas")
    return TokenOut(access_token=create_access_token(user_id=u.id, email=u.email))


@app.get("/auth/me", response_model=UserOut)
def auth_me(user: CurrentUser) -> UserOut:
    return _user_out(user)


@app.patch("/auth/me", response_model=UserOut)
def auth_patch_me(
    body: UserProfilePatch,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> UserOut:
    svc = user_services(user)
    if body.investments is not None:
        svc[SERVICE_INVESTMENTS] = body.investments
    if body.banking is not None:
        svc[SERVICE_BANKING] = body.banking
    user.services_json = json.dumps(svc)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@app.patch("/auth/me/fintual", response_model=UserOut)
def auth_patch_fintual(
    body: FintualCredentialsIn,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> UserOut:
    user.fintual_session = body.session_cookie.strip()
    uid = (body.uid or "").strip()
    user.fintual_uid = uid if uid else None
    user.fintual_reconnect_required = False
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_out(user)


@app.post("/auth/change-password")
def auth_change_password(
    body: PasswordChange,
    user: CurrentUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La contraseña actual no es correcta")
    user.password_hash = hash_password(body.new_password)
    db.add(user)
    db.commit()
    return {"status": "ok"}


def _seed_if_empty() -> None:
    db = SessionLocal()
    try:
        n = db.query(func.count(Transaction.id)).scalar() or 0
        if n == 0:
            seed_txs = [
                Transaction(
                    user_id=1,
                    fecha=date(2024, 2, 1),
                    tipo="compra",
                    activo="FONDO_BCH",
                    acciones=1.0,
                    precio_unitario=1_000_000.0,
                    monto_total=1_000_000.0,
                    categoria="Fondos",
                    currency="CLP",
                    nombre_activo="Fondo Banchile Acciones",
                    occurred_at=datetime.combine(date(2024, 2, 1), time(12, 0, 0)),
                ),
                Transaction(
                    user_id=1,
                    fecha=date(2024, 5, 1),
                    tipo="compra",
                    activo="AFP_HAB",
                    acciones=1.0,
                    precio_unitario=500_000.0,
                    monto_total=500_000.0,
                    categoria="AFP",
                    currency="CLP",
                    nombre_activo="AFP Habitat Fondo A",
                    occurred_at=datetime.combine(date(2024, 5, 1), time(12, 0, 0)),
                ),
                Transaction(
                    user_id=1,
                    fecha=date(2024, 8, 1),
                    tipo="compra",
                    activo="FONDO_BCH",
                    acciones=1.0,
                    precio_unitario=1_050_000.0,
                    monto_total=1_050_000.0,
                    categoria="Fondos",
                    currency="CLP",
                    nombre_activo="Fondo Banchile Acciones",
                    occurred_at=datetime.combine(date(2024, 8, 1), time(12, 0, 0)),
                ),
            ]
            for t in seed_txs:
                db.add(t)

            ma_bch = ManualAsset(
                user_id=1,
                nombre="Fondo Banchile Acciones",
                categoria="Fondos",
                moneda="CLP",
                descripcion="FONDO_BCH",
            )
            db.add(ma_bch)
            ma_afp = ManualAsset(
                user_id=1,
                nombre="AFP Habitat Fondo A",
                categoria="AFP",
                moneda="CLP",
                descripcion="AFP_HAB",
            )
            db.add(ma_afp)
            db.flush()
            for fd, val in [
                (date(2024, 2, 1), 1_000_000.0),
                (date(2024, 6, 1), 1_120_000.0),
                (date(2024, 12, 1), 1_300_000.0),
            ]:
                db.add(ManualAssetHistory(asset_id=ma_bch.id, fecha=fd, valor=val))
            for fd, val in [
                (date(2024, 5, 1), 500_000.0),
                (date(2024, 9, 1), 540_000.0),
                (date(2024, 12, 1), 580_000.0),
            ]:
                db.add(ManualAssetHistory(asset_id=ma_afp.id, fecha=fd, valor=val))

            db.commit()
            logger.info("Seed data inserted.")
    finally:
        db.close()


def _backfill_banking_template_ids() -> None:
    """Completa `template_sub_id` en subcategorías según el JSON por defecto (filas antiguas)."""
    db = SessionLocal()
    try:
        from banking_service import backfill_banking_subcategory_template_ids

        backfill_banking_subcategory_template_ids(db)
    finally:
        db.close()


def _backfill_banking_category_colors() -> None:
    db = SessionLocal()
    try:
        from banking_service import backfill_banking_category_colors

        backfill_banking_category_colors(db)
    finally:
        db.close()


def _ensure_banking_personal_provision_amount_clp() -> None:
    """Si la tabla existía sin `amount_clp` (despliegues previos), añade la columna."""
    from sqlalchemy import inspect as sa_inspect

    insp = sa_inspect(engine)
    if not insp.has_table("banking_personal_provision_items"):
        return
    cols = {c["name"] for c in insp.get_columns("banking_personal_provision_items")}
    if "amount_clp" in cols:
        return
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(
                text(
                    "ALTER TABLE banking_personal_provision_items "
                    "ADD COLUMN IF NOT EXISTS amount_clp DOUBLE PRECISION"
                )
            )
        else:
            conn.execute(text("ALTER TABLE banking_personal_provision_items ADD COLUMN amount_clp FLOAT"))
    logger.info("Migración: banking_personal_provision_items.amount_clp añadida")


def _ensure_savings_calculator_initial_balance() -> None:
    """Planes de calculadora: columna `initial_balance_clp` en despliegues previos."""
    from sqlalchemy import inspect as sa_inspect

    insp = sa_inspect(engine)
    if not insp.has_table("savings_calculator_plans"):
        return
    cols = {c["name"] for c in insp.get_columns("savings_calculator_plans")}
    if "initial_balance_clp" in cols:
        return
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(
                text(
                    "ALTER TABLE savings_calculator_plans "
                    "ADD COLUMN IF NOT EXISTS initial_balance_clp DOUBLE PRECISION NOT NULL DEFAULT 0"
                )
            )
        else:
            conn.execute(text("ALTER TABLE savings_calculator_plans ADD COLUMN initial_balance_clp FLOAT NOT NULL DEFAULT 0"))
    logger.info("Migración: savings_calculator_plans.initial_balance_clp añadida")


def _ensure_banking_personal_provision_category_label() -> None:
    from sqlalchemy import inspect as sa_inspect

    insp = sa_inspect(engine)
    if not insp.has_table("banking_personal_provision_items"):
        return
    cols = {c["name"] for c in insp.get_columns("banking_personal_provision_items")}
    if "category_label" in cols:
        return
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(
                text(
                    "ALTER TABLE banking_personal_provision_items "
                    "ADD COLUMN IF NOT EXISTS category_label VARCHAR(255)"
                )
            )
        else:
            conn.execute(
                text("ALTER TABLE banking_personal_provision_items ADD COLUMN category_label VARCHAR(255)")
            )
    logger.info("Migración: banking_personal_provision_items.category_label añadida")


def _ensure_banking_personal_savings_target_amount() -> None:
    """Metas de ahorro: columna opcional `target_amount_clp` (objetivo para % de completitud)."""
    from sqlalchemy import inspect as sa_inspect

    insp = sa_inspect(engine)
    if not insp.has_table("banking_personal_savings_goals"):
        return
    cols = {c["name"] for c in insp.get_columns("banking_personal_savings_goals")}
    if "target_amount_clp" in cols:
        return
    with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            conn.execute(
                text(
                    "ALTER TABLE banking_personal_savings_goals "
                    "ADD COLUMN IF NOT EXISTS target_amount_clp DOUBLE PRECISION"
                )
            )
        else:
            conn.execute(text("ALTER TABLE banking_personal_savings_goals ADD COLUMN target_amount_clp FLOAT"))
    logger.info("Migración: banking_personal_savings_goals.target_amount_clp añadida")


def _backfill_personal_provision_category_labels() -> None:
    """Una vez: copia nombres de categorías bancarias legacy a category_label (texto libre)."""
    from models import BankingCategory, BankingPersonalProvisionItem, BankingSubcategory

    db = SessionLocal()
    try:
        rows = (
            db.query(BankingPersonalProvisionItem)
            .filter(
                BankingPersonalProvisionItem.category_label.is_(None),
                BankingPersonalProvisionItem.category_id.isnot(None),
            )
            .all()
        )
        if not rows:
            return
        for r in rows:
            parts: list[str] = []
            if r.category_id:
                c = db.query(BankingCategory).filter(BankingCategory.id == r.category_id).first()
                if c and c.name:
                    parts.append(str(c.name).strip())
            if r.subcategory_id:
                s = db.query(BankingSubcategory).filter(BankingSubcategory.id == r.subcategory_id).first()
                if s and s.name:
                    parts.append(str(s.name).strip())
            if parts:
                r.category_label = " · ".join(parts)[:255]
        db.commit()
        logger.info("Backfill: category_label desde categorías legacy (orden personal).")
    finally:
        db.close()


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    _ensure_savings_calculator_initial_balance()
    _ensure_banking_personal_provision_amount_clp()
    _ensure_banking_personal_provision_category_label()
    _ensure_banking_personal_savings_target_amount()
    _backfill_personal_provision_category_labels()
    if _db_is_sqlite():
        _migrate_db()
        _migrate_banking_schema()
    _backfill_banking_category_colors()
    _backfill_banking_template_ids()
    if _db_is_sqlite():
        run_multiuser_migration(engine)
    else:
        _postgres_bootstrap_user_if_needed()
    _migrate_db_backfill()
    _seed_if_empty()
    db_tpl = SessionLocal()
    try:
        _reset_catalog = os.environ.get("RESET_BANKING_CATALOG_ON_STARTUP", "").strip().lower() in (
            "1",
            "true",
            "yes",
            "on",
        )
        if _reset_catalog:
            from banking_service import reset_banking_catalog_from_json_fresh

            reset_banking_catalog_from_json_fresh(db_tpl)
        else:
            from banking_service import reapply_banking_template_all_users

            reapply_banking_template_all_users(db_tpl)
    except Exception as e:
        logger.warning("Startup: plantilla categorías banking (%s)", e)
    finally:
        db_tpl.close()
    db_boot = SessionLocal()
    try:
        store_today_rate(db_boot)
    except Exception as e:
        logger.warning("Startup: no se pudo refrescar USD/CLP (%s)", e)
        db_boot.rollback()
    finally:
        db_boot.close()


def _period_start(period: str, last_day: date) -> date:
    if period == "1M":
        return last_day - timedelta(days=30)
    if period == "3M":
        return last_day - timedelta(days=90)
    if period == "6M":
        return last_day - timedelta(days=180)
    if period == "1Y":
        return last_day - timedelta(days=365)
    if period == "3Y":
        return last_day - timedelta(days=365 * 3)
    if period == "YTD":
        return date(last_day.year, 1, 1)
    # ALL — caller clamps to first transaction
    return date(1970, 1, 1)


def _subsample_chart_rows(rows: list[ChartRow], period: str, max_points: int = 400) -> list[ChartRow]:
    """Long windows: reduce points for the client (daily cache → sampled series)."""
    if period not in ("3Y", "ALL") or len(rows) <= max_points:
        return rows
    n = len(rows)
    indices = [int(round(i * (n - 1) / (max_points - 1))) for i in range(max_points)]
    out: list[ChartRow] = []
    prev = -1
    for idx in indices:
        if idx != prev:
            out.append(rows[idx])
            prev = idx
    return out


@app.get("/sync-status", response_model=SyncStatus)
def sync_status(user: InvestmentsUser, db: Session = Depends(get_db)) -> SyncStatus:
    uid = user.id
    tickers = get_tickers_from_transactions(db, uid)
    lu = get_last_cached_date(db, uid)
    return SyncStatus(
        needs_sync=cache_needs_sync(db, uid),
        last_updated=lu,
        tickers=tickers,
    )


@app.delete("/unsupported-tickers")
def clear_unsupported_tickers(
    user: InvestmentsUser,
    ticker: str | None = Query(None, description="If set, only remove this symbol; otherwise clear all flags."),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """
    Remove Alpha Vantage 'unsupported' flags so live quotes are attempted again.
    Use after rate limits mistakenly marked tickers, or to fix bad data.
    """
    if ticker:
        sym = ticker.upper().strip()
        row = db.query(UnsupportedTicker).filter(UnsupportedTicker.ticker == sym).first()
        if not row:
            return {"deleted": 0}
        db.delete(row)
        db.commit()
        return {"deleted": 1}
    rows = db.query(UnsupportedTicker).all()
    n = len(rows)
    for r in rows:
        db.delete(r)
    db.commit()
    return {"deleted": n}


async def _sse_sync(user: User, tickers: list[str], force: bool) -> AsyncGenerator[dict, None]:
    n = max(len(tickers), 1)
    yield {
        "event": "message",
        "data": json.dumps({"event": "batch_start", "total": n, "progress_pct": 0}),
    }

    db = SessionLocal()
    try:
        yield {
            "event": "message",
            "data": json.dumps(
                {"event": "message", "message": "Sincronizando Fintual (posiciones, precios, movimientos)…", "progress_pct": 8},
            ),
        }
        from fintual_auth_state import is_likely_fintual_auth_error
        from market_data import sync_pipeline_prices_and_portfolio

        try:
            with use_fintual_credentials(user.fintual_session, user.fintual_uid):
                await sync_pipeline_prices_and_portfolio(db, force, user.id)
            yield {
                "event": "message",
                "data": json.dumps(
                    {
                        "event": "computing",
                        "message": "Calculando historial del portafolio…",
                        "progress_pct": 90,
                    },
                ),
            }
            uid_local = user.id
            await asyncio.to_thread(build_portfolio_history, "ALL", uid_local)
        except Exception as e:
            logger.exception("SSE sync falló")
            auth_fail = is_likely_fintual_auth_error(e)
            msg = (
                "Tu sesión con Fintual expiró o dejó de ser válida. Volvé a pegar la cookie en el panel de conexión."
                if auth_fail
                else "No se pudo completar la sincronización. Reintentá más tarde."
            )
            yield {
                "event": "message",
                "data": json.dumps(
                    {
                        "status": "fintual_auth_error" if auth_fail else "sync_error",
                        "message": msg,
                        "progress_pct": 0,
                    },
                ),
            }
            return
    finally:
        db.close()

    yield {
        "event": "message",
        "data": json.dumps({"status": "complete", "event": "complete", "progress_pct": 100}),
    }


@app.get("/sync")
async def sync_stream(
    user: InvestmentsUserSSE,
    force: bool = Query(False),
):
    db = SessionLocal()
    try:
        tickers = list(dict.fromkeys(get_tickers_from_transactions(db, user.id)))
    finally:
        db.close()

    async def gen():
        async for ev in _sse_sync(user, tickers, force):
            yield ev

    return EventSourceResponse(gen())


@app.get("/dashboard-initial", response_model=DashboardInitialOut)
def dashboard_initial(
    user: InvestmentsUser,
    db: Session = Depends(get_db),
    fintual_live: bool = Query(
        True,
        description="Si false, no consulta Fintual en red (metas vacías, precios solo cache local).",
    ),
) -> DashboardInitialOut:
    """Carga inicial: portafolio y holdings. Con fintual_live=0 evita Fintual en red hasta sync manual."""
    uid = user.id
    with use_fintual_credentials(user.fintual_session, user.fintual_uid):
        ensure_cache(db, uid, force=False)
    try:
        ensure_exchange_history(db, uid)
    except Exception as e:
        logger.warning("ensure_exchange_history: %s", e)
    with use_fintual_credentials(user.fintual_session, user.fintual_uid):
        syms = get_open_tickers(db, uid)
        if syms:
            prices = asyncio.run(
                get_current_prices(
                    db,
                    syms,
                    user_id=uid,
                    allow_fintual_network=fintual_live,
                )
            )
        else:
            prices = {}
        p = portfolio_summary(db, uid, prices=prices)
        rows = holdings_with_metrics(db, uid, prices=prices)
        slices_raw = sector_distribution(db, uid, prices=prices)
    holdings_out: list[HoldingOut] = []
    for m in rows:
        holdings_out.append(
            HoldingOut(
                ticker=m["ticker"],
                nombre=m["nombre"],
                total_shares=m["total_shares"],
                avg_buy_price=m["avg_buy_price"],
                capital_invertido=m["capital_invertido"],
                capital_inicial_total=m["capital_inicial_total"],
                current_price=m["current_price"],
                current_value=m["current_value"],
                ganancia_realizada=m["ganancia_realizada"],
                ganancia_no_realizada=m["ganancia_no_realizada"],
                dividendos=m["dividendos"],
                ganancia_total=m["ganancia_total"],
                rentabilidad_realizada_pct=m["rentabilidad_realizada_pct"],
                rentabilidad_no_realizada_pct=m["rentabilidad_no_realizada_pct"],
                rentabilidad_total_pct=m["rentabilidad_total_pct"],
                peso_portafolio_pct=m["peso_portafolio_pct"],
                sector=m.get("sector"),
                price_unavailable=bool(m.get("price_unavailable")),
                logo_url=m.get("logo_url"),
            )
        )
    manual_out: list[ManualAssetOut] = []
    for a in db.query(ManualAsset).filter(ManualAsset.user_id == uid).order_by(ManualAsset.id).all():
        h = (
            db.query(ManualAssetHistory)
            .filter(ManualAssetHistory.asset_id == a.id)
            .order_by(ManualAssetHistory.fecha.desc())
            .first()
        )
        manual_out.append(
            ManualAssetOut(
                id=a.id,
                nombre=a.nombre,
                categoria=a.categoria,
                moneda=a.moneda,
                descripcion=a.descripcion,
                ultimo_valor=float(h.valor) if h else None,
                ultima_fecha=h.fecha if h else None,
            )
        )
    if fintual_live:
        with use_fintual_credentials(user.fintual_session, user.fintual_uid):
            goal_cards = fetch_active_goal_cards(db, user_id=uid)
    else:
        goal_cards = []
    goals_out = [FintualGoalCardOut(**x) for x in goal_cards]
    return DashboardInitialOut(
        portfolio=PortfolioOut(**p),
        holdings=holdings_out,
        sectors=SectorDistributionOut(slices=[SectorSlice(**s) for s in slices_raw]),
        manual_assets=manual_out,
        fintual_goals=goals_out,
    )


@app.get("/portfolio", response_model=PortfolioOut)
def get_portfolio(user: InvestmentsUser, db: Session = Depends(get_db)) -> PortfolioOut:
    with use_fintual_credentials(user.fintual_session, user.fintual_uid):
        p = portfolio_summary(db, user.id)
    return PortfolioOut(**p)


@app.get("/holdings", response_model=list[HoldingOut])
def get_holdings(user: InvestmentsUser, db: Session = Depends(get_db)) -> list[HoldingOut]:
    with use_fintual_credentials(user.fintual_session, user.fintual_uid):
        rows = holdings_with_metrics(db, user.id)
    out: list[HoldingOut] = []
    for m in rows:
        out.append(
            HoldingOut(
                ticker=m["ticker"],
                nombre=m["nombre"],
                total_shares=m["total_shares"],
                avg_buy_price=m["avg_buy_price"],
                capital_invertido=m["capital_invertido"],
                capital_inicial_total=m["capital_inicial_total"],
                current_price=m["current_price"],
                current_value=m["current_value"],
                ganancia_realizada=m["ganancia_realizada"],
                ganancia_no_realizada=m["ganancia_no_realizada"],
                dividendos=m["dividendos"],
                ganancia_total=m["ganancia_total"],
                rentabilidad_realizada_pct=m["rentabilidad_realizada_pct"],
                rentabilidad_no_realizada_pct=m["rentabilidad_no_realizada_pct"],
                rentabilidad_total_pct=m["rentabilidad_total_pct"],
                peso_portafolio_pct=m["peso_portafolio_pct"],
                sector=m.get("sector"),
                price_unavailable=bool(m.get("price_unavailable")),
                logo_url=m.get("logo_url"),
            )
        )
    return out


@app.get("/chart-data", response_model=list[ChartRow])
def chart_data(
    user: InvestmentsUser,
    period: Literal["1M", "3M", "6M", "1Y", "3Y", "YTD", "ALL"] = "ALL",
    db: Session = Depends(get_db),
) -> list[ChartRow]:
    uid = user.id
    ensure_cache(db, uid, force=False)
    last_day = get_last_cached_date(db, uid) or get_last_trading_day()
    first_tx = get_first_transaction_date(db, uid)
    start = _period_start(period, last_day)
    if period == "ALL" and first_tx is not None:
        start = first_tx
    elif first_tx is not None:
        start = max(start, first_tx)

    rows = (
        db.query(PortfolioValueCache)
        .filter(
            PortfolioValueCache.user_id == uid,
            PortfolioValueCache.fecha >= start,
            PortfolioValueCache.fecha <= last_day,
        )
        .order_by(PortfolioValueCache.fecha)
        .all()
    )
    by_date: dict[date, dict[str, PortfolioValueCache]] = {}
    for r in rows:
        by_date.setdefault(r.fecha, {})[r.categoria] = r
    out: list[ChartRow] = []
    for d in sorted(by_date.keys()):
        m = by_date[d]
        acc = m.get("acciones")
        fondos = m.get("fondos")
        afp = m.get("afp")
        man = m.get("manuales")
        tot = m.get("total")
        tv = tot.valor if tot else 0.0
        ti = tot.invertido if tot else 0.0
        rate = float(get_rate_for_date(db, d))
        if rate <= 0:
            rate = 950.0
        out.append(
            ChartRow(
                date=d,
                acciones_valor=acc.valor if acc else 0.0,
                acciones_invertido=acc.invertido if acc else 0.0,
                fondos_valor=fondos.valor if fondos else 0.0,
                fondos_invertido=fondos.invertido if fondos else 0.0,
                afp_valor=afp.valor if afp else 0.0,
                afp_invertido=afp.invertido if afp else 0.0,
                manuales_valor=man.valor if man else 0.0,
                total_valor=tv,
                total_invertido=ti,
                total_valor_clp=tv * rate,
                total_invertido_clp=ti * rate,
                fx_usd_clp=rate,
            )
        )
    with use_fintual_credentials(user.fintual_session, user.fintual_uid):
        out = augment_chart_rows_with_fintual_goal_balance(db, out, uid)
    return _subsample_chart_rows(out, period)


@app.get("/market-price/{ticker}")
def get_market_price(
    ticker: str, user: InvestmentsUser, db: Session = Depends(get_db)
) -> dict[str, float | None]:
    with use_fintual_credentials(user.fintual_session, user.fintual_uid):
        px = market_price(db, ticker.upper(), user.id)
    return {"ticker": ticker.upper(), "price": px}


@app.get("/stocks/{symbol}/display")
def stock_display_name(
    symbol: str, user: InvestmentsUser, db: Session = Depends(get_db)
) -> dict[str, str | None]:
    """Nombre legible del activo: primero tabla local `stock_assets` (rellenada en sync), luego Fintual una vez."""
    sym = symbol.strip().upper()
    if not sym:
        raise HTTPException(status_code=400, detail="symbol required")
    cached = get_stock_display_from_db(db, sym)
    if cached:
        return cached
    with use_fintual_credentials(user.fintual_session, user.fintual_uid):
        configured = fintual_configured()
    if not configured:
        return {"symbol": sym, "name": None}
    try:
        with use_fintual_credentials(user.fintual_session, user.fintual_uid):
            d = get_asset_details(sym)
        name = (d.get("name") or "").strip() or None
        if name and name.upper() == sym:
            name = None
        out_sym = d.get("symbol") or sym
        if isinstance(out_sym, str):
            out_sym = out_sym.strip().upper()
        else:
            out_sym = sym
        if name:
            upsert_stock_asset(db, out_sym, name, fintual_asset_id=str(d.get("id") or "") or None)
            db.commit()
        return {"symbol": out_sym, "name": name}
    except Exception:
        logger.exception("stock_display_name failed for %s", sym)
        return {"symbol": sym, "name": None}


@app.get("/sector-distribution", response_model=SectorDistributionOut)
def get_sector_distribution(user: InvestmentsUser, db: Session = Depends(get_db)) -> SectorDistributionOut:
    with use_fintual_credentials(user.fintual_session, user.fintual_uid):
        slices = [SectorSlice(**s) for s in sector_distribution(db, user.id)]
    return SectorDistributionOut(slices=slices)


@app.get("/transactions", response_model=TransactionListOut)
def list_transactions(
    user: InvestmentsUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=10_000),
    tipo: str | None = Query(None),
    categoria: str | None = Query(None),
    currency: str | None = Query(None),
    q: str | None = Query(None),
    activo_exact: str | None = Query(
        None,
        description="Símbolo del activo (coincidencia exacta, p. ej. historial por ticker)",
    ),
    db: Session = Depends(get_db),
) -> TransactionListOut:
    rows, total = query_transactions(
        db,
        user.id,
        page=page,
        page_size=page_size,
        tipo=tipo,
        categoria=categoria,
        currency=currency,
        q=q,
        activo_exact=activo_exact,
    )
    items: list[TransactionOut] = []
    for r in rows:
        rd = dict(r)
        rd.pop("_src", None)
        if "source" not in rd:
            rd["source"] = None
        items.append(TransactionOut.model_validate(rd))
    return TransactionListOut(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@app.get("/transactions/distinct-tipos", response_model=DistinctTiposOut)
def list_distinct_transaction_tipos(
    user: InvestmentsUser,
    categoria: str | None = Query(None),
    currency: str | None = Query(None),
    q: str | None = Query(None),
    db: Session = Depends(get_db),
) -> DistinctTiposOut:
    tipos = distinct_transaction_tipos(
        db, user.id, categoria=categoria, currency=currency, q=q
    )
    return DistinctTiposOut(tipos=tipos)


@app.get("/exchange-rate", response_model=ExchangeRateOut)
def get_exchange_rate(db: Session = Depends(get_db)) -> ExchangeRateOut:
    return _exchange_rate_payload(db)


@app.post("/exchange-rate/refresh", response_model=ExchangeRateOut)
def post_exchange_rate_refresh(
    db: Session = Depends(get_db),
    auth_user: User | None = Depends(get_optional_user),
) -> ExchangeRateOut:
    try:
        uid = auth_user.id if auth_user is not None else None
        store_today_rate(db, user_id=uid)
    except Exception as e:
        logger.warning("exchange-rate/refresh: %s", e)
    return _exchange_rate_payload(db)


@app.get("/exchange-rate/history", response_model=list[ExchangeRateHistoryRow])
def exchange_rate_history(db: Session = Depends(get_db)) -> list[ExchangeRateHistoryRow]:
    rows = db.query(ExchangeRateHistory).order_by(ExchangeRateHistory.date.asc()).all()
    return [
        ExchangeRateHistoryRow(date=r.date, rate=float(r.usd_to_clp), source=r.source or "")
        for r in rows
    ]


@app.get("/activity/monthly-movements", response_model=list[MonthlyMovementRow])
def activity_monthly_movements(
    user: InvestmentsUser,
    currency: Literal["USD", "CLP", "all"] = "USD",
    scope: Literal["wallet", "stocks", "all", "fondos"] = Query(
        "stocks",
        description="wallet: billetera USD; stocks: compras/ventas acciones US; all: consolidado; fondos: depósitos/retiros CLP (metas Fintual)",
    ),
    db: Session = Depends(get_db),
) -> list[MonthlyMovementRow]:
    raw = monthly_movements(db, user.id, currency, scope)
    return [MonthlyMovementRow(**row) for row in raw]


@app.get("/market-indicators", response_model=MarketIndicatorsOut)
def market_indicators(user: InvestmentsUser, db: Session = Depends(get_db)) -> MarketIndicatorsOut:
    return MarketIndicatorsOut(sp500_change_pct=sp500_change_pct(db))


def _bg_recompute(fecha: date, user_id: int) -> None:
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.id == user_id).first()
        if not u:
            return

        async def _refresh() -> None:
            from market_data import sync_pipeline_prices_and_portfolio

            with use_fintual_credentials(u.fintual_session, u.fintual_uid):
                await sync_pipeline_prices_and_portfolio(db, False, user_id)

        asyncio.run(_refresh())
        recompute_from_transaction_date(db, fecha, user_id)
    finally:
        db.close()


def _bg_full_recompute(user_id: int) -> None:
    db = SessionLocal()
    try:
        full_recompute(db, user_id)
    finally:
        db.close()


@app.post("/transactions", response_model=TransactionOut)
def create_transaction(
    body: TransactionCreate,
    background: BackgroundTasks,
    user: InvestmentsUser,
    db: Session = Depends(get_db),
) -> TransactionOut:
    if (body.categoria or "Acciones") == "Acciones":
        raise HTTPException(
            status_code=400,
            detail="Las acciones US se sincronizan desde Fintual. Solo puedes registrar Fondos o AFP manualmente.",
        )
    sym = body.activo.upper().strip()

    row = Transaction(
        user_id=user.id,
        fecha=body.fecha,
        tipo=body.tipo,
        activo=sym,
        acciones=body.acciones,
        precio_unitario=body.precio_unitario,
        monto_total=body.monto_total,
        categoria=body.categoria,
        currency=body.currency,
        nombre_activo=body.nombre_activo,
        source="manual",
        occurred_at=datetime.combine(body.fecha, time(12, 0, 0)),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    background.add_task(_bg_recompute, row.fecha, user.id)
    return row


@app.put("/transactions/{tx_id}", response_model=TransactionOut)
def update_transaction(
    tx_id: int,
    body: TransactionUpdate,
    background: BackgroundTasks,
    user: InvestmentsUser,
    db: Session = Depends(get_db),
) -> TransactionOut:
    old = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id, Transaction.id == tx_id)
        .first()
    )
    if not old:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    if getattr(old, "source", None) == "fintual" or (old.categoria or "Acciones") == "Acciones":
        raise HTTPException(status_code=400, detail="No se pueden editar movimientos de acciones (Fintual).")
    if (body.categoria or "Acciones") == "Acciones":
        raise HTTPException(status_code=400, detail="No se pueden registrar acciones manualmente.")

    validate_state_after_update(db, tx_id, body, user.id)

    prev_fecha = old.fecha
    sym = body.activo.upper().strip()
    old.fecha = body.fecha
    old.tipo = body.tipo
    old.activo = sym
    old.acciones = body.acciones
    old.precio_unitario = body.precio_unitario
    old.monto_total = body.monto_total
    old.categoria = body.categoria
    old.currency = body.currency
    old.nombre_activo = body.nombre_activo
    old.occurred_at = datetime.combine(body.fecha, time(12, 0, 0))
    db.commit()
    db.refresh(old)

    background.add_task(_bg_recompute, min(prev_fecha, body.fecha), user.id)
    return old


@app.delete("/transactions/{tx_id}")
def delete_transaction(
    tx_id: int,
    background: BackgroundTasks,
    user: InvestmentsUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    old = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id, Transaction.id == tx_id)
        .first()
    )
    if not old:
        raise HTTPException(status_code=404, detail="Transacción no encontrada")
    if getattr(old, "source", None) == "fintual" or (old.categoria or "Acciones") == "Acciones":
        raise HTTPException(status_code=400, detail="No se pueden eliminar movimientos de acciones (Fintual).")

    validate_state_after_delete(db, tx_id, user.id)

    fecha = old.fecha
    db.delete(old)
    db.commit()
    background.add_task(_bg_recompute, fecha, user.id)
    return {"status": "ok"}


@app.get("/manual-assets", response_model=list[ManualAssetOut])
def list_manual_assets(user: InvestmentsUser, db: Session = Depends(get_db)) -> list[ManualAssetOut]:
    assets = (
        db.query(ManualAsset)
        .filter(ManualAsset.user_id == user.id)
        .order_by(ManualAsset.id)
        .all()
    )
    out: list[ManualAssetOut] = []
    for a in assets:
        h = (
            db.query(ManualAssetHistory)
            .filter(ManualAssetHistory.asset_id == a.id)
            .order_by(ManualAssetHistory.fecha.desc())
            .first()
        )
        out.append(
            ManualAssetOut(
                id=a.id,
                nombre=a.nombre,
                categoria=a.categoria,
                moneda=a.moneda,
                descripcion=a.descripcion,
                ultimo_valor=float(h.valor) if h else None,
                ultima_fecha=h.fecha if h else None,
            )
        )
    return out


@app.post("/manual-assets", response_model=ManualAssetOut)
def create_manual_asset(
    body: ManualAssetCreate, user: InvestmentsUser, db: Session = Depends(get_db)
) -> ManualAssetOut:
    a = ManualAsset(
        user_id=user.id,
        nombre=body.nombre,
        categoria=body.categoria,
        moneda=body.moneda,
        descripcion=body.descripcion,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return ManualAssetOut(
        id=a.id,
        nombre=a.nombre,
        categoria=a.categoria,
        moneda=a.moneda,
        descripcion=a.descripcion,
        ultimo_valor=None,
        ultima_fecha=None,
    )


@app.post("/manual-assets/{asset_id}/snapshot", response_model=ManualAssetOut)
def add_snapshot(
    asset_id: int,
    body: ManualSnapshotCreate,
    background: BackgroundTasks,
    user: InvestmentsUser,
    db: Session = Depends(get_db),
) -> ManualAssetOut:
    a = (
        db.query(ManualAsset)
        .filter(ManualAsset.user_id == user.id, ManualAsset.id == asset_id)
        .first()
    )
    if not a:
        raise HTTPException(status_code=404, detail="Activo no encontrado")
    db.add(ManualAssetHistory(asset_id=a.id, fecha=body.fecha, valor=body.valor))
    db.commit()
    background.add_task(_bg_recompute, body.fecha, user.id)
    h = (
        db.query(ManualAssetHistory)
        .filter(ManualAssetHistory.asset_id == a.id)
        .order_by(ManualAssetHistory.fecha.desc())
        .first()
    )
    return ManualAssetOut(
        id=a.id,
        nombre=a.nombre,
        categoria=a.categoria,
        moneda=a.moneda,
        descripcion=a.descripcion,
        ultimo_valor=float(h.valor) if h else None,
        ultima_fecha=h.fecha if h else None,
    )


@app.delete("/manual-assets/{asset_id}")
def delete_manual_asset(
    asset_id: int,
    background: BackgroundTasks,
    user: InvestmentsUser,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    a = (
        db.query(ManualAsset)
        .filter(ManualAsset.user_id == user.id, ManualAsset.id == asset_id)
        .first()
    )
    if not a:
        raise HTTPException(status_code=404, detail="Activo no encontrado")
    db.delete(a)
    db.commit()
    background.add_task(_bg_full_recompute, user.id)
    return {"status": "ok"}

