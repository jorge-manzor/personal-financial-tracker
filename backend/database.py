import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base


def _resolve_database_url() -> str:
    """
    - Desarrollo: sin DATABASE_URL → SQLite local.
    - Producción (p. ej. Render): DATABASE_URL de PostgreSQL.
    """
    url = (os.environ.get("DATABASE_URL") or "").strip()
    if not url:
        return "sqlite:///./portfolio.db"
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "postgresql+" not in url:
        return "postgresql+psycopg2://" + url[len("postgresql://") :]
    return url


SQLALCHEMY_DATABASE_URL = _resolve_database_url()

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
