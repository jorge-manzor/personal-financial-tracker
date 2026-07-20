# AGENTS.md — backend

Complementa el `AGENTS.md` raíz. Trabaja aquí al editar Python bajo `backend/`.

## Layout

| Rol | Archivos |
|-----|----------|
| App + rutas inversiones | `main.py` |
| Auth HTTP | `auth_routes.py` |
| Auth JWT / services | `auth.py` |
| ORM | `models.py` |
| Pydantic I/O | `schemas.py` |
| DB engine / session | `database.py` |
| Migraciones SQLite al vuelo | `multiuser_migration.py` |
| Banking HTTP | `banking_routes.py`, `banking_personal_order_routes.py`, `savings_calculator_routes.py` |
| Banking lógica | `banking_service.py` |
| Bancos Chile (SBIF) | `banking_banks.py` |
| Fintual HTTP | `fintual_client.py` |
| Sync portafolio | `fintual_sync.py` |
| Histórico / métricas | `history.py`, `portfolio_metrics.py`, `activity_service.py` |
| FX | `exchange_service.py`, `fx_usd_clp.py` |
| Datos estáticos | `data/bancos_chile.json`, `data/categorias_banking_default.json`, `data/stock-sector.json` |

Routers banking se montan en `main.py` con `prefix="/banking"`.

## Reglas de código

- Lógica de negocio en servicios (`banking_service.py`, etc.), no en handlers gordos.
- Endpoints banking: `BankingUser = Annotated[User, Depends(require_banking_user)]`.
- Endpoints inversiones: `InvestmentsUser` / para SSE `InvestmentsUserSSE`.
- Perfil genérico: `get_current_user`.
- Respuestas tipadas con `response_model=...` de `schemas.py` cuando ya exista el patrón.
- No añadir Alembic; extender `multiuser_migration.py` con flags idempotentes (`_migration_flags`).
- No imprimir cookies ni tokens. Errores al cliente: mensajes genéricos o `detail` controlado.
- Precios de acciones: preferir fuentes Fintual ya integradas; no sustituir por Yahoo “porque sí”.

## Migraciones (checklist)

1. Añadir/ajustar columna o tabla en `models.py`.
2. En `multiuser_migration.py`: detectar con `inspect` / `_table_cols`; `ALTER`/`CREATE` solo si falta; marcar con `_set_migration_flag` si el cambio no es trivialmente detectable.
3. Actualizar `schemas.py` y callers.
4. Probar arranque: `uvicorn` debe aplicar migración sin romper SQLite existente.
5. Postgres en prod: asegurar que el mismo camino de startup / columnas sea compatible (el código ya normaliza `postgres://` en `database.py`).

## Auth y Fintual (trampas)

- `services_json` keys: `investments`, `banking` (`SERVICE_*` en `auth.py`).
- `use_fintual_credentials(session, uid)`: sin cookie en BD del usuario → no caer al `.env` en rutas por usuario.
- Sync marca `fintual_reconnect_required` ante sesión inválida; el frontend abre reconexión.

## Archivos que no reescribir enteros

`banking_service.py`, `main.py`, `fintual_sync.py`, `fintual_client.py`. Cambios quirúrgicos.

## Verificación

```bash
cd backend
python -c "import main"
pip install -r requirements-dev.txt   # una vez
pytest -q tests/test_smoke.py
# API arriba:
curl -s http://127.0.0.1:8000/health
# Explorar contratos: http://127.0.0.1:8000/docs
```

`api_tests/` es exploratorio local (gitignored): no es la suite CI.
Smoke oficial: `tests/test_smoke.py`.
