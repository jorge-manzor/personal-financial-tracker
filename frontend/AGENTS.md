# AGENTS.md — frontend

Complementa el `AGENTS.md` raíz. Trabaja aquí al editar `frontend/src/`.

## Entry y routing

- Entry: `main.tsx` → `App.tsx` (`/auth/me`, `/dashboard-initial` si inversiones).
- Rutas condicionadas por `me.services.investments` / `me.services.banking`.
- Banking va lazy-loaded y envuelto en `BankingThemeProvider`.

| Ruta | Página | Servicio |
|------|--------|----------|
| `/` | `Dashboard.tsx` | investments |
| `/transactions` | Activity / transacciones | investments |
| `/profile` | `Profile.tsx` | auth |
| `/banking/transactions` | `BankingTransactionsPage.tsx` (orquestador) | banking |
| `/banking/settings` | `BankingSettingsPage.tsx` | banking |
| `/banking/provisiones` | `BankingProvisionsPage.tsx` | banking |
| `/banking/ahorro-objetivo` | `BankingSavingsGoalsPage.tsx` | banking |
| `/banking/savings-calculator` | `SavingsCalculatorPage.tsx` | banking |

Navegación: `AppSidebar.tsx`, `AppHeader.tsx`.

### Módulos de movimientos banking

Preferir extender estos archivos antes de hinchar `BankingTransactionsPage.tsx`:

| Archivo | Rol |
|---------|-----|
| `bankingTxHelpers.ts` | Utilidades puras (fechas, mask, search, templates) |
| `bankingTxShared.ts` | Tipos, prefs de columnas, cache SWR, constantes CSS/shared |
| `bankingTxIcons.tsx` | Iconos SVG |
| `bankingBalanceCards.tsx` | Tarjetas de saldo / privacidad |
| `bankingTxFilters.tsx` | Filtros de columna y picker |
| `bankingTxMainTable.tsx` | Tabla principal virtualizada |
| `bankingTxAuxTables.tsx` | Tablas TC / compartidos / provisiones |
| `BankingConfirmDialog.tsx` | Confirmación (delete, etc.) |

Tests: `src/**/*.test.ts` vía `npm test` (Vitest).

## API y auth

- Base URL: `config.ts` → `API_BASE` (`VITE_API_BASE`, default `http://localhost:8000`, sin barra final).
- Todas las llamadas autenticadas: `api.ts` (`apiFetch` / `fetchJson` / `patchJson`) + `auth.ts` (Bearer en `localStorage`).
- No usar `fetch` crudo a la API salvo casos ya existentes justificados (p. ej. SSE).
- 401 → `logoutSession()`.

## UI / estilo

- Tailwind CSS 4 (utilidades existentes del proyecto).
- No introducir design system nuevo ni dependencias UI sin pedido.
- Copy en **español**.
- Tipos compartidos: `types.ts`. Formatos: `format.ts`, fechas locales: `localDate.ts`.

## Archivos calientes

No reescribir de cero sin pedido explícito:

- `BankingTransactionsPage.tsx` (orquestador + modal)
- `BankingProvisionsPage.tsx`
- `BankingSettingsPage.tsx`
- `Dashboard.tsx`
- `App.tsx` (solo tocar routing/estado global con cuidado)

Preferir diffs locales: handlers, columnas, filtros, llamadas API.

## Añadir una pantalla

1. Crear componente en `src/`.
2. `lazy(() => import(...))` en `App.tsx` si es pesada (patrón banking).
3. `<Route>` con guard `bankingOn` / `investmentsOn`.
4. Link en `AppSidebar.tsx` solo si el servicio está activo.
5. Tipos en `types.ts`; llamadas vía `api.ts`.

## Verificación

```bash
cd frontend
npm run lint
npm test
npm run build   # si cambiaste tipos, rutas o imports
```
