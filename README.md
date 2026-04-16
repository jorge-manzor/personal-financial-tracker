# Monitro — Rastreador financiero personal

Aplicación web **full-stack** para seguir **inversiones** (acciones y fondos vía Fintual, activos manuales, gráficos y métricas) con **cuentas de usuario**, **JWT** y **servicios opt-in** por perfil.

> Este README resume el contexto del repo para **desarrolladores** y para **nuevas conversaciones con asistentes de IA**: arquitectura, decisiones y cómo arrancar el proyecto.

---

## Producto (estado actual)

| Ámbito | Descripción |
|--------|-------------|
| **Nombre en UI** | Monitro |
| **Servicio 1 — Inversiones** | Panel, transacciones (Fintual + manuales), sincronización de precios/posiciones, metas/fondos, billetera USD, gráficos, sectores. Activable en **Perfil**. |
| **Autenticación** | Registro / login con **email + contraseña**; sesión con **JWT** (Bearer). |
| **Multiusuario** | Cada usuario tiene su propia fila en `users`, datos de portafolio **acotados por `user_id`**, y credenciales **Fintual propias** guardadas en BD (no se mezclan con otras cuentas). |
| **Servicio 2 (planeado)** | Cuentas bancarias, movimientos y control — orientado a otro perfil de uso (p. ej. pareja). Aún **no implementado** como módulo separado; el modelo de `services_json` está pensado para extenderse (`investments` hoy; nuevas claves mañana). |

---

## Stack técnico

| Capa | Tecnología |
|------|------------|
| Backend | **Python 3.11+**, **FastAPI**, **SQLAlchemy 2**, **SQLite** (`portfolio.db` por defecto) |
| Auth | **bcrypt**, **python-jose** (JWT HS256) |
| Tiempo real | **SSE** (`sse-starlette`) para sincronización del portafolio |
| HTTP cliente | **httpx** (Fintual, CMF, etc.) |
| Frontend | **React 19**, **Vite 8**, **TypeScript**, **Tailwind CSS 4**, **React Router 7**, **Recharts** |

---

## Arquitectura backend (conceptos clave)

- **`main.py`**: App FastAPI, CORS, rutas de auth, dashboard, sync SSE, transacciones, activos manuales, etc.
- **`auth.py`**: Hash de contraseñas, emisión/validación de JWT, `get_current_user`, **`require_investments_user`** / **`InvestmentsUser`** para rutas que exigen el servicio de inversiones activo. SSE usa **`get_current_user_sse`** con query `?access_token=` porque `EventSource` no envía cabecera `Authorization`.
- **`models.py`**: `User` (email, `password_hash`, `fintual_session`, `fintual_uid`, `services_json`, `fintual_reconnect_required`), `Transaction`, `ManualAsset`, caches, `FintualPosition`, `WalletMovement`, etc. — en general con **`user_id`** donde aplica.
- **`fintual_client.py`**: Cliente HTTP a **fintual.cl** (GraphQL, JWT de pricing, etc.). Contexto **`use_fintual_credentials(session, uid)`**: si el usuario **no** tiene cookie en BD, **no** se usa `FINTUAL_SESSION` del `.env` en rutas por usuario (multiusuario).
- **`schemas.py`**: Pydantic; **`UserOut`** incluye `services`, `fintual_needs_setup`, `fintual_reconnect_required`, y credenciales guardadas para la UI de perfil (`fintual_session_cookie`, `fintual_uid`).
- **`multiuser_migration.py`**: Migraciones SQLite al vuelo (columnas `user_id`, etc.) — revisar si se añaden tablas nuevas.
- **`exchange_service.py`**: Histórico USD/CLP (CMF); **`ensure_exchange_history(db, user_id)`** usa la primera fecha relevante del **usuario** para acotar backfill.

**Precios e históricos de acciones**: principalmente **Fintual** (no el README antiguo que citaba Yahoo Finance como fuente principal).

---

## Arquitectura frontend (conceptos clave)

- **`src/App.tsx`**: Boot (`/auth/me`, `/dashboard-initial`), estado global, rutas, overlay de sync SSE, modal **Fintual** cuando faltan credenciales o hay que reconectar.
- **`src/api.ts` / `auth.ts`**: `fetch` con `Authorization: Bearer`, token en `localStorage`.
- **`src/Profile.tsx`**: Servicios (toggle inversiones), estado Fintual, credenciales enmascaradas con ojo.
- **`src/FintualConnectModal.tsx`**: Formulario de cookie/uid; `allowDismiss` si se abre desde Perfil vs modal obligatorio.
- **`src/config.ts`**: `VITE_API_BASE` (default `http://localhost:8000`).

---

## Variables de entorno (backend)

Copiar `backend/.env.example` → `backend/.env` (no commitear `.env`).

| Variable | Uso |
|----------|-----|
| `JWT_SECRET` | Firma JWT; **obligatorio en producción** (el default es inseguro). |
| `FINTUAL_SESSION` / `FINTUAL_UID` | Opcional; útiles para **scripts locales** o pruebas sin usuario en BD; **no** sustituyen la cookie de cada usuario en la API. |
| `FINTUAL_GQL_GOALS` | Opcional; por defecto GraphQL de metas en `https://fintual.cl/gql/`. |
| `CMF_API_KEY` | Histórico oficial USD/CLP (Chile); mejora el backfill de `exchange_rate_history`. |

Frontend: `VITE_API_BASE` si el API no está en el mismo origen.

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

Build producción frontend: `npm run build` → `frontend/dist`.

---

## Flujos importantes

1. **Registro / login** → token JWT guardado en el cliente.
2. **Perfil** → activar “Portafolio de inversiones”; si no hay cookie Fintual, modal de conexión.
3. **Sincronizar** (SSE `/sync`) → pipeline Fintual + recálculo de historial; errores de sesión marcan `fintual_reconnect_required` y disparan reconexión.

---

## Estructura de carpetas (resumen)

```
personal-financial-tracker/
├── backend/
│   ├── main.py              # FastAPI, rutas
│   ├── auth.py              # JWT, servicios por usuario
│   ├── models.py, schemas.py
│   ├── fintual_client.py, fintual_sync.py, market_data.py
│   ├── history.py, portfolio_metrics.py, exchange_service.py
│   ├── multiuser_migration.py
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx, Dashboard.tsx
│   │   ├── Login.tsx, Profile.tsx, FintualConnectModal.tsx
│   │   ├── AppSidebar.tsx, AppHeader.tsx, SyncOverlay.tsx
│   │   ├── api.ts, auth.ts, types.ts, config.ts
│   │   └── ...
│   └── package.json
└── README.md
```

---

## Próximos pasos sugeridos (producto)

- **Segundo servicio** (cuentas / movimientos bancarios): nuevo flag en `services_json`, rutas y modelos **por `user_id`**, UI separada; MVP razonable: **cuentas + movimientos manuales o import CSV** antes que agregadores bancarios.
- **Producción**: HTTPS, `JWT_SECRET` fuerte, base de datos persistente (p. ej. Postgres si escalás), backups, y revisar que **no** se expongan secretos en logs.

---

## Nota histórica

Existía un README más corto centrado solo en CSV y activos manuales; el proyecto creció hacia **Fintual multiusuario**, **auth** y **Perfil**. Si algo en issues o docs antiguos menciona solo “portfolio local”, puede estar desactualizado.
