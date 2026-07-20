# Frontend — Zendo Finance

UI React de **Zendo Finance** (inversiones + banking).

## Arranque

```bash
npm install
npm run dev
```

Por defecto habla con la API en `http://localhost:8000` (`VITE_API_BASE` en build/dev).

## Scripts

| Script | Uso |
|--------|-----|
| `npm run dev` | Vite HMR |
| `npm run lint` | ESLint |
| `npm run build` | Typecheck + build → `dist/` |
| `npm run preview` | Preview del build |

## Para agentes de IA

- Instrucciones del paquete: [`AGENTS.md`](./AGENTS.md)
- Raíz del repo: [`../AGENTS.md`](../AGENTS.md)
- Arquitectura / dominio: [`../docs/`](../docs/)

No uses este README como guía del template Vite; el producto real está en `src/` (`App.tsx`, banking, dashboard).
