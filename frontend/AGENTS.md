# AGENTS.md — frontend

Complementa el `AGENTS.md` raíz. Trabaja aquí al editar `frontend/src/`.

## Entry y routing

- Utilidades banking: `bankingTxHelpers.ts` (preferir extender ahí antes de hinchar la página de movimientos).
- Entry: `main.tsx` → `App.tsx` (`/auth/me`, `/dashboard-initial` si inversiones).
- Rutas condicionadas por `me.services.investments` / `me.services.banking`.
- Banking va lazy-loaded y envuelto en `BankingThemeProvider`.

| Ruta | Página | Servicio |
|------|--------|----------|
| `/` | `Dashboard.tsx` | investments |
| `/transactions` | Activity / transacciones | investments |
| `/profile` | `Profile.tsx` | auth |
| `/banking/transactions` | `BankingTransactionsPage.tsx` | banking |
| `/banking/settings` | `BankingSettingsPage.tsx` | banking |
| `/banking/personal-order` | `BankingPersonalOrderPage.tsx` | banking |
| `/banking/savings-calculator` | `SavingsCalculatorPage.tsx` | banking |

Navegación: `AppSidebar.tsx`, `AppHeader.tsx`.

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

- `BankingTransactionsPage.tsx` (~muy grande)
- `BankingPersonalOrderPage.tsx`
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
npm run build   # si cambiaste tipos, rutas o imports
```
