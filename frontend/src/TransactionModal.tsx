import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "./config";
import { formatMoneyCLP, formatMoneyUSDLabel } from "./format";
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
}

function parseDecimal(s: string): number {
  const n = parseFloat(s.replace(",", ".").trim());
  return Number.isNaN(n) ? NaN : n;
}

function isTipo(t: string): t is Tipo {
  return t === "compra" || t === "venta" || t === "dividendo";
}

export function TransactionModal({ open, editing, onClose, onSaved }: Props) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
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
      const url = isEdit ? `${API_BASE}/transactions/${editing.id}` : `${API_BASE}/transactions`;
      const r = await fetch(url, {
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

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div
        className="w-full max-w-md rounded-xl border border-[#30363d] bg-[#161b22] p-6 shadow-xl"
        role="dialog"
      >
        <h2 className="mb-4 text-lg font-semibold text-white">{title}</h2>
        <div className="flex flex-col gap-3">
          <label className="text-sm text-[#8b949e]">
            Fecha
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
            />
          </label>
          <label className="text-sm text-[#8b949e]">
            Tipo
            <select
              className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as Tipo)}
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-[#8b949e]">
            Categoría
            <select
              className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white"
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
          <label className="text-sm text-[#8b949e]">
            Moneda
            <select
              className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyType)}
            >
              {MONEDAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-[#8b949e]">
            Activo (ticker / código)
            <input
              className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 uppercase text-white placeholder:text-[#484f58]"
              placeholder="Ej: AAPL, FONDO_BCH"
              value={activo}
              onChange={(e) => setActivo(e.target.value.toUpperCase())}
            />
          </label>
          <label className="text-sm text-[#8b949e]">
            Nombre del activo (opcional, fondos / AFP)
            <input
              className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white placeholder:text-[#484f58]"
              placeholder="Ej: Fondo Mutuo Banchile"
              value={nombreActivo}
              onChange={(e) => setNombreActivo(e.target.value)}
            />
          </label>
          <label className="text-sm text-[#8b949e]">
            N° acciones / unidades
            <input
              className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white"
              inputMode="decimal"
              autoComplete="off"
              value={acciones}
              onChange={(e) => setAcciones(e.target.value)}
            />
          </label>
          <label className="text-sm text-[#8b949e]">
            {unitLabel}
            <input
              className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white"
              inputMode="decimal"
              autoComplete="off"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
            />
          </label>
          <div className="text-sm text-[#8b949e]">
            {totalLabel}
            <output
              className="mt-1 block w-full rounded-lg border border-[#30363d] bg-[#21262d] px-3 py-2 text-base tabular-nums text-white"
              aria-live="polite"
            >
              {montoDisplay ?? "—"}
            </output>
            <p className="mt-1 text-xs text-[#6e7681]">acciones × precio unitario</p>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-[#ef4444]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#8b949e] hover:bg-[#21262d]"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-lg bg-[#22c55e] px-4 py-2 text-sm font-medium text-[#0d1117] disabled:opacity-50"
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
