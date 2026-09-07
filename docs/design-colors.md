# Paleta de colores — pastel Zendo

Reglas de color usadas en Perfil, Banking (`BankingSettingsPage.tsx`, `Profile.tsx`) y
Proyectos (`ProjectsPage.tsx`). Úsalas al tocar esas pantallas o al construir features
nuevas para no reinventar tonos ni terminar con dos paletas incompatibles en el sitio.

## Los dos acentos de marca

Son **fijos** — el mismo hex en claro y oscuro, nunca lo invierten el uno del otro:

| Rol | Hex | Uso |
|-----|-----|-----|
| Salvia (acento primario) | `#8FBFA6` | Botones primarios, tabs/nav activos, toggles "on", "Pagado" |
| Borde del salvia (toggles/botones) | `#6FA588` | Borde de switches y botones sage para que no se pierdan contra el fondo |
| Texto sobre fondo salvia | `#1F2E25` | Texto de botones con `bg-[#8FBFA6]` (nunca blanco/negro puro) |
| Dorado (acento secundario) | `#C79A56` | Detalles decorativos (logo, avatar, íconos con círculo de color) |
| Rosa (peligro/eliminar) | `#cc8e9e` | Botón sólido de confirmar-eliminar (`border-[#a5677a]`, texto `#2a1216`) |

**Nunca** un componente nuevo debería usar `indigo`, `amber`, `emerald`, `rose`, `zinc` o
`slate` de Tailwind como acento genérico — esos son restos de la paleta vieja. La única
excepción es la sección "Ingresos / egresos" más abajo.

## Tokens claro / oscuro (fondo, borde, texto)

Todo lo demás (fondos, bordes, texto) SÍ cambia entre modos. Tabla de pares exactos:

| Rol | Claro | Oscuro |
|-----|-------|--------|
| Fondo de página (base) | `#FAF7F1` | `#0d1117` |
| Fondo de página (degradé, extremo) | `#F5F1E8` | `#0a0d12` |
| Resplandor radial de fondo | `rgba(199,154,86,0.08–0.10)` (dorado) | `rgba(143,191,166,0.06–0.07)` (salvia) |
| Tarjeta / card | `#FFFFFF` | `#12161d` |
| Borde de tarjeta | `#E8E1D4` | `#1e242e` |
| Fondo hundido (inputs, filas sunken) | `#FBFAF7` | `#0d1117` |
| Fondo de cabecera de tabla / superficie elevada | `#F5F1E8` | `#161b22` |
| Borde de fila / separador de tabla | `#F0EAE0` | `#1a1f2e` |
| Botón fantasma — fondo | `#F5F1E8` | `#161b22` |
| Botón fantasma — borde | `#DCD3C2` | `#30363d` |
| Botón fantasma — hover | `#ECE5D6` | `#1c2129` |
| Toggle apagado — fondo | `#EDE7D9` | `#21262d` |
| Texto principal | `#2B2620` | `#F3F1EC` |
| Texto secundario / body | `#4A453C` | `#c9d1d9` |
| Texto muted | `#8A8072` | `#8b949e` |
| Texto muted (íconos, más claro) | `#9A9284` | `#6b7280` |
| Foco de inputs (borde/ring) | `#8FBFA6` (antes `#58a6ff`, ver nota) | `#8FBFA6` |

Nota: algunos inputs viejos (Perfil) todavía usan `#58a6ff` para el foco; no hace falta
migrarlos salvo que estés ya tocando ese componente.

## Texto de color dinámico sobre fondo claro (categorías, verde/dorado activo)

Los pasteles pensados para fondo oscuro (`#8FBFA6`, `#C79A56`, y los colores de
categoría — ver abajo) casi no contrastan sobre blanco/crema. Regla:

- **Modo oscuro**: usar el color tal cual.
- **Modo claro**: limitar el *lightness* (HSL) a un máximo de **42%**, misma familia de
  color, si el original es más claro que eso (si ya es oscuro, no tocar).

Implementado en `categoryTextColor()` (`BankingSettingsPage.tsx`) para nombres de
categoría. Para el acento salvia específicamente ya existe el valor fijo
darkeneado `#5C7F6C` (nav activo, pestañas activas, links) — no hace falta recalcularlo
con la fórmula, reusar ese hex directamente:

| Elemento | Claro | Oscuro |
|----------|-------|--------|
| Nav / pestaña activa (texto) | `#5C7F6C` | `#8FBFA6` |
| Nav / pestaña activa (fondo) | `#8FBFA6` @ 16% opacidad | `#8FBFA6` @ 10% opacidad |
| Link de acento (`hover:underline`) | `#5C7F6C` | `#8FBFA6` |

## Ingresos / egresos: reusar el verde/rojo de Movimientos bancarios

Para cualquier semántica de **ingreso vs. egreso** (aportes/abonos, entradas/salidas,
saldo disponible positivo/negativo) — **no** usar salvia/dorado/rosa pastel. Reusar
exactamente los mismos tokens que ya usa `bankingTxMainTable.tsx`:

| Semántica | Clase (texto plano) | Badge (fondo + texto) |
|-----------|---------------------|------------------------|
| Ingreso / positivo | `text-emerald-600` (claro) `text-emerald-400` (oscuro) | `bg-emerald-50 text-emerald-600` (claro) · `bg-emerald-500/15 text-emerald-300` (oscuro) |
| Egreso / negativo / vencido | `text-rose-600` (claro) `text-rose-400` (oscuro) | `bg-rose-50 text-rose-600` (claro) · `bg-rose-500/15 text-rose-300` (oscuro) |

Son las únicas clases Tailwind "de fábrica" (no arbitrarias) que sí siguen vigentes en
la paleta nueva — justamente para no reinventar lo que Movimientos bancarios ya resuelve
bien. Ver `accentText()`, `negativeText()` y `historyIconBadge()` en `ProjectsPage.tsx`
como referencia de implementación.

## Colores de categorías bancarias (`backend/banking_service.py`)

`CATEGORY_COLOR_PALETTE` — ciclo de 12 tonos pastel asignados por `sort_order % 12` a
categorías nuevas:

```
#cc998e  coral      #ccb38e  ámbar      #ccc78e  mostaza    #a8cc8e  oliva
#8ecca8  salvia     #8eccbd  menta      #8ec2cc  teal       #8ea8cc  celeste
#998ecc  índigo     #bd8ecc  lavanda    #cc8eb8  malva      #cc8e9e  rosa
```

Colores fijos por nombre de categoría (`_canonical_hex_for_banking_category_name`):

| Categoría(s) | Hex |
|---|---|
| Remuneración, Otros ingresos, Ahorros, Inversiones | `#7fbd84` |
| Transferencia(s) | `#bfb9b0` |
| Pago Tarjeta de Crédito | `#8ea8cc` |
| Provisiones | `#cc8e9e` |
| Default (resto) | `#8FBFA6` |

Si cambias esta paleta de nuevo, replicá el patrón de
`repalette_legacy_banking_category_colors()`: migrar solo los colores que **coinciden
exacto** con un valor viejo asignado automáticamente, nunca un color que el usuario haya
elegido a mano con el selector. Correr como parte del backfill de arranque (no depende
de SQLite, corre igual en Postgres).

## Dos formas válidas de manejar claro/oscuro — cuál usar

Conviven dos mecanismos en el código; ambos son válidos, elegí según dónde vive la
pantalla:

1. **Variante Tailwind `banking-dark:`** (`@custom-variant banking-dark (.banking-dark &)`
   en `index.css`) — usar cuando la pantalla cuelga de `/banking/*` o de `/profile`
   (`BankingBodyClassSync` en `BankingThemeContext.tsx` agrega la clase al `<body>` solo
   en esas rutas). Así se escribe: clase base = claro, `banking-dark:clase` = oscuro, en
   la MISMA cadena de className. Ejemplo real: `bg-[#FFFFFF] banking-dark:bg-[#12161d]`.
   Ventaja: los portales (menús, modales via `createPortal`) heredan el tema solos,
   porque la clase vive en `<body>`, no en un ancestro del propio árbol React.

2. **`isDark` explícito vía `useBankingTheme()`** — usar cuando la pantalla vive FUERA de
   esas rutas (como `/proyectos`) y por lo tanto nunca hereda `.banking-dark` en el
   `<body>`. El patrón son funciones helper `algo(isDark: boolean): string` que devuelven
   la clase completa por rama, ej. `panelCard(isDark)` en `ProjectsPage.tsx`. Cualquier
   componente montado vía portal en una pantalla así debe recibir `isDark` como prop
   explícita (no hay clase de `<body>` de la que colgar `banking-dark:`).

En ambos casos, el toggle real (☀️/🌙 del sidebar) y el estado persistido
(`localStorage["banking-ui-dark"]`) son los mismos — `useBankingTheme()` es la única
fuente de verdad.

## Checklist rápido para una pantalla nueva

1. ¿Fondo/tarjeta/texto? → tabla de tokens claro/oscuro de arriba.
2. ¿Botón de acción primaria, toggle "on", elemento activo? → salvia `#8FBFA6` fijo.
3. ¿Texto de color dinámico (categoría, o el propio salvia/dorado) sobre fondo claro?
   → aplicar el cap de lightness 42%, o reusar `#5C7F6C` si es el acento salvia.
4. ¿Ingreso/egreso, positivo/negativo, pagado/vencido? → `emerald-600/400` /
   `rose-600/400` de Tailwind, no la paleta pastel.
5. ¿La pantalla cuelga de `/banking/*` o `/profile`? → `banking-dark:` variant. Si no →
   `isDark` explícito de `useBankingTheme()`.
