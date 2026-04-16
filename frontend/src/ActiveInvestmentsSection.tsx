import type { FintualGoalCard } from "./types";
import { FundGoalCard } from "./FundGoalCard";

const CREATE_GOAL_URL =
  "https://fintual.cl/f/mutual-funds/investible-objects-creation/discovery/investment-type-selection/";

interface Props {
  goals: FintualGoalCard[];
  onSelectGoal: (g: FintualGoalCard) => void;
}

export function ActiveInvestmentsSection({ goals, onSelectGoal }: Props) {
  const n = goals.length;

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <h2 className="text-base font-bold uppercase tracking-[0.12em] text-white [&>span]:normal-case">
        Inversiones activas <span className="tabular-nums">({n})</span>
      </h2>

      <div className="grid w-full min-w-0 gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr))]">
        {goals.map((g) => (
          <FundGoalCard key={g.id} goal={g} onSelect={onSelectGoal} />
        ))}

        <a
          href={CREATE_GOAL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-[220px] w-full min-w-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#30363d] bg-transparent px-4 py-10 text-center transition hover:border-[#6e7681] hover:bg-[#161b22]/50"
        >
          <span className="text-3xl font-light leading-none text-[#6e7681]" aria-hidden>
            +
          </span>
          <span className="mt-3 text-sm font-medium text-[#8b949e]">Crear nueva meta</span>
        </a>
      </div>
    </div>
  );
}
