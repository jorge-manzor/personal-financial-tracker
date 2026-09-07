# Zendo Finance — Rastreador financiero personal

Aplicación web **full-stack** para **inversiones** (Fintual, activos manuales, gráficos) y **cuentas / movimientos bancarios** en CLP, con **cuentas de usuario**, **JWT** y **servicios opt-in** por perfil.

> Este README resume el contexto del repo para **desarrolladores**: arquitectura, decisiones y cómo arrancar el proyecto.
>
> **Agentes de IA**: empezar por [`AGENTS.md`](./AGENTS.md) (symlinks `CLAUDE.md` / `GEMINI.md`). Detalle en `backend/AGENTS.md`, `frontend/AGENTS.md` y `docs/`.

---

## Producto (estado actual)

| Ámbito | Descripción |
|--------|-------------|
| **Nombre en UI** | Zendo Finance |
| **Servicio — Inversiones** | Panel, transacciones (Fintual + manuales), sincronización de precios/posiciones, metas/fondos, billetera USD, gráficos, sectores. Activable en **Perfil** como “Portafolio de inversiones”. |
| **Servicio — Cuentas y movimientos** | Cuentas (efectivo, corriente, tarjetas de crédito con cuenta corriente enlazada), movimientos con categorías y subcategorías, totales de deuda, vistas de cargos pendientes en TC y gastos compartidos sin liquidar. Catálogo de bancos Chile (SBIF). Activable en **Perfil** como “Cuentas y movimientos”; rutas `/banking/transactions` y `/banking/settings`. Independiente del portafolio Fintual. |
| **Autenticación** | Registro / login con **email + contraseña**; sesión con **JWT** (Bearer). |
| **Multiusuario** | Datos **acotados por `user_id`** (inversiones, banca, credenciales Fintual propias en BD). Las cookies Fintual del `.env` no sustituyen las guardadas por usuario en la API. |

---

## Stack técnico

| Capa | Tecnología |
|------|------------|
| Backend | **Python** (recomendado **3.12**, ver `backend/.python-version`), **FastAPI**, **SQLAlchemy 2**, **SQLite** en local (`portfolio.db`) o **PostgreSQL** en producción (`DATABASE_URL`) |
| Auth | **bcrypt**, **python-jose** (JWT HS256) |
| Tiempo real | **SSE** (`sse-starlette`) para sincronización del portafolio |
| HTTP cliente | **httpx** (Fintual, CMF, etc.) |
| Frontend | **React 19**, **Vite 8**, **TypeScript**, **Tailwind CSS 4**, **React Router 7**, **Recharts**, **@dnd-kit** (orden en tablas Banking), **@tanstack/react-virtual** (tabla principal Banking) |
| Testing frontend | **Vitest** (`npm test`), unidades sobre helpers puros (`bankingTxHelpers.test.ts`) |

---

## Arquitectura backend (conceptos clave)

- **`main.py`**: App FastAPI, CORS, rutas de auth, dashboard, sync SSE, transacciones de inversión, activos manuales, inclusión del router bancario.
- **`banking_routes.py`** / **`banking_service.py`**: API REST bajo prefijo `/banking/*` (cuentas, categorías, movimientos, totales de deuda, agrupaciones TC / gastos compartidos). Protegido con **`require_banking_user`** (`BankingUser`).
- **`auth.py`**: JWT, `get_current_user`, **`SERVICE_INVESTMENTS`** / **`SERVICE_BANKING`** en `services_json`, **`require_investments_user`** / **`InvestmentsUser`**, **`require_banking_user`** / **`BankingUser`**. SSE usa **`get_current_user_sse`** con query `?access_token=` porque `EventSource` no envía cabecera `Authorization`.
- **`models.py`**: `User`, tablas de inversión (`Transaction`, caches, etc.) y tablas **Banking*** (`BankingAccount`, `BankingCategory`, `BankingSubcategory`, `BankingTransaction`, …) con **`user_id`** donde aplica.
- **`fintual_client.py`**: Cliente HTTP a **fintual.cl**. Contexto **`use_fintual_credentials(session, uid)`**: si el usuario **no** tiene cookie en BD, **no** se usa `FINTUAL_SESSION` del `.env` en rutas por usuario.
- **`schemas.py`**: Pydantic; **`UserOut`** incluye `services`, flags Fintual y credenciales enmascaradas para Perfil.
- **`database.py`**: Si no hay `DATABASE_URL`, SQLite local; si hay, Postgres (normaliza URLs `postgres://` del panel de hosting).
- **`multiuser_migration.py`**: Migraciones SQLite al vuelo — revisar al añadir tablas o columnas.
- **`exchange_service.py`**: Histórico USD/CLP (CMF); **`ensure_exchange_history(db, user_id)`** acota el backfill por el usuario.

**Precios e históricos de acciones**: principalmente **Fintual** (no fuentes tipo Yahoo como fuente principal).

---

## Arquitectura frontend (conceptos clave)

- **`src/App.tsx`**: Boot (`/auth/me`, `/dashboard-initial`), rutas, overlay de sync SSE, modal Fintual, navegación condicionada por `me.services.investments` / `banking`. Banking va lazy-loaded.
- **`src/BankingTransactionsPage.tsx`**: orquestador de la tabla de movimientos; la lógica vive repartida en módulos hermanos para no volver a un archivo monolítico: `bankingTxHelpers.ts` (utilidades puras), `bankingTxShared.ts` (tipos/constantes/cache), `bankingTxFilters.tsx`, `bankingTxMainTable.tsx` (tabla virtualizada), `bankingTxAuxTables.tsx` (TC / compartidos / provisiones), `bankingBalanceCards.tsx`, `bankingTxIcons.tsx` y `BankingConfirmDialog.tsx`.
- **`src/BankingSettingsPage.tsx`**: ajustes de cuentas y categorías del servicio bancario.
- **`src/api.ts` / `auth.ts`**: `fetch` con `Authorization: Bearer`, token en `localStorage`.
- **`src/Profile.tsx`**: Activación de inversiones y de “Cuentas y movimientos”; estado y credenciales Fintual.
- **`src/FintualConnectModal.tsx`**: Cookie/uid Fintual; cierre con X, **Esc** o clic fuera.
- **`src/config.ts`**: `VITE_API_BASE` (por defecto `http://localhost:8000`).

---

## Variables de entorno (backend)

Copiar `backend/.env.example` → `backend/.env` (no commitear `.env`).

| Variable | Uso |
|----------|-----|
| `JWT_SECRET` | Firma JWT; **obligatorio en producción** (el default es inseguro). |
| `DATABASE_URL` | Opcional; sin valor → SQLite `./portfolio.db`. En producción suele ser **PostgreSQL** (Render, Railway, etc.). |
| `CORS_ORIGINS` | Orígenes permitidos para el navegador (coma-separados, `https://…`, sin barra final). |
| `FINTUAL_SESSION` / `FINTUAL_UID` | Opcional; útiles para **scripts locales** o pruebas sin usuario en BD; **no** sustituyen la cookie de cada usuario en la API. |
| `FINTUAL_GQL_GOALS` | Opcional; por defecto GraphQL de metas en `https://fintual.cl/gql/`. |
| `CMF_API_KEY` | Histórico oficial USD/CLP (Chile); mejora el backfill de `exchange_rate_history`. |
| `RESET_BANKING_CATALOG_ON_STARTUP` | Solo desarrollo: si está activo, repuebla catálogo bancario desde `data/categorias_banking_default.json` (destructivo sobre datos bancarios locales). |

Frontend: `VITE_API_BASE` si el API no está en el mismo origen.

Despliegue: ver `docs/deploy-render.md` y `docs/deploy-railway.md`.

---

## Cómo ejecutar en local

**Backend** (desde `backend/`, con venv):

```bash
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**Frontend**:

```bash
cd frontend && npm install && npm run dev
```

- API: `http://127.0.0.1:8000`  
- UI: `http://localhost:5173` (CORS apunta al dev frontend).

Tests unitarios frontend (Vitest): `cd frontend && npm test`.

Build producción frontend: `npm run build` → `frontend/dist`.

---

## Flujos importantes

1. **Registro / login** → token JWT guardado en el cliente.
2. **Perfil** → activar “Portafolio de inversiones”; si no hay cookie Fintual, modal de conexión.
3. **Perfil** → activar “Cuentas y movimientos” → acceso a **Movimientos** y **Ajustes** bancarios (`/banking/*`).
4. **Sincronizar** (SSE `/sync`) → pipeline Fintual + recálculo de historial; errores de sesión marcan `fintual_reconnect_required` y disparan reconexión.

---

## Estructura de carpetas (resumen)

```
personal-financial-tracker/
├── AGENTS.md                    # Instrucciones para agentes de IA (también CLAUDE.md / GEMINI.md)
├── .cursor/rules/               # Reglas Cursor (apuntan a AGENTS/docs)
├── scripts/verify.sh            # Smoke: import backend + lint frontend
├── backend/
│   ├── AGENTS.md
│   ├── main.py, database.py
│   ├── auth.py, auth_routes.py
│   ├── banking_routes.py, banking_service.py, banking_banks.py
│   ├── banking_personal_order_routes.py
│   ├── savings_calculator_routes.py
│   ├── models.py, schemas.py
│   ├── fintual_client.py, fintual_sync.py, market_data.py
│   ├── history.py, portfolio_metrics.py, exchange_service.py
│   ├── multiuser_migration.py
│   ├── tests/test_smoke.py
│   ├── data/                    # categorías, bancos Chile, sectores (JSON)
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/
│   ├── AGENTS.md
│   ├── src/
│   │   ├── App.tsx, Dashboard.tsx
│   │   ├── BankingTransactionsPage.tsx (orquestador) + bankingTx*.ts(x) (helpers, filtros, tablas)
│   │   ├── BankingSettingsPage.tsx, BankingConfirmDialog.tsx
│   │   ├── BankingProvisionsPage.tsx, BankingSavingsGoalsPage.tsx, SavingsCalculatorPage.tsx
│   │   ├── Login.tsx, Profile.tsx, FintualConnectModal.tsx
│   │   ├── AppSidebar.tsx, AppHeader.tsx, SyncOverlay.tsx
│   │   ├── api.ts, auth.ts, types.ts, config.ts, format.ts
│   │   └── ...
│   └── package.json
├── docs/
│   ├── architecture.md, invariants.md, adding-a-feature.md
│   ├── domain-banking.md, domain-investments.md, api-cheat-sheet.md
│   ├── github-branch-protection.md
│   ├── deploy-render.md
│   └── deploy-railway.md
├── .github/workflows/ci.yml
└── README.md
```

Para asistentes de IA: empezar por **`AGENTS.md`**. Detalle de dominio y playbooks en `docs/`.

---

## Próximos pasos sugeridos (producto)

- **Banca**: import CSV de bancos, reglas de categorización, o integración con agregadores (si encaja con privacidad y alcance).
- **Inversiones**: mejoras de métricas o exportación según uso real.
- **Producción**: HTTPS, `JWT_SECRET` fuerte, base persistente y backups, CORS acotado a tu dominio, y evitar secretos en logs.

---

## Nota histórica

Existía un README más corto centrado solo en CSV y activos manuales; el proyecto creció hacia **Fintual multiusuario**, **auth**, **Perfil**, **módulo bancario** y opción **Postgres**. Si algo en issues o docs antiguos menciona solo “portfolio local” o “banca planificada”, puede estar desactualizado.
