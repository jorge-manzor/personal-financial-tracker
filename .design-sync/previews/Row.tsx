import { Row } from "@zendo/design-system";

export function Default() {
  return (
    <dl
      style={{ maxWidth: 280 }}
      className="space-y-2.5 rounded-xl border border-[#E8E1D4] bg-white p-4 text-[12px]"
    >
      <Row label="Acciones" value="12.5" isDark={false} />
      <Row label="Costo actual" value="$227.55 c/u" isDark={false} />
      <Row label="Costo prom." value="$168.32 c/u" isDark={false} />
      <Row label="Valor" value="$2,844.38" isDark={false} />
      <Row label="Peso" value="22.4%" isDark={false} />
    </dl>
  );
}

export function Compact() {
  return (
    <dl
      style={{ maxWidth: 200 }}
      className="space-y-1 rounded-lg border border-[#E8E1D4] bg-white p-3 text-[10px]"
    >
      <Row compact label="Acciones" value="6" isDark={false} />
      <Row compact label="Valor" value="$1,284.66" isDark={false} />
    </dl>
  );
}

export function Dark() {
  return (
    <dl
      style={{ maxWidth: 280, background: "#161b22" }}
      className="space-y-2.5 rounded-xl border border-[#30363d] p-4 text-[12px]"
    >
      <Row label="Acciones" value="12.5" isDark />
      <Row label="Valor" value="$2,844.38" isDark />
      <Row label="Peso" value="22.4%" isDark />
    </dl>
  );
}
