# Despliegue en Railway (plan Hobby, ~5 USD/mes)

Guía para publicar **API (FastAPI)**, **PostgreSQL** y **frontend (Vite)** en un solo proyecto Railway (monorepo `backend/` + `frontend/`). El código ya usa `DATABASE_URL`, `CORS_ORIGINS` y build-time `VITE_API_BASE` (ver [`backend/database.py`](../backend/database.py), [`backend/main.py`](../backend/main.py), [`frontend/src/config.ts`](../frontend/src/config.ts)).

**Documentación oficial útil:** [Monorepo](https://docs.railway.com/deployments/monorepo), [Variables / referencias](https://docs.railway.com/guides/variables), [Pricing](https://docs.railway.com/pricing).

---

## 0. Antes de empezar

1. Repo en **GitHub** con rama **`main`** (o la que despliegues).
2. Generar **`JWT_SECRET`**: `openssl rand -hex 32`
3. Cuenta Railway con plan **Hobby** (según flujo actual de Railway; revisa límites y facturación en su web).

---

## 1. Cuenta y proyecto

1. Entra en [railway.com](https://railway.com) e inicia sesión.
2. **New Project** → **Deploy from GitHub** → autoriza la app de Railway en GitHub si te lo pide.
3. Selecciona el repositorio **personal-financial-tracker** y la rama **`main`**.
4. Railway puede proponerte servicios automáticos; puedes **editar/borrar** y seguir esta guía paso a paso, o crear un proyecto vacío y añadir servicios manualmente (**New** → **GitHub Repo** por servicio).

**Watch paths (recomendado):** en cada servicio, **Settings** → limitar despliegues al subárbol correspondiente (p. ej. `backend/**` para el API y `frontend/**` para el front) para no redesplegar todo en cada push.

---

## 2. PostgreSQL

1. En el proyecto: **New** → **Database** → **PostgreSQL**.
2. Espera a que el servicio esté **Running**.
3. El plugin Postgres expone variables (habitualmente **`DATABASE_URL`**). El nombre del servicio en el canvas (p. ej. `Postgres`) se usa para **referencias** entre servicios.

### Migración desde Render (opcional)

- **Opción A — Copiar datos:** `pg_dump` desde Render → restaurar en Railway (`psql` u otra herramienta con la URL de Railway).
- **Opción B — BD vacía:** registráis de nuevo usuarios en la app (como en el primer deploy).

---

## 3. Servicio API (backend)

1. **New** → **GitHub Repo** → mismo repo y rama.
2. **Settings** → **Root Directory**: `backend`
3. **Settings** → **Build** / **Deploy** (según UI actual):
   - **Build command** (si no se detecta solo):  
     `pip install -r requirements.txt`
   - **Start command** (si no usas solo `Procfile`):  
     `uvicorn main:app --host 0.0.0.0 --port $PORT`

   El repo incluye [`backend/Procfile`](../backend/Procfile) con la línea `web:` para que plataformas tipo Railway/Heroku detecten el proceso web.

4. **Python 3.12:** el repo tiene [`backend/.python-version`](../backend/.python-version). Si el build usa otra versión, fija **3.12** en variables de servicio (p. ej. `NIXPACKS_PYTHON_VERSION` / opciones que documente Railway en su momento) para evitar builds desde fuente de dependencias nativas.

### Variables del servicio API

En **Variables** del servicio backend:

| Variable | Valor |
|----------|--------|
| `DATABASE_URL` | Referencia al Postgres: **`${{ NombreDelServicioPostgres.DATABASE_URL }}`** (sustituye `NombreDelServicioPostgres` por el nombre exacto del servicio en el canvas; la UI de Railway permite elegir referencias con autocompletado). |
| `JWT_SECRET` | El secreto largo generado arriba. |
| `CORS_ORIGINS` | Vacío hasta tener URL del front; luego la URL HTTPS exacta del frontend (ej. `https://tu-front.up.railway.app`). Sin barra final. Varias URLs: separadas por coma. |

Opcional: secretos que ya uses en prod (`CMF_API_KEY`, etc.), copiados desde tu `.env` seguro.

5. **Deploy** y comprueba en el navegador:

   `https://TU-DOMINIO-PUBLICO-DEL-API/docs`

   El dominio público lo muestra Railway (**Settings** → **Networking** / variable `RAILWAY_PUBLIC_DOMAIN`). También puedes usar:

   `https://${{ TU_API_SERVICE.RAILWAY_PUBLIC_DOMAIN }}/docs`

   desde otro servicio como referencia.

---

## 4. Servicio frontend (Vite)

1. **New** → **GitHub Repo** → mismo repo y rama.
2. **Settings** → **Root Directory**: `frontend`
3. **Build command:**  
   `npm ci && npm run build`
4. **Start command** (servir la carpeta `dist` como SPA; rutas del cliente necesitan fallback a `index.html`):  

   `npx --yes serve@14 dist -s -l tcp://0.0.0.0:$PORT`

   (`serve` sirve la SPA en modo single-page con `-s`.)

5. **Variables** (necesarias en **build**, porque Vite inserta env en compilación):

| Variable | Valor |
|----------|--------|
| `VITE_API_BASE` | URL base del API **HTTPS**, **sin barra final**. Ejemplo con referencia al servicio API llamado `portfolio-api`: **`https://${{ portfolio-api.RAILWAY_PUBLIC_DOMAIN }}`** |

   Ajusta `portfolio-api` al **nombre real** del servicio backend en Railway.

6. Deploy y abre la URL pública del servicio frontend. En DevTools → **Red**, confirma que las peticiones van al host del API.

---

## 5. CORS

1. Copia la URL **HTTPS** del frontend (la que muestra Railway).
2. En el servicio **API**, edita **`CORS_ORIGINS`** con ese valor exacto (origen único en prod salvo que añadas más).
3. Vuelve a **desplegar** el API si no se aplica solo al guardar variables.

---

## 6. Corte desde Render u otro hosting

1. Validad login, registro, sync Fintual y módulo banking contra Railway.
2. **Pausad o eliminad** servicios en Render (u otro proveedor) para no pagar ni mantener dos producciones.
3. Actualizad marcadores y comunicación entre los dos usuarios.

---

## 7. Checklist rápido

- [ ] Postgres en estado Running.
- [ ] API: `/docs` carga en el dominio público.
- [ ] Front: SPA carga; `VITE_API_BASE` apunta al API correcto (rebuild si cambias la URL del API).
- [ ] Login/registro sin errores de red ni CORS.
- [ ] `DATABASE_URL` referenciada correctamente (sin copiar manualmente si usáis referencias).

---

## Problemas frecuentes

| Síntoma | Qué revisar |
|--------|--------------|
| Front llama a `localhost` | Falta `VITE_API_BASE` en variables de **build** del front o no redeploy tras cambiarla. |
| CORS | `CORS_ORIGINS` debe coincidir exactamente con el origen del navegador (`https://…`). |
| Error SSL / conexión a Postgres | Añadir `?sslmode=require` al final de `DATABASE_URL` si Railway/postgres lo requieren (probar desde el panel de variables). |
| Build Python incorrecto | Forzar Python **3.12** alineado con [`backend/.python-version`](../backend/.python-version). |
| Rutas React 404 al refrescar | El comando `serve -s` debe estar activo en el **start** del servicio frontend. |

---

Cuando todo esté estable, podéis asignar **dominios personalizados** en Railway y actualizar `CORS_ORIGINS` + `VITE_API_BASE` en consecuencia.
