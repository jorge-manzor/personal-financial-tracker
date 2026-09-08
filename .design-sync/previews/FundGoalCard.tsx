import { FundGoalCard } from "@zendo/design-system";
import type { FintualGoalCard } from "@zendo/design-system";

const jubilacion: FintualGoalCard = {
  id: "g-1",
  name: "Jubilación",
  nav_clp: 18_450_320,
  deposited_clp: 15_200_000,
  profit_clp: 3_250_320,
  profit_pct: 21.4,
  badge_label: "Riesgo moderado",
};

const emergencia: FintualGoalCard = {
  id: "g-2",
  name: "Fondo de emergencia",
  nav_clp: 0,
  deposited_clp: 0,
  profit_clp: 0,
  profit_pct: 0,
  badge_label: "Sin saldo",
};

const perdida: FintualGoalCard = {
  id: "g-3",
  name: "Vacaciones 2027",
  nav_clp: 1_120_400,
  deposited_clp: 1_260_000,
  profit_clp: -139_600,
  profit_pct: -11.08,
  badge_label: "Riesgo bajo",
};

export function Default() {
  return (
    <div style={{ maxWidth: 280 }}>
      <FundGoalCard goal={jubilacion} onSelect={() => {}} isDark={false} />
    </div>
  );
}

export function Inactive() {
  return (
    <div style={{ maxWidth: 280 }}>
      <FundGoalCard goal={emergencia} onSelect={() => {}} inactive isDark={false} />
    </div>
  );
}

export function NegativeReturn() {
  return (
    <div style={{ maxWidth: 280 }}>
      <FundGoalCard goal={perdida} onSelect={() => {}} isDark={false} />
    </div>
  );
}

export function Dark() {
  return (
    <div style={{ maxWidth: 280, background: "#0d1117", padding: 16, borderRadius: 12 }}>
      <FundGoalCard goal={jubilacion} onSelect={() => {}} isDark />
    </div>
  );
}
