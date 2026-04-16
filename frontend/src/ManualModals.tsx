import { useEffect, useMemo, useState } from "react";
import { API_BASE } from "./config";
import type { ManualAsset } from "./types";

interface SnapshotProps {
  asset: ManualAsset | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ManualSnapshotModal({ asset, open, onClose, onSaved }: SnapshotProps) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [fecha, setFecha] = useState(today);
  const [valor, setValor] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFecha(today);
      setValor("");
      setError(null);
    }
  }, [open, today]);

  if (!open || !asset) return null;

  async function submit() {
    if (!asset) return;
    const v = parseFloat(valor.replace(",", "."));
    if (Number.isNaN(v) || v <= 0) {
      setError("Valor inválido.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/manual-assets/${asset.id}/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha, valor: v }),
      });
      if (!r.ok) {
        setError("No se pudo guardar.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Error de red.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl border border-[#30363d] bg-[#161b22] p-6">
        <h2 className="mb-1 text-lg font-semibold text-white">Actualizar valor</h2>
        <p className="mb-4 text-sm text-[#8b949e]">{asset.nombre}</p>
        <label className="text-sm text-[#8b949e]">
          Fecha
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </label>
        <label className="mt-3 block text-sm text-[#8b949e]">
          Valor actual total (USD)
          <input
            className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
          />
        </label>
        {error && <p className="mt-2 text-sm text-[#ef4444]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#8b949e]"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-lg bg-[#22c55e] px-4 py-2 text-sm font-medium text-[#0d1117] disabled:opacity-50"
            disabled={saving}
            onClick={submit}
          >
            Guardar snapshot
          </button>
        </div>
      </div>
    </div>
  );
}

interface CreateProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ManualCreateModal({ open, onClose, onSaved }: CreateProps) {
  const [nombre, setNombre] = useState("");
  const [categoria, setCategoria] = useState("Fondo Mutuo");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setNombre("");
      setCategoria("Fondo Mutuo");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    if (!nombre.trim()) {
      setError("Nombre requerido.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/manual-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          categoria,
          moneda: "USD",
        }),
      });
      if (!r.ok) {
        setError("No se pudo crear.");
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Error de red.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-xl border border-[#30363d] bg-[#161b22] p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Nuevo activo manual</h2>
        <label className="text-sm text-[#8b949e]">
          Nombre
          <input
            className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
        <label className="mt-3 block text-sm text-[#8b949e]">
          Categoría
          <input
            className="mt-1 w-full rounded-lg border border-[#30363d] bg-[#0d1117] px-3 py-2 text-white"
            value={categoria}
            onChange={(e) => setCategoria(e.target.value)}
          />
        </label>
        {error && <p className="mt-2 text-sm text-[#ef4444]">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[#30363d] px-4 py-2 text-sm text-[#8b949e]"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-lg bg-[#22c55e] px-4 py-2 text-sm font-medium text-[#0d1117] disabled:opacity-50"
            disabled={saving}
            onClick={submit}
          >
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}
