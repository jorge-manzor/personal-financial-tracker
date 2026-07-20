# AGENTS.md — Zendo Finance

Instrucciones operativas para agentes de IA. Producto y arquitectura humana: ver `README.md`.

## Overview

App full-stack: **inversiones** (Fintual + manuales) y **cuentas/movimientos** (banking CLP). Auth JWT multiusuario; servicios opt-in por perfil (`investments` / `banking`).

- Backend: Python 3.12, FastAPI, SQLAlchemy 2, SQLite local o Postgres (`DATABASE_URL`)
- Frontend: React 19, Vite 8, TypeScript, Tailwind 4, React Router 7

## Setup y comandos

```bash
# Backend (desde backend/, con venv activado)
pip install -r requirements.txt
cp .env.example .env   # si no existe
uvicorn main:app --reload --host 127.0.0.1 --port 8000

# Frontend
cd frontend && npm install && npm run dev
```

| Comando | Qué hace |
|---------|----------|
| `cd backend && uvicorn main:app --reload --host 127.0.0.1 --port 8000` | API local |
| `cd frontend && npm run dev` | UI en `:5173` |
| `cd frontend && npm run lint` | ESLint |
| `cd frontend && npm run build` | `tsc -b` + Vite build |
| `./scripts/verify.sh` | Import backend + smoke pytest + lint; `VERIFY_BUILD=1` para build; `SKIP_LINT=1` / `SKIP_SMOKE=1` para omitir |

API: `http://127.0.0.1:8000` · OpenAPI: `/docs` · UI: `http://localhost:5173`

Guías anidadas: `backend/AGENTS.md`, `frontend/AGENTS.md`.

## Mapa feature → archivos

| Feature | Backend | Frontend |
|---------|---------|----------|
| Auth / perfil / servicios | `auth.py`, `auth_routes.py` (`/auth/*`) | `Login.tsx`, `Profile.tsx`, `auth.ts` |
| Dashboard inversiones + sync SSE | `main.py`, `fintual_sync.py`, `history.py`, `portfolio_metrics.py` | `App.tsx`, `Dashboard.tsx`, `SyncOverlay.tsx` |
| Transacciones inversión / manuales | `main.py`, `transaction_validation.py` | `TransactionModal.tsx`, `ManualModals.tsx`, Activity* |
| Cliente Fintual | `fintual_client.py`, `fintual_auth_state.py` | `FintualConnectModal.tsx` |
| FX USD/CLP | `exchange_service.py`, `fx_usd_clp.py` | vía dashboard / API |
| Banking CRUD | `banking_routes.py`, `banking_service.py`, `banking_banks.py` | `BankingTransactionsPage.tsx`, `bankingTxHelpers.ts`, `BankingSettingsPage.tsx` |
| Orden personal / provisiones | `banking_personal_order_routes.py` | `BankingPersonalOrderPage.tsx` |
| Calculadora ahorro | `savings_calculator_routes.py` | `SavingsCalculatorPage.tsx` |
| Modelos / schemas | `models.py`, `schemas.py` | `types.ts` |
| Migraciones SQLite al vuelo | `multiuser_migration.py` | — |
| Catálogos JSON | `data/*.json` | — |

## Hard rules (no negociables)

1. **Secretos**: no leer/commitear `backend/.env`; no loguear JWT, cookies Fintual, `JWT_SECRET`, `CMF_API_KEY`, ni passwords.
2. **Multiusuario**: toda query de datos de usuario debe filtrar por `user_id` del usuario autenticado.
3. **Servicios**: banking → `BankingUser` / `require_banking_user`; inversiones → `InvestmentsUser` / `require_investments_user`. No mezclar guards.
4. **SSE `/sync`**: usar `InvestmentsUserSSE` / `get_current_user_sse` con `?access_token=` (EventSource no envía `Authorization`).
5. **Fintual**: credenciales por usuario en BD. `FINTUAL_SESSION` / `FINTUAL_UID` del `.env` **no** sustituyen la cookie del usuario en rutas por usuario (`use_fintual_credentials`).
6. **Migraciones**: el proyecto usa `multiuser_migration.py` (idempotente), no Alembic. Al añadir columna/tabla: `models.py` + migración + `schemas.py` si aplica.
7. **`RESET_BANKING_CATALOG_ON_STARTUP`**: solo desarrollo local; destructivo. Nunca activarlo en producción ni documentarlo como default.
8. **Archivos calientes**: no reescribir enteros sin pedido explícito:
   - `frontend/src/BankingTransactionsPage.tsx`
   - `backend/banking_service.py`
   - `backend/main.py`
   - `backend/fintual_sync.py`
   - `frontend/src/BankingPersonalOrderPage.tsx`
9. **Scope**: cambios mínimos al pedido; no refactors colaterales ni docs no pedidas salvo este árbol AGENTS/docs de agentes.

## Playbooks rápidos

### Nueva ruta API

1. Schema en `schemas.py`.
2. Lógica en el `*_service.py` correspondiente (no hinchar `main.py` si ya hay módulo).
3. Endpoint con el Depends correcto (`BankingUser` / `InvestmentsUser` / `get_current_user`).
4. Si es banking nuevo bajo `/banking`, preferir router dedicado + `include_router` en `main.py`.

### Nueva pantalla frontend

1. Página en `frontend/src/`.
2. Ruta en `App.tsx` condicionada por `me.services.*`.
3. Entrada en sidebar (`AppSidebar.tsx`) si aplica.
4. Llamadas solo vía `api.ts` / `auth.ts` (`API_BASE` en `config.ts`).

### Cambio de modelo / migración

Ver `docs/adding-a-feature.md` y `backend/AGENTS.md`. Checklist: modelo → migración idempotente → schema → rutas → tipos TS.

## Verificación mínima tras cambios

1. Backend importa: `cd backend && python -c "import main"`
2. Frontend: `cd frontend && npm run lint` (y `npm run build` si tocaste tipos/rutas).
3. Si API está arriba: `curl -s http://127.0.0.1:8000/health` y revisar `/docs`.
4. Opcional: `./scripts/verify.sh` (con build: `VERIFY_BUILD=1 ./scripts/verify.sh`)
5. CI: `.github/workflows/ci.yml` (tests backend + lint/build frontend)
6. Flujo PR: no pushear directo a `main` si la branch protection está activa — ver abajo.

## Pull requests (proteger `main`)

1. Trabajar en rama (`feat/…`, `fix/…`), nunca commits directos a `main` una vez activa la protection.
2. Abrir PR a `main`; esperar checks **`backend-smoke`** y **`frontend`** verdes.
3. Merge preferido: squash.
4. Instrucciones de GitHub Settings: `docs/github-branch-protection.md`.

## Docs profundas

| Doc | Contenido |
|-----|-----------|
| `docs/architecture.md` | Capas, auth, sync SSE |
| `docs/invariants.md` | Reglas que no se deben romper |
| `docs/domain-banking.md` | Dominio banking |
| `docs/domain-investments.md` | Dominio inversiones |
| `docs/adding-a-feature.md` | Playbook completo |
| `docs/api-cheat-sheet.md` | Endpoints críticos |
| `docs/github-branch-protection.md` | Cómo proteger `main` + required checks |
| `docs/deploy-render.md` / `docs/deploy-railway.md` | Deploy |

## Idioma

- Copy de UI y mensajes al usuario: **español** (como el resto del producto).
- Identificadores de código: inglés (`snake_case` / `PascalCase` existente).
- Docs de agentes: español, imperativo.
