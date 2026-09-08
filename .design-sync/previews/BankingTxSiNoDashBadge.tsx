import { BankingTxSiNoDashBadge } from "@zendo/design-system";

export function Si() {
  return (
    <div className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingTxSiNoDashBadge text="Sí" />
    </div>
  );
}

export function No() {
  return (
    <div className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingTxSiNoDashBadge text="No" />
    </div>
  );
}

export function Dash() {
  return (
    <div className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingTxSiNoDashBadge text="—" />
    </div>
  );
}

export function AllStates() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-[#E8E1D4] bg-white p-4">
      <div className="flex flex-col items-center gap-1 text-xs text-[#8A8072]">
        <BankingTxSiNoDashBadge text="Sí" />
        Compartido liquidado
      </div>
      <div className="flex flex-col items-center gap-1 text-xs text-[#8A8072]">
        <BankingTxSiNoDashBadge text="No" />
        Cargo TC
      </div>
      <div className="flex flex-col items-center gap-1 text-xs text-[#8A8072]">
        <BankingTxSiNoDashBadge text="—" />
        No aplica
      </div>
    </div>
  );
}
