# API cheat sheet

Contratos completos: con el API arriba, usar **http://127.0.0.1:8000/docs**. Aquí solo lo crítico.

Auth: header `Authorization: Bearer <token>` salvo SSE.

## Salud

| Método | Path | Auth |
|--------|------|------|
| GET | `/health` | no |
| GET | `/` | no |

## Auth / perfil

| Método | Path | Notas |
|--------|------|--------|
| POST | `/auth/register` | → token |
| POST | `/auth/login` | → token |
| GET | `/auth/me` | `UserOut` + `services` |
| PATCH | `/auth/me` | activa `investments` / `banking` |
| PATCH | `/auth/me/fintual` | cookie/uid Fintual |
| POST | `/auth/change-password` | |

## Inversiones (requiere servicio investments)

| Método | Path | Notas |
|--------|------|--------|
| GET | `/sync` | **SSE**; `?access_token=` |
| GET | `/sync-status` | |
| GET | `/dashboard-initial` | boot UI |
| GET | `/portfolio`, `/holdings`, `/chart-data` | |
| GET/POST/PUT/DELETE | `/transactions`… | |
| GET/POST/DELETE | `/manual-assets`… | |
| GET | `/exchange-rate`, `/exchange-rate/history` | |
| POST | `/exchange-rate/refresh` | |
| GET | `/activity/monthly-movements` | |
| GET | `/sector-distribution` | |
| GET | `/market-indicators` | |
| GET | `/market-price/{ticker}` | |

## Banking (prefijo `/banking`, requiere servicio banking)

### Cuentas y catálogo

| Método | Path |
|--------|------|
| GET | `/banking/banks` |
| GET/POST | `/banking/accounts` |
| PATCH/DELETE | `/banking/accounts/{id}` |
| GET | `/banking/debt-totals` |
| GET/POST/PATCH/DELETE | `/banking/categories`… |
| PATCH | `/banking/categories/reorder` |
| … | subcategories + reorder |

### Movimientos

| Método | Path |
|--------|------|
| GET/POST | `/banking/transactions` |
| PATCH/DELETE | `/banking/transactions/{id}` |
| POST | `/banking/transactions/{id}/reverse-provision` |
| POST | `/banking/transactions/bulk-reverse-provision` |
| POST | `/banking/transactions/bulk-shared-settled` |
| GET | `/banking/credit-card/unpaid-grouped` |
| GET | `/banking/provisions/pending-reversal-grouped` |
| GET | `/banking/shared/unsettled-grouped` |

### Orden personal

| Método | Path |
|--------|------|
| CRUD-ish | `/banking/personal-order/provision-items`… |
| POST | `/banking/personal-order/provision-items/register-movements` |
| POST | `/banking/personal-order/provision-items/reset-paid` |
| CRUD-ish | `/banking/personal-order/savings-goals`… |
| … | `savings-adjustments` |

### Calculadora

| Método | Path |
|--------|------|
| GET/POST | `/banking/savings-calculator/plans` |
| PATCH/DELETE | `/banking/savings-calculator/plans/{id}` |
