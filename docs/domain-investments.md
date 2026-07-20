# Dominio — Inversiones

Servicio opt-in `investments`. Fuentes principales de precios/posiciones: **Fintual** (no Yahoo como default).

## Conceptos

| Concepto | Dónde |
|----------|--------|
| Transacciones | `Transaction` — compras/ventas/movimientos; API `/transactions` |
| Activos manuales | `ManualAsset` + historial — `/manual-assets` |
| Posiciones Fintual | `FintualPosition` — sync |
| Wallet USD | `WalletMovement` |
| Caches | `PriceCache`, `PortfolioValueCache` |
| FX | `ExchangeRateHistory` — CMF + lógica en `exchange_service.py` |
| Sectores | `data/stock-sector.json`, endpoint sector-distribution |
| Metas/fondos | `fintual_goals_dashboard.py`, charts goal/fondos |
| Tickers no soportados | `UnsupportedTicker` |

## Flujos UI

1. Activar “Portafolio de inversiones” en Perfil.
2. Si falta cookie Fintual → `FintualConnectModal`.
3. Dashboard (`/`) carga `/dashboard-initial` y datos de chart/holdings.
4. Botón sincronizar → SSE `/sync`.
5. Actividad / transacciones en `/transactions`.

## Backend clave

- Orquestación HTTP: `main.py`
- Sync: `fintual_sync.py`
- Cliente: `fintual_client.py` + `use_fintual_credentials`
- Auth rutas: `InvestmentsUser`; SSE: `InvestmentsUserSSE`

## Al cambiar inversiones

1. No romper el contrato SSE (eventos que el overlay ya entiende) sin actualizar frontend.
2. Recálculos de historial: revisar `history.py` / `portfolio_metrics.py` antes de duplicar lógica.
3. Credenciales: nunca fallback silencioso al `.env` en rutas por usuario.
4. Tras cambios de sync, probar reconexión cuando la cookie es inválida.
