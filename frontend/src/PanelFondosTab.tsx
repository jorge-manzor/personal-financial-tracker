import { ActiveInvestmentsSection } from "./ActiveInvestmentsSection";
import { InactiveInvestmentsSection } from "./InactiveInvestmentsSection";
import type { FintualGoalCard } from "./types";

interface Props {
  goalsActive: FintualGoalCard[];
  goalsInactive: FintualGoalCard[];
  onSelectGoal: (g: FintualGoalCard) => void;
  isDark: boolean;
}

export function PanelFondosTab({ goalsActive, goalsInactive, onSelectGoal, isDark }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <ActiveInvestmentsSection goals={goalsActive} onSelectGoal={onSelectGoal} isDark={isDark} />
      <InactiveInvestmentsSection goals={goalsInactive} onSelectGoal={onSelectGoal} isDark={isDark} />
    </div>
  );
}
