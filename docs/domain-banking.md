# Dominio — Banking (cuentas y movimientos)

Servicio opt-in `banking`. Moneda principal: **CLP**. Independiente del portafolio Fintual.

## Conceptos

| Concepto | Modelo / notas |
|----------|----------------|
| Cuenta | `BankingAccount` — efectivo, corriente, tarjeta de crédito (puede enlazar corriente) |
| Categoría / subcategoría | `BankingCategory`, `BankingSubcategory` — ordenables |
| Movimiento | `BankingTransaction` — filtros, bulk de provisiones y gastos compartidos |
| Bancos Chile | Catálogo `data/bancos_chile.json` → `GET /banking/banks` |
| Deuda | `GET /banking/debt-totals` |
| TC cargos pendientes | `GET /banking/credit-card/unpaid-grouped`, provisiones |
| Gastos compartidos | `GET /banking/shared/unsettled-grouped` + bulk settled |
| Orden personal | Provisiones y metas de ahorro (`BankingPersonal*`) |
| Calculadora | `SavingsCalculatorPlan` — planes what-if |

## UI

| Ruta | Archivo | Rol |
|------|---------|-----|
| `/banking/transactions` | `BankingTransactionsPage.tsx` | Tabla principal (muy grande) |
| `/banking/settings` | `BankingSettingsPage.tsx` | Cuentas / categorías |
| `/banking/personal-order` | `BankingPersonalOrderPage.tsx` | Provisiones y ahorro personal |
| `/banking/savings-calculator` | `SavingsCalculatorPage.tsx` | Planes calculadora |
| Tema | `BankingThemeContext.tsx` | Clase/tema banking |

## Backend

- Rutas: `banking_routes.py`, `banking_personal_order_routes.py`, `savings_calculator_routes.py`
- Service: `banking_service.py`
- Auth: siempre `BankingUser`

## Al cambiar banking

1. Preferir extender `banking_service.py` con funciones pequeñas y reutilizar queries existentes.
2. No resetear catálogo en prod.
3. Mantener `user_id` en creates/lists.
4. Actualizar `schemas.py` + `frontend/src/types.ts` juntos.
5. UI: cambios locales en la página afectada; no “limpiar” el archivo enorme.
