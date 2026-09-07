/** Selector de fecha propio (reemplaza el `<input type="date">` nativo) — mismo trigger que Producto/Categoría. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bankingModalCategoryTriggerClass, bankingPickerListScrollClass } from "./bankingTxShared";
import { IconCalendar } from "./bankingTxIcons";

const WEEKDAY_LABELS_ES = ["L", "M", "M", "J", "V", "S", "D"];
const MONTH_LABELS_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];
const MONTH_ABBR_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const parts = iso.split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return null;
  return { y, m, d };
}

function isoFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayParts(): { y: number; m: number; d: number } {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/** 0 = lunes … 6 = domingo (la convención chilena de la grilla). */
function mondayFirstWeekday(y: number, m: number, d: number): number {
  const jsDay = new Date(y, m - 1, d).getDay(); // 0 = domingo
  return (jsDay + 6) % 7;
}

function formatDateLabelEs(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  return `${String(p.d).padStart(2, "0")} ${MONTH_ABBR_ES[p.m - 1]} ${p.y}`;
}

type CalendarCell = { y: number; m: number; d: number; inMonth: boolean };

function buildCalendarGrid(y: number, m: number): CalendarCell[] {
  const firstWeekday = mondayFirstWeekday(y, m, 1);
  const totalDays = daysInMonth(y, m);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevDays = daysInMonth(prevY, prevM);
  const cells: CalendarCell[] = [];
  for (let i = firstWeekday - 1; i >= 0; i--) {
    cells.push({ y: prevY, m: prevM, d: prevDays - i, inMonth: false });
  }
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ y, m, d, inMonth: true });
  }
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  let nextD = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ y: nextY, m: nextM, d: nextD, inMonth: false });
    nextD += 1;
  }
  return cells;
}

/** Calendario propio — mismo trigger visual que Producto/Categoría; popover con navegación de mes y grilla de días. */
export function BankingDatePicker({
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  /** Fecha en formato ISO `YYYY-MM-DD`. */
  value: string;
  onChange: (iso: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const selected = parseIsoDate(value);
  const [viewY, setViewY] = useState(() => selected?.y ?? todayParts().y);
  const [viewM, setViewM] = useState(() => selected?.m ?? todayParts().m);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const updateBox = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setBox({ top: r.bottom + 6, left: r.left, width: Math.max(260, r.width) });
  }, []);

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((o) => {
      const next = !o;
      if (next) {
        const p = parseIsoDate(value) ?? todayParts();
        setViewY(p.y);
        setViewM(p.m);
      }
      return next;
    });
  }, [disabled, value]);

  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    updateBox();
    window.addEventListener("scroll", updateBox, true);
    window.addEventListener("resize", updateBox);
    return () => {
      window.removeEventListener("scroll", updateBox, true);
      window.removeEventListener("resize", updateBox);
    };
  }, [open, updateBox]);

  useEffect(() => {
    if (!open) return;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const goPrevMonth = () => {
    setViewM((m) => {
      if (m === 1) {
        setViewY((y) => y - 1);
        return 12;
      }
      return m - 1;
    });
  };
  const goNextMonth = () => {
    setViewM((m) => {
      if (m === 12) {
        setViewY((y) => y + 1);
        return 1;
      }
      return m + 1;
    });
  };

  const cells = buildCalendarGrid(viewY, viewM);
  const t = todayParts();

  const pick = (c: CalendarCell) => {
    onChange(isoFromParts(c.y, c.m, c.d));
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        onClick={toggle}
        className={bankingModalCategoryTriggerClass}
      >
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-[#8FBFA6]/16 text-[#3F6B52] banking-dark:bg-[#8FBFA6]/14 banking-dark:text-[#8FBFA6]">
          <IconCalendar className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
          {value ? formatDateLabelEs(value) : "Selecciona una fecha"}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
          className={`h-5 w-5 shrink-0 text-[#8A8072] transition banking-dark:text-[#8FBFA6]/75 ${open ? "rotate-180" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.24 4.496a.75.75 0 01-1.08 0l-4.24-4.497a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && box
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label={`Calendario — ${ariaLabel}`}
              style={{ position: "fixed", top: box.top, left: box.left, width: box.width, zIndex: 9998 }}
              className="banking-theme overflow-hidden rounded-2xl border border-[#DCD3C2] bg-white shadow-2xl shadow-[#2B2620]/10 ring-1 ring-[#DCD3C2] banking-dark:border-[#30363d] banking-dark:bg-[#161b22] banking-dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.65)] banking-dark:ring-[#30363d]"
            >
              <div className="flex items-center justify-between px-3.5 pb-2 pt-3.5">
                <button
                  type="button"
                  aria-label="Mes anterior"
                  onClick={goPrevMonth}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-lg text-[#8A8072] transition hover:bg-[#F5F1E8] hover:text-[#2B2620] banking-dark:text-[#8b949e] banking-dark:hover:bg-[#12161d] banking-dark:hover:text-[#F3F1EC]"
                >
                  ‹
                </button>
                <span className="text-[13px] font-bold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                  {MONTH_LABELS_ES[viewM - 1]} {viewY}
                </span>
                <button
                  type="button"
                  aria-label="Mes siguiente"
                  onClick={goNextMonth}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-lg text-[#8A8072] transition hover:bg-[#F5F1E8] hover:text-[#2B2620] banking-dark:text-[#8b949e] banking-dark:hover:bg-[#12161d] banking-dark:hover:text-[#F3F1EC]"
                >
                  ›
                </button>
              </div>
              <div className="grid grid-cols-7 px-2.5">
                {WEEKDAY_LABELS_ES.map((w, i) => (
                  <span
                    key={`${w}-${i}`}
                    className="py-1 text-center text-[9.5px] font-bold text-[#9A9284] banking-dark:text-[#6b7280]"
                  >
                    {w}
                  </span>
                ))}
              </div>
              <div className={`grid grid-cols-7 gap-0.5 px-2.5 pb-3 ${bankingPickerListScrollClass}`}>
                {cells.map((c, idx) => {
                  const isSelected = !!selected && selected.y === c.y && selected.m === c.m && selected.d === c.d;
                  const isToday = t.y === c.y && t.m === c.m && t.d === c.d;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => pick(c)}
                      className={`flex h-7 items-center justify-center rounded-full text-[12px] transition ${
                        !c.inMonth
                          ? "text-[#C7BFAF] hover:bg-[#F5F1E8] banking-dark:text-[#4b5361] banking-dark:hover:bg-[#12161d]"
                          : isSelected
                            ? "bg-[#8FBFA6] font-extrabold text-[#1F2E25]"
                            : isToday
                              ? "border border-[#8FBFA6] font-bold text-[#3F6B52] banking-dark:text-[#8FBFA6]"
                              : "text-[#2B2620] hover:bg-[#F5F1E8] banking-dark:text-[#F3F1EC] banking-dark:hover:bg-[#12161d]"
                      }`}
                    >
                      {c.d}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => pick({ ...t, inMonth: true })}
                className="flex w-full items-center justify-center border-t border-[#F0EAE0] py-2.5 text-[11.5px] font-bold text-[#3F6B52] transition hover:bg-[#F5F1E8] banking-dark:border-[#1e242e] banking-dark:text-[#8FBFA6] banking-dark:hover:bg-[#12161d]"
              >
                Hoy · {formatDateLabelEs(isoFromParts(t.y, t.m, t.d))}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
