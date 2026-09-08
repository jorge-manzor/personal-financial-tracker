import { BankingTxPaidStatusBadge } from "@zendo/design-system";

export function Pagado() {
  return (
    <div className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingTxPaidStatusBadge text="Pagado" />
    </div>
  );
}

export function NoPagado() {
  return (
    <div className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingTxPaidStatusBadge text="No pagado" />
    </div>
  );
}

export function NoAplica() {
  return (
    <div className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingTxPaidStatusBadge text="—" />
    </div>
  );
}

export function AllStates() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingTxPaidStatusBadge text="Pagado" />
      <BankingTxPaidStatusBadge text="No pagado" />
      <BankingTxPaidStatusBadge text="—" />
    </div>
  );
}
