import { useState } from "react";
import { AccountSelect } from "@zendo/design-system";
import type { BankingAccountRow } from "@zendo/design-system";

const ACCOUNTS: BankingAccountRow[] = [
  { id: 1, name: "Cuenta Corriente BCI", balance: 1_845_320, product_type: "cuenta_corriente" },
  { id: 2, name: "Cuenta RUT", balance: 320_500, product_type: "cuenta_vista" },
  { id: 3, name: "Tarjeta Falabella Visa", balance: -540_900, product_type: "tarjeta_credito" },
  { id: 4, name: "Cuenta ahorro Banco Estado", balance: 4_120_000, product_type: "cuenta_prepago" },
];

export function Default() {
  const [value, setValue] = useState<number | "">(1);
  return (
    <div style={{ maxWidth: 320 }}>
      <AccountSelect value={value} onChange={setValue} accounts={ACCOUNTS} placeholder="Selecciona una cuenta" />
    </div>
  );
}

export function Placeholder() {
  const [value, setValue] = useState<number | "">("");
  return (
    <div style={{ maxWidth: 320 }}>
      <AccountSelect value={value} onChange={setValue} accounts={ACCOUNTS} placeholder="Selecciona una cuenta" />
    </div>
  );
}

export function FewAccounts() {
  const [value, setValue] = useState<number | "">(2);
  return (
    <div style={{ maxWidth: 320 }}>
      <AccountSelect value={value} onChange={setValue} accounts={ACCOUNTS.slice(0, 2)} placeholder="Cuenta destino" />
    </div>
  );
}
