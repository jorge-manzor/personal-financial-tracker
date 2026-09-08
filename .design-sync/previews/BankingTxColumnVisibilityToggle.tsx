import { useState } from "react";
import { BankingTxColumnVisibilityToggle } from "@zendo/design-system";

function Row({ label, initialOn, disabled }: { label: string; initialOn: boolean; disabled?: boolean }) {
  const [on, setOn] = useState(initialOn);
  return (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-sm text-[#2B2620]">{label}</span>
      <BankingTxColumnVisibilityToggle
        on={on}
        disabled={disabled}
        onToggle={() => setOn((v) => !v)}
        ariaLabel={`Mostrar columna ${label}`}
      />
    </div>
  );
}

export function Default() {
  return (
    <div style={{ maxWidth: 280 }} className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <Row label="Categoría" initialOn />
      <Row label="Compartido liquidado" initialOn={false} />
      <Row label="Cargo TC" initialOn />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ maxWidth: 280 }} className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <Row label="Fecha" initialOn disabled />
    </div>
  );
}
