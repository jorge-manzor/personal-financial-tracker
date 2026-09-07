import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, fetchJson, patchJson, postJson } from "./api";
import { formatBankingClpSigned, formatClpDots, parseChileanAmountInput } from "./format";
import { IconPencil, IconTrash } from "./bankingTxIcons";
import {
  AccountSelect,
  RowActionsMenu,
  btnPrimary,
  btnSecondary,
  cardClass,
  inputClass,
  labelClass,
  modalBackdropClass,
  modalPanelClass,
} from "./bankingPersonalOrderShared";
import type { BankingAccountRow } from "./types";

function savingsGoalProgressPercent(balance: number, target: number | null | undefined): number | null {
  if (target == null || !(target > 0)) return null;
  return Math.round((balance / target) * 100);
}

type PersonalSavingsAdjustment = {
  id: number;
  goal_id: number;
  amount: number;
  created_at: string;
};

function groupSavingsAdjustmentsByGoal(rows: PersonalSavingsAdjustment[]): Record<number, PersonalSavingsAdjustment[]> {
  const m: Record<number, PersonalSavingsAdjustment[]> = {};
  for (const r of rows) {
    if (!m[r.goal_id]) m[r.goal_id] = [];
    m[r.goal_id].push(r);
  }
  for (const k of Object.keys(m)) {
    m[Number(k)].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id);
  }
  return m;
}

function formatSavingsAdjustmentWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("es-CL", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

type PersonalSavingsGoal = {
  id: number;
  title: string;
  account_id: number;
  account_name: string;
  balance_clp: number;
  /** Monto meta CLP; null/undefined = solo seguimiento, sin % */
  target_amount_clp?: number | null;
};

const ADJUST_STEP_CLP = 10000;

/** Anillo de progreso circular — reemplaza la barra lineal de la versión anterior. */
function GoalProgressRing({ percent }: { percent: number }) {
  const r = 40;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, percent));
  const offset = circumference * (1 - clamped / 100);
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg width="76" height="76" viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#EDE7D9" strokeWidth="9" className="banking-dark:hidden" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#21262d"
          strokeWidth="9"
          className="hidden banking-dark:block"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#8FBFA6"
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-base font-extrabold text-[#3F6B52] banking-dark:text-[#8FBFA6]">
        {percent}%
      </div>
    </div>
  );
}

function AdjustStepper({
  value,
  onChange,
  onApply,
}: {
  value: string;
  onChange: (v: string) => void;
  onApply: () => void;
}) {
  const step = (delta: number) => {
    const current = parseChileanAmountInput(value.trim() || "0");
    const base = Number.isFinite(current) ? current : 0;
    onChange(String(base + delta));
  };
  return (
    <div>
      <label className={labelClass}>Ajustar saldo (+ o −)</label>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          aria-label="Restar"
          onClick={() => step(-ADJUST_STEP_CLP)}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-[#DCD3C2] bg-white text-base font-bold text-[#4A453C] transition hover:bg-[#F5F1E8] banking-dark:border-[#30363d] banking-dark:bg-[#0d1117] banking-dark:text-[#c9d1d9] banking-dark:hover:bg-[#161b22]"
        >
          −
        </button>
        <input
          className={`${inputClass} mt-0 tabular-nums`}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ej.: 50000 o -10000"
        />
        <button
          type="button"
          aria-label="Sumar"
          onClick={() => step(ADJUST_STEP_CLP)}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-[#DCD3C2] bg-white text-base font-bold text-[#4A453C] transition hover:bg-[#F5F1E8] banking-dark:border-[#30363d] banking-dark:bg-[#0d1117] banking-dark:text-[#c9d1d9] banking-dark:hover:bg-[#161b22]"
        >
          +
        </button>
        <button type="button" className={`${btnPrimary} shrink-0 whitespace-nowrap`} onClick={onApply}>
          Aplicar
        </button>
      </div>
    </div>
  );
}

/** Historial como línea de tiempo (puntos conectados) — reemplaza la tabla de la versión anterior. */
function GoalHistoryTimeline({
  rows,
  onEditRow,
  onRemoveRow,
}: {
  rows: (PersonalSavingsAdjustment & { balanceAfter: number })[];
  onEditRow: (row: PersonalSavingsAdjustment) => void;
  onRemoveRow: (row: PersonalSavingsAdjustment) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold text-[#4A453C] banking-dark:text-[#c9d1d9]">Historial de movimientos</span>
        <span className="text-[11px] text-[#8A8072] banking-dark:text-[#8b949e]">
          {rows.length} {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        rows.length === 0 ? (
          <p className="mt-2 text-[11px] leading-snug text-[#8A8072] banking-dark:text-[#8b949e]">
            Sin movimientos registrados. Si el saldo inicial fue 0, el primer ajuste creará la primera línea.
          </p>
        ) : (
          <div className="mt-2.5 max-h-56 space-y-2.5 overflow-y-auto border-l-2 border-[#F0EAE0] pl-2.5 tx-scroll banking-dark:border-[#1a1f2e]">
            {[...rows].reverse().map((row) => (
              <div key={row.id} className="relative flex items-start justify-between gap-2 pl-3.5">
                <span
                  className={`absolute left-[-19px] top-[6px] h-2 w-2 rounded-full ${
                    row.amount >= 0 ? "bg-emerald-600 banking-dark:bg-emerald-400" : "bg-rose-600 banking-dark:bg-rose-400"
                  }`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-[11.5px] text-[#8A8072] banking-dark:text-[#8b949e]">
                    {formatSavingsAdjustmentWhen(row.created_at)} ·{" "}
                    <span
                      className={`font-bold ${
                        row.amount >= 0 ? "text-emerald-600 banking-dark:text-emerald-400" : "text-rose-600 banking-dark:text-rose-400"
                      }`}
                    >
                      {formatBankingClpSigned(row.amount)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-[#9A9284] banking-dark:text-[#6b7280]">
                    Saldo después: {formatBankingClpSigned(row.balanceAfter)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    title="Editar movimiento"
                    aria-label="Editar movimiento"
                    onClick={() => onEditRow(row)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-[#9A9284] transition hover:bg-[#F5F1E8] hover:text-[#4A453C] banking-dark:text-[#6b7280] banking-dark:hover:bg-[#161b22] banking-dark:hover:text-[#c9d1d9]"
                  >
                    <IconPencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Eliminar movimiento"
                    aria-label="Eliminar movimiento"
                    onClick={() => void onRemoveRow(row)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-[#9A9284] transition hover:bg-[#FDF2F5] hover:text-[#A65568] banking-dark:text-[#6b7280] banking-dark:hover:bg-[#2a1216]/70 banking-dark:hover:text-[#cc8e9e]"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

function GoalCard({
  goal,
  history,
  adjustValue,
  onAdjustChange,
  onApplyAdjust,
  onEdit,
  onRemove,
  onEditHistoryRow,
  onRemoveHistoryRow,
}: {
  goal: PersonalSavingsGoal;
  history: PersonalSavingsAdjustment[];
  adjustValue: string;
  onAdjustChange: (v: string) => void;
  onApplyAdjust: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onEditHistoryRow: (row: PersonalSavingsAdjustment) => void;
  onRemoveHistoryRow: (row: PersonalSavingsAdjustment) => void;
}) {
  const target = goal.target_amount_clp ?? null;
  const pct = savingsGoalProgressPercent(goal.balance_clp, target);
  const histRows = history.reduce<(PersonalSavingsAdjustment & { balanceAfter: number })[]>((acc, h) => {
    const balanceAfter = (acc.length > 0 ? acc[acc.length - 1].balanceAfter : 0) + h.amount;
    acc.push({ ...h, balanceAfter });
    return acc;
  }, []);

  return (
    <div className={`${cardClass} relative flex flex-col`}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-3.5">
          {pct != null ? (
            <GoalProgressRing percent={pct} />
          ) : (
            <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-full bg-[#C79A56]/14 text-2xl">
              🐷
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-[#2B2620] banking-dark:text-[#F3F1EC]">{goal.title}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-[#8A8072] banking-dark:text-[#8b949e]">{goal.account_name}</p>
            <span
              className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                pct != null
                  ? "bg-[#C79A56]/16 text-[#8A6631] banking-dark:bg-[#C79A56]/15 banking-dark:text-[#C79A56]"
                  : "bg-[#F5F1E8] text-[#8A8072] banking-dark:bg-[#161b22] banking-dark:text-[#8b949e]"
              }`}
            >
              {pct != null ? "Con meta" : "Solo seguimiento"}
            </span>
          </div>
        </div>
        <RowActionsMenu ariaLabel={`Acciones de la meta: ${goal.title}`} onEdit={onEdit} onRemove={onRemove} />
      </div>

      {pct != null && target != null ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[#F0EAE0] bg-[#FBFAF7] px-3.5 py-3 banking-dark:border-[#1a1f2e] banking-dark:bg-[#0d1117]">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8072] banking-dark:text-[#8b949e]">
              Saldo actual
            </p>
            <p className="mt-0.5 text-xl font-extrabold text-[#2B2620] banking-dark:text-[#F3F1EC]">
              {formatClpDots(goal.balance_clp)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8072] banking-dark:text-[#8b949e]">
              Faltan
            </p>
            <p className="mt-0.5 text-sm font-bold text-[#4A453C] banking-dark:text-[#c9d1d9]">
              {formatClpDots(Math.max(0, target - goal.balance_clp))}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-[#F0EAE0] bg-[#FBFAF7] px-3.5 py-3 banking-dark:border-[#1a1f2e] banking-dark:bg-[#0d1117]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8A8072] banking-dark:text-[#8b949e]">
            Saldo actual
          </p>
          <p className="mt-0.5 text-xl font-extrabold text-[#2B2620] banking-dark:text-[#F3F1EC]">
            {formatClpDots(goal.balance_clp)}
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-1 flex-col gap-3">
        <AdjustStepper value={adjustValue} onChange={onAdjustChange} onApply={onApplyAdjust} />
        <GoalHistoryTimeline rows={histRows} onEditRow={onEditHistoryRow} onRemoveRow={onRemoveHistoryRow} />
      </div>
    </div>
  );
}

export function BankingSavingsGoalsPage({ onToast }: { onToast: (msg: string | null) => void }) {
  const [accounts, setAccounts] = useState<BankingAccountRow[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<PersonalSavingsGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const [newSavTitle, setNewSavTitle] = useState("");
  const [newSavAccountId, setNewSavAccountId] = useState<number | "">("");
  const [newSavInitial, setNewSavInitial] = useState("");
  /** Monto objetivo opcional al crear (vacío = solo control de saldo). */
  const [newSavTarget, setNewSavTarget] = useState("");

  const [adjustInputs, setAdjustInputs] = useState<Record<number, string>>({});
  const [savingsAdjustmentsByGoal, setSavingsAdjustmentsByGoal] = useState<Record<number, PersonalSavingsAdjustment[]>>({});

  const [editingSavings, setEditingSavings] = useState<PersonalSavingsGoal | null>(null);
  const [svTitle, setSvTitle] = useState("");
  const [svAccountId, setSvAccountId] = useState<number | "">("");
  const [svTarget, setSvTarget] = useState("");

  const [newSavingsModalOpen, setNewSavingsModalOpen] = useState(false);

  const [editingSavingsAdjustment, setEditingSavingsAdjustment] = useState<PersonalSavingsAdjustment | null>(null);
  const [editSavingsAdjAmount, setEditSavingsAdjAmount] = useState("");
  const [savingSavingsAdjEdit, setSavingSavingsAdjEdit] = useState(false);

  const fetchSavingsAdjustmentsMap = useCallback(async () => {
    const adj = await fetchJson<PersonalSavingsAdjustment[]>("/banking/personal-order/savings-adjustments");
    setSavingsAdjustmentsByGoal(groupSavingsAdjustmentsByGoal(adj));
  }, []);

  const reloadSavingsSection = useCallback(async () => {
    const [sav, adj] = await Promise.all([
      fetchJson<PersonalSavingsGoal[]>("/banking/personal-order/savings-goals"),
      fetchJson<PersonalSavingsAdjustment[]>("/banking/personal-order/savings-adjustments"),
    ]);
    setSavingsGoals(sav);
    setSavingsAdjustmentsByGoal(groupSavingsAdjustmentsByGoal(adj));
  }, []);

  const loadAll = useCallback(async () => {
    const [acc, sav] = await Promise.all([
      fetchJson<BankingAccountRow[]>("/banking/accounts"),
      fetchJson<PersonalSavingsGoal[]>("/banking/personal-order/savings-goals"),
    ]);
    setAccounts(acc.filter((a) => (a.enabled ?? true) !== false));
    setSavingsGoals(sav);
    try {
      await fetchSavingsAdjustmentsMap();
    } catch {
      setSavingsAdjustmentsByGoal({});
    }
  }, [fetchSavingsAdjustmentsMap]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadAll()
      .catch((e) => {
        console.error(e);
        if (!cancelled) onToast("No se pudo cargar Ahorro por objetivo.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAll, onToast]);

  useEffect(() => {
    if (!editingSavings) return;
    setSvTitle(editingSavings.title);
    setSvAccountId(editingSavings.account_id);
    const tg = editingSavings.target_amount_clp;
    setSvTarget(tg != null && tg > 0 ? String(Math.round(tg)) : "");
  }, [editingSavings]);

  useEffect(() => {
    if (!editingSavings && !editingSavingsAdjustment && !newSavingsModalOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setEditingSavings(null);
        setEditingSavingsAdjustment(null);
        setNewSavingsModalOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingSavings, editingSavingsAdjustment, newSavingsModalOpen]);

  const summary = useMemo(() => {
    const totalSaved = savingsGoals.reduce((acc, g) => acc + g.balance_clp, 0);
    const withTarget = savingsGoals.filter((g) => (g.target_amount_clp ?? 0) > 0);
    const avgProgress =
      withTarget.length > 0
        ? Math.round(
            withTarget.reduce((acc, g) => acc + (savingsGoalProgressPercent(g.balance_clp, g.target_amount_clp) ?? 0), 0) /
              withTarget.length,
          )
        : null;
    return { totalSaved, activeGoals: savingsGoals.length, avgProgress };
  }, [savingsGoals]);

  const addSavingsGoal = async () => {
    const t = newSavTitle.trim();
    if (!t) {
      onToast("Escribe un nombre para el ahorro.");
      return;
    }
    if (newSavAccountId === "") {
      onToast("Selecciona una cuenta.");
      return;
    }
    const initial = parseChileanAmountInput(newSavInitial.trim() || "0");
    let targetPayload: number | null = null;
    const tgtRaw = newSavTarget.trim();
    if (tgtRaw !== "") {
      const tp = parseChileanAmountInput(tgtRaw);
      if (!Number.isFinite(tp) || tp <= 0) {
        onToast("El monto objetivo no es válido; déjalo vacío si solo quieres llevar el saldo.");
        return;
      }
      targetPayload = tp;
    }
    try {
      const row = await postJson<PersonalSavingsGoal>("/banking/personal-order/savings-goals", {
        title: t,
        account_id: newSavAccountId,
        initial_balance_clp: initial,
        target_amount_clp: targetPayload,
      });
      setSavingsGoals((prev) => [...prev, row]);
      setNewSavTitle("");
      setNewSavAccountId("");
      setNewSavInitial("");
      setNewSavTarget("");
      setNewSavingsModalOpen(false);
      onToast("Meta de ahorro creada.");
      try {
        await fetchSavingsAdjustmentsMap();
      } catch {
        /* historial: recarga en próxima visita */
      }
    } catch {
      onToast("No se pudo crear la meta.");
    }
  };

  const applyAdjust = async (g: PersonalSavingsGoal) => {
    const raw = (adjustInputs[g.id] ?? "").trim();
    if (raw === "") {
      onToast("Ingresa un monto (positivo o negativo).");
      return;
    }
    const delta = parseChileanAmountInput(raw);
    try {
      const updated = await postJson<PersonalSavingsGoal>(`/banking/personal-order/savings-goals/${g.id}/adjust`, {
        amount: delta,
      });
      setSavingsGoals((prev) => prev.map((x) => (x.id === g.id ? updated : x)));
      setAdjustInputs((m) => ({ ...m, [g.id]: "" }));
      onToast("Saldo actualizado.");
      try {
        await fetchSavingsAdjustmentsMap();
      } catch {
        /* historial: recarga con la página */
      }
    } catch {
      onToast("No se pudo aplicar el ajuste.");
    }
  };

  const removeSavings = async (id: number) => {
    if (!confirm("¿Eliminar esta meta de ahorro? El historial de ajustes se pierde.")) return;
    try {
      const r = await apiFetch(`/banking/personal-order/savings-goals/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(String(r.status));
      setSavingsGoals((prev) => prev.filter((x) => x.id !== id));
      setEditingSavings((cur) => (cur?.id === id ? null : cur));
      setSavingsAdjustmentsByGoal((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      onToast("Meta eliminada.");
    } catch {
      onToast("No se pudo eliminar.");
    }
  };

  const openEditSavingsAdjustment = useCallback((row: PersonalSavingsAdjustment) => {
    setEditingSavingsAdjustment(row);
    setEditSavingsAdjAmount(String(row.amount));
  }, []);

  const saveSavingsAdjustmentEdit = async () => {
    if (!editingSavingsAdjustment) return;
    const amt = parseChileanAmountInput(editSavingsAdjAmount.trim());
    if (!Number.isFinite(amt) || amt === 0) {
      onToast("Indica un monto distinto de cero.");
      return;
    }
    setSavingSavingsAdjEdit(true);
    try {
      const updated = await patchJson<PersonalSavingsGoal>(
        `/banking/personal-order/savings-adjustments/${editingSavingsAdjustment.id}`,
        { amount: amt },
      );
      setSavingsGoals((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setEditingSavingsAdjustment(null);
      await fetchSavingsAdjustmentsMap();
      onToast("Movimiento actualizado.");
    } catch {
      onToast("No se pudo guardar.");
    } finally {
      setSavingSavingsAdjEdit(false);
    }
  };

  const removeSavingsAdjustmentRow = async (adj: PersonalSavingsAdjustment) => {
    if (!confirm("¿Eliminar este movimiento del historial? El saldo seguido se actualizará.")) return;
    try {
      const r = await apiFetch(`/banking/personal-order/savings-adjustments/${adj.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(String(r.status));
      await reloadSavingsSection();
      setEditingSavingsAdjustment((cur) => (cur?.id === adj.id ? null : cur));
      onToast("Movimiento eliminado.");
    } catch {
      onToast("No se pudo eliminar.");
    }
  };

  const openNewSavingsModal = useCallback(() => {
    setNewSavTitle("");
    setNewSavAccountId("");
    setNewSavInitial("");
    setNewSavTarget("");
    setNewSavingsModalOpen(true);
  }, []);

  const saveSavingsEdit = async () => {
    if (!editingSavings) return;
    const t = svTitle.trim();
    if (!t) {
      onToast("Escribe un nombre para la meta.");
      return;
    }
    if (svAccountId === "") {
      onToast("Selecciona una cuenta.");
      return;
    }
    let targetPatch: number | null;
    const tgtTrim = svTarget.trim();
    if (tgtTrim === "") {
      targetPatch = null;
    } else {
      const tp = parseChileanAmountInput(tgtTrim);
      if (!Number.isFinite(tp) || tp <= 0) {
        onToast("Monto objetivo no válido; vacía el campo para solo seguimiento de saldo.");
        return;
      }
      targetPatch = tp;
    }
    try {
      const updated = await patchJson<PersonalSavingsGoal>(`/banking/personal-order/savings-goals/${editingSavings.id}`, {
        title: t,
        account_id: svAccountId,
        target_amount_clp: targetPatch,
      });
      setSavingsGoals((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      setEditingSavings(null);
      onToast("Meta actualizada.");
    } catch {
      onToast("No se pudo guardar.");
    }
  };

  const pageShell =
    "banking-theme w-full min-h-[calc(100dvh-3.5rem)] bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(199,154,86,0.09),transparent_52%),linear-gradient(to_bottom,#FAF7F1,#F5F1E8)] text-[#4A453C] banking-dark:bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(143,191,166,0.06),transparent_52%),linear-gradient(to_bottom,#0d1117,#0a0d12)] banking-dark:text-[#c9d1d9]";
  const innerClass = "mx-auto max-w-[1100px] space-y-6 p-4 pb-28 md:p-6";

  if (loading) {
    return (
      <div className={pageShell}>
        <div className={innerClass}>
          <p className="text-sm text-[#8A8072] banking-dark:text-[#8b949e]">Cargando…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={pageShell}>
      <div className={innerClass}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#2B2620] banking-dark:text-[#F3F1EC]">
              Ahorro por objetivo
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[#4A453C] banking-dark:text-[#c9d1d9]">
              El saldo es solo un registro tuyo (el dinero real sigue en la cuenta del banco). Puedes definir un monto
              objetivo opcional para ver el % de avance; si no, la tarjeta sirve solo para ir actualizando el saldo al
              cierre de mes u otro control. Cada ajuste queda guardado en el historial del servidor.
            </p>
          </div>
          <button type="button" className={`${btnPrimary} shrink-0`} onClick={openNewSavingsModal}>
            Nuevo Objetivo
          </button>
        </header>

        {savingsGoals.length > 0 ? (
          <div className={`${cardClass} flex flex-wrap items-center gap-7`}>
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8A8072] banking-dark:text-[#8b949e]">
                Total ahorrado
              </p>
              <p className="mt-0.5 text-[26px] font-extrabold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                {formatClpDots(summary.totalSaved)}
              </p>
            </div>
            <div className="h-9 w-px bg-[#E8E1D4] banking-dark:bg-[#1e242e]" aria-hidden />
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8A8072] banking-dark:text-[#8b949e]">
                Metas activas
              </p>
              <p className="mt-0.5 text-[26px] font-extrabold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                {summary.activeGoals}
              </p>
            </div>
            <div className="h-9 w-px bg-[#E8E1D4] banking-dark:bg-[#1e242e]" aria-hidden />
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8A8072] banking-dark:text-[#8b949e]">
                Promedio de avance
              </p>
              <p className="mt-0.5 text-[26px] font-extrabold text-[#3F6B52] banking-dark:text-[#8FBFA6]">
                {summary.avgProgress != null ? `${summary.avgProgress}%` : "—"}
              </p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {savingsGoals.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              history={savingsAdjustmentsByGoal[g.id] ?? []}
              adjustValue={adjustInputs[g.id] ?? ""}
              onAdjustChange={(v) => setAdjustInputs((m) => ({ ...m, [g.id]: v }))}
              onApplyAdjust={() => void applyAdjust(g)}
              onEdit={() => setEditingSavings(g)}
              onRemove={() => void removeSavings(g.id)}
              onEditHistoryRow={openEditSavingsAdjustment}
              onRemoveHistoryRow={removeSavingsAdjustmentRow}
            />
          ))}

          <button
            type="button"
            onClick={openNewSavingsModal}
            className={`flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#DCD3C2] p-5 transition hover:border-[#8FBFA6] hover:bg-[#8FBFA6]/5 banking-dark:border-[#30363d] banking-dark:hover:border-[#8FBFA6]/60 banking-dark:hover:bg-[#8FBFA6]/5 ${
              savingsGoals.length === 0 ? "" : "md:col-span-2"
            }`}
          >
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#8FBFA6]/18 text-lg font-extrabold text-[#3F6B52] banking-dark:bg-[#8FBFA6]/14 banking-dark:text-[#8FBFA6]">
              +
            </span>
            <span className="text-sm font-semibold text-[#8A8072] banking-dark:text-[#8b949e]">Nueva meta de ahorro</span>
          </button>
        </div>

        {editingSavings ? (
          <div className={modalBackdropClass} role="presentation">
            <button
              type="button"
              aria-label="Cerrar"
              className="absolute inset-0 cursor-default bg-transparent"
              onClick={() => setEditingSavings(null)}
            />
            <div
              className={modalPanelClass}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-sav-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="edit-sav-title" className="text-lg font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                Editar meta de ahorro
              </h3>
              <p className="mt-1 text-xs text-[#8A8072] banking-dark:text-[#8b949e]">
                El saldo seguido se actualiza con «Aplicar» en la tarjeta. El monto objetivo es opcional: vacía el campo
                para seguir solo el saldo sin porcentaje.
              </p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className={labelClass}>Nombre del objetivo</label>
                  <input className={inputClass} value={svTitle} onChange={(e) => setSvTitle(e.target.value)} maxLength={512} />
                </div>
                <div>
                  <label className={labelClass}>Cuenta en la que ahorras</label>
                  <AccountSelect value={svAccountId} onChange={setSvAccountId} accounts={accounts} placeholder="Selecciona…" />
                </div>
                <div>
                  <label className={labelClass}>Monto objetivo (CLP, opcional)</label>
                  <input
                    className={`${inputClass} tabular-nums`}
                    inputMode="decimal"
                    value={svTarget}
                    onChange={(e) => setSvTarget(e.target.value)}
                    placeholder="Vacío = solo seguimiento de saldo"
                  />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" className={btnSecondary} onClick={() => setEditingSavings(null)}>
                  Cancelar
                </button>
                <button type="button" className={btnPrimary} onClick={() => void saveSavingsEdit()}>
                  Guardar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {editingSavingsAdjustment ? (
          <div className={modalBackdropClass} role="presentation">
            <button
              type="button"
              aria-label="Cerrar"
              className="absolute inset-0 cursor-default bg-transparent"
              onClick={() => !savingSavingsAdjEdit && setEditingSavingsAdjustment(null)}
            />
            <div
              className={modalPanelClass}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-sav-adj-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="edit-sav-adj-title" className="text-lg font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                Editar movimiento
              </h3>
              <p className="mt-1 text-xs text-[#8A8072] banking-dark:text-[#8b949e]">
                {savingsGoals.find((x) => x.id === editingSavingsAdjustment.goal_id)?.title ?? "Meta"} ·{" "}
                {formatSavingsAdjustmentWhen(editingSavingsAdjustment.created_at)}
              </p>
              <div className="mt-4">
                <label className={labelClass} htmlFor="edit-sav-adj-amt">
                  Monto CLP (+ o −)
                </label>
                <input
                  id="edit-sav-adj-amt"
                  className={`${inputClass} tabular-nums`}
                  inputMode="decimal"
                  value={editSavingsAdjAmount}
                  onChange={(e) => setEditSavingsAdjAmount(e.target.value)}
                  disabled={savingSavingsAdjEdit}
                />
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className={btnSecondary}
                  disabled={savingSavingsAdjEdit}
                  onClick={() => setEditingSavingsAdjustment(null)}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={savingSavingsAdjEdit}
                  onClick={() => void saveSavingsAdjustmentEdit()}
                >
                  {savingSavingsAdjEdit ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {newSavingsModalOpen ? (
          <div className={modalBackdropClass} role="presentation">
            <button
              type="button"
              aria-label="Cerrar"
              className="absolute inset-0 cursor-default bg-transparent"
              onClick={() => setNewSavingsModalOpen(false)}
            />
            <div
              className={modalPanelClass}
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-sav-modal-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="new-sav-modal-title" className="text-lg font-semibold text-[#2B2620] banking-dark:text-[#F3F1EC]">
                Nuevo Objetivo
              </h3>
              <div className="mt-4 space-y-3">
                <div>
                  <label className={labelClass}>Nombre del objetivo</label>
                  <input
                    className={inputClass}
                    value={newSavTitle}
                    onChange={(e) => setNewSavTitle(e.target.value)}
                    placeholder="Ej.: Viaje fin de año"
                    maxLength={512}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Cuenta en la que ahorras</label>
                    <AccountSelect
                      value={newSavAccountId}
                      onChange={setNewSavAccountId}
                      accounts={accounts}
                      placeholder="Selecciona…"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Saldo inicial (CLP)</label>
                    <input
                      className={`${inputClass} tabular-nums`}
                      inputMode="decimal"
                      value={newSavInitial}
                      onChange={(e) => setNewSavInitial(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Monto objetivo (CLP, opcional)</label>
                  <input
                    className={`${inputClass} tabular-nums`}
                    inputMode="decimal"
                    value={newSavTarget}
                    onChange={(e) => setNewSavTarget(e.target.value)}
                    placeholder="Si lo dejas vacío, solo verás el saldo sin % de avance"
                  />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" className={btnSecondary} onClick={() => setNewSavingsModalOpen(false)}>
                  Cancelar
                </button>
                <button type="button" className={btnPrimary} onClick={() => void addSavingsGoal()}>
                  Crear meta
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
