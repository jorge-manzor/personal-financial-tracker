# Rastreador de portafolio (local)

Aplicación web para seguir inversiones en acciones y activos manuales, con historial de valor, métricas de rentabilidad y distribución por sector.

## Requisitos

- **Python** 3.11+
- **Node.js** 18+

## Backend (FastAPI)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

La API queda en `http://127.0.0.1:8000`. CORS está habilitado para el frontend en `http://localhost:5173`.

En el primer arranque se crea `portfolio.db` y, si no hay transacciones, se insertan datos de ejemplo (acciones + un activo manual con snapshots mensuales).

## Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

La interfaz queda en `http://localhost:5173`. Por defecto llama al backend en `http://localhost:8000` (configurable con `VITE_API_BASE`).

## Importar CSV

Exporta tu hoja con columnas como en Google Sheets:

`fecha | tipo | activo | Acciones | Precio Unitario (USD) | Monto Total (USD)`

```bash
cd backend
source .venv/bin/activate
python import_csv.py /ruta/a/transacciones.csv
```

El script normaliza decimales con coma, fechas `DD/MM/AAAA`, mayúsculas en tickers, evita duplicados exactos y recalcula el historial en caché.

## Activos manuales en la UI

1. En el panel derecho, bajo **Activos Manuales**, usa **Agregar activo manual** e indica nombre y categoría.
2. Para actualizar el valor, pulsa **Actualizar valor** en cada activo, elige fecha y monto total en USD, y guarda el snapshot.

## Forzar actualización de datos

Usa el botón **Actualizar** (icono de refresco) en la cabecera. Vuelve a mostrar la sincronización (SSE) y recalcula la caché de historial desde el backend.

## Estructura de carpetas

```
personal-financial-tracker/
├── backend/
│   ├── main.py              # FastAPI: rutas, CORS, arranque, seed
│   ├── database.py          # Motor SQLite y sesión SQLAlchemy
│   ├── models.py            # Tablas: transactions, manual_*, portfolio_value_cache
│   ├── schemas.py           # Modelos Pydantic
│   ├── history.py           # Motor de historial y caché (yfinance, días hábiles NYSE)
│   ├── portfolio_metrics.py # Métricas por ticker y resumen
│   ├── import_csv.py        # Importación CSV
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Estado global, SSE, datos
│   │   ├── Dashboard.tsx    # Gráficos y tarjetas
│   │   ├── SyncOverlay.tsx
│   │   ├── TransactionModal.tsx
│   │   └── ManualModals.tsx
│   └── package.json
└── README.md
```

## Notas

- Los precios y sectores dependen de **Yahoo Finance** (`yfinance`). Si hay límites de peticiones, los valores pueden tardar o fallar hasta el siguiente intento.
- El historial del gráfico se guarda en `portfolio_value_cache` y se actualiza de forma incremental salvo cuando fuerzas sincronización o importas datos.
