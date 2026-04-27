import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch, fetchJson, patchJson, postJson } from "./api";
import { BankingThemeToggle, useBankingTheme } from "./BankingThemeContext";
import { formatClpDots } from "./format";

/** Misma línea visual que fecha en el modal «Nuevo movimiento»; para `type="month"`. */
const BANKING_MONTH_INPUT_CLASS =
  "mt-1.5 w-full cursor-pointer rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 [color-scheme:light] banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:focus:border-amber-700/55 banking-dark:focus:ring-amber-500/15";

function openBankingMonthPicker(e: MouseEvent<HTMLInputElement>) {
  e.currentTarget.showPicker?.();
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function addMonthsYm(ym: string, delta: number): string {
  const [yy, mm] = ym.split("-").map(Number);
  const total = yy * 12 + mm - 1 + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Backend usa `date`; guardamos día 1 del mes elegido. */
function ymToApiFirstDay(ym: string): string {
  const [y, m] = ym.split("-");
  if (!y || !m) return `${ym}-01`;
  return `${y}-${m.padStart(2, "0")}-01`;
}

function apiDateToYm(isoDate: string): string {
  return isoDate.length >= 7 ? isoDate.slice(0, 7) : isoDate;
}

const MONTH_SHORT_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Muestra «ene 2026» a partir de ISO `YYYY-MM-DD` o `YYYY-MM`. */
function formatMonthLabelEs(isoDateOrYm: string): string {
  const ym = isoDateOrYm.length >= 7 ? isoDateOrYm.slice(0, 7) : isoDateOrYm;
  const parts = ym.split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!y || !m || m < 1 || m > 12) return isoDateOrYm;
  return `${MONTH_SHORT_ES[m - 1]} ${y}`;
}

type SavingsMode = "end_date" | "target_amount";

type SavingsCalculatorChartPoint = {
  period_index: number;
  period_label: string;
  cumulative_clp: number;
};

type SavingsCalculatorPlanOut = {
  id: number;
  name: string;
  mode: SavingsMode;
  start_date: string;
  end_date: string | null;
  monthly_amount_clp: number;
  initial_balance_clp: number;
  target_amount_clp: number | null;
  months_count: number | null;
  total_projected_clp: number | null;
  months_needed: number | null;
  total_at_goal_clp: number | null;
  chart: SavingsCalculatorChartPoint[];
};

/** Paneles y tipografía según `isDark` explícito (evita bandas del fondo #0d1117 de la app y desajustes de variant). */
function panelCard(isDark: boolean): string {
  return isDark
    ? "rounded-2xl border border-zinc-700 bg-zinc-900/95 p-5 shadow-none ring-1 ring-white/5"
    : "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-900/[0.04]";
}

function fieldLabel(isDark: boolean): string {
  return `block text-[10px] font-semibold uppercase tracking-wide ${
    isDark ? "text-zinc-400" : "text-slate-500"
  }`;
}

function fieldInput(isDark: boolean): string {
  return [
    "mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none ring-teal-400/0 transition focus:ring-2",
    isDark
      ? "border-zinc-600 bg-zinc-950 text-zinc-100 focus:border-amber-500 focus:ring-amber-500/35"
      : "border-slate-300 bg-white text-slate-900 focus:border-teal-400 focus:ring-teal-400/35 [color-scheme:light]",
  ].join(" ");
}

function primaryBtn(isDark: boolean): string {
  return [
    "rounded-lg px-4 py-2 text-sm font-semibold shadow-sm disabled:opacity-50",
    isDark
      ? "bg-amber-500 text-zinc-950 shadow-md hover:bg-amber-400 disabled:opacity-45"
      : "bg-teal-600 text-white hover:bg-teal-700",
  ].join(" ");
}

function secondaryBtn(isDark: boolean): string {
  return [
    "rounded-lg border px-4 py-2 text-sm font-medium shadow-sm transition-colors duration-150",
    isDark
      ? "border-zinc-500 bg-zinc-900 text-zinc-100 hover:border-teal-400/55 hover:bg-teal-950/35"
      : "border-slate-300 bg-white text-slate-800 hover:border-teal-400 hover:bg-teal-50",
  ].join(" ");
}

function dangerBtn(isDark: boolean): string {
  return [
    "rounded-lg border px-3 py-1.5 text-sm font-medium shadow-sm transition-colors duration-150",
    isDark
      ? "border-rose-500/50 bg-rose-950/35 text-rose-400 hover:border-rose-400/80 hover:bg-rose-950/55"
      : "border-rose-300 bg-rose-50 text-rose-800 hover:border-rose-400 hover:bg-rose-100",
  ].join(" ");
}

function formTabBtn(active: boolean, isDark: boolean): string {
  const base = "rounded-lg px-3 py-1.5 text-sm font-medium transition ";
  if (active) {
    return base + (isDark ? "bg-amber-500 text-zinc-950" : "bg-teal-600 text-white");
  }
  return (
    base +
    (isDark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-slate-100 text-slate-700 hover:bg-slate-200")
  );
}

function modeBadge(mode: SavingsMode, isDark: boolean): string {
  const base = "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ";
  if (mode === "end_date") {
    return base + (isDark ? "bg-amber-950/60 text-amber-200" : "bg-teal-100 text-teal-900");
  }
  return base + (isDark ? "bg-zinc-800 text-violet-300" : "bg-violet-100 text-violet-900");
}

function PlanChart({ plan, isDark }: { plan: SavingsCalculatorPlanOut; isDark: boolean }) {
  const data = useMemo(
    () =>
      plan.chart.map((p) => ({
        mes: p.period_label,
        clp: p.cumulative_clp,
      })),
    [plan.chart],
  );

  const axisColor = isDark ? "#a1a1aa" : "#64748b";
  const gridColor = isDark ? "#3f3f46" : "#e2e8f0";
  const stroke = isDark ? "#fbbf24" : "#0d9488";

  if (data.length === 0) {
    return (
      <p className={isDark ? "text-xs text-zinc-500" : "text-xs text-slate-500"}>Sin puntos para graficar.</p>
    );
  }

  return (
    <div
      className={
        isDark
          ? "mt-4 rounded-xl border border-zinc-700/80 bg-zinc-950/50 p-3"
          : "mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3"
      }
    >
      <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} opacity={0.85} />
          <XAxis dataKey="mes" tick={{ fill: axisColor, fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis
            tick={{ fill: axisColor, fontSize: 10 }}
            tickFormatter={(v: number) => formatClpDots(Number(v)).replace("$", "")}
            width={72}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: isDark ? "#18181b" : "#fff",
              border: isDark ? "1px solid #52525b" : "1px solid #e2e8f0",
              borderRadius: "8px",
              fontSize: "12px",
              color: isDark ? "#f4f4f5" : "#0f172a",
            }}
            formatter={(value) => {
              if (value === undefined || value === null) return ["", ""];
              const num = typeof value === "number" ? value : Number(value);
              if (!Number.isFinite(num)) return ["", ""];
              return [formatClpDots(num), "Acumulado"];
            }}
            labelFormatter={(label) => String(label)}
          />
          <Line type="monotone" dataKey="clp" stroke={stroke} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}

export function SavingsCalculatorPage({ onToast }: { onToast: (msg: string | null) => void }) {
  const { isDark } = useBankingTheme();
  const [plans, setPlans] = useState<SavingsCalculatorPlanOut[]>([]);
  const [loading, setLoading] = useState(true);

  const [formTab, setFormTab] = useState<SavingsMode>("end_date");
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState(() => currentYearMonth());
  const [newEnd, setNewEnd] = useState(() => addMonthsYm(currentYearMonth(), 12));
  const [newInitial, setNewInitial] = useState("");
  const [newMonthly, setNewMonthly] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editMonthly, setEditMonthly] = useState("");
  const [editInitial, setEditInitial] = useState("");
  const [editTarget, setEditTarget] = useState("");

  const loadPlans = useCallback(async () => {
    const rows = await fetchJson<SavingsCalculatorPlanOut[]>("/banking/savings-calculator/plans");
    setPlans(rows);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadPlans()
      .catch((e) => {
        console.error(e);
        if (!cancelled) onToast("No se pudo cargar la calculadora de ahorros.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPlans, onToast]);

  const pageShell = `banking-theme w-full min-h-[calc(100dvh-3.5rem)] ${
    isDark
      ? "bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(251,191,36,0.055),transparent_52%),linear-gradient(to_bottom,#0d0d0d,#070707)] text-zinc-300"
      : "bg-slate-100 bg-gradient-to-br from-slate-100 via-white to-slate-100 text-slate-800"
  }`;

  const innerClass = "mx-auto max-w-[920px] space-y-10 p-4 pb-28 md:p-6";

  const parseMoney = (raw: string): number => {
    const n = Number(raw.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : Number.NaN;
  };

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) {
      onToast("Escribe un nombre para la meta.");
      return;
    }
    const monthly = parseMoney(newMonthly);
    if (!Number.isFinite(monthly) || monthly <= 0) {
      onToast("Indica un monto mensual válido mayor que cero.");
      return;
    }
    const initialBal = parseMoney(newInitial.trim() === "" ? "0" : newInitial);
    if (!Number.isFinite(initialBal) || initialBal < 0) {
      onToast("El saldo inicial debe ser un monto válido (cero o mayor).");
      return;
    }
    setSaving(true);
    try {
      if (formTab === "end_date") {
        if (newEnd < newStart) {
          onToast("El mes final debe ser igual o posterior al mes inicial.");
          setSaving(false);
          return;
        }
        const body = {
          name,
          mode: "end_date" as const,
          start_date: ymToApiFirstDay(newStart),
          end_date: ymToApiFirstDay(newEnd),
          monthly_amount_clp: monthly,
          initial_balance_clp: initialBal,
        };
        await postJson<SavingsCalculatorPlanOut>("/banking/savings-calculator/plans", body);
      } else {
        const target = parseMoney(newTarget);
        if (!Number.isFinite(target) || target <= 0) {
          onToast("Indica el monto objetivo que quieres acumular.");
          setSaving(false);
          return;
        }
        await postJson<SavingsCalculatorPlanOut>("/banking/savings-calculator/plans", {
          name,
          mode: "target_amount",
          start_date: ymToApiFirstDay(newStart),
          end_date: null,
          monthly_amount_clp: monthly,
          initial_balance_clp: initialBal,
          target_amount_clp: target,
        });
      }
      onToast("Meta guardada.");
      setNewName("");
      setNewInitial("");
      setNewMonthly("");
      setNewTarget("");
      await loadPlans();
    } catch (e) {
      console.error(e);
      onToast(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  const deletePlan = async (id: number) => {
    if (!confirm("¿Eliminar esta simulación?")) return;
    try {
      const r = await apiFetch(`/banking/savings-calculator/plans/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      onToast("Eliminada.");
      await loadPlans();
      if (editId === id) setEditId(null);
    } catch {
      onToast("No se pudo eliminar.");
    }
  };

  const startEdit = (p: SavingsCalculatorPlanOut) => {
    setEditId(p.id);
    setEditName(p.name);
    setEditStart(apiDateToYm(p.start_date));
    setEditEnd(p.end_date ? apiDateToYm(p.end_date) : currentYearMonth());
    setEditMonthly(String(Math.round(p.monthly_amount_clp)));
    setEditInitial(String(Math.round(p.initial_balance_clp ?? 0)));
    setEditTarget(p.target_amount_clp != null ? String(Math.round(p.target_amount_clp)) : "");
  };

  const cancelEdit = () => setEditId(null);

  const saveEdit = async () => {
    if (editId == null) return;
    const name = editName.trim();
    if (!name) {
      onToast("El nombre no puede estar vacío.");
      return;
    }
    const monthly = parseMoney(editMonthly);
    if (!Number.isFinite(monthly) || monthly <= 0) {
      onToast("Monto mensual inválido.");
      return;
    }
    const initialBal = parseMoney(editInitial.trim() === "" ? "0" : editInitial);
    if (!Number.isFinite(initialBal) || initialBal < 0) {
      onToast("El saldo inicial debe ser cero o mayor.");
      return;
    }
    const plan = plans.find((x) => x.id === editId);
    if (!plan) return;

    setSaving(true);
    try {
      if (plan.mode === "end_date" && editEnd < editStart) {
        onToast("El mes final debe ser igual o posterior al mes inicial.");
        setSaving(false);
        return;
      }
      const patch: Record<string, unknown> = {
        name,
        start_date: ymToApiFirstDay(editStart),
        monthly_amount_clp: monthly,
        initial_balance_clp: initialBal,
      };
      if (plan.mode === "end_date") {
        patch.end_date = ymToApiFirstDay(editEnd);
        patch.mode = "end_date";
      } else {
        const target = parseMoney(editTarget);
        if (!Number.isFinite(target) || target <= 0) {
          onToast("Indica el monto objetivo.");
          setSaving(false);
          return;
        }
        patch.mode = "target_amount";
        patch.target_amount_clp = target;
        patch.end_date = null;
      }
      await patchJson<SavingsCalculatorPlanOut>(`/banking/savings-calculator/plans/${editId}`, patch);
      onToast("Cambios guardados.");
      setEditId(null);
      await loadPlans();
    } catch (e) {
      console.error(e);
      onToast(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={pageShell}>
        <div className={innerClass}>
          <p className={isDark ? "text-sm text-zinc-400" : "text-sm text-slate-600"}>Cargando…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={pageShell}>
      <div className={innerClass}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1
              className={`text-2xl font-bold tracking-tight ${isDark ? "text-zinc-50" : "text-slate-900"}`}
            >
              Calculadora de ahorros
            </h1>
            <p
              className={`mt-1 max-w-2xl text-sm leading-relaxed ${
                isDark ? "text-zinc-400" : "text-slate-600"
              }`}
            >
              Simula cuánto acumulas aportando un monto fijo cada mes, o cuántos meses necesitas para llegar a una meta.
              Tus planes se guardan en el servidor asociados a tu usuario.
            </p>
          </div>
          <BankingThemeToggle />
        </header>

        <section className={panelCard(isDark)} aria-labelledby="new-plan-heading">
          <h2
            id="new-plan-heading"
            className={`text-lg font-semibold ${isDark ? "text-zinc-100" : "text-slate-900"}`}
          >
            Nuevo plan
          </h2>
          <p className={`mt-1 text-xs ${isDark ? "text-zinc-500" : "text-slate-500"}`}>
            En «Por meses», mes inicial y mes final (ambos incluidos). En «Meta en pesos», mes de inicio y meta. Opcional:
            saldo inicial (dinero que ya tienes antes del primer aporte). Sin intereses.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setFormTab("end_date")}
              className={formTabBtn(formTab === "end_date", isDark)}
            >
              Por meses
            </button>
            <button
              type="button"
              onClick={() => setFormTab("target_amount")}
              className={formTabBtn(formTab === "target_amount", isDark)}
            >
              Meta en pesos
            </button>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className={fieldLabel(isDark)}>Nombre del plan</span>
              <input
                className={fieldInput(isDark)}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej. Fondo de emergencia"
              />
            </label>
            <label>
              <span className={fieldLabel(isDark)}>Mes inicial</span>
              <input
                className={BANKING_MONTH_INPUT_CLASS}
                type="month"
                value={newStart}
                onChange={(e) => setNewStart(e.target.value)}
                onClick={openBankingMonthPicker}
              />
            </label>
            {formTab === "end_date" ? (
              <label>
                <span className={fieldLabel(isDark)}>Mes final</span>
                <input
                  className={BANKING_MONTH_INPUT_CLASS}
                  type="month"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  onClick={openBankingMonthPicker}
                />
              </label>
            ) : (
              <label>
                <span className={fieldLabel(isDark)}>Meta acumulada (CLP)</span>
                <input
                  className={fieldInput(isDark)}
                  inputMode="numeric"
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  placeholder="Ej. 5000000"
                />
              </label>
            )}
            <label className="sm:col-span-2">
              <span className={fieldLabel(isDark)}>Saldo inicial (CLP)</span>
              <input
                className={fieldInput(isDark)}
                inputMode="numeric"
                value={newInitial}
                onChange={(e) => setNewInitial(e.target.value)}
                placeholder="Opcional · ej. lo que ya tienes guardado"
              />
            </label>
            <label className="sm:col-span-2">
              <span className={fieldLabel(isDark)}>Ahorro mensual (CLP)</span>
              <input
                className={fieldInput(isDark)}
                inputMode="numeric"
                value={newMonthly}
                onChange={(e) => setNewMonthly(e.target.value)}
                placeholder="Ej. 150000"
              />
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className={primaryBtn(isDark)} disabled={saving} onClick={() => void submitCreate()}>
              {saving ? "Guardando…" : "Guardar plan"}
            </button>
          </div>
        </section>

        <section aria-labelledby="plans-heading">
          <h2
            id="plans-heading"
            className={`mb-4 text-lg font-semibold ${isDark ? "text-zinc-100" : "text-slate-900"}`}
          >
            Tus planes guardados
          </h2>

          {plans.length === 0 ? (
            <p className={isDark ? "text-sm text-zinc-500" : "text-sm text-slate-500"}>
              Aún no hay planes. Crea uno arriba para ver la proyección y el gráfico.
            </p>
          ) : (
            <ul className="space-y-6">
              {plans.map((p) => (
                <li key={p.id} className={panelCard(isDark)}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={`text-base font-semibold ${isDark ? "text-zinc-100" : "text-slate-900"}`}>
                          {p.name}
                        </h3>
                        <span className={modeBadge(p.mode, isDark)}>
                          {p.mode === "end_date" ? "Por meses" : "Meta en $"}
                        </span>
                      </div>
                      <p className={`mt-2 text-sm ${isDark ? "text-zinc-400" : "text-slate-600"}`}>
                        Desde{" "}
                        <strong className={isDark ? "text-zinc-200" : "text-slate-800"}>
                          {formatMonthLabelEs(p.start_date)}
                        </strong>
                        {p.mode === "end_date" && p.end_date ? (
                          <>
                            {" "}
                            hasta{" "}
                            <strong className={isDark ? "text-zinc-200" : "text-slate-800"}>
                              {formatMonthLabelEs(p.end_date)}
                            </strong>
                          </>
                        ) : null}
                        {" · "}
                        <strong className={isDark ? "text-zinc-200" : "text-slate-800"}>
                          {formatClpDots(p.monthly_amount_clp)}
                        </strong>
                        /mes
                      </p>
                      {(p.initial_balance_clp ?? 0) > 0 ? (
                        <p className={`mt-1 text-xs ${isDark ? "text-zinc-500" : "text-slate-500"}`}>
                          Saldo inicial al arrancar el plan:{" "}
                          <strong className={isDark ? "text-zinc-300" : "text-slate-700"}>
                            {formatClpDots(p.initial_balance_clp)}
                          </strong>
                        </p>
                      ) : null}
                      {p.mode === "end_date" ? (
                        <p className={`mt-2 text-sm font-medium ${isDark ? "text-amber-200" : "text-teal-800"}`}>
                          En {p.months_count ?? "—"} meses acumulas{" "}
                          <strong>{formatClpDots(p.total_projected_clp ?? 0)}</strong>
                        </p>
                      ) : p.months_needed === 0 ? (
                        <p className={`mt-2 text-sm font-medium ${isDark ? "text-amber-200" : "text-teal-800"}`}>
                          Con saldo inicial de{" "}
                          <strong>{formatClpDots(p.initial_balance_clp ?? 0)}</strong> ya cumples la meta de{" "}
                          <strong>{formatClpDots(p.target_amount_clp ?? 0)}</strong> (sin meses de aporte adicional).
                        </p>
                      ) : (
                        <p className={`mt-2 text-sm font-medium ${isDark ? "text-amber-200" : "text-teal-800"}`}>
                          Para juntar <strong>{formatClpDots(p.target_amount_clp ?? 0)}</strong> necesitas{" "}
                          <strong>{p.months_needed ?? "—"}</strong> mes(es) de aporte · total al cerrar{" "}
                          <strong>{formatClpDots(p.total_at_goal_clp ?? 0)}</strong>
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" className={secondaryBtn(isDark)} onClick={() => startEdit(p)}>
                        Editar
                      </button>
                      <button type="button" className={dangerBtn(isDark)} onClick={() => void deletePlan(p.id)}>
                        Eliminar
                      </button>
                    </div>
                  </div>

                  <PlanChart plan={p} isDark={isDark} />

                  {editId === p.id ? (
                    <div
                      className={`mt-6 border-t pt-4 ${isDark ? "border-zinc-700" : "border-slate-200"}`}
                    >
                      <p className={`mb-3 text-sm font-medium ${isDark ? "text-zinc-200" : "text-slate-800"}`}>
                        Editar plan
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="sm:col-span-2">
                          <span className={fieldLabel(isDark)}>Nombre</span>
                          <input
                            className={fieldInput(isDark)}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                        </label>
                        <label>
                          <span className={fieldLabel(isDark)}>Mes inicial</span>
                          <input
                            className={BANKING_MONTH_INPUT_CLASS}
                            type="month"
                            value={editStart}
                            onChange={(e) => setEditStart(e.target.value)}
                            onClick={openBankingMonthPicker}
                          />
                        </label>
                        {p.mode === "end_date" ? (
                          <label>
                            <span className={fieldLabel(isDark)}>Mes final</span>
                            <input
                              className={BANKING_MONTH_INPUT_CLASS}
                              type="month"
                              value={editEnd}
                              onChange={(e) => setEditEnd(e.target.value)}
                              onClick={openBankingMonthPicker}
                            />
                          </label>
                        ) : (
                          <label>
                            <span className={fieldLabel(isDark)}>Meta (CLP)</span>
                            <input
                              className={fieldInput(isDark)}
                              inputMode="numeric"
                              value={editTarget}
                              onChange={(e) => setEditTarget(e.target.value)}
                            />
                          </label>
                        )}
                        <label className="sm:col-span-2">
                          <span className={fieldLabel(isDark)}>Saldo inicial (CLP)</span>
                          <input
                            className={fieldInput(isDark)}
                            inputMode="numeric"
                            value={editInitial}
                            onChange={(e) => setEditInitial(e.target.value)}
                            placeholder="0"
                          />
                        </label>
                        <label className="sm:col-span-2">
                          <span className={fieldLabel(isDark)}>Mensual (CLP)</span>
                          <input
                            className={fieldInput(isDark)}
                            inputMode="numeric"
                            value={editMonthly}
                            onChange={(e) => setEditMonthly(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          className={primaryBtn(isDark)}
                          disabled={saving}
                          onClick={() => void saveEdit()}
                        >
                          Guardar cambios
                        </button>
                        <button type="button" className={secondaryBtn(isDark)} onClick={cancelEdit}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
