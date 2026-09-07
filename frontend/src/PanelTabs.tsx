export type PanelTabId = "resumen" | "acciones" | "fondos" | "sectores" | "actividad";

interface Props {
  activeTab: PanelTabId;
  onChange: (tab: PanelTabId) => void;
  accionesCount: number;
  fondosCount: number;
  isDark: boolean;
}

export function PanelTabs({ activeTab, onChange, accionesCount, fondosCount, isDark }: Props) {
  const borderClass = isDark ? "border-[#1e242e]" : "border-[#E8E1D4]";
  const idleClass = isDark ? "text-[#8b949e] hover:text-[#F3F1EC]" : "text-[#8A8072] hover:text-[#2B2620]";
  const activeClass = isDark
    ? "text-[#F3F1EC] border-b-[#8FBFA6]"
    : "text-[#2B2620] border-b-[#8FBFA6]";

  const tabs: { id: PanelTabId; label: string }[] = [
    { id: "resumen", label: "Resumen" },
    { id: "acciones", label: `Acciones (${accionesCount})` },
    { id: "fondos", label: `Fondos (${fondosCount})` },
    { id: "sectores", label: "Sectores" },
    { id: "actividad", label: "Actividad" },
  ];

  return (
    <div className={`flex gap-1 overflow-x-auto border-b ${borderClass}`} role="tablist" aria-label="Secciones del panel">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={activeTab === t.id}
          onClick={() => onChange(t.id)}
          className={`shrink-0 border-b-2 px-1 py-2.5 text-[13px] font-semibold transition ${
            activeTab === t.id ? activeClass : `border-b-transparent ${idleClass}`
          } mr-5 last:mr-0`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
