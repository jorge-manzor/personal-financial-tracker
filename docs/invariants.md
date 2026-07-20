# Invariantes — no romper

Reglas de dominio y seguridad. Si un cambio las viola, el cambio está mal aunque “compile”.

## Seguridad

1. `JWT_SECRET` en producción debe ser fuerte; el default del código es inseguro para prod.
2. Nunca persistir ni loguear: password en claro, JWT, cookies Fintual, API keys.
3. No commitear `backend/.env`, `portfolio.db`, ni credenciales.
4. `CORS_ORIGINS` debe listar orígenes exactos del frontend (https, sin barra final).

## Multiusuario y autorización

5. Filas de portafolio, banking, caches y credenciales Fintual van acotadas por `user_id` (donde el modelo lo define).
6. Activar un servicio en perfil (`services_json`) no implica acceso a datos de otro usuario.
7. Rutas banking exigen servicio banking + usuario autenticado (`require_banking_user`).
8. Rutas de sync/dashboard de inversiones exigen servicio investments (`require_investments_user` o variante SSE).

## Fintual

9. Cookie/uid por usuario en BD tienen prioridad; el `.env` no sustituye en API por usuario.
10. Sesión inválida → señal de reconexión (`fintual_reconnect_required`), no silenciar el error inventando datos.

## Banking

11. Tarjetas de crédito pueden enlazar cuenta corriente; respetar invariantes de deuda/provisiones del service existente.
12. `RESET_BANKING_CATALOG_ON_STARTUP` borra datos bancarios locales: solo dev explícito.
13. Catálogo default vive en `data/categorias_banking_default.json` / bancos en `data/bancos_chile.json`.

## Datos y migraciones

14. Migraciones SQLite son idempotentes vía `multiuser_migration.py`; no asumir DB limpia.
15. Sin `DATABASE_URL` → SQLite `./portfolio.db`; con URL → Postgres (normalizar `postgres://`).

## Frontend

16. Token solo en cliente vía `auth.ts`; SSE usa query `access_token` porque EventSource no manda header.
17. Rutas UI deben respetar flags `me.services.*` (mismo gate que el API).
18. `API_BASE` sin trailing slash.
