import { ActivitySection } from "./ActivitySection";
import type { TransactionRow } from "./types";

interface Props {
  dataVersion: number;
  onEdit: (tx: TransactionRow) => void;
  onToast: (msg: string | null) => void;
  onMutate: () => void;
  isDark: boolean;
}

/** Reemplaza a la antigua página standalone /transactions — misma función, ahora como pestaña del Panel. */
export function PanelActividadTab({ dataVersion, onEdit, onToast, onMutate, isDark }: Props) {
  return (
    <ActivitySection
      dataVersion={dataVersion}
      onEdit={onEdit}
      onToast={(msg) => onToast(msg)}
      onMutate={onMutate}
      isDark={isDark}
    />
  );
}
