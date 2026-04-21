# Despliegue en Render (subdominio del proveedor, sin dominio propio)

Guía ordenada para publicar el **API (FastAPI)** y el **frontend (Vite)** con URL `https://…onrender.com`, base **PostgreSQL** y CORS listo. El backend ya lee `DATABASE_URL` y `CORS_ORIGINS` (ver `backend/database.py` y `main.py`).

---

## 0. Antes de abrir Render (5 minutos)

1. Código **subido a GitHub** (rama que quieras desplegar; suele ser `main`).
2. En tu máquina, el proyecto arranca bien: backend en `backend/`, frontend en `frontend/` (como hasta ahora).
3. Ten a mano un valor para **`JWT_SECRET`**: cadena larga aleatoria (por ejemplo 32+ caracteres). En macOS/Linux:  
   `openssl rand -hex 32`

---

## 1. Cuenta y proyecto en Render

1. Entra en [render.com](https://render.com) → **Sign up** (con GitHub recomendado).
2. **New** → **PostgreSQL**.
   - **Name:** por ejemplo `portfolio-db`.
   - **Plan:** el más barato para empezar (uso personal).
   - Crear → espera a estado **Available**.
3. En la página de la BD, copia **Internal Database URL** (sirve si API y BD están en Render). Guárdala como referencia para el paso 4.

---

## 2. Servicio Web del backend (API)

1. **New** → **Web Service**.
2. Conecta el **mismo repo** GitHub → elige rama (`main`).
3. Configuración típica:
   - **Name:** por ejemplo `portfolio-api`.
   - **Region:** la más cercana (ej. Frankfurt si estás en Europa).
   - **Root Directory:** `backend`
   - **Runtime:** Python 3.
   - **Versión de Python:** Render puede usar **3.14 por defecto** en servicios nuevos; para paquetes con extensiones (p. ej. `pydantic-core`) conviene **3.12**. El repo incluye `backend/.python-version` con `3.12`. Alternativa en el dashboard: variable de entorno **`PYTHON_VERSION`** = `3.12.11` (u otra patch 3.12.x que ofrezca Render).
   - **Build Command:**  
     `pip install -r requirements.txt`
   - **Start Command:**  
     `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. **Instance type:** para uso diario de dos personas, el plan **de pago más pequeño** evita que la API “se duerma” (el gratuito suele tener cold start largo).

### Variables de entorno (Environment)

En la pestaña **Environment** del Web Service, añade:

| Key | Valor |
|-----|--------|
| `DATABASE_URL` | Pegar **Internal Database URL** del Postgres (o la External si Render la pide así). |
| `JWT_SECRET` | El secreto largo que generaste. |
| `CORS_ORIGINS` | La URL **HTTPS** del frontend cuando exista (paso 3). *Primera vez puedes dejarlo vacío y volver después del paso 3.* Ejemplo final: `https://TU-FRONT.onrender.com` |

Copia otros secretos que uses en local desde `backend/.env` (ej. `FINTUAL_SESSION`, `CMF_API_KEY`) si los necesitáis en prod.

5. **Deploy**. Cuando termine, abre la URL del servicio (`https://TU-API.onrender.com`) y prueba:  
   `GET https://TU-API.onrender.com/docs`  
   Debe cargar la documentación Swagger.

---

## 3. Sitio estático del frontend

1. **New** → **Static Site**.
2. Mismo repo → rama `main`.
3. Configuración típica:
   - **Root Directory:** `frontend`
   - **Build Command:**  
     `npm ci && npm run build`
   - **Publish directory:** `dist`

### Variable de build (importante)

Vite incrusta la URL del API **en tiempo de build**:

| Key | Valor |
|-----|--------|
| `VITE_API_BASE` | URL base del API **sin barra final**, ej. `https://TU-API.onrender.com` |

Sin esto, el navegador seguiría llamando a `localhost:8000`.

4. **Deploy**. Anota la URL (`https://TU-FRONT.onrender.com`).

---

## 4. CORS (una vez conocidas las dos URLs)

1. Ve al **Web Service** del API → **Environment**.
2. Edita **`CORS_ORIGINS`** al valor exacto del frontend, por ejemplo:  
   `https://TU-FRONT.onrender.com`  
   (solo esa URL en prod; puedes separar por comas si más adelante añades otra origen.)
3. **Manual Deploy** → **Deploy latest commit** para que reinicie con la variable nueva.

---

## 5. Primera vez en PostgreSQL vacío

La primera vez que el API usa Postgres, las tablas se crean al arrancar; **no hay datos**. Debéis **registrar usuarios** otra vez (vosotros dos) desde la pantalla de registro de la app.

Si migráis datos desde SQLite local, es un paso aparte (export/import o script); para MVP solemos **empezar BD prod limpia**.

---

## 6. Backup (mínimo viable)

1. En el panel del **PostgreSQL** en Render, revisa opciones de **snapshots / backup** según tu plan.
2. Regla práctica: no confíes solo en el disco del contenedor del API; la **BD gestionada** es la fuente de verdad.

---

## 7. Checklist rápido de verificación

- [ ] `https://TU-API.onrender.com/docs` abre.
- [ ] `https://TU-FRONT.onrender.com` abre la SPA.
- [ ] Login/registro funcionan sin error de red (pestaña Red del navegador: las llamadas van a la URL del API).
- [ ] Sin error CORS en consola tras configurar `CORS_ORIGINS`.
- [ ] Variable `VITE_API_BASE` coincide con la URL **real** del API (si cambias la URL del API, hay que **rebuild** del Static Site).

---

## Problemas frecuentes

| Síntoma | Qué revisar |
|--------|--------------|
| Front llama a `localhost:8000` | Falta `VITE_API_BASE` en el Static Site o no hiciste redeploy después de definirla. |
| Error CORS en consola | `CORS_ORIGINS` debe ser exactamente la URL del front (https, sin path). Redeploy del API. |
| API cae tras un rato | Plan gratuito con sleep; subir de plan en el Web Service. |
| Error al conectar a Postgres | Comprobar `DATABASE_URL`; en Render usar la URL **Internal** desde el mismo servicio. |
| Build del API: `pydantic-core` / `maturin` / `Read-only file system` / Rust | Estás en Python **3.14** sin wheel; fija **3.12** con `backend/.python-version` o `PYTHON_VERSION` (p. ej. `3.12.11`) y redeploy. |

---

Cuando completes el paso 7, podéis usar la app desde cualquier lugar con las URLs `onrender.com`; si más adelante queréis dominio propio, solo será cambiar DNS y actualizar `CORS_ORIGINS` + `VITE_API_BASE`.
