import { BankingConfirmDialog } from "@zendo/design-system";

export function Default() {
  return (
    <div style={{ position: "relative", height: 360 }}>
      <BankingConfirmDialog
        open
        title="Eliminar movimiento"
        message="¿Seguro que quieres eliminar el movimiento «Compra Jumbo Vitacura» por $45.900? Esta acción no se puede deshacer."
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </div>
  );
}

export function CustomLabels() {
  return (
    <div style={{ position: "relative", height: 360 }}>
      <BankingConfirmDialog
        open
        title="Marcar como pagado"
        message="Se marcará el cargo de tarjeta «Netflix suscripción mensual» ($9.990) como pagado."
        confirmLabel="Marcar pagado"
        cancelLabel="Volver"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </div>
  );
}

export function Busy() {
  return (
    <div style={{ position: "relative", height: 360 }}>
      <BankingConfirmDialog
        open
        busy
        title="Eliminar cuenta"
        message="Eliminando «Cuenta Corriente BCI» y sus movimientos asociados…"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </div>
  );
}
