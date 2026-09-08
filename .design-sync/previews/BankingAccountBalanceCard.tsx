import { BankingAccountBalanceCard, IconGripVertical } from "@zendo/design-system";
import type { BankingAccountRow } from "@zendo/design-system";

const cuentaCorriente: BankingAccountRow = {
  id: 1,
  name: "Cuenta Corriente BCI",
  balance: 1_845_320,
  provision_net_sum: 180_000,
  balance_at_bank: 1_665_320,
  product_type: "cuenta_corriente",
};

const cuentaVista: BankingAccountRow = {
  id: 2,
  name: "Cuenta RUT",
  balance: 320_500,
  product_type: "cuenta_vista",
};

const tarjetaCredito: BankingAccountRow = {
  id: 3,
  name: "Tarjeta Falabella Visa",
  balance: -540_900,
  product_type: "tarjeta_credito",
};

const cuentaInactiva: BankingAccountRow = {
  id: 4,
  name: "Cuenta ahorro cerrada",
  balance: 0,
  product_type: "cuenta_prepago",
};

export function Default() {
  return (
    <div style={{ maxWidth: 300 }}>
      <BankingAccountBalanceCard account={cuentaCorriente} amountsVisible creditCardUnpaidAllocatedClp={95_000} />
    </div>
  );
}

export function WithDragHandle() {
  return (
    <div style={{ maxWidth: 300 }}>
      <BankingAccountBalanceCard
        account={cuentaVista}
        amountsVisible
        dragHandle={
          <button type="button" className="cursor-grab rounded p-1 text-[#9A9284]" aria-label="Reordenar">
            <IconGripVertical className="h-4 w-4" />
          </button>
        }
      />
    </div>
  );
}

export function CreditCard() {
  return (
    <div style={{ maxWidth: 300 }}>
      <BankingAccountBalanceCard account={tarjetaCredito} amountsVisible />
    </div>
  );
}

export function AmountsHidden() {
  return (
    <div style={{ maxWidth: 300 }}>
      <BankingAccountBalanceCard account={cuentaCorriente} amountsVisible={false} creditCardUnpaidAllocatedClp={95_000} />
    </div>
  );
}

export function Inactive() {
  return (
    <div style={{ maxWidth: 300 }}>
      <BankingAccountBalanceCard account={cuentaInactiva} amountsVisible />
    </div>
  );
}
