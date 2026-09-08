import { useEffect, useRef, useState } from "react";
import { BankingDatePicker } from "@zendo/design-system";

/**
 * `BankingDatePicker` keeps its open/closed state internal (no `open` prop) — this wrapper clicks
 * the real trigger button right after mount so the static screenshot captures the open calendar
 * popover instead of just the closed trigger.
 */
function OpenedDatePicker({ value, ariaLabel, disabled }: { value: string; ariaLabel: string; disabled?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const btn = wrapRef.current?.querySelector("button");
    if (btn instanceof HTMLElement) btn.click();
  }, []);
  return (
    <div ref={wrapRef} style={{ maxWidth: 320 }}>
      <BankingDatePicker value={current} onChange={setCurrent} ariaLabel={ariaLabel} disabled={disabled} />
    </div>
  );
}

export function Open() {
  return <OpenedDatePicker value="2026-09-07" ariaLabel="Fecha del movimiento" />;
}

export function ClosedTrigger() {
  const [value, setValue] = useState("2026-08-15");
  return (
    <div style={{ maxWidth: 320 }}>
      <BankingDatePicker value={value} onChange={setValue} ariaLabel="Fecha del movimiento" />
    </div>
  );
}

export function EmptyValue() {
  const [value, setValue] = useState("");
  return (
    <div style={{ maxWidth: 320 }}>
      <BankingDatePicker value={value} onChange={setValue} ariaLabel="Fecha del movimiento" />
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ maxWidth: 320 }}>
      <BankingDatePicker value="2026-09-07" onChange={() => {}} ariaLabel="Fecha del movimiento" disabled />
    </div>
  );
}
