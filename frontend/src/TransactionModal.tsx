import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { formatMoneyCLP, formatMoneyUSDLabel } from "./format";
import { localDateISOString } from "./localDate";
import type { CategoriaType, CurrencyType, TransactionRow, TransactionType } from "./types";

const TIPOS = ["compra", "venta", "dividendo"] as const;
const CATEGORIAS: CategoriaType[] = ["Fondos", "AFP"];
const MONEDAS: CurrencyType[] = ["USD", "CLP"];

type Tipo = (typeof TIPOS)[number];

interface Props {
  open: boolean;
  editing: TransactionRow | null;
  onClose: () => void;
  onSaved: () => void;
  isDark: boolean;
}

function parseDecimal(s: string): number {
  const n = parseFloat(s.replace(",", ".").trim());
  return Number.isNaN(n) ? NaN : n;
}

function isTipo(t: string): t is Tipo {
  return t === "compra" || t === "venta" || t === "dividendo";
}

export function TransactionModal({ open, editing, onClose, onSaved, isDark }: Props) {
  const today = useMemo(() => localDateISOString(), []);
  const [fecha, setFecha] = useState(today);
  const [tipo, setTipo] = useState<Tipo>("compra");
  const [activo, setActivo] = useState("");
  const [acciones, setAcciones] = useState("");
  const [precio, setPrecio] = useState("");
  const [categoria, setCategoria] = useState<CategoriaType>("Fondos");
  const [currency, setCurrency] = useState<CurrencyType>("USD");
  const [nombreActivo, setNombreActivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      setFecha(editing.fecha.slice(0, 10));
      setTipo(isTipo(editing.tipo) ? editing.tipo : "compra");
      setActivo(editing.activo);
      setAcciones(String(editing.acciones));
      setPrecio(String(editing.precio_unitario));
      setCategoria(editing.categoria === "AFP" ? "AFP" : "Fondos");
      setCurrency(editing.currency === "CLP" ? "CLP" : "USD");
      setNombreActivo(editing.nombre_activo ?? "");
    } else {
      setFecha(today);
      setTipo("compra");
      setActivo("");
      setAcciones("");
      setPrecio("");
      setCategoria("Fondos");
      setCurrency("USD");
      setNombreActivo("");
    }
  }, [open, editing, today]);

  const montoDisplay = useMemo(() => {
    const a = parseDecimal(acciones);
    const p = parseDecimal(precio);
    if (Number.isNaN(a) || Number.isNaN(p) || a <= 0 || p <= 0) {
      return null;
    }
    const total = a * p;
    return currency === "CLP" ? formatMoneyCLP(total) : formatMoneyUSDLabel(total);
  }, [acciones, precio, currency]);

  const handleSubmit = async () => {
    setError(null);
    const a = parseDecimal(acciones);
    const p = parseDecimal(precio);
    if (!activo.trim() || Number.isNaN(a) || a <= 0 || Number.isNaN(p) || p <= 0) {
      setError("Completa todos los campos con valores válidos.");
      return;
    }
    const montoTotal = a * p;
    const body = {
      fecha,
      tipo: tipo as TransactionType,
      activo: activo.toUpperCase(),
      acciones: a,
      precio_unitario: p,
      monto_total: montoTotal,
      categoria,
      currency,
      nombre_activo: nombreActivo.trim() || null,
    };
    setSaving(true);
    try {
      const isEdit = editing != null;
      const url = isEdit ? `/transactions/${editing.id}` : `/transactions`;
      const r = await apiFetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const detail = d.detail;
        setError(
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail.map((x: { msg?: string }) => x.msg).join(" ")
              : "No se pudo guardar.",
        );
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Error de red.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const title = editing ? "Editar transacción" : "Nueva transacción";
  const unitLabel = currency === "CLP" ? "Precio unitario (CLP)" : "Precio unitario (USD)";
  const totalLabel = currency === "CLP" ? "Monto total (CLP)" : "Monto total (USD)";

  const cardClass = isDark
    ? "w-full max-w-md rounded-xl border border-[#30363d] bg-[#161b22] p-6 shadow-xl"
    : "w-full max-w-md rounded-xl border border-[#E8E1D4] bg-white p-6 shadow-xl";
  const titleClass = isDark ? "text-[#F3F1EC]" : "text-[#2B2620]";
  const labelClass = `text-sm ${isDark ? "text-[#8b949e]" : "text-[#4A453C]"}`;
  const controlClass = isDark
    ? "mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-[#F3F1EC] placeholder:text-[#484f58]"
    : "mt-1 w-full rounded-lg border border-[#DCD3C2] bg-white px-3 py-2 text-[#2B2620] placeholder:text-[#9A9284]";
  const outputClass = isDark
    ? "mt-1 block w-full rounded-lg border border-[#30363d] bg-[#21262d] px-3 py-2 text-base tabular-nums text-[#F3F1EC]"
    : "mt-1 block w-full rounded-lg border border-[#DCD3C2] bg-[#F5F1E8] px-3 py-2 text-base tabular-nums text-[#2B2620]";
  const helperClass = isDark ? "mt-1 text-xs text-[#6e7681]" : "mt-1 text-xs text-[#9A9284]";
  const cancelBtnClass = isDark
    ? "rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#8b949e] hover:bg-[#21262d]"
    : "rounded-lg border border-[#DCD3C2] px-4 py-2 text-sm text-[#4A453C] hover:bg-[#F5F1E8]";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className={cardClass} role="dialog">
        <h2 className={`mb-4 text-lg font-semibold ${titleClass}`}>{title}</h2>
        <div className="flex flex-col gap-3">
          <label className={labelClass}>
            Fecha
            <input type="date" className={controlClass} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>
          <label className={labelClass}>
            Tipo
            <select className={controlClass} value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Categoría
            <select
              className={controlClass}
              value={categoria}
              onChange={(e) => setCategoria(e.target.value as CategoriaType)}
            >
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Moneda
            <select className={controlClass} value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyType)}>
              {MONEDAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Activo (ticker / código)
            <input
              className={`${controlClass} uppercase`}
              placeholder="Ej: AAPL, FONDO_BCH"
              value={activo}
              onChange={(e) => setActivo(e.target.value.toUpperCase())}
            />
          </label>
          <label className={labelClass}>
            Nombre del activo (opcional, fondos / AFP)
            <input
              className={controlClass}
              placeholder="Ej: Fondo Mutuo Banchile"
              value={nombreActivo}
              onChange={(e) => setNombreActivo(e.target.value)}
            />
          </label>
          <label className={labelClass}>
            N° acciones / unidades
            <input
              className={controlClass}
              inputMode="decimal"
              autoComplete="off"
              value={acciones}
              onChange={(e) => setAcciones(e.target.value)}
            />
          </label>
          <label className={labelClass}>
            {unitLabel}
            <input
              className={controlClass}
              inputMode="decimal"
              autoComplete="off"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
            />
          </label>
          <div className={labelClass}>
            {totalLabel}
            <output className={outputClass} aria-live="polite">
              {montoDisplay ?? "—"}
            </output>
            <p className={helperClass}>acciones × precio unitario</p>
          </div>
        </div>
        {error && <p className={`mt-3 text-sm ${isDark ? "text-[#f87171]" : "text-rose-600"}`}>{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={cancelBtnClass} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-lg bg-[#8FBFA6] px-4 py-2 text-sm font-medium text-[#1F2E25] hover:bg-[#7FB097] disabled:opacity-50"
            disabled={saving}
            onClick={() => void handleSubmit()}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
