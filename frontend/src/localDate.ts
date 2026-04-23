/**
 * Fecha civil en la zona horaria del usuario (YYYY-MM-DD).
 * `toISOString().slice(0, 10)` usa UTC y adelanta el día en horas vespertinas en Chile.
 */
export function localDateISOString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Año-mes locales (YYYY-MM). */
export function localYearMonthString(date: Date = new Date()): string {
  return localDateISOString(date).slice(0, 7);
}
