import type { FintualGoalCard } from "./types";
import { FundGoalCard } from "./FundGoalCard";

const CREATE_GOAL_URL =
  "https://fintual.cl/f/mutual-funds/investible-objects-creation/discovery/investment-type-selection/";

interface Props {
  goals: FintualGoalCard[];
  onSelectGoal: (g: FintualGoalCard) => void;
  isDark: boolean;
}

export function ActiveInvestmentsSection({ goals, onSelectGoal, isDark }: Props) {
  const n = goals.length;
  const textPrimary = isDark ? "text-white" : "text-[#2B2620]";
  const dashBorder = isDark ? "border-[#30363d]" : "border-[#DCD3C2]";
  const dashHover = isDark ? "hover:border-[#6e7681] hover:bg-[#161b22]/50" : "hover:border-[#C79A56] hover:bg-[#F5F1E8]/50";
  const plusColor = isDark ? "text-[#6e7681]" : "text-[#9A9284]";
  const labelColor = isDark ? "text-[#8b949e]" : "text-[#8A8072]";

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <h2 className={`text-base font-bold uppercase tracking-[0.12em] ${textPrimary} [&>span]:normal-case`}>
        Inversiones activas <span className="tabular-nums">({n})</span>
      </h2>

      <div className="grid w-full min-w-0 gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
        {goals.map((g) => (
          <FundGoalCard key={g.id} goal={g} onSelect={onSelectGoal} isDark={isDark} />
        ))}

        <a
          href={CREATE_GOAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex min-h-[220px] w-full min-w-0 flex-col items-center justify-center rounded-xl border-2 border-dashed ${dashBorder} bg-transparent px-4 py-10 text-center transition ${dashHover}`}
        >
          <span className={`text-3xl font-light leading-none ${plusColor}`} aria-hidden>
            +
          </span>
          <span className={`mt-3 text-sm font-medium ${labelColor}`}>Crear nueva meta</span>
        </a>
      </div>
    </div>
  );
}
