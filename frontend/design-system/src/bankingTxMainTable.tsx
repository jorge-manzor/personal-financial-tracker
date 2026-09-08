/** Extraído de `frontend/src/bankingTxMainTable.tsx` — solo la píldora de estado de pago. */

export function BankingTxPaidStatusBadge({ text }: { text: string }) {
  if (text === "Pagado") {
    return (
      <span className="inline-flex justify-center whitespace-nowrap rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-600 banking-dark:bg-emerald-500/15 banking-dark:text-emerald-300">
        Pagado
      </span>
    );
  }
  if (text === "No pagado") {
    return (
      <span className="inline-flex justify-center whitespace-nowrap rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600 banking-dark:bg-rose-500/15 banking-dark:text-rose-300">
        No pagado
      </span>
    );
  }
  return (
    <span className="inline-flex justify-center whitespace-nowrap rounded-full bg-[#F5F1E8] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#9A9284] banking-dark:bg-[#161b22] banking-dark:text-[#6b7280]">
      —
    </span>
  );
}
