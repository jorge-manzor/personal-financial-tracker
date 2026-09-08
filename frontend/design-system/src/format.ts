/**
 * Pure formatting helpers, copied from `frontend/src/format.ts` (only the subset used by the
 * components in this package). Keep in sync manually if the app's originals change.
 */

/** Solo tarjetas de posiciones en dashboard: limita decimales para lectura. */
export function formatSharesCard(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** USD con signo + explícito para ganancias en cabeceras. */
export function formatUsdSignedGain(n: number): string {
  if (!Number.isFinite(n)) return formatMoney(0);
  if (n > 0) return `+${formatMoney(n)}`;
  return formatMoney(n);
}

/** CLP solo con miles tipo chileno — p. ej. cabeceras ($100.753.265). */
export function formatClpDots(n: number): string {
  const s = (Math.round(n) || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });
  return `$${s.replace(/,/g, ".")}`;
}

/** CLP con signo, miles con punto (cabecera / variación). */
export function formatClpSigned(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  const s = Math.round(Math.abs(n)).toLocaleString("es-CL", { maximumFractionDigits: 0 });
  return `${sign}$${s.replace(/,/g, ".")}`;
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/** USD con miles tipo punto y dos decimales (coma decimal), ej. $1.833.141,50 */
export function formatUsdDotsTwoDecimals(n: number): string {
  if (!Number.isFinite(n)) return "$0,00";
  const neg = n < 0;
  const abs = Math.abs(n);
  const [intPart, frac] = abs.toFixed(2).split(".");
  const intGrouped = Number(intPart).toLocaleString("es-CL", { maximumFractionDigits: 0 });
  return `${neg ? "-" : ""}$${intGrouped},${frac}`;
}

export function formatAxisMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

/** Eje Y del gráfico en CLP (miles / millones) — sin decimales (peso chileno). */
export function formatAxisClp(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${Math.round(n / 1e9)}MM`;
  if (abs >= 1e6) return `$${Math.round(n / 1e6)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

/** Tooltip del gráfico mensual: importe completo, sin abreviar (K/M) ni redondear a miles. */
export function formatMonthlyTooltipValue(n: number, currency: "USD" | "CLP"): string {
  if (currency === "CLP") {
    const s = (Math.round(n) || 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });
    return `CLP $${s.replace(/,/g, ".")}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function chartDateLabel(d: string, period: string): string {
  const x = new Date(d + "T12:00:00");
  const mo = x.toLocaleDateString("es", { month: "short" });
  const yr = x.getFullYear().toString().slice(-2);
  const day = x.getDate();
  if (period === "1M" || period === "3M") {
    return `${day} ${mo}`;
  }
  if (period === "6M" || period === "1Y" || period === "YTD") {
    return mo;
  }
  return `${mo} ${yr}`;
}

/** Tooltip title — period-aware (see portfolio chart spec). */
export function chartTooltipDateLabel(isoDate: string, period: string): string {
  const d = new Date(isoDate + "T12:00:00");
  if (period === "1M" || period === "3M") {
    return d.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
  }
  return d.toLocaleDateString("es", { month: "short", year: "numeric" });
}
