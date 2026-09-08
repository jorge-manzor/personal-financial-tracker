import { useState } from "react";
import { BankingAuxRoundCheckbox } from "@zendo/design-system";

function Group() {
  const [teal, setTeal] = useState(true);
  const [indigo, setIndigo] = useState(true);
  const [sage, setSage] = useState(true);
  return (
    <div className="flex items-center gap-6 rounded-xl border border-[#E8E1D4] bg-white p-4">
      <div className="flex flex-col items-center gap-1.5 text-xs text-[#8A8072]">
        <BankingAuxRoundCheckbox checked={teal} onChange={() => setTeal((v) => !v)} color="teal" aria-label="Cargo TC" title="Cargo TC" />
        teal
      </div>
      <div className="flex flex-col items-center gap-1.5 text-xs text-[#8A8072]">
        <BankingAuxRoundCheckbox checked={indigo} onChange={() => setIndigo((v) => !v)} color="indigo" aria-label="Seleccionar todos" title="Seleccionar todos" />
        indigo
      </div>
      <div className="flex flex-col items-center gap-1.5 text-xs text-[#8A8072]">
        <BankingAuxRoundCheckbox checked={sage} onChange={() => setSage((v) => !v)} color="sage" aria-label="Compartido liquidado" title="Compartido liquidado" />
        sage
      </div>
    </div>
  );
}

export function ColorSweep() {
  return <Group />;
}

export function Unchecked() {
  const [checked, setChecked] = useState(false);
  return (
    <div className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingAuxRoundCheckbox checked={checked} onChange={() => setChecked((v) => !v)} color="sage" aria-label="Provisión" />
    </div>
  );
}

export function Indeterminate() {
  return (
    <div className="rounded-xl border border-[#E8E1D4] bg-white p-4">
      <BankingAuxRoundCheckbox checked={false} indeterminate onChange={() => {}} color="indigo" aria-label="Seleccionar todos (parcial)" />
    </div>
  );
}
