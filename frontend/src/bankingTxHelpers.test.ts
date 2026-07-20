import { describe, expect, it } from "vitest";
import {
  bankingPickerSearchMatches,
  bankingTxRangeForLastTwoMonths,
  maskBankingBalanceText,
  normalizeBankingTxCustomRange,
  resolveBankingTxMovementDateRange,
} from "./bankingTxHelpers";
import {
  BANKING_TAB_CACHE_MAX_ENTRIES,
  bankingTabCachePut,
  normalizeBankingTxColumnOrder,
  normalizeBankingTxVisibility,
  type BankingTabTxCacheEntry,
} from "./bankingTxShared";

describe("bankingTxHelpers date range", () => {
  it("swaps inverted custom ranges", () => {
    expect(normalizeBankingTxCustomRange("2026-05-10", "2026-04-01")).toEqual({
      from: "2026-04-01",
      to: "2026-05-10",
    });
  });

  it("falls back to last two months when from/to incomplete", () => {
    const fallback = bankingTxRangeForLastTwoMonths();
    expect(resolveBankingTxMovementDateRange("", "2026-01-01")).toEqual(fallback);
    expect(resolveBankingTxMovementDateRange("2026-01-01", "")).toEqual(fallback);
  });

  it("keeps complete custom range", () => {
    expect(resolveBankingTxMovementDateRange("2026-01-01", "2026-01-31")).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });
});

describe("bankingTxHelpers search and mask", () => {
  it("matches without accents or case", () => {
    expect(bankingPickerSearchMatches("Café", "cafe")).toBe(true);
    expect(bankingPickerSearchMatches("Supermercado", "MERC")).toBe(true);
    expect(bankingPickerSearchMatches("Agua", "luz")).toBe(false);
  });

  it("masks balance with fixed star count", () => {
    expect(maskBankingBalanceText("$1.234.567")).toBe("$****");
  });
});

describe("bankingTxShared prefs and cache", () => {
  it("forces required columns visible", () => {
    const vis = normalizeBankingTxVisibility({
      fecha: false,
      monto: false,
      descripcion: true,
    } as never);
    expect(vis.fecha).toBe(true);
    expect(vis.monto).toBe(true);
    expect(vis.descripcion).toBe(true);
  });

  it("normalizes column order and appends missing keys", () => {
    const order = normalizeBankingTxColumnOrder(["monto", "fecha", "unknown"]);
    expect(order[0]).toBe("monto");
    expect(order[1]).toBe("fecha");
    expect(order).toContain("descripcion");
    expect(new Set(order).size).toBe(order.length);
  });

  it("evicts oldest cache entries beyond max", () => {
    const map = new Map<string, BankingTabTxCacheEntry>();
    const empty: BankingTabTxCacheEntry = {
      items: [],
      total: 0,
      page: 1,
      sharedUnsettledGroups: [],
      provisionPendingGroups: [],
    };
    for (let i = 0; i < BANKING_TAB_CACHE_MAX_ENTRIES + 3; i++) {
      bankingTabCachePut(map, `k${i}`, empty);
    }
    expect(map.size).toBe(BANKING_TAB_CACHE_MAX_ENTRIES);
    expect(map.has("k0")).toBe(false);
    expect(map.has(`k${BANKING_TAB_CACHE_MAX_ENTRIES + 2}`)).toBe(true);
  });
});
