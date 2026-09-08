import { useEffect, useRef } from "react";
import { IconMenuButton, IconPencil, IconTrash } from "@zendo/design-system";
import type { IconMenuButtonItem } from "@zendo/design-system";

/**
 * `IconMenuButton` opens its floating menu from internal state (no `open` prop) — this wrapper
 * clicks the real trigger button right after mount so the static screenshot shows the open menu
 * instead of just the closed "⋯" trigger.
 */
function OpenedMenu({ items, ariaLabel }: { items: IconMenuButtonItem[]; ariaLabel: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const btn = wrapRef.current?.querySelector("button");
    if (btn instanceof HTMLElement) btn.click();
  }, []);
  return (
    <div ref={wrapRef} style={{ display: "inline-block" }}>
      <IconMenuButton items={items} ariaLabel={ariaLabel} />
    </div>
  );
}

export function EditDelete() {
  const items: IconMenuButtonItem[] = [
    { label: "Editar", onClick: () => {}, icon: <IconPencil className="h-4 w-4" /> },
    { label: "Eliminar", onClick: () => {}, destructive: true, icon: <IconTrash className="h-4 w-4" /> },
  ];
  return (
    <div style={{ height: 180, paddingTop: 8, paddingLeft: 8 }}>
      <OpenedMenu items={items} ariaLabel="Acciones del movimiento" />
    </div>
  );
}

export function WithDisabledItem() {
  const items: IconMenuButtonItem[] = [
    { label: "Editar", onClick: () => {}, icon: <IconPencil className="h-4 w-4" /> },
    {
      label: "Eliminar",
      onClick: () => {},
      destructive: true,
      disabled: true,
      title: "No puedes eliminar un movimiento compartido liquidado",
      icon: <IconTrash className="h-4 w-4" />,
    },
  ];
  return (
    <div style={{ height: 180, paddingTop: 8, paddingLeft: 8 }}>
      <OpenedMenu items={items} ariaLabel="Acciones del movimiento" />
    </div>
  );
}

export function ClosedTrigger() {
  const items: IconMenuButtonItem[] = [
    { label: "Editar", onClick: () => {} },
    { label: "Eliminar", onClick: () => {}, destructive: true },
  ];
  return (
    <div style={{ display: "inline-block" }}>
      <IconMenuButton items={items} ariaLabel="Acciones del movimiento" />
    </div>
  );
}
