# Arquitectura

Vista mental para agentes. Detalle de producto: `README.md`. Invariantes: `invariants.md`.

## Capas

```
Browser (React/Vite)
  │  Bearer JWT (localStorage) · SSE ?access_token=
  ▼
FastAPI (main.py + routers)
  │  Depends: get_current_user / InvestmentsUser / BankingUser / SSE
  ▼
Services (banking_service, fintual_sync, exchange_service, …)
  │
  ▼
SQLAlchemy models → SQLite (local) o PostgreSQL (prod)
  │
  └─ Fintual / CMF vía httpx (credenciales por usuario o env solo scripts)
```

## Auth y servicios

1. Registro/login → JWT HS256 (`auth.py`).
2. `User.services_json`: `{ "investments": bool, "banking": bool }`.
3. Perfil (`PATCH /auth/me`) activa servicios; Fintual (`PATCH /auth/me/fintual`) guarda cookie/uid.
4. Frontend oculta rutas si el servicio está off; backend **también** rechaza con 403.

## Sync de portafolio (SSE)

1. UI abre EventSource a `GET /sync?access_token=…`.
2. Pipeline en `fintual_sync.py` + recálculos (`history`, métricas).
3. Overlay de progreso (`SyncOverlay.tsx`); errores de sesión disparan modal de reconexión.

## Banking

- Prefijo HTTP `/banking/*`.
- Tres routers: CRUD principal, orden personal, calculadora de ahorro.
- Lógica centralizada en `banking_service.py` (archivo grande: editar con cuidado).

## Inversiones

- Rutas mayormente en `main.py`.
- Modelos: transacciones, posiciones Fintual, wallet, caches de precio/valor, activos manuales.
- Dashboard agrega holdings, charts, activity, sectores.

## Startup

Al arrancar: engine DB, migraciones `run_multiuser_migration`, seed de catálogos banking según flags de entorno. Ver `main.py` lifespan / imports de migración.
