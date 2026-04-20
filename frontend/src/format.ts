/** Acciones fraccionales tal cual en backend (hasta ~16 decimales visibles, sin agrupar miles). */
export function formatSharesExact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: 16,
  });
}

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

/** USD con separadores estilo Chile (miles con punto), sin decimales — cabeceras tipo dashboard. */
export function formatMoneyUsdCompact(n: number): string {
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** CLP: thousands with dot, prefix CLP $ */
export function formatMoneyCLP(n: number): string {
  const s = Math.round(n).toLocaleString("es-CL", { maximumFractionDigits: 0 });
  return `CLP $${s.replace(/,/g, ".")}`;
}

/** CLP solo con miles tipo chileno — p. ej. cabeceras ($100.753.265). */
export function formatClpDots(n: number): string {
  const s = Math.round(n).toLocaleString("es-CL", { maximumFractionDigits: 0 });
  return `$${s.replace(/,/g, ".")}`;
}

/** Movimientos bancarios: siempre `$1.000` con separador de miles; el signo se indica con color (verde/rojo). */
export function formatBankingClpSigned(amount: number): string {
  const abs = Math.abs(Math.round(amount));
  const body = abs.toLocaleString("es-CL", { maximumFractionDigits: 0 }).replace(/,/g, ".");
  return `$${body}`;
}

/** USD label style: USD $1,092.77 */
export function formatMoneyUSDLabel(n: number): string {
  const x = formatMoney(n).replace("$", "").trim();
  return `USD $${x}`;
}

/** USD enteros con miles tipo punto — leyendas de torta / sectores (ej. $1.833.141). */
export function formatUsdDotsInteger(n: number): string {
  const s = Math.round(n).toLocaleString("es-CL", { maximumFractionDigits: 0 });
  return `$${s.replace(/,/g, ".")}`;
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

const EGRESO_TIPOS = new Set([
  "venta",
  "retiro",
  "acat_comision",
  "acat_egreso",
  "warrant_comision",
  "warrant_costo",
]);

/** Ingreso / Egreso para detalle de movimiento (splits: sin efectivo). */
export function txDirectionLabel(tipo: string): "Ingreso" | "Egreso" | "Sin flujo de efectivo" {
  if (tipo === "division_accion") return "Sin flujo de efectivo";
  return EGRESO_TIPOS.has(tipo) ? "Egreso" : "Ingreso";
}

/** Fecha calendario larga (es-CL), `fecha` = YYYY-MM-DD. */
export function formatDateLongEs(fecha: string): string {
  const d = new Date(fecha + "T12:00:00");
  return d.toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" });
}

/** Instantánea ISO del backend (`occurred_at`). */
export function formatExecutedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("es-CL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatFxRateClpPerUsd(n: number): string {
  const s = n.toLocaleString("es-CL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${s} CLP/USD`;
}

export function formatTxSignedAmount(
  monto: number,
  currency: string,
  tipo: string,
): { text: string; signClass: string } {
  const isOut = EGRESO_TIPOS.has(tipo);
  const sign = isOut ? "-" : "+";
  const cur = (currency || "USD").toUpperCase();
  const body = cur === "CLP" ? formatMoneyCLP(Math.abs(monto)) : formatMoneyUSDLabel(Math.abs(monto));
  return {
    text: `${sign}${body}`,
    signClass: isOut ? "text-[#f87171]" : "text-[#4ade80]",
  };
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
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

/** CLP con signo, miles con punto (cabecera / variación). */
export function formatClpSigned(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  const s = Math.round(Math.abs(n)).toLocaleString("es-CL", { maximumFractionDigits: 0 });
  return `${sign}$${s.replace(/,/g, ".")}`;
}

/** Tooltip del gráfico mensual: importe completo, sin abreviar (K/M) ni redondear a miles. */
export function formatMonthlyTooltipValue(n: number, currency: "USD" | "CLP"): string {
  if (currency === "CLP") {
    const s = Math.round(n).toLocaleString("es-CL", { maximumFractionDigits: 0 });
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
