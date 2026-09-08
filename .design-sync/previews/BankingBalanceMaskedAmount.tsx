import { BankingBalanceMaskedAmount } from "@zendo/design-system";

export function Visible() {
  return (
    <div className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingBalanceMaskedAmount
        text="$1.845.320"
        visible
        className="block text-2xl font-bold tabular-nums tracking-tight text-[#2B2620]"
      />
    </div>
  );
}

export function Masked() {
  return (
    <div className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingBalanceMaskedAmount
        text="$1.845.320"
        visible={false}
        className="block text-2xl font-bold tabular-nums tracking-tight text-[#2B2620]"
        title="Montos ocultos por privacidad"
      />
    </div>
  );
}

export function SmallInline() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-[#E8E1D4] bg-white p-4 text-sm text-[#8A8072]">
      <span>Deuda TC:</span>
      <BankingBalanceMaskedAmount text="$540.900" visible={false} className="font-bold tabular-nums text-[#A65568]" />
    </div>
  );
}
