import { useState } from "react";
import { BankingBalancePrivacyEye } from "@zendo/design-system";

function Interactive({ initialVisible }: { initialVisible: boolean }) {
  const [visible, setVisible] = useState(initialVisible);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#E8E1D4] bg-white p-4">
      <span className="text-sm font-medium text-[#2B2620]">Saldo total: $2.145.700</span>
      <BankingBalancePrivacyEye amountsVisible={visible} onToggle={() => setVisible((v) => !v)} />
    </div>
  );
}

export function Visible() {
  return <Interactive initialVisible />;
}

export function Hidden() {
  return <Interactive initialVisible={false} />;
}

export function LargerIcon() {
  const [visible, setVisible] = useState(true);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#E8E1D4] bg-white p-4">
      <span className="text-sm font-medium text-[#2B2620]">Saldo total: $2.145.700</span>
      <BankingBalancePrivacyEye
        amountsVisible={visible}
        onToggle={() => setVisible((v) => !v)}
        iconClassName="h-6 w-6 shrink-0"
      />
    </div>
  );
}
