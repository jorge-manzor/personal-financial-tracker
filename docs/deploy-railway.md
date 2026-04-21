# Despliegue en Railway (plan Hobby, ~5 USD/mes)

Guía para publicar **API (FastAPI)**, **PostgreSQL** y **frontend (Vite)** en un solo proyecto Railway (monorepo `backend/` + `frontend/`). El código ya usa `DATABASE_URL`, `CORS_ORIGINS` y build-time `VITE_API_BASE` (ver [`backend/database.py`](../backend/database.py), [`backend/main.py`](../backend/main.py), [`frontend/src/config.ts`](../frontend/src/config.ts)).

**Documentación oficial útil:** [Monorepo](https://docs.railway.com/deployments/monorepo), [Variables / referencias](https://docs.railway.com/guides/variables), [Pricing](https://docs.railway.com/pricing).

---

## Orden de ejecución (léelo primero)

Hay **un solo proyecto Railway** con **tres piezas independientes** (tres “cajitas” en el lienzo):

| Orden | Qué añades | ¿GitHub? | Carpeta (`Root Directory`) | Watch paths (recomendado) |
|:-----:|------------|:--------:|----------------------------|---------------------------|
| 1 | **Proyecto vacío** | No | — | — |
| 2 | **PostgreSQL** | No | — | No aplica |
| 3 | **Servicio API** | Sí (eliges repo + rama) | `backend` | `backend/**` |
| 4 | **Servicio frontend** | Sí (**mismo** repo + rama) | `frontend` | `frontend/**` |
| 5 | Variables + CORS | — | — | — |

**GitHub no se “conecta dos veces” como cuenta distinta.** Lo normal es:

1. **Una vez** autorizas la aplicación **Railway** en GitHub (OAuth).
2. Cada vez que creas **un nuevo servicio** desde **GitHub Repo**, Railway te pide **elegir repositorio y rama**: es para **enganchar ese servicio concreto** al código. Para el API y el front usas **el mismo repo** y la misma rama (`main`), pero **cada servicio tiene su propia carpeta** (`backend` vs `frontend`).

Si al crear el proyecto elegiste **“Deploy from GitHub”** y Railway generó solo un servicio automático, puedes **renombrarlo / ajustar Root Directory** o borrarlo y seguir esta guía desde **New** → servicios como abajo.

### ¿Postgres primero o el watch path `backend/**`?

**Son cosas distintas; no es “uno u otro”.**

1. **Orden sí importa:** primero **PostgreSQL**, después **API** (`backend`), después **Frontend** (`frontend`). El watch path **no sustituye** ese orden.
2. **`Root Directory`** (p. ej. `backend`): define **qué carpeta del repo** usa ese servicio para instalar dependencias y arrancar. Sin esto, Railway no sabe si es API o front.
3. **`Watch paths`** (p. ej. `backend/**`): es **opcional** y va **dentro del servicio API**, cuando ya existe. Solo dice: “solo vuelve a desplegar **este** servicio si el commit tocó archivos bajo `backend/`”. Así un cambio en `frontend/` no redespliega el API (y al revés en el otro servicio con `frontend/**`).

Resumen: **partes con proyecto vacío → añades Postgres → luego añades el servicio API** (ahí pones Root `backend` y, si quieres, Watch `backend/**`) **→ luego añades el servicio frontend** (Root `frontend`, Watch `frontend/**`).

---

## 0. Antes de empezar

1. Repo en **GitHub** con rama **`main`** (o la que despliegues).
2. Generar **`JWT_SECRET`**: `openssl rand -hex 32`
3. Cuenta Railway con plan **Hobby** (según flujo actual de Railway; revisa límites y facturación en su web).

---

## 1. Crear proyecto (vacío recomendado)

1. Entra en [railway.com](https://railway.com) e inicia sesión.
2. **New Project** → elige **Empty Project** (proyecto vacío; la UI puede usar otro nombre equivalente). Objetivo: **no** importar todo el monorepo en un solo deploy automático.

Así evitas que Railway cree **un solo servicio** tratando todo el monorepo como una sola app. Tú vas a crear **dos servicios web** (`backend` y `frontend`) más la base de datos.

---

## 2. PostgreSQL

1. En el proyecto: **New** → **Database** → **PostgreSQL**.
2. Espera a que el servicio esté **Running**.
3. Opcional: renombra el servicio en el lienzo a algo corto y estable (p. ej. **`Postgres`**): ese nombre es el que usarás en variables como **`${{ Postgres.DATABASE_URL }}`**.
4. El plugin Postgres expone variables (habitualmente **`DATABASE_URL`**). El nombre del servicio en el canvas se usa para **referencias** entre servicios.

### Migración desde Render (opcional)

- **Opción A — Copiar datos:** `pg_dump` desde Render → restaurar en Railway (`psql` u otra herramienta con la URL de Railway).
- **Opción B — BD vacía:** registráis de nuevo usuarios en la app (como en el primer deploy).

---

## 3. Servicio API (backend)

Es **otro servicio** en el mismo proyecto (en el lienzo verás varias cajas: Postgres + API + más adelante el front). No tiene relación con “subcarpetas” del Postgres; es un **deploy web** independiente.

1. En el proyecto: **New** → **GitHub Repo** (o **Add service** → fuente GitHub).
2. Autoriza **GitHub** si es la primera vez en esta cuenta; luego **selecciona el mismo repositorio** `personal-financial-tracker` y la rama **`main`**. Esto no sustituye al Postgres: es **solo** para este servicio API.
3. Abre **Settings** del servicio recién creado:
   - **Root Directory**: `backend`  
     (Railway solo usará esa carpeta para build/deploy; ver [monorepo](https://docs.railway.com/deployments/monorepo)).
   - **Watch paths** (si la UI lo ofrece): **`backend/**`**  
     Así un cambio solo en `frontend/` **no** redespliega el API.
4. Renombra el servicio si quieres (p. ej. **`portfolio-api`**): lo usarás en referencias tipo **`${{ portfolio-api.RAILWAY_PUBLIC_DOMAIN }}`**.
5. **Settings** → **Build** / **Deploy** (según UI actual):
   - **Build command** (si no se detecta solo):  
     `pip install -r requirements.txt`
   - **Start command** (si no usas solo `Procfile`):  
     `uvicorn main:app --host 0.0.0.0 --port $PORT`

   El repo incluye [`backend/Procfile`](../backend/Procfile) con la línea `web:` para que plataformas tipo Railway/Heroku detecten el proceso web.

6. **Python 3.12:** el repo tiene [`backend/.python-version`](../backend/.python-version) y [`backend/nixpacks.toml`](../backend/nixpacks.toml). Si el build usa otra versión, fija **3.12** en variables de servicio para evitar builds desde fuente de dependencias nativas.

### Variables del servicio API

En **Variables** del servicio backend:

| Variable | Valor |
|----------|--------|
| `DATABASE_URL` | Referencia al Postgres: **`${{ NombreDelServicioPostgres.DATABASE_URL }}`** (sustituye `NombreDelServicioPostgres` por el nombre exacto del servicio en el canvas; la UI de Railway permite elegir referencias con autocompletado). |
| `JWT_SECRET` | El secreto largo generado arriba. |
| `CORS_ORIGINS` | Vacío hasta tener URL del front; luego la URL HTTPS exacta del frontend (ej. `https://tu-front.up.railway.app`). Sin barra final. Varias URLs: separadas por coma. |

Opcional: secretos que ya uses en prod (`CMF_API_KEY`, etc.), copiados desde tu `.env` seguro.

7. **Deploy** y comprueba en el navegador:

   `https://TU-DOMINIO-PUBLICO-DEL-API/docs`

   El dominio público lo muestra Railway (**Settings** → **Networking** / variable `RAILWAY_PUBLIC_DOMAIN`). También puedes usar:

   `https://${{ TU_API_SERVICE.RAILWAY_PUBLIC_DOMAIN }}/docs`

   desde otro servicio como referencia.

---

## 4. Servicio frontend (Vite)

Es **un tercer servicio** (otra caja en el lienzo), **separado** del API y del Postgres.

1. **New** → **GitHub Repo** otra vez → **mismo repositorio** `personal-financial-tracker`, misma rama **`main`**.  
   Es normal que el asistente vuelva a pedir **elegir repo**: estás creando **otro servicio** enlazado al mismo código, con otra carpeta raíz.
2. **Settings** → **Root Directory**: **`frontend`** (solo el front).
3. **Watch paths** (recomendado): **`frontend/**`**
4. **Build command:**  
   `npm run build:railway`

   Equivale a **`npm run build`** (Nixpacks ya ejecuta **`npm ci`** en la fase *install*). Lo importante es el archivo **[`frontend/nixpacks.toml`](../frontend/nixpacks.toml)** del mismo directorio raíz del servicio: desactiva la caché de build por defecto de Node en **`node_modules/.cache`** (Nixpacks la monta entre builds en otro volumen → **`EBUSY` / `EXDEV`** al borrar o renombrar `node_modules`). La caché de Vite y los `tsBuildInfo` siguen fuera de `node_modules` ([`vite.config.ts`](../frontend/vite.config.ts), `tsconfig.*.json`).
5. **Start command** (servir la carpeta `dist` como SPA; rutas del cliente necesitan fallback a `index.html`):  

   `npx --yes serve@14 dist -s -l tcp://0.0.0.0:$PORT`

   (`serve` sirve la SPA en modo single-page con `-s`.)

6. Renombra el servicio si quieres (p. ej. **`portfolio-web`**).

### Variables de build del frontend

(Vite inserta env en **compilación**, deben existir cuando corre `npm run build`.)

7. **Variables** del servicio frontend:

| Variable | Valor |
|----------|--------|
| `VITE_API_BASE` | URL base del API **HTTPS**, **sin barra final**. Ejemplo con referencia al servicio API llamado `portfolio-api`: **`https://${{ portfolio-api.RAILWAY_PUBLIC_DOMAIN }}`** |

   Ajusta `portfolio-api` al **nombre real** del servicio backend en Railway (debe coincidir con el nombre del servicio en el lienzo).

8. **Deploy** del frontend y abre su URL pública. En DevTools → **Red**, confirma que las peticiones van al host del API.

> **No** pongas `backend/**` y `frontend/**` en el mismo campo de un solo servicio. Son **dos servicios** distintos: cada uno solo su watch path.

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
| Build front: `EBUSY` / `EXDEV` en `node_modules/.cache` | Asegúrate de tener **[`frontend/nixpacks.toml`](../frontend/nixpacks.toml)** (`[phases.build] cacheDirectories = []`). Opcional: variable **`NIXPACKS_NO_CACHE=1`** en el servicio (desactiva toda la caché Nixpacks). Luego **borrar build cache** en Railway y redeploy. |
| Rutas React 404 al refrescar | El comando `serve -s` debe estar activo en el **start** del servicio frontend. |

---

Cuando todo esté estable, podéis asignar **dominios personalizados** en Railway y actualizar `CORS_ORIGINS` + `VITE_API_BASE` en consecuencia.
