import { StockLogoImg } from "@zendo/design-system";

export function Default() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-[#E8E1D4] bg-white p-4">
      <StockLogoImg symbol="AAPL" isDark={false} />
      <StockLogoImg symbol="TSLA" isDark={false} />
      <StockLogoImg symbol="MSFT" isDark={false} />
      <StockLogoImg symbol="NVDA" isDark={false} />
    </div>
  );
}

export function Large() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-[#E8E1D4] bg-white p-4">
      <StockLogoImg symbol="AAPL" size="lg" isDark={false} />
      <StockLogoImg symbol="AMZN" size="lg" isDark={false} />
    </div>
  );
}

export function Dark() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-[#30363d] bg-[#0d1117] p-4">
      <StockLogoImg symbol="GOOGL" size="lg" isDark />
      <StockLogoImg symbol="META" isDark />
    </div>
  );
}
