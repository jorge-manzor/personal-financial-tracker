/** Extraído de `frontend/src/bankingPersonalOrderShared.tsx`. */

import type { BankingAccountRow } from "./types";

export const inputClass =
  "mt-1 w-full rounded-lg border border-[#DCD3C2] bg-white px-3 py-2 text-sm text-[#2B2620] outline-none ring-[#8FBFA6]/0 transition focus:border-[#8FBFA6] focus:ring-2 focus:ring-[#8FBFA6]/35 banking-dark:border-[#30363d] banking-dark:bg-[#0d1117] banking-dark:text-[#F3F1EC] banking-dark:focus:border-[#8FBFA6] banking-dark:focus:ring-[#8FBFA6]/35";

/** Selector de cuenta modernizado: mismo `inputClass` que el resto del formulario + flecha propia. */
export function AccountSelect({
  value,
  onChange,
  accounts,
  placeholder,
}: {
  value: number | "";
  onChange: (v: number | "") => void;
  accounts: BankingAccountRow[];
  placeholder: string;
}) {
  return (
    <div className="relative mt-1">
      <select
        className={`${inputClass} mt-0 appearance-none pr-9`}
        value={value === "" ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      >
        <option value="">{placeholder}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9A9284] banking-dark:text-[#6b7280]"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.24 4.496a.75.75 0 01-1.08 0l-4.24-4.497a.75.75 0 01.02-1.06z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}
