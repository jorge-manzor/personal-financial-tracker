## Zendo Finance design system — build conventions

No provider or root wrapper is required. Every component takes plain props — there is no
ThemeProvider, no router, no context of any kind in this bundle. Compose components directly.

### Light/dark: two different mechanisms — check which one a component uses

This bundle mixes two independent theming approaches; using the wrong one silently produces
unstyled or wrongly-themed output.

1. **`isDark: boolean` prop** (most components — `HoldingCard`, `Row`, `GainRow`,
   `StockLogoImg`, `FundGoalCard`, `PanelHero`, `PortfolioChart`, `PanelSectoresTab`,
   `BankingAccountBalanceCard`): pass `isDark={true}` or `isDark={false}` directly. The
   component picks its own light/dark hex values internally — no CSS class or wrapper needed.
2. **`banking-dark:` Tailwind variant** (`AccountSelect`, `BankingAuxRoundCheckbox`,
   `BankingConfirmDialog`, `BankingDatePicker`, `IconMenuButton`, `BankingBalancePrivacyEye`,
   `BankingBalanceMaskedAmount`, `BankingBalanceScopeHelpButton`, `BankingTxColumnVisibilityToggle`,
   `BankingTxSiNoDashBadge`, `BankingTxPaidStatusBadge`): these ship `banking-dark:*` utility
   classes compiled into `styles.css`. To see the dark variant, wrap them in an ancestor with
   a `banking-dark` class, e.g. `<div className="banking-dark">…</div>`. Without that ancestor
   class they always render light.

Don't mix the two: passing `isDark` to a `banking-dark:`-based component does nothing (it has
no such prop), and wrapping an `isDark`-based component in `.banking-dark` does nothing either.

### Styling idiom: literal hex utility classes, not named tokens

There is no design-token layer (no `bg-primary`, no `--color-*` custom properties consumed by
these components). Every color is a literal Tailwind arbitrary-value class, e.g.
`bg-[#8FBFA6]`, `text-[#2B2620]`, `border-[#DCD3C2]`. When composing NEW layout/glue around
these components, match the existing palette by reusing these exact hex values rather than
inventing new ones:

| Role | Light | Dark |
|---|---|---|
| Primary accent (sage green — buttons, selected state, positive) | `#8FBFA6` | `#8FBFA6` (same, often at reduced opacity e.g. `/14`, `/18`) |
| Primary text | `#2B2620` | `#F3F1EC` |
| Secondary/muted text | `#8A8072` | `#8b949e` |
| Card background | `#FFFFFF` (white) | `#161b22` |
| Border | `#DCD3C2` | `#30363d` |
| Subtle panel background | `#F5F1E8` | `#12161d` / `#21262d` |
| Gold accent (badges, "compartido"/shared) | `#C79A56` | `#C79A56` |
| Gain/positive | `#22c55e` (or `text-emerald-600` / `text-emerald-400`) | same |
| Loss/negative | `text-rose-600` / `text-rose-400` | same |

### Where the truth lives

- `styles.css` at the bundle root — the compiled Tailwind output. Read it directly to confirm
  any class actually has a rule before using it; this package does not use every Tailwind
  utility, only what these 40 components reference.
- Each component's own `.d.ts` (in `components/<group>/<Name>/`) is the authoritative prop
  contract — always check it before composing, several components have narrower prop shapes
  than the app's original screens (e.g. this bundle's prop types are hand-trimmed to only what
  each component reads).

### Build example

```tsx
import { HoldingCard, GainRow } from '@zendo/design-system';

<HoldingCard
  h={{
    ticker: 'AAPL',
    nombre: 'Apple Inc.',
    current_value: 4_820_000,
    rentabilidad_total_pct: 12.4,
    // ...see HoldingCard.d.ts for the full Holding shape
  }}
  isDark={false}
  compact={false}
/>
```
