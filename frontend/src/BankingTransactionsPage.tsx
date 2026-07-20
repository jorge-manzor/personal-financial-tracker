import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { BankingThemeToggle, useBankingTheme } from "./BankingThemeContext";
import { BankingConfirmDialog } from "./BankingConfirmDialog";
import { apiFetch, fetchJson, patchJson, postJson } from "./api";
import { formatBankingClpSigned, formatClpDots, parseChileanAmountInput } from "./format";
import { localDateISOString, localYearMonthString } from "./localDate";
import type {
  BankingAccountRow,
  BankingCategoryRow,
  BankingCreditCardUnpaidGroup,
  BankingSharedUnsettledGroup,
  BankingDebtTotalsOut,
  BankingTransactionRow,
} from "./types";
import {
  BANKING_TEMPLATE_CAT_PROVISIONES,
  BANKING_TEMPLATE_CAT_TRANSFERENCIA,
  BANKING_TEMPLATE_SUB_ENTRE_CUENTAS_PROPIAS,
  BANKING_TX_PAGE_SIZE,
  bankingPickerSearchMatches,
  bankingTxRangeForLastTwoMonths,
  resolveBankingTxMovementDateRange,
} from "./bankingTxHelpers";
import {
  ACCOUNTING_MONTH_ABBR_ES,
  BANKING_BALANCE_PRIVACY_KEY_SHARED,
  BANKING_BALANCE_PRIVACY_KEY_TOTAL,
  BANKING_BALANCE_PRIVACY_STRICT_KEY,
  BANKING_CC_PENDING_EXCLUDED_COLUMNS,
  BANKING_MAIN_TX_CARD_CLASS,
  BANKING_MAIN_TX_FOOTER_CLASS,
  BANKING_MAIN_TX_THEAD_CLASS,
  BANKING_MAIN_TX_TOOLBAR_CLASS,
  BANKING_MOVEMENTS_SECTION_CLASS,
  BANKING_MOVEMENTS_TAB_BAR_CLASS,
  BANKING_MOVEMENTS_TAB_BTN_ACTIVE,
  BANKING_MOVEMENTS_TAB_BTN_IDLE,
  BANKING_SELECTION_SUMMARY_TICKET_ACTIVE_CLASS,
  BANKING_TX_COL_WIDTH,
  BANKING_TX_COLUMN_LABELS,
  BANKING_TX_TABLE_PREFS_STORAGE_KEY,
  DEFAULT_BANKING_TX_COLUMN_ORDER,
  DEFAULT_BANKING_TX_COLUMN_VISIBILITY,
  accountingYearRange,
  bankingAccountIncludedInTotalBalance,
  bankingBalancePrivacyKeyAccount,
  bankingBalanceScopeQueryParam,
  bankingModalCategoryTriggerClass,
  bankingModalControlClass,
  bankingModalFieldLabelClass,
  bankingModalHelperTextClass,
  bankingNonCreditAccounts,
  bankingPickerListScrollClass,
  bankingPickerSearchInputClass,
  bankingTabCacheKey,
  bankingTabCachePut,
  bankingToolbarDateInputClass,
  bankingToolbarGhostBtnClass,
  bankingToolbarGhostBtnMdClass,
  bankingTxColumnFilterActive,
  bankingTxSortableColumnId,
  buildYm,
  cancelIdlePrefetch,
  creditCardUnpaidAllocatedByChecking,
  dateInputClass,
  firstDayIsoFromMonthInput,
  isAbortError,
  isBankingTxColumnRequired,
  loadBalanceCardOrder,
  loadBankingBalanceScope,
  mergeBalanceCardOrder,
  monthInputFromRow,
  normalizeBankingTxVisibility,
  parseAccountingYm,
  parseBankingTxTablePreferences,
  pickDate,
  readBankingTxPrefsRaw,
  readStoredBalanceStrictPrivacy,
  saveBalanceCardOrder,
  saveBankingBalanceScope,
  scheduleIdlePrefetch,
  sharedPendingPerPersonClp,
  sumUnpaidTcDebtFromItems,
  type BankingBalanceScope,
  type BankingMovementTabScope,
  type BankingTabTxCacheEntry,
  type BankingTxColumnKey,
  type BankingTxFilterSnapshot,
  type BankingTxLiquidadoOption,
  type BankingTxSharedScopeOption,
  type BankingTxTcPaidOption,
} from "./bankingTxShared";
import { IconCalendar, IconColumns, IconEyeOutline, IconEyeSlashOutline } from "./bankingTxIcons";
import {
  BankingBalanceScopeHelpButton,
  BankingNonCreditTotalBalanceCard,
  BankingSharedUnsettledDebtCard,
  SortableBankingBalanceCard,
} from "./bankingBalanceCards";
import {
  BankingTxColumnHeader,
  BankingTxFilterUICtx,
  BankingTxHeaderFilterFields,
  SortableBankingTxColumnPickerRow,
  type BankingTxFilterUICtxValue,
} from "./bankingTxFilters";
import { BankingVirtualizedMainTxTableBody } from "./bankingTxMainTable";
import {
  BankingCcPendingChargesTable,
  BankingProvisionPendingTable,
  BankingSharedPendingChargesTable,
} from "./bankingTxAuxTables";

function SiNoField({
  label,
  yesLabel = "Sí",
  noLabel = "No",
  value,
  onChange,
}: {
  label: string;
  yesLabel?: string;
  noLabel?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className={bankingModalFieldLabelClass}>{label}</span>
      <div className="flex gap-2 rounded-xl border border-slate-300 bg-slate-50/80 p-1 banking-dark:border-zinc-600 banking-dark:bg-zinc-900/75">
        <button
          type="button"
          aria-pressed={value === true}
          onClick={() => onChange(true)}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            value === true
              ? "border border-emerald-200 bg-emerald-100 text-emerald-800 shadow-sm ring-1 ring-emerald-200/80 banking-dark:border-emerald-800/55 banking-dark:bg-emerald-950/55 banking-dark:text-emerald-300 banking-dark:ring-emerald-800/60 banking-dark:shadow-none"
              : "border border-transparent text-slate-600 hover:bg-white hover:text-slate-900 banking-dark:text-zinc-400 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-100"
          }`}
        >
          {yesLabel}
        </button>
        <button
          type="button"
          aria-pressed={value === false}
          onClick={() => onChange(false)}
          className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
            value === false
              ? "border border-rose-200 bg-rose-100 text-rose-800 shadow-sm ring-1 ring-rose-200/80 banking-dark:border-rose-900/45 banking-dark:bg-rose-950/50 banking-dark:text-rose-300 banking-dark:ring-rose-900/55 banking-dark:shadow-none"
              : "border border-transparent text-slate-600 hover:bg-white hover:text-slate-900 banking-dark:text-zinc-400 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-100"
          }`}
        >
          {noLabel}
        </button>
      </div>
    </div>
  );
}

export function BankingTransactionsPage({ onToast }: { onToast: (msg: string | null) => void }) {
  const { isDark } = useBankingTheme();
  const [accounts, setAccounts] = useState<BankingAccountRow[]>([]);
  /** ledger=libro; through_current_accounting_month=saldos según mes contable ≤ mes en curso (Chile), vía API. */
  const [bankingBalanceScope, setBankingBalanceScope] = useState<BankingBalanceScope>(loadBankingBalanceScope);
  /** Ref sincronizado cada render: evita que el callback de meta dependa de `bankingBalanceScope` y re-dispare la carga de la tabla. */
  const bankingBalanceScopeRef = useRef(bankingBalanceScope);
  bankingBalanceScopeRef.current = bankingBalanceScope;
  const [bankingDebtTotals, setBankingDebtTotals] = useState<BankingDebtTotalsOut>({
    credit_card_unpaid_clp: 0,
    shared_unsettled_clp: 0,
  });
  const [categories, setCategories] = useState<BankingCategoryRow[]>([]);
  const [items, setItems] = useState<BankingTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** Error de carga de lista/meta (no se muestra si fue AbortError). */
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Revalidación en segundo plano (caché hit) — no bloquea la UI. */
  const [tabRefreshing, setTabRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BankingTransactionRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    row: BankingTransactionRow;
    message: string;
  } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [accountId, setAccountId] = useState<number | "">("");
  const [fecha, setFecha] = useState(() => localDateISOString());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [subcategoryId, setSubcategoryId] = useState<number | "">("");
  const [isShared, setIsShared] = useState(false);
  const [splitParticipants, setSplitParticipants] = useState("2");
  const [sharedExpenseSettled, setSharedExpenseSettled] = useState(false);
  const [creditCardChargePaid, setCreditCardChargePaid] = useState(false);
  const [accountingMonthYm, setAccountingMonthYm] = useState(() => localYearMonthString());
  const [transferDestinationAccountId, setTransferDestinationAccountId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  /** Solo edición de categoría Provisiones: al guardar con Sí se crea la reversa tras actualizar. */
  const [provisionReversalOnSave, setProvisionReversalOnSave] = useState(false);
  const [bankingTxPage, setBankingTxPage] = useState(1);
  const [movementTab, setMovementTab] = useState<BankingMovementTabScope>("all");
  /** Para resetear filtros de TC al entrar en Provisiones desde otra pestaña (las filas suelen tener `credit_card_charge_paid` null). */
  const movementTabPrevRef = useRef<BankingMovementTabScope | null>(null);
  const [ccUnpaidGroups, setCcUnpaidGroups] = useState<BankingCreditCardUnpaidGroup[]>([]);
  const [sharedUnsettledGroups, setSharedUnsettledGroups] = useState<BankingSharedUnsettledGroup[]>([]);
  const [provisionPendingGroups, setProvisionPendingGroups] = useState<BankingCreditCardUnpaidGroup[]>([]);
  const [selectedProvisionReverseIds, setSelectedProvisionReverseIds] = useState<Set<number>>(() => new Set());
  const [reversingProvisionId, setReversingProvisionId] = useState<number | null>(null);
  const [bulkReversingProvision, setBulkReversingProvision] = useState(false);
  const [markingPaidId, setMarkingPaidId] = useState<number | null>(null);
  const [markingSharedSettledId, setMarkingSharedSettledId] = useState<number | null>(null);
  const [bulkSettlingShared, setBulkSettlingShared] = useState(false);
  const [selectedSharedIds, setSelectedSharedIds] = useState<Set<number>>(() => new Set());
  const [bankingTxTotal, setBankingTxTotal] = useState(0);
  const [columnOrder, setColumnOrder] = useState<BankingTxColumnKey[]>(() =>
    parseBankingTxTablePreferences(readBankingTxPrefsRaw()).order,
  );
  const [columnVisibility, setColumnVisibility] = useState<Record<BankingTxColumnKey, boolean>>(() =>
    parseBankingTxTablePreferences(readBankingTxPrefsRaw()).visibility,
  );
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const columnPickerWrapRef = useRef<HTMLDivElement>(null);
  const [balancePrivacyStrict, setBalancePrivacyStrict] = useState(readStoredBalanceStrictPrivacy);
  const [balancePrivacyPeekKey, setBalancePrivacyPeekKey] = useState<string | null>(null);
  const [balanceCardHiddenKeys, setBalanceCardHiddenKeys] = useState<Set<string>>(() => new Set());
  /** Contenedor con scroll de la tabla principal (virtualizada). */
  const bankingTxScrollRef = useRef<HTMLDivElement>(null);
  /** Clave de cache alineada con el render actual (evita aplicar respuestas obsoletas al cambiar de pestaña). */
  const bankingViewKeyRef = useRef("");
  /** Entradas SWR por clave de vista; se invalida en mutaciones. */
  const tabTxCacheRef = useRef(new Map<string, BankingTabTxCacheEntry>());
  /** Aborta navegación de página si el usuario cambia de página o vista antes de responder. */
  const bankingTxPageFetchAbortRef = useRef<AbortController | null>(null);

  const columnDndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterDescription, setFilterDescription] = useState("");
  const [filterAccountIds, setFilterAccountIds] = useState<number[]>([]);
  /** Rango por fecha de movimiento en servidor (Desde / hasta; por defecto últimos 2 meses). */
  const [bankingTxDateFrom, setBankingTxDateFrom] = useState(() => bankingTxRangeForLastTwoMonths().from);
  const [bankingTxDateTo, setBankingTxDateTo] = useState(() => bankingTxRangeForLastTwoMonths().to);
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [filterCategoryIds, setFilterCategoryIds] = useState<number[]>([]);
  const [filterSubcategoryIds, setFilterSubcategoryIds] = useState<number[]>([]);
  const [filterSharedScopes, setFilterSharedScopes] = useState<BankingTxSharedScopeOption[]>([]);
  const [filterLiquidadoValues, setFilterLiquidadoValues] = useState<BankingTxLiquidadoOption[]>([]);
  const [filterTcPaidValues, setFilterTcPaidValues] = useState<BankingTxTcPaidOption[]>([]);
  const [filterAccountingMonthYms, setFilterAccountingMonthYms] = useState<string[]>([]);
  const [headerFilterOpen, setHeaderFilterOpen] = useState<BankingTxColumnKey | null>(null);
  const [headerFilterPopoverPos, setHeaderFilterPopoverPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const headerFilterCellRefs = useRef<Partial<Record<BankingTxColumnKey, HTMLTableCellElement | null>>>({});
  const filterPopoverPanelRef = useRef<HTMLDivElement | null>(null);

  const balanceAmountsVisible = useCallback(
    (key: string) =>
      balancePrivacyStrict ? balancePrivacyPeekKey === key : !balanceCardHiddenKeys.has(key),
    [balancePrivacyStrict, balancePrivacyPeekKey, balanceCardHiddenKeys],
  );

  const handleBalancePeekStart = useCallback((key: string) => {
    setBalancePrivacyPeekKey(key);
  }, []);

  const handleBalancePeekEnd = useCallback(() => {
    setBalancePrivacyPeekKey(null);
  }, []);

  const toggleBalanceCardHidden = useCallback((key: string) => {
    setBalanceCardHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    const payload = {
      v: 2 as const,
      order: columnOrder,
      visibility: normalizeBankingTxVisibility(columnVisibility),
    };
    localStorage.setItem(BANKING_TX_TABLE_PREFS_STORAGE_KEY, JSON.stringify(payload));
  }, [columnOrder, columnVisibility]);

  useEffect(() => {
    try {
      localStorage.setItem(BANKING_BALANCE_PRIVACY_STRICT_KEY, balancePrivacyStrict ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [balancePrivacyStrict]);

  useEffect(() => {
    if (filterCategoryIds.length === 0) return;
    const allowed = new Set<number>();
    for (const cid of filterCategoryIds) {
      const cat = categories.find((c) => c.id === cid);
      if (cat) for (const s of cat.subcategories) allowed.add(s.id);
    }
    setFilterSubcategoryIds((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filterCategoryIds, categories]);

  useEffect(() => {
    if (!columnPickerOpen) return;
    function handleDown(e: MouseEvent) {
      if (columnPickerWrapRef.current?.contains(e.target as Node)) return;
      setColumnPickerOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setColumnPickerOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [columnPickerOpen]);

  const registerHeaderCellRef = useCallback((k: BankingTxColumnKey, el: HTMLTableCellElement | null) => {
    headerFilterCellRefs.current[k] = el;
  }, []);

  const toggleHeaderFilter = useCallback((k: BankingTxColumnKey) => {
    setHeaderFilterOpen((prev) => (prev === k ? null : k));
  }, []);

  useLayoutEffect(() => {
    if (headerFilterOpen == null) {
      setHeaderFilterPopoverPos(null);
      return;
    }
    const col: BankingTxColumnKey = headerFilterOpen;
    function update() {
      const el = headerFilterCellRefs.current[col];
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(320, Math.max(260, window.innerWidth - 24));
      let left = r.left + r.width / 2 - width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      const top = r.bottom + 6;
      setHeaderFilterPopoverPos({ top, left, width });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [headerFilterOpen]);

  useEffect(() => {
    if (headerFilterOpen == null) return;
    const col: BankingTxColumnKey = headerFilterOpen;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (filterPopoverPanelRef.current?.contains(t)) return;
      if (headerFilterCellRefs.current[col]?.contains(t)) return;
      setHeaderFilterOpen(null);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setHeaderFilterOpen(null);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [headerFilterOpen]);

  const filterSnapshot = useMemo(
    (): BankingTxFilterSnapshot => ({
      filterDateFrom,
      filterDateTo,
      filterDescription,
      filterAccountIds,
      filterAmountMin,
      filterAmountMax,
      filterCategoryIds,
      filterSubcategoryIds,
      filterSharedScopes,
      filterLiquidadoValues,
      filterTcPaidValues,
      filterAccountingMonthYms,
    }),
    [
      filterDateFrom,
      filterDateTo,
      filterDescription,
      filterAccountIds,
      filterAmountMin,
      filterAmountMax,
      filterCategoryIds,
      filterSubcategoryIds,
      filterSharedScopes,
      filterLiquidadoValues,
      filterTcPaidValues,
      filterAccountingMonthYms,
    ],
  );

  const isColumnFilterActive = useCallback(
    (k: BankingTxColumnKey) => bankingTxColumnFilterActive(k, filterSnapshot),
    [filterSnapshot],
  );

  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const scopeMenuRef = useRef<HTMLDivElement>(null);
  const scopeTriggerRef = useRef<HTMLButtonElement>(null);
  const scopePanelRef = useRef<HTMLDivElement>(null);
  const [scopePanelBox, setScopePanelBox] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateScopePanelBox = useCallback(() => {
    const el = scopeTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setScopePanelBox({ top: r.bottom + 8, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!scopeMenuOpen) {
      setScopePanelBox(null);
      return;
    }
    updateScopePanelBox();
    window.addEventListener("scroll", updateScopePanelBox, true);
    window.addEventListener("resize", updateScopePanelBox);
    return () => {
      window.removeEventListener("scroll", updateScopePanelBox, true);
      window.removeEventListener("resize", updateScopePanelBox);
    };
  }, [scopeMenuOpen, updateScopePanelBox]);

  useEffect(() => {
    if (!scopeMenuOpen) return;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (scopeMenuRef.current?.contains(t)) return;
      if (scopePanelRef.current?.contains(t)) return;
      setScopeMenuOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setScopeMenuOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [scopeMenuOpen]);

  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement>(null);
  const categoryPanelRef = useRef<HTMLDivElement>(null);
  const [categoryPanelBox, setCategoryPanelBox] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const [categoryPickerSearch, setCategoryPickerSearch] = useState("");
  const categorySearchInputRef = useRef<HTMLInputElement>(null);

  const [subcategoryMenuOpen, setSubcategoryMenuOpen] = useState(false);
  const subcategoryMenuRef = useRef<HTMLDivElement>(null);
  const subcategoryTriggerRef = useRef<HTMLButtonElement>(null);
  const subcategoryPanelRef = useRef<HTMLDivElement>(null);
  const [subcategoryPanelBox, setSubcategoryPanelBox] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const [subcategoryPickerSearch, setSubcategoryPickerSearch] = useState("");
  const subcategorySearchInputRef = useRef<HTMLInputElement>(null);

  const [accountingPickMode, setAccountingPickMode] = useState<null | "month" | "year">(null);
  const accountingMonthWrapRef = useRef<HTMLDivElement>(null);
  const accountingMonthTriggerRef = useRef<HTMLDivElement>(null);
  const accountingMonthPanelRef = useRef<HTMLDivElement>(null);
  const [accountingMonthPanelBox, setAccountingMonthPanelBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const updateAccountingMonthPanelBox = useCallback(() => {
    const el = accountingMonthTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAccountingMonthPanelBox({
      top: r.bottom + 8,
      left: r.left,
      width: Math.max(r.width, 260),
    });
  }, []);

  useLayoutEffect(() => {
    if (!accountingPickMode) {
      setAccountingMonthPanelBox(null);
      return;
    }
    updateAccountingMonthPanelBox();
    window.addEventListener("scroll", updateAccountingMonthPanelBox, true);
    window.addEventListener("resize", updateAccountingMonthPanelBox);
    return () => {
      window.removeEventListener("scroll", updateAccountingMonthPanelBox, true);
      window.removeEventListener("resize", updateAccountingMonthPanelBox);
    };
  }, [accountingPickMode, updateAccountingMonthPanelBox]);

  useEffect(() => {
    if (!accountingPickMode) return;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (accountingMonthWrapRef.current?.contains(t)) return;
      if (accountingMonthPanelRef.current?.contains(t)) return;
      setAccountingPickMode(null);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAccountingPickMode(null);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [accountingPickMode]);

  const updateCategoryPanelBox = useCallback(() => {
    const el = categoryTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCategoryPanelBox({ top: r.bottom + 8, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!categoryMenuOpen) {
      setCategoryPanelBox(null);
      return;
    }
    updateCategoryPanelBox();
    window.addEventListener("scroll", updateCategoryPanelBox, true);
    window.addEventListener("resize", updateCategoryPanelBox);
    return () => {
      window.removeEventListener("scroll", updateCategoryPanelBox, true);
      window.removeEventListener("resize", updateCategoryPanelBox);
    };
  }, [categoryMenuOpen, updateCategoryPanelBox]);

  useEffect(() => {
    if (!categoryMenuOpen) return;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (categoryMenuRef.current?.contains(t)) return;
      if (categoryPanelRef.current?.contains(t)) return;
      setCategoryMenuOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCategoryMenuOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [categoryMenuOpen]);

  const updateSubcategoryPanelBox = useCallback(() => {
    const el = subcategoryTriggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSubcategoryPanelBox({ top: r.bottom + 8, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!subcategoryMenuOpen) {
      setSubcategoryPanelBox(null);
      return;
    }
    updateSubcategoryPanelBox();
    window.addEventListener("scroll", updateSubcategoryPanelBox, true);
    window.addEventListener("resize", updateSubcategoryPanelBox);
    return () => {
      window.removeEventListener("scroll", updateSubcategoryPanelBox, true);
      window.removeEventListener("resize", updateSubcategoryPanelBox);
    };
  }, [subcategoryMenuOpen, updateSubcategoryPanelBox]);

  useEffect(() => {
    if (!subcategoryMenuOpen) return;
    function handleDown(e: MouseEvent) {
      const t = e.target as Node;
      if (subcategoryMenuRef.current?.contains(t)) return;
      if (subcategoryPanelRef.current?.contains(t)) return;
      setSubcategoryMenuOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSubcategoryMenuOpen(false);
    }
    document.addEventListener("mousedown", handleDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [subcategoryMenuOpen]);

  useEffect(() => {
    if (!categoryMenuOpen) return;
    const id = requestAnimationFrame(() => categorySearchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [categoryMenuOpen]);

  useEffect(() => {
    if (!subcategoryMenuOpen) return;
    const id = requestAnimationFrame(() => subcategorySearchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [subcategoryMenuOpen]);

  const effectiveBankingMovementDateRange = useMemo(
    () => resolveBankingTxMovementDateRange(bankingTxDateFrom, bankingTxDateTo),
    [bankingTxDateFrom, bankingTxDateTo],
  );

  bankingViewKeyRef.current = bankingTabCacheKey(
    movementTab,
    filterAccountIds,
    effectiveBankingMovementDateRange.from,
    effectiveBankingMovementDateRange.to,
    filterSnapshot,
  );
  const buildBankingTxQueryParams = useCallback(
    (page: number, tabScope: BankingMovementTabScope = movementTab) => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(BANKING_TX_PAGE_SIZE));
      if (filterAccountIds.length === 1) {
        params.set("account_id", String(filterAccountIds[0]));
      } else if (filterAccountIds.length > 1) {
        for (const id of filterAccountIds) params.append("account_ids", String(id));
      }
      if (tabScope === "credit_card") params.set("scope", "credit_card");
      if (tabScope === "shared") params.set("scope", "shared");
      if (tabScope === "provisiones") params.set("scope", "provisiones");
      params.set("date_from", effectiveBankingMovementDateRange.from);
      params.set("date_to", effectiveBankingMovementDateRange.to);
      if (filterDateFrom) params.set("tx_date_from", filterDateFrom);
      if (filterDateTo) params.set("tx_date_to", filterDateTo);
      const desc = filterDescription.trim();
      if (desc) params.set("description", desc);
      const amountMin = parseChileanAmountInput(filterAmountMin);
      if (filterAmountMin.trim() && Number.isFinite(amountMin)) params.set("amount_min", String(amountMin));
      const amountMax = parseChileanAmountInput(filterAmountMax);
      if (filterAmountMax.trim() && Number.isFinite(amountMax)) params.set("amount_max", String(amountMax));
      for (const id of filterCategoryIds) params.append("category_ids", String(id));
      for (const id of filterSubcategoryIds) params.append("subcategory_ids", String(id));
      for (const v of filterSharedScopes) params.append("shared_scopes", v);
      for (const v of filterLiquidadoValues) params.append("liquidado_values", v);
      for (const v of filterTcPaidValues) params.append("tc_paid_values", v);
      for (const ym of filterAccountingMonthYms) params.append("accounting_months", ym);
      return params;
    },
    [
      filterAccountIds,
      movementTab,
      effectiveBankingMovementDateRange.from,
      effectiveBankingMovementDateRange.to,
      filterDateFrom,
      filterDateTo,
      filterDescription,
      filterAmountMin,
      filterAmountMax,
      filterCategoryIds,
      filterSubcategoryIds,
      filterSharedScopes,
      filterLiquidadoValues,
      filterTcPaidValues,
      filterAccountingMonthYms,
    ],
  );

  /** Respuesta cruda de lista (sin setState). */
  const loadBankingTransactionsFromNetwork = useCallback(
    async (page: number, tabScope: BankingMovementTabScope, signal?: AbortSignal) => {
      const params = buildBankingTxQueryParams(page, tabScope);
      return fetchJson<{
        items: BankingTransactionRow[];
        total: number;
        page: number;
        page_size: number;
      }>(`/banking/transactions?${params.toString()}`, signal ? { signal } : undefined);
    },
    [buildBankingTxQueryParams],
  );

  /** Solo saldos (tarjetas de cuentas / TC en resumen). No afecta la lista de movimientos. */
  const refreshBalanceCardsMeta = useCallback(
    async (scope: BankingBalanceScope) => {
      const bq = bankingBalanceScopeQueryParam(scope);
      try {
        const [acc, debt, ccUg] = await Promise.all([
          fetchJson<BankingAccountRow[]>(`/banking/accounts${bq}`),
          fetchJson<BankingDebtTotalsOut>(`/banking/debt-totals${bq}`),
          fetchJson<{ groups: BankingCreditCardUnpaidGroup[] }>(`/banking/credit-card/unpaid-grouped${bq}`),
        ]);
        setAccounts(acc);
        setBankingDebtTotals(debt);
        setCcUnpaidGroups(ccUg.groups);
      } catch (e) {
        console.error(e);
        onToast("No se pudo recalcular saldos con el filtro de mes contable. Reintenta o recarga la página.");
      }
    },
    [onToast],
  );

  /** Meta global + grupos según pestaña (compartidos, provisiones pendientes de reversa, etc.). */
  const fetchBankingMetaFromNetwork = useCallback(async (tabScope: BankingMovementTabScope, signal?: AbortSignal) => {
    const init = signal ? { signal } : undefined;
    const bq = bankingBalanceScopeQueryParam(bankingBalanceScopeRef.current);
    /** Evita encadenar awaits: el endpoint de provisiones puede ser pesado; en paralelo llega antes a la UI. */
    const sharedExtra =
      tabScope === "shared"
        ? fetchJson<{ groups: BankingSharedUnsettledGroup[] }>("/banking/shared/unsettled-grouped", init)
        : Promise.resolve({ groups: [] as BankingSharedUnsettledGroup[] });
    const provisionExtra =
      tabScope === "provisiones"
        ? fetchJson<{ groups: BankingCreditCardUnpaidGroup[] }>(
            "/banking/provisions/pending-reversal-grouped",
            init,
          )
        : Promise.resolve({ groups: [] as BankingCreditCardUnpaidGroup[] });

    const [acc, cats, debt, ccUg, ug, pg] = await Promise.all([
      fetchJson<BankingAccountRow[]>(`/banking/accounts${bq}`, init),
      fetchJson<BankingCategoryRow[]>("/banking/categories", init),
      fetchJson<BankingDebtTotalsOut>(`/banking/debt-totals${bq}`, init),
      fetchJson<{ groups: BankingCreditCardUnpaidGroup[] }>(`/banking/credit-card/unpaid-grouped${bq}`, init),
      sharedExtra,
      provisionExtra,
    ]);
    return {
      acc,
      cats,
      debt,
      ccGroups: ccUg.groups,
      sharedGroups: ug.groups,
      provisionPendingGroups: pg.groups,
    };
  }, []);

  const applyBankingMetaGlobal = useCallback(
    (meta: {
      acc: BankingAccountRow[];
      cats: BankingCategoryRow[];
      debt: BankingDebtTotalsOut;
      ccGroups: BankingCreditCardUnpaidGroup[];
    }) => {
      setAccounts(meta.acc);
      setBankingDebtTotals(meta.debt);
      setCategories([...meta.cats].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id));
      setCcUnpaidGroups(meta.ccGroups);
    },
    [],
  );

  /** Carga lista + meta; actualiza estado de movimientos solo si `expectedViewKey` sigue siendo la vista activa. */
  const reloadBankingDataForScope = useCallback(
    async (
      page: number,
      tabScope: BankingMovementTabScope,
      expectedViewKey: string,
      signal?: AbortSignal,
    ) => {
      const [txList, meta] = await Promise.all([
        loadBankingTransactionsFromNetwork(page, tabScope, signal),
        fetchBankingMetaFromNetwork(tabScope, signal),
      ]);
      if (signal?.aborted) return;
      applyBankingMetaGlobal(meta);
      if (bankingViewKeyRef.current !== expectedViewKey) return;
      setItems(txList.items);
      setBankingTxTotal(txList.total);
      setBankingTxPage(txList.page);
      setSharedUnsettledGroups(meta.sharedGroups);
      setProvisionPendingGroups(meta.provisionPendingGroups);
      bankingTabCachePut(tabTxCacheRef.current, expectedViewKey, {
        items: txList.items,
        total: txList.total,
        page: txList.page,
        sharedUnsettledGroups: meta.sharedGroups,
        provisionPendingGroups: meta.provisionPendingGroups,
      });
    },
    [applyBankingMetaGlobal, fetchBankingMetaFromNetwork, loadBankingTransactionsFromNetwork],
  );

  /** Tras crear/editar/borrar/marcar: invalidar SWR y recargar vista actual. */
  const reloadBankingFull = useCallback(
    async (page: number) => {
      tabTxCacheRef.current.clear();
      const k = bankingViewKeyRef.current;
      setTabRefreshing(true);
      setLoadError(null);
      try {
        await reloadBankingDataForScope(page, movementTab, k);
        setLoadError(null);
      } catch (e) {
        if (!isAbortError(e)) {
          console.error(e);
          setLoadError(e instanceof Error ? e.message : "No se pudieron cargar los movimientos.");
        }
      } finally {
        setTabRefreshing(false);
      }
    },
    [movementTab, reloadBankingDataForScope],
  );

  const balanceScopeReloadSkipRef = useRef(true);
  useEffect(() => {
    saveBankingBalanceScope(bankingBalanceScope);
  }, [bankingBalanceScope]);

  /** Cambiar "Actual" solo recalcula saldos vía API; no recarga filas de la tabla. */
  useEffect(() => {
    if (balanceScopeReloadSkipRef.current) {
      balanceScopeReloadSkipRef.current = false;
      return;
    }
    void refreshBalanceCardsMeta(bankingBalanceScope);
  }, [bankingBalanceScope, refreshBalanceCardsMeta]);

  useEffect(() => {
    if (movementTab !== "shared") setSelectedSharedIds(new Set());
  }, [movementTab]);

  useEffect(() => {
    if (movementTab !== "provisiones") setSelectedProvisionReverseIds(new Set());
  }, [movementTab]);

  useEffect(() => {
    const prev = movementTabPrevRef.current;
    movementTabPrevRef.current = movementTab;
    if (movementTab === "provisiones" && prev !== null && prev !== "provisiones") {
      setFilterTcPaidValues([]);
    }
  }, [movementTab]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const requestKey = bankingTabCacheKey(
      movementTab,
      filterAccountIds,
      effectiveBankingMovementDateRange.from,
      effectiveBankingMovementDateRange.to,
      filterSnapshot,
    );
    const cached = tabTxCacheRef.current.get(requestKey);

    const onReloadError = (e: unknown) => {
      if (isAbortError(e)) return;
      console.error(e);
      setLoadError(e instanceof Error ? e.message : "No se pudieron cargar los movimientos.");
    };

    if (cached) {
      setItems(cached.items);
      setBankingTxTotal(cached.total);
      setBankingTxPage(cached.page);
      setSharedUnsettledGroups(cached.sharedUnsettledGroups);
      setProvisionPendingGroups(cached.provisionPendingGroups ?? []);
      setLoading(false);
      setLoadError(null);
      setTabRefreshing(true);
      void reloadBankingDataForScope(1, movementTab, requestKey, ac.signal)
        .then(() => {
          if (!cancelled) setLoadError(null);
        })
        .catch(onReloadError)
        .finally(() => {
          if (!cancelled) setTabRefreshing(false);
        });
      return () => {
        cancelled = true;
        ac.abort();
      };
    }

    setItems([]);
    setBankingTxTotal(0);
    setBankingTxPage(1);
    setLoading(true);
    setLoadError(null);
    void reloadBankingDataForScope(1, movementTab, requestKey, ac.signal)
      .then(() => {
        if (!cancelled) setLoadError(null);
      })
      .catch(onReloadError)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [
    movementTab,
    filterAccountIds,
    effectiveBankingMovementDateRange.from,
    effectiveBankingMovementDateRange.to,
    filterSnapshot,
    reloadBankingDataForScope,
  ]);

  /** Precarga en idle las otras pestañas con los mismos filtros/fechas para cambio instantáneo. */
  useEffect(() => {
    if (loading) return;

    const ac = new AbortController();
    const idleId = scheduleIdlePrefetch(() => {
      if (ac.signal.aborted) return;
      const scopes: BankingMovementTabScope[] = ["all", "credit_card", "shared", "provisiones"];
      void (async () => {
        for (const scope of scopes) {
          if (ac.signal.aborted) return;
          if (scope === movementTab) continue;
          const key = bankingTabCacheKey(
            scope,
            filterAccountIds,
            effectiveBankingMovementDateRange.from,
            effectiveBankingMovementDateRange.to,
            filterSnapshot,
          );
          if (tabTxCacheRef.current.has(key)) continue;
          try {
            const [txList, meta] = await Promise.all([
              loadBankingTransactionsFromNetwork(1, scope, ac.signal),
              fetchBankingMetaFromNetwork(scope, ac.signal),
            ]);
            if (ac.signal.aborted) return;
            if (tabTxCacheRef.current.has(key)) continue;
            bankingTabCachePut(tabTxCacheRef.current, key, {
              items: txList.items,
              total: txList.total,
              page: txList.page,
              sharedUnsettledGroups: meta.sharedGroups,
              provisionPendingGroups: meta.provisionPendingGroups,
            });
          } catch (e) {
            if (!isAbortError(e)) console.error(e);
          }
        }
      })();
    });

    return () => {
      cancelIdlePrefetch(idleId);
      ac.abort();
    };
  }, [
    movementTab,
    filterAccountIds,
    effectiveBankingMovementDateRange.from,
    effectiveBankingMovementDateRange.to,
    filterSnapshot,
    loadBankingTransactionsFromNetwork,
    fetchBankingMetaFromNetwork,
    loading,
  ]);


  /** Tras cargar o cambiar de página, el scroll de la tabla vuelve arriba. */
  useEffect(() => {
    if (loading) return;
    bankingTxScrollRef.current?.scrollTo(0, 0);
  }, [loading, bankingTxPage]);

  const bankingTxTotalPages = useMemo(
    () => Math.max(1, Math.ceil(bankingTxTotal / BANKING_TX_PAGE_SIZE)),
    [bankingTxTotal],
  );

  const goBankingTxPage = useCallback(
    async (nextPage: number) => {
      if (nextPage < 1 || nextPage > bankingTxTotalPages) return;
      const scope = movementTab;
      const pageKey = bankingTabCacheKey(
        scope,
        filterAccountIds,
        effectiveBankingMovementDateRange.from,
        effectiveBankingMovementDateRange.to,
        filterSnapshot,
      );
      bankingTxPageFetchAbortRef.current?.abort();
      const ac = new AbortController();
      bankingTxPageFetchAbortRef.current = ac;
      setLoading(true);
      try {
        const txList = await loadBankingTransactionsFromNetwork(nextPage, scope, ac.signal);
        if (bankingViewKeyRef.current !== pageKey || ac.signal.aborted) return;
        setItems(txList.items);
        setBankingTxTotal(txList.total);
        setBankingTxPage(txList.page);
        const prev = tabTxCacheRef.current.get(pageKey);
        bankingTabCachePut(tabTxCacheRef.current, pageKey, {
          items: txList.items,
          total: txList.total,
          page: txList.page,
          sharedUnsettledGroups: prev?.sharedUnsettledGroups ?? [],
          provisionPendingGroups: prev?.provisionPendingGroups ?? [],
        });
      } catch (e) {
        if (!isAbortError(e)) console.error(e);
      } finally {
        if (bankingTxPageFetchAbortRef.current === ac && bankingViewKeyRef.current === pageKey) {
          setLoading(false);
        }
      }
    },
    [
      effectiveBankingMovementDateRange.from,
      effectiveBankingMovementDateRange.to,
      bankingTxTotalPages,
      filterAccountIds,
      filterSnapshot,
      loadBankingTransactionsFromNetwork,
      movementTab,
    ],
  );

  const toggleBankingTxColumn = useCallback((key: BankingTxColumnKey) => {
    if (isBankingTxColumnRequired(key)) return;
    setColumnVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const resetBankingTxColumns = useCallback(() => {
    setColumnOrder([...DEFAULT_BANKING_TX_COLUMN_ORDER]);
    setColumnVisibility({ ...DEFAULT_BANKING_TX_COLUMN_VISIBILITY });
    setColumnPickerOpen(false);
  }, []);

  const handleBankingTxColumnDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((prev) => {
      const ids = prev.map((k) => bankingTxSortableColumnId(k));
      const oldIndex = ids.indexOf(active.id);
      const newIndex = ids.indexOf(over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  /** Para nuevos movimientos solo categorías/sub activas; al editar se incluye la opción actual aunque esté desactivada. Las categorías `internal_reserved` solo se muestran al editar un movimiento que ya las usa. */
  const categoryOptions = useMemo(() => {
    if (editing) {
      return categories.filter((c) => {
        if (c.internal_reserved) return c.id === editing.category_id;
        return (c.enabled ?? true) || c.id === editing.category_id;
      });
    }
    return categories.filter((c) => !c.internal_reserved && (c.enabled ?? true));
  }, [categories, editing]);

  const selectedCategory = useMemo(
    () => (categoryId === "" ? undefined : categoryOptions.find((c) => c.id === categoryId)),
    [categoryOptions, categoryId],
  );

  const accountOptions = useMemo(() => {
    if (editing) {
      return accounts.filter((a) => (a.enabled ?? true) || a.id === editing.account_id);
    }
    return accounts.filter((a) => a.enabled ?? true);
  }, [accounts, editing]);

  const hasVisibleAccount = useMemo(() => accounts.some((a) => a.enabled ?? true), [accounts]);

  const selectedAccount = useMemo(
    () => (accountId === "" ? undefined : accounts.find((a) => a.id === accountId)),
    [accounts, accountId],
  );
  const isCreditCardAccount = selectedAccount?.product_type === "tarjeta_credito";

  const isEditingProvision = useMemo(
    () =>
      Boolean(
        editing &&
          !editing.is_provision_reversal &&
          selectedCategory?.template_cat_id === BANKING_TEMPLATE_CAT_PROVISIONES,
      ),
    [editing, selectedCategory?.template_cat_id],
  );

  const amountPerPersonLabel = useMemo(() => {
    const amt = parseChileanAmountInput(amount);
    const n = parseInt(splitParticipants, 10);
    if (!isShared || Number.isNaN(amt) || Number.isNaN(n) || n < 1) return "—";
    const per = Math.abs(amt) / n;
    return formatBankingClpSigned(per);
  }, [amount, splitParticipants, isShared]);

  const accountingYmParts = useMemo(() => parseAccountingYm(accountingMonthYm), [accountingMonthYm]);

  const subOptions = useMemo(() => {
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return [];
    const subs = [...cat.subcategories].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id,
    );
    if (editing) {
      return subs.filter((s) => (s.enabled ?? true) || s.id === editing.subcategory_id);
    }
    return subs.filter((s) => s.enabled ?? true);
  }, [categories, categoryId, editing]);

  const selectedSubcategoryRow = useMemo(() => {
    if (subcategoryId === "" || subOptions.length === 0) return undefined;
    return subOptions.find((s) => s.id === subcategoryId);
  }, [subOptions, subcategoryId]);

  const categoryOptionsFiltered = useMemo(
    () => categoryOptions.filter((c) => bankingPickerSearchMatches(c.name, categoryPickerSearch)),
    [categoryOptions, categoryPickerSearch],
  );

  const subOptionsFiltered = useMemo(
    () => subOptions.filter((s) => bankingPickerSearchMatches(s.name, subcategoryPickerSearch)),
    [subOptions, subcategoryPickerSearch],
  );

  const isOwnAccountsTransfer = useMemo(() => {
    const c = selectedCategory;
    const s = selectedSubcategoryRow;
    if (!c || !s) return false;
    const tc = c.template_cat_id ?? null;
    const ts = s.template_sub_id ?? null;
    if (tc === BANKING_TEMPLATE_CAT_TRANSFERENCIA && ts === BANKING_TEMPLATE_SUB_ENTRE_CUENTAS_PROPIAS) {
      return true;
    }
    return c.name.trim() === "Transferencia" && s.name.trim() === "Entre cuentas propias";
  }, [selectedCategory, selectedSubcategoryRow]);

  const transferDestinationOptions = useMemo(() => {
    return accounts.filter(
      (a) =>
        (a.enabled ?? true) &&
        a.product_type !== "tarjeta_credito" &&
        (accountId === "" || a.id !== accountId),
    );
  }, [accounts, accountId]);

  const orderedVisibleBankingTxColumns = useMemo(
    () => columnOrder.filter((k) => columnVisibility[k]),
    [columnOrder, columnVisibility],
  );

  const bankingCcPendingVisibleColumns = useMemo(
    () => orderedVisibleBankingTxColumns.filter((k) => !BANKING_CC_PENDING_EXCLUDED_COLUMNS.has(k)),
    [orderedVisibleBankingTxColumns],
  );

  const bankingTableMinWidthPx = useMemo(
    () => Math.max(440, orderedVisibleBankingTxColumns.length * 88 + 128),
    [orderedVisibleBankingTxColumns],
  );

  /** Ancho mínimo tabla pendientes TC (checkbox + columnas + Pagado + acciones). */
  const pendingCcTableMinWidthPx = useMemo(
    () => Math.max(440, bankingCcPendingVisibleColumns.length * 88 + 128 + 84 + 44),
    [bankingCcPendingVisibleColumns],
  );

  /** + columna checkbox (pendientes compartidos). */
  const pendingSharedTableMinWidthPx = useMemo(
    () => Math.max(480, bankingCcPendingVisibleColumns.length * 88 + 128 + 84 + 44),
    [bankingCcPendingVisibleColumns],
  );

  /** Pendientes compartidos en todas las cuentas (para totales globales de selección). */
  const sharedPendingAllRows = useMemo(
    () => sharedUnsettledGroups.flatMap((g) => g.items),
    [sharedUnsettledGroups],
  );

  /** Suma de todos los pendientes marcados en la vista compartido, sin importar la cuenta. */
  const sharedSelectionGlobalTotals = useMemo(() => {
    let totalAbs = 0;
    let sumPerPerson = 0;
    let count = 0;
    for (const row of sharedPendingAllRows) {
      if (!selectedSharedIds.has(row.id)) continue;
      totalAbs += Math.abs(row.amount);
      sumPerPerson += sharedPendingPerPersonClp(row);
      count += 1;
    }
    return { totalAbs, sumPerPerson, count };
  }, [sharedPendingAllRows, selectedSharedIds]);

  /** Provisiones pendientes de reversar en todas las cuentas (totales globales de selección). */
  const provisionPendingAllRows = useMemo(
    () => provisionPendingGroups.flatMap((g) => g.items),
    [provisionPendingGroups],
  );

  /** Suma con signo de los pendientes marcados en la vista Provisiones, sin importar la cuenta. */
  const provisionSelectionGlobalTotals = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const row of provisionPendingAllRows) {
      if (!selectedProvisionReverseIds.has(row.id)) continue;
      sum += row.amount;
      count += 1;
    }
    return { sum, count };
  }, [provisionPendingAllRows, selectedProvisionReverseIds]);

  const filterAccountsSorted = useMemo(() => {
    return [...accounts].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [accounts]);

  const [balanceCardOrderIds, setBalanceCardOrderIds] = useState<number[]>(loadBalanceCardOrder);

  /** Cuentas no TC con saldos; orden persistido en localStorage y reordenable por arrastre. */
  const bankingNonCreditBalances = useMemo(() => {
    const rows = bankingNonCreditAccounts(accounts);
    const mergedIds = mergeBalanceCardOrder(balanceCardOrderIds, rows);
    const byId = new Map(rows.map((r) => [r.id, r]));
    return mergedIds.map((id) => byId.get(id)).filter((x): x is BankingAccountRow => x != null);
  }, [accounts, balanceCardOrderIds]);

  /** Solo cuentas marcadas para sumar en la tarjeta Total (Configuración → Productos). */
  const bankingNonCreditBalancesForTotal = useMemo(
    () => bankingNonCreditBalances.filter(bankingAccountIncludedInTotalBalance),
    [bankingNonCreditBalances],
  );

  const totalLinkedUnpaidForTotalCard = useMemo(() => {
    const includedCheckingIds = new Set(bankingNonCreditBalancesForTotal.map((a) => a.id));
    let s = 0;
    for (const g of ccUnpaidGroups) {
      const tc = accounts.find((x) => x.id === g.account_id);
      if (!tc || tc.product_type !== "tarjeta_credito") continue;
      const lid = tc.linked_checking_account_id;
      if (lid == null || !includedCheckingIds.has(lid)) continue;
      s += sumUnpaidTcDebtFromItems(g.items);
    }
    return s;
  }, [accounts, ccUnpaidGroups, bankingNonCreditBalancesForTotal]);

  const { byCheckingId: ccUnpaidByCheckingId } = useMemo(
    () => creditCardUnpaidAllocatedByChecking(accounts, ccUnpaidGroups),
    [accounts, ccUnpaidGroups],
  );

  useEffect(() => {
    const rows = bankingNonCreditAccounts(accounts);
    setBalanceCardOrderIds((prev) => {
      const merged = mergeBalanceCardOrder(prev, rows);
      const same =
        merged.length === prev.length && merged.every((id, i) => id === prev[i]);
      return same ? prev : merged;
    });
  }, [accounts]);

  useEffect(() => {
    saveBalanceCardOrder(balanceCardOrderIds);
  }, [balanceCardOrderIds]);

  const handleBalanceCardDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const toNum = (id: UniqueIdentifier) =>
      typeof id === "number" ? id : typeof id === "string" ? Number.parseInt(id, 10) : NaN;
    const activeId = toNum(active.id);
    const overId = toNum(over.id);
    if (!Number.isFinite(activeId) || !Number.isFinite(overId)) return;
    setBalanceCardOrderIds((ids) => {
      const oldIndex = ids.indexOf(activeId);
      const newIndex = ids.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) return ids;
      return arrayMove(ids, oldIndex, newIndex);
    });
  }, []);

  const filterCategoriesSorted = useMemo(() => {
    return [...categories]
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }, [categories]);

  const filterSubcategoryDropdownRows = useMemo(() => {
    const rows: { id: number; label: string; categoryId: number; categoryColor: string }[] = [];
    for (const c of categories) {
      for (const s of c.subcategories) {
        rows.push({
          id: s.id,
          categoryId: c.id,
          categoryColor: c.color,
          label: `${c.name} › ${s.name}`,
        });
      }
    }
    rows.sort((a, b) => a.label.localeCompare(b.label, "es"));
    if (filterCategoryIds.length === 0) return rows;
    const allow = new Set(filterCategoryIds);
    return rows.filter((r) => allow.has(r.categoryId));
  }, [categories, filterCategoryIds]);

  const filteredBankingTxItems = useMemo(() => {
    const parseAmt = (s: string) => {
      const n = parseChileanAmountInput(s);
      return Number.isFinite(n) ? n : NaN;
    };
    const descQ = filterDescription.trim().toLowerCase();

    return items.filter((row) => {
      const fecha = row.fecha.slice(0, 10);
      if (filterDateFrom && fecha < filterDateFrom) return false;
      if (filterDateTo && fecha > filterDateTo) return false;

      if (descQ && !(row.description ?? "").toLowerCase().includes(descQ)) return false;

      if (filterAccountIds.length > 0 && !filterAccountIds.includes(row.account_id)) return false;

      if (filterCategoryIds.length > 0 && !filterCategoryIds.includes(row.category_id)) return false;
      if (filterSubcategoryIds.length > 0 && !filterSubcategoryIds.includes(row.subcategory_id)) return false;

      if (filterAmountMin.trim()) {
        const mn = parseAmt(filterAmountMin);
        if (!Number.isNaN(mn) && row.amount < mn) return false;
      }
      if (filterAmountMax.trim()) {
        const mx = parseAmt(filterAmountMax);
        if (!Number.isNaN(mx) && row.amount > mx) return false;
      }

      if (filterSharedScopes.length > 0) {
        const ok = filterSharedScopes.some((scope) => {
          if (scope === "personal") return !row.is_shared;
          if (scope === "shared_any") return row.is_shared;
          return false;
        });
        if (!ok) return false;
      }

      if (filterLiquidadoValues.length > 0) {
        const matchesLiq = (v: BankingTxLiquidadoOption) => {
          if (v === "yes") return row.is_shared && row.shared_expense_settled;
          if (v === "no") return row.is_shared && !row.shared_expense_settled;
          if (v === "na") return !row.is_shared;
          return false;
        };
        if (!filterLiquidadoValues.some(matchesLiq)) return false;
      }

      if (filterTcPaidValues.length > 0) {
        const matchesTc = (v: BankingTxTcPaidOption) => {
          if (v === "paid") return row.credit_card_charge_paid === true;
          if (v === "unpaid") return row.credit_card_charge_paid === false;
          if (v === "na") return row.credit_card_charge_paid == null;
          return false;
        };
        if (!filterTcPaidValues.some(matchesTc)) return false;
      }

      if (filterAccountingMonthYms.length > 0) {
        const rowYm = row.accounting_month ? row.accounting_month.slice(0, 7) : row.fecha.slice(0, 7);
        if (!filterAccountingMonthYms.includes(rowYm)) return false;
      }

      return true;
    });
  }, [
    items,
    filterDateFrom,
    filterDateTo,
    filterDescription,
    filterAccountIds,
    filterAmountMin,
    filterAmountMax,
    filterCategoryIds,
    filterSubcategoryIds,
    filterSharedScopes,
    filterLiquidadoValues,
    filterTcPaidValues,
    filterAccountingMonthYms,
  ]);

  useEffect(() => {
    if (filteredBankingTxItems.length === 0) {
      setHeaderFilterOpen(null);
    }
  }, [filteredBankingTxItems.length]);

  const bankingTxFiltersActive = useMemo(() => {
    return (
      filterDateFrom !== "" ||
      filterDateTo !== "" ||
      filterDescription.trim() !== "" ||
      filterAccountIds.length > 0 ||
      filterAmountMin.trim() !== "" ||
      filterAmountMax.trim() !== "" ||
      filterCategoryIds.length > 0 ||
      filterSubcategoryIds.length > 0 ||
      filterSharedScopes.length > 0 ||
      filterLiquidadoValues.length > 0 ||
      filterTcPaidValues.length > 0 ||
      filterAccountingMonthYms.length > 0
    );
  }, [
    filterDateFrom,
    filterDateTo,
    filterDescription,
    filterAccountIds,
    filterAmountMin,
    filterAmountMax,
    filterCategoryIds,
    filterSubcategoryIds,
    filterSharedScopes,
    filterLiquidadoValues,
    filterTcPaidValues,
    filterAccountingMonthYms,
  ]);

  const bankingTxFilterUICtxValue = useMemo(
    (): BankingTxFilterUICtxValue => ({
      headerFilterOpen,
      toggleHeaderFilter,
      registerHeaderCellRef,
      isColumnFilterActive,
      filterDateFrom,
      setFilterDateFrom,
      filterDateTo,
      setFilterDateTo,
      filterDescription,
      setFilterDescription,
      filterAccountIds,
      setFilterAccountIds,
      filterAmountMin,
      setFilterAmountMin,
      filterAmountMax,
      setFilterAmountMax,
      filterCategoryIds,
      setFilterCategoryIds,
      filterSubcategoryIds,
      setFilterSubcategoryIds,
      filterSharedScopes,
      setFilterSharedScopes,
      filterLiquidadoValues,
      setFilterLiquidadoValues,
      filterTcPaidValues,
      setFilterTcPaidValues,
      filterAccountingMonthYms,
      setFilterAccountingMonthYms,
      filterAccountsSorted,
      filterCategoriesSorted,
      filterSubcategoryDropdownRows,
    }),
    [
      headerFilterOpen,
      toggleHeaderFilter,
      registerHeaderCellRef,
      isColumnFilterActive,
      filterDateFrom,
      filterDateTo,
      filterDescription,
      filterAccountIds,
      filterAmountMin,
      filterAmountMax,
      filterCategoryIds,
      filterSubcategoryIds,
      filterSharedScopes,
      filterLiquidadoValues,
      filterTcPaidValues,
      filterAccountingMonthYms,
      filterAccountsSorted,
      filterCategoriesSorted,
      filterSubcategoryDropdownRows,
    ],
  );

  const clearBankingTxFilters = useCallback(() => {
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterDescription("");
    setFilterAccountIds([]);
    setFilterAmountMin("");
    setFilterAmountMax("");
    setFilterCategoryIds([]);
    setFilterSubcategoryIds([]);
    setFilterSharedScopes([]);
    setFilterLiquidadoValues([]);
    setFilterTcPaidValues([]);
    setFilterAccountingMonthYms([]);
    setHeaderFilterOpen(null);
  }, []);

  const closeMovementModal = useCallback(() => {
    setModalOpen(false);
    setEditing(null);
    setScopeMenuOpen(false);
    setCategoryMenuOpen(false);
    setSubcategoryMenuOpen(false);
    setCategoryPickerSearch("");
    setSubcategoryPickerSearch("");
    setAccountingPickMode(null);
    setProvisionReversalOnSave(false);
  }, []);

  function openNew() {
    setEditing(null);
    const vis = accounts.filter((a) => a.enabled ?? true);
    setAccountId(vis[0]?.id ?? "");
    const today = localDateISOString();
    setFecha(today);
    setAccountingMonthYm(localYearMonthString());
    setAmount("");
    setDescription("");
    setIsShared(false);
    setSplitParticipants("2");
    setSharedExpenseSettled(false);
    setCreditCardChargePaid(false);
    const enabledCats = categories.filter((c) => !c.internal_reserved && (c.enabled ?? true));
    const firstCat = enabledCats[0];
    setCategoryId(firstCat?.id ?? "");
    const subs = [...(firstCat?.subcategories ?? [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id)
      .filter((s) => s.enabled ?? true);
    setSubcategoryId(subs[0]?.id ?? "");
    setTransferDestinationAccountId("");
    setScopeMenuOpen(false);
    setCategoryMenuOpen(false);
    setSubcategoryMenuOpen(false);
    setCategoryPickerSearch("");
    setSubcategoryPickerSearch("");
    setAccountingPickMode(null);
    setProvisionReversalOnSave(false);
    setModalOpen(true);
  }

  function openEdit(row: BankingTransactionRow) {
    setEditing(row);
    setAccountId(row.account_id);
    setFecha(row.fecha.slice(0, 10));
    setAccountingMonthYm(monthInputFromRow(row));
    setAmount(String(row.amount));
    setDescription(row.description ?? "");
    setCategoryId(row.category_id);
    setSubcategoryId(row.subcategory_id);
    setIsShared(row.is_shared ?? false);
    setSplitParticipants(String(row.split_participants ?? 2));
    setSharedExpenseSettled(row.shared_expense_settled ?? false);
    setCreditCardChargePaid(row.credit_card_charge_paid ?? false);
    setTransferDestinationAccountId("");
    setScopeMenuOpen(false);
    setCategoryMenuOpen(false);
    setSubcategoryMenuOpen(false);
    setCategoryPickerSearch("");
    setSubcategoryPickerSearch("");
    setAccountingPickMode(null);
    setProvisionReversalOnSave(false);
    setModalOpen(true);
  }

  useEffect(() => {
    if (!modalOpen || !editing) return;
    if (!isEditingProvision) {
      setProvisionReversalOnSave(false);
    }
  }, [modalOpen, editing, isEditingProvision]);

  useEffect(() => {
    setSubcategoryPickerSearch("");
    setSubcategoryMenuOpen(false);
  }, [categoryId]);

  useEffect(() => {
    if (!modalOpen || categoryId === "") return;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) return;
    const subs = [...cat.subcategories]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id)
      .filter((s) =>
        editing ? (s.enabled ?? true) || s.id === editing.subcategory_id : s.enabled ?? true,
      );
    if (!subs.some((s) => s.id === subcategoryId)) {
      setSubcategoryId(subs[0]?.id ?? "");
    }
  }, [modalOpen, categoryId, categories, subcategoryId, editing]);

  useEffect(() => {
    if (!modalOpen || editing) return;
    const vis = accounts.filter((a) => a.enabled ?? true);
    if (accountId !== "" && !vis.some((a) => a.id === accountId)) {
      setAccountId(vis[0]?.id ?? "");
    }
  }, [modalOpen, editing, accounts, accountId]);

  async function saveModal() {
    if (accountId === "" || categoryId === "" || subcategoryId === "") {
      onToast("Completa cuenta, categoría y subcategoría");
      return;
    }
    if (!description.trim()) {
      onToast("La descripción es obligatoria");
      return;
    }
    const amt = parseChileanAmountInput(amount);
    if (Number.isNaN(amt) || amt === 0) {
      onToast("El monto debe ser distinto de cero (positivo = ingreso, negativo = egreso)");
      return;
    }
    const participants = parseInt(splitParticipants, 10);
    if (isShared) {
      if (Number.isNaN(participants) || participants < 1) {
        onToast("Indica cuántas personas participan (mínimo 1)");
        return;
      }
    }
    const accountingIso = firstDayIsoFromMonthInput(accountingMonthYm);
    const ccPaid = isCreditCardAccount ? creditCardChargePaid : null;
    if (isOwnAccountsTransfer && !editing) {
      if (transferDestinationAccountId === "") {
        onToast("Selecciona la cuenta destino de la transferencia");
        return;
      }
      if (transferDestinationAccountId === accountId) {
        onToast("La cuenta destino no puede ser la misma que la cuenta de este movimiento");
        return;
      }
    }
    setSaving(true);
    try {
      if (editing) {
        await patchJson<BankingTransactionRow>(`/banking/transactions/${editing.id}`, {
          account_id: accountId,
          fecha,
          amount: amt,
          description: description.trim(),
          category_id: categoryId,
          subcategory_id: subcategoryId,
          is_shared: isShared,
          split_participants: isShared ? participants : undefined,
          shared_expense_settled: isShared ? sharedExpenseSettled : false,
          credit_card_charge_paid: ccPaid,
          accounting_month: accountingIso,
        });
        const catSaving = categories.find((c) => c.id === categoryId);
        const applyProvisionReversal =
          provisionReversalOnSave &&
          catSaving?.template_cat_id === BANKING_TEMPLATE_CAT_PROVISIONES;
        let reversalNote: string | null = null;
        if (applyProvisionReversal) {
          const r = await apiFetch(`/banking/transactions/${editing.id}/reverse-provision`, {
            method: "POST",
          });
          if (!r.ok) {
            let detail = "error desconocido";
            try {
              const j = (await r.json()) as { detail?: unknown };
              if (typeof j.detail === "string") detail = j.detail;
            } catch {
              /* ignore */
            }
            reversalNote = detail;
          }
        }
        if (reversalNote) {
          onToast(`Guardado. La reversa no se pudo crear: ${reversalNote}`);
        } else if (applyProvisionReversal) {
          onToast("Movimiento actualizado y reversa registrada ✅");
        } else {
          onToast("Movimiento actualizado ✅");
        }
      } else {
        await postJson<BankingTransactionRow>("/banking/transactions", {
          account_id: accountId,
          fecha,
          amount: amt,
          description: description.trim(),
          category_id: categoryId,
          subcategory_id: subcategoryId,
          is_shared: isShared,
          split_participants: isShared ? participants : undefined,
          shared_expense_settled: isShared ? sharedExpenseSettled : false,
          credit_card_charge_paid: ccPaid,
          accounting_month: accountingIso,
          ...(isOwnAccountsTransfer && transferDestinationAccountId !== ""
            ? { transfer_destination_account_id: transferDestinationAccountId as number }
            : {}),
        });
        onToast(
          isOwnAccountsTransfer ? "Transferencia registrada en origen y destino ✅" : "Movimiento registrado ✅",
        );
      }
      const wasEditing = editing != null;
      const pageAfterSave = wasEditing ? bankingTxPage : 1;
      closeMovementModal();
      await reloadBankingFull(pageAfterSave);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(row: BankingTransactionRow) {
    const message =
      row.peer_transaction_id && row.cc_payment_mirror === true
        ? "¿Eliminar este pago en cuenta corriente? El cargo en la tarjeta volverá a figurar como no pagado."
        : row.peer_transaction_id
          ? "¿Eliminar esta transferencia entre cuentas? Se eliminarán los dos movimientos enlazados y se ajustarán los saldos."
          : "¿Eliminar este movimiento? El saldo de la cuenta se ajustará.";
    setDeleteConfirm({ row, message });
  }

  async function confirmDeleteRow() {
    if (!deleteConfirm) return;
    const row = deleteConfirm.row;
    setDeleteBusy(true);
    try {
      const r = await apiFetch(`/banking/transactions/${row.id}`, { method: "DELETE" });
      if (!r.ok) {
        onToast("No se pudo eliminar");
        return;
      }
      onToast("Movimiento eliminado");
      setDeleteConfirm(null);
      await reloadBankingFull(bankingTxPage);
    } catch {
      onToast("No se pudo eliminar");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleMarkCcChargePaid(row: BankingTransactionRow) {
    try {
      setMarkingPaidId(row.id);
      await patchJson<BankingTransactionRow>(`/banking/transactions/${row.id}`, {
        credit_card_charge_paid: true,
      });
      onToast(
        row.amount >= 0
          ? "Marcado como pagado en la tarjeta (sin movimiento en cuenta corriente)."
          : "Cargo marcado como pagado; se registró el movimiento en la cuenta corriente. Puedes editarlo ahí para ajustar el monto pagado si hubo devoluciones.",
      );
      await reloadBankingFull(bankingTxPage);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo marcar como pagado");
    } finally {
      setMarkingPaidId(null);
    }
  }

  function toggleSharedRow(id: number) {
    setSelectedSharedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSharedSelectAll(rows: BankingTransactionRow[]) {
    const ids = rows.map((r) => r.id);
    setSelectedSharedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((i) => prev.has(i));
      const next = new Set(prev);
      if (allSelected) for (const i of ids) next.delete(i);
      else for (const i of ids) next.add(i);
      return next;
    });
  }

  async function handleMarkSharedSettled(row: BankingTransactionRow) {
    try {
      setMarkingSharedSettledId(row.id);
      await patchJson<BankingTransactionRow>(`/banking/transactions/${row.id}`, {
        shared_expense_settled: true,
      });
      onToast("Movimiento marcado como liquidado.");
      setSelectedSharedIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      await reloadBankingFull(bankingTxPage);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo marcar como liquidado");
    } finally {
      setMarkingSharedSettledId(null);
    }
  }

  async function handleBulkSharedSettled() {
    if (selectedSharedIds.size === 0) return;
    try {
      setBulkSettlingShared(true);
      const out = await postJson<{ updated: number }>("/banking/transactions/bulk-shared-settled", {
        transaction_ids: [...selectedSharedIds],
      });
      onToast(`${out.updated} movimiento(s) marcado(s) como liquidado(s).`);
      setSelectedSharedIds(new Set());
      await reloadBankingFull(bankingTxPage);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo liquidar la selección");
    } finally {
      setBulkSettlingShared(false);
    }
  }

  function toggleProvisionReverseRow(id: number) {
    setSelectedProvisionReverseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleProvisionReverseSelectAll(rows: BankingTransactionRow[]) {
    const ids = rows.map((r) => r.id);
    setSelectedProvisionReverseIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((i) => prev.has(i));
      const next = new Set(prev);
      if (allSelected) for (const i of ids) next.delete(i);
      else for (const i of ids) next.add(i);
      return next;
    });
  }

  async function handleReverseProvisionOne(row: BankingTransactionRow) {
    try {
      setReversingProvisionId(row.id);
      const r = await apiFetch(`/banking/transactions/${row.id}/reverse-provision`, { method: "POST" });
      if (!r.ok) {
        let msg = "No se pudo crear la reversa";
        try {
          const j = (await r.json()) as { detail?: unknown };
          if (typeof j.detail === "string") msg = j.detail;
        } catch {
          /* ignore */
        }
        onToast(msg);
        return;
      }
      onToast("Reversa de provisión registrada ✅");
      setSelectedProvisionReverseIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      await reloadBankingFull(bankingTxPage);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudo crear la reversa");
    } finally {
      setReversingProvisionId(null);
    }
  }

  async function handleBulkProvisionReverse() {
    if (selectedProvisionReverseIds.size === 0) return;
    try {
      setBulkReversingProvision(true);
      const out = await postJson<{ created: number }>("/banking/transactions/bulk-reverse-provision", {
        transaction_ids: [...selectedProvisionReverseIds],
      });
      onToast(
        out.created > 0
          ? `${out.created} reversa(s) de provisión registrada(s) ✅`
          : "No se registró ninguna reversa (revisa que los movimientos sigan siendo válidos).",
      );
      setSelectedProvisionReverseIds(new Set());
      await reloadBankingFull(bankingTxPage);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "No se pudieron crear las reversas");
    } finally {
      setBulkReversingProvision(false);
    }
  }

  return (
    <div
      className={`banking-theme w-full min-h-[calc(100dvh-3.5rem)] ${
        isDark
          ? "bg-[radial-gradient(ellipse_100%_120%_at_50%_-35%,rgba(251,191,36,0.055),transparent_52%),linear-gradient(to_bottom,#0d0d0d,#070707)] text-zinc-300"
          : "bg-gradient-to-br from-slate-50 via-slate-50 to-slate-100/80 text-slate-800"
      }`}
    >
    <div className="mx-auto w-full max-w-[min(100%,1560px)] space-y-6 px-4 pb-28 pt-4 md:px-10 md:pt-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setBalancePrivacyStrict((s) => !s);
            setBalancePrivacyPeekKey(null);
          }}
          aria-pressed={balancePrivacyStrict}
          title={
            balancePrivacyStrict
              ? "Mostrar montos en todas las tarjetas"
              : "Ocultar montos en todas las tarjetas; mantén pulsado el ojo en una tarjeta para verla temporalmente"
          }
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
            balancePrivacyStrict
              ? "border-teal-400/85 bg-teal-50 text-teal-900 shadow-sm hover:border-teal-500 hover:bg-teal-100 banking-dark:border-teal-700/75 banking-dark:bg-teal-950/35 banking-dark:text-teal-100 banking-dark:hover:border-teal-600 banking-dark:hover:bg-teal-950/55"
              : "border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-amber-200/90 banking-dark:hover:border-amber-900/60 banking-dark:hover:bg-zinc-800"
          }`}
        >
          {balancePrivacyStrict ? <IconEyeOutline className="h-4 w-4 shrink-0" /> : <IconEyeSlashOutline className="h-4 w-4 shrink-0" />}
          {balancePrivacyStrict ? "Mostrar montos" : "Ocultar montos"}
        </button>
        <BankingThemeToggle />
      </div>
      {accounts.length > 0 ? (
        <section aria-labelledby="banking-account-balances-heading">
          <h2
            id="banking-account-balances-heading"
            className="mb-3 text-lg font-semibold text-slate-800 banking-dark:text-zinc-100"
          >
            Saldos cuentas
          </h2>
          <DndContext sensors={columnDndSensors} collisionDetection={closestCenter} onDragEnd={handleBalanceCardDragEnd}>
            <div className="space-y-3 md:space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                {bankingNonCreditBalances.length > 0 ? (
                  <BankingNonCreditTotalBalanceCard
                    liquidAccounts={bankingNonCreditBalancesForTotal}
                    creditCardUnpaidLinkedTotalClp={totalLinkedUnpaidForTotalCard}
                    privacyKey={BANKING_BALANCE_PRIVACY_KEY_TOTAL}
                    strictPrivacy={balancePrivacyStrict}
                    amountsVisible={balanceAmountsVisible(BANKING_BALANCE_PRIVACY_KEY_TOTAL)}
                    onPeekStart={handleBalancePeekStart}
                    onPeekEnd={handleBalancePeekEnd}
                    onToggleCardHidden={toggleBalanceCardHidden}
                  />
                ) : null}
                <BankingSharedUnsettledDebtCard
                  amountClp={bankingDebtTotals.shared_unsettled_clp}
                  privacyKey={BANKING_BALANCE_PRIVACY_KEY_SHARED}
                  strictPrivacy={balancePrivacyStrict}
                  amountsVisible={balanceAmountsVisible(BANKING_BALANCE_PRIVACY_KEY_SHARED)}
                  onPeekStart={handleBalancePeekStart}
                  onPeekEnd={handleBalancePeekEnd}
                  onToggleCardHidden={toggleBalanceCardHidden}
                />
              </div>
              {bankingNonCreditBalances.length > 0 ? (
                <SortableContext
                  items={bankingNonCreditBalances.map((a) => a.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                    {bankingNonCreditBalances.map((a) => {
                      const pk = bankingBalancePrivacyKeyAccount(a.id);
                      return (
                        <SortableBankingBalanceCard
                          key={a.id}
                          account={a}
                          creditCardUnpaidAllocatedClp={ccUnpaidByCheckingId.get(a.id) ?? 0}
                          privacyKey={pk}
                          strictPrivacy={balancePrivacyStrict}
                          amountsVisible={balanceAmountsVisible(pk)}
                          onPeekStart={handleBalancePeekStart}
                          onPeekEnd={handleBalancePeekEnd}
                          onToggleCardHidden={toggleBalanceCardHidden}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              ) : null}
            </div>
          </DndContext>
        </section>
      ) : null}

      <section className={BANKING_MOVEMENTS_SECTION_CLASS} aria-label="Movimientos">
        <div className={BANKING_MOVEMENTS_TAB_BAR_CLASS} role="tablist" aria-label="Tipo de vista">
          <button
            type="button"
            role="tab"
            aria-selected={movementTab === "all"}
            onClick={() => setMovementTab("all")}
            className={movementTab === "all" ? BANKING_MOVEMENTS_TAB_BTN_ACTIVE : BANKING_MOVEMENTS_TAB_BTN_IDLE}
          >
            Movimientos bancarios
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={movementTab === "credit_card"}
            onClick={() => setMovementTab("credit_card")}
            className={
              movementTab === "credit_card" ? BANKING_MOVEMENTS_TAB_BTN_ACTIVE : BANKING_MOVEMENTS_TAB_BTN_IDLE
            }
          >
            Tarjeta de crédito
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={movementTab === "shared"}
            onClick={() => setMovementTab("shared")}
            className={movementTab === "shared" ? BANKING_MOVEMENTS_TAB_BTN_ACTIVE : BANKING_MOVEMENTS_TAB_BTN_IDLE}
          >
            Pago compartido
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={movementTab === "provisiones"}
            onClick={() => setMovementTab("provisiones")}
            className={
              movementTab === "provisiones" ? BANKING_MOVEMENTS_TAB_BTN_ACTIVE : BANKING_MOVEMENTS_TAB_BTN_IDLE
            }
          >
            Provisiones
          </button>
        </div>

        <div className="space-y-5 bg-white p-4 md:p-6 banking-dark:bg-zinc-950 banking-dark:text-zinc-300">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 banking-dark:text-zinc-100">
            {movementTab === "credit_card"
              ? "Tarjeta de crédito"
              : movementTab === "shared"
                ? "Pago compartido"
                : movementTab === "provisiones"
                  ? "Provisiones"
                  : "Movimientos bancarios"}
          </h2>
          {movementTab !== "all" ? (
            <p className="mt-1 text-sm text-slate-600 banking-dark:text-zinc-400">
              {movementTab === "credit_card"
                ? "Cargos y pagos de TC; arriba, cargos pendientes por tarjeta para marcarlos pagados al liquidar."
                : movementTab === "shared"
                  ? "Solo movimientos compartidos; arriba, pendientes de liquidar. Puedes marcar varios a la vez con la casilla y «Marcar como pagados»."
                  : "Solo categoría Provisiones; arriba, pendientes de registrar la reversa contable. La tabla lista todas las provisiones del período."}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div ref={columnPickerWrapRef} className="relative">
            <button
              type="button"
              aria-expanded={columnPickerOpen}
              aria-haspopup="dialog"
              aria-controls="banking-tx-column-picker"
              onClick={() => setColumnPickerOpen((o) => !o)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:hover:border-zinc-500 banking-dark:hover:bg-zinc-800"
            >
              <IconColumns className="h-4 w-4 text-slate-300 banking-dark:text-zinc-500" aria-hidden />
              Columnas
            </button>
            {columnPickerOpen && (
              <div
                id="banking-tx-column-picker"
                role="dialog"
                aria-label="Columnas de la tabla"
                className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[min(calc(100vw-2rem),21rem)] rounded-xl border border-slate-300 bg-white p-3 shadow-xl shadow-slate-300/40 ring-1 ring-slate-300 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:shadow-black/40 banking-dark:ring-zinc-700"
              >
                <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-slate-400 banking-dark:text-zinc-500">
                  Orden y visibilidad
                </p>
                <p className="mb-2 text-[12px] leading-snug text-slate-500 banking-dark:text-zinc-400">
                  Arrastra ⋮⋮ para ordenar. Fecha y Monto no se pueden ocultar.
                </p>
                <DndContext
                  sensors={columnDndSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleBankingTxColumnDragEnd}
                >
                  <SortableContext
                    items={columnOrder.map((k) => bankingTxSortableColumnId(k))}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="max-h-[min(60vh,22rem)] space-y-1 overflow-y-auto pr-1 tx-scroll">
                      {columnOrder.map((key) => (
                        <SortableBankingTxColumnPickerRow
                          key={key}
                          columnKey={key}
                          visible={columnVisibility[key]}
                          requiredCol={isBankingTxColumnRequired(key)}
                          onToggle={() => toggleBankingTxColumn(key)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
                <button
                  type="button"
                  onClick={resetBankingTxColumns}
                  className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 banking-dark:border-zinc-600 banking-dark:text-zinc-400 banking-dark:hover:border-zinc-500 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-100"
                >
                  Restablecer orden y columnas
                </button>
              </div>
            )}
          </div>
          <Link
            to="/banking/settings"
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:hover:border-zinc-500 banking-dark:hover:bg-zinc-800"
          >
            Cuentas
          </Link>
          <button
            type="button"
            disabled={!hasVisibleAccount}
            onClick={openNew}
            className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 banking-dark:border-amber-600/45 banking-dark:bg-amber-600 banking-dark:text-zinc-950 banking-dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] banking-dark:hover:border-amber-500/55 banking-dark:hover:bg-amber-500"
          >
            Nuevo movimiento
          </button>
        </div>
      </div>

      {accounts.length === 0 && !loading && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900/90 banking-dark:border-amber-900/45 banking-dark:bg-amber-950/35 banking-dark:text-amber-100/90">
          Primero crea al menos un producto en{" "}
          <Link
            to="/banking/settings"
            className="font-medium text-teal-700 underline decoration-teal-300 hover:text-teal-800 banking-dark:text-amber-300/95 banking-dark:decoration-amber-900 banking-dark:hover:text-amber-200"
          >
            Cuentas
          </Link>
          .
        </p>
      )}
      {accounts.length > 0 && !hasVisibleAccount && !loading && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900/90 banking-dark:border-amber-900/45 banking-dark:bg-amber-950/35 banking-dark:text-amber-100/90">
          Ningún producto está visible para movimientos. Activa al menos uno en{" "}
          <Link
            to="/banking/settings"
            className="font-medium text-teal-700 underline decoration-teal-300 hover:text-teal-800 banking-dark:text-amber-300/95 banking-dark:decoration-amber-900 banking-dark:hover:text-amber-200"
          >
            Cuentas
          </Link>
          .
        </p>
      )}

      {movementTab === "credit_card" && !loading && ccUnpaidGroups.length > 0 ? (
        <div className="space-y-1">
          {ccUnpaidGroups.map((g) => (
            <BankingCcPendingChargesTable
              key={g.account_id}
              accountId={g.account_id}
              accountHeading={g.account_name}
              rows={g.items}
              orderedVisibleBankingTxColumns={bankingCcPendingVisibleColumns}
              tableMinWidthPx={pendingCcTableMinWidthPx}
              markingPaidId={markingPaidId}
              onMarkPaid={handleMarkCcChargePaid}
              openEdit={openEdit}
              removeRow={removeRow}
            />
          ))}
        </div>
      ) : null}

      {movementTab === "shared" && !loading && sharedSelectionGlobalTotals.count > 0 ? (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm ${BANKING_SELECTION_SUMMARY_TICKET_ACTIVE_CLASS}`}
        >
          <p className="min-w-0 flex-1 leading-snug text-teal-950 banking-dark:text-amber-50">
            <span className="font-semibold text-teal-900 banking-dark:text-amber-100">Selección global (todas las cuentas):</span>{" "}
            <span className="text-teal-800/88 banking-dark:text-amber-200/78">total gasto </span>
            <strong className="tabular-nums text-teal-950 banking-dark:text-amber-50">
              {formatClpDots(sharedSelectionGlobalTotals.totalAbs)}
            </strong>
            <span className="text-teal-800/88 banking-dark:text-amber-200/78"> · suma cuotas por persona </span>
            <strong className="tabular-nums text-teal-950 banking-dark:text-amber-50">
              {formatClpDots(sharedSelectionGlobalTotals.sumPerPerson)}
            </strong>
            <span className="text-teal-700/85 banking-dark:text-amber-300/82"> · {sharedSelectionGlobalTotals.count} movimiento(s)</span>
          </p>
          <button
            type="button"
            onClick={() => setSelectedSharedIds(new Set())}
            className={bankingToolbarGhostBtnClass}
          >
            Limpiar toda la selección
          </button>
        </div>
      ) : null}

      {movementTab === "shared" && !loading && sharedUnsettledGroups.length > 0 ? (
        <div className="space-y-1">
          {sharedUnsettledGroups.map((g) => (
            <BankingSharedPendingChargesTable
              key={g.account_id}
              accountId={g.account_id}
              accountHeading={g.account_name}
              rows={g.items}
              orderedVisibleBankingTxColumns={bankingCcPendingVisibleColumns}
              tableMinWidthPx={pendingSharedTableMinWidthPx}
              markingSettledId={markingSharedSettledId}
              bulkSettling={bulkSettlingShared}
              selectedIds={selectedSharedIds}
              onToggleRow={toggleSharedRow}
              onToggleSelectAll={() => toggleSharedSelectAll(g.items)}
              onBulkSettle={handleBulkSharedSettled}
              onMarkSettled={handleMarkSharedSettled}
              openEdit={openEdit}
              removeRow={removeRow}
            />
          ))}
        </div>
      ) : null}

      {movementTab === "provisiones" && !loading && provisionSelectionGlobalTotals.count > 0 ? (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm ${BANKING_SELECTION_SUMMARY_TICKET_ACTIVE_CLASS}`}
        >
          <p className="min-w-0 flex-1 leading-snug text-teal-950 banking-dark:text-amber-50">
            <span className="font-semibold text-teal-900 banking-dark:text-amber-100">Selección global (todas las cuentas):</span>{" "}
            <span className="text-teal-800/88 banking-dark:text-amber-200/78">suma de movimientos </span>
            <strong className="tabular-nums text-teal-950 banking-dark:text-amber-50">
              {formatBankingClpSigned(provisionSelectionGlobalTotals.sum)}
            </strong>
            <span className="text-teal-700/85 banking-dark:text-amber-300/82"> · {provisionSelectionGlobalTotals.count} movimiento(s)</span>
          </p>
          <button
            type="button"
            onClick={() => setSelectedProvisionReverseIds(new Set())}
            className={bankingToolbarGhostBtnClass}
          >
            Limpiar toda la selección
          </button>
        </div>
      ) : null}

      {movementTab === "provisiones" && !loading && provisionPendingGroups.length > 0 ? (
        <div className="space-y-1">
          {provisionPendingGroups.map((g) => (
            <BankingProvisionPendingTable
              key={g.account_id}
              accountId={g.account_id}
              accountHeading={g.account_name}
              rows={g.items}
              orderedVisibleBankingTxColumns={bankingCcPendingVisibleColumns}
              tableMinWidthPx={pendingCcTableMinWidthPx}
              bulkReversing={bulkReversingProvision}
              reversingId={reversingProvisionId}
              selectedIds={selectedProvisionReverseIds}
              onToggleRow={toggleProvisionReverseRow}
              onToggleSelectAll={() => toggleProvisionReverseSelectAll(g.items)}
              onBulkReverse={handleBulkProvisionReverse}
              onReverseOne={handleReverseProvisionOne}
              openEdit={openEdit}
              removeRow={removeRow}
            />
          ))}
        </div>
      ) : null}

      {loadError ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900 banking-dark:border-rose-900/50 banking-dark:bg-rose-950/40 banking-dark:text-rose-100"
          role="alert"
        >
          <p className="min-w-0 flex-1">
            <span className="font-semibold">No se pudieron cargar los movimientos.</span>{" "}
            <span className="opacity-90">{loadError}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              void reloadBankingFull(bankingTxPage);
            }}
            className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-sm font-semibold text-rose-800 transition hover:bg-rose-100 banking-dark:border-rose-800 banking-dark:bg-zinc-900 banking-dark:text-rose-100 banking-dark:hover:bg-zinc-800"
          >
            Reintentar
          </button>
        </div>
      ) : null}

      <div className={BANKING_MAIN_TX_CARD_CLASS}>
        {loading ? (
          <p className="p-6 text-sm text-slate-400 banking-dark:text-zinc-500">Cargando…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-t-xl border-b border-slate-300 bg-white px-3 py-2.5 banking-dark:border-zinc-700 banking-dark:bg-zinc-950">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 banking-dark:text-zinc-500">
                Fecha movimiento
              </span>
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500 banking-dark:text-zinc-500">Desde</span>
                  <input
                    id="banking-tx-date-from"
                    type="date"
                    value={bankingTxDateFrom}
                    onChange={(e) => setBankingTxDateFrom(e.target.value)}
                    onClick={pickDate}
                    className={bankingToolbarDateInputClass}
                    aria-label="Fecha desde (movimiento)"
                  />
                  <span className="text-xs text-slate-500 banking-dark:text-zinc-500">hasta</span>
                  <input
                    id="banking-tx-date-to"
                    type="date"
                    value={bankingTxDateTo}
                    onChange={(e) => setBankingTxDateTo(e.target.value)}
                    onClick={pickDate}
                    className={bankingToolbarDateInputClass}
                    aria-label="Fecha hasta (movimiento)"
                  />
                </div>
                <div
                  className="relative z-20 flex items-center gap-1 sm:ml-0.5 sm:border-l sm:border-slate-200 sm:pl-2.5 banking-dark:sm:border-zinc-600"
                  id="banking-balance-scope-actual-group"
                >
                  <span
                    className="text-xs font-medium text-slate-600 banking-dark:text-zinc-300"
                    id="banking-balance-scope-actual-label"
                  >
                    Actual
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={bankingBalanceScope === "ledger"}
                    aria-labelledby="banking-balance-scope-actual-label"
                    onClick={() =>
                      setBankingBalanceScope((s) => (s === "ledger" ? "through_current_accounting_month" : "ledger"))
                    }
                    className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-teal-400/40 focus:ring-offset-1 focus:ring-offset-white banking-dark:focus:ring-amber-500/35 banking-dark:focus:ring-offset-zinc-950 ${
                      bankingBalanceScope === "ledger"
                        ? "border-teal-600 bg-teal-500 banking-dark:border-amber-600/90 banking-dark:bg-amber-600"
                        : "border-slate-300 bg-slate-200 banking-dark:border-zinc-600 banking-dark:bg-zinc-700"
                    } `}
                  >
                    <span
                      className={`pointer-events-none absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-slate-900/5 transition-transform banking-dark:ring-white/10 ${
                        bankingBalanceScope === "ledger" ? "translate-x-[1.12rem]" : "translate-x-0"
                      }`}
                    />
                  </button>
                  <BankingBalanceScopeHelpButton />
                </div>
                {tabRefreshing ? <span className="text-[11px] text-slate-500 banking-dark:text-zinc-500">Actualizando…</span> : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/90 px-3 py-2 banking-dark:border-zinc-800 banking-dark:bg-zinc-950/80">
              <p className="text-xs text-slate-600 banking-dark:text-zinc-400">
                Período:{" "}
                <strong className="tabular-nums font-semibold text-slate-800 banking-dark:text-zinc-200">
                  {effectiveBankingMovementDateRange.from}
                </strong>
                {" → "}
                <strong className="tabular-nums font-semibold text-slate-800 banking-dark:text-zinc-200">
                  {effectiveBankingMovementDateRange.to}
                </strong>
              </p>
              <button
                type="button"
                onClick={() => {
                  const r = bankingTxRangeForLastTwoMonths();
                  setBankingTxDateFrom(r.from);
                  setBankingTxDateTo(r.to);
                }}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:hover:bg-zinc-800"
              >
                Últimos 2 meses
              </button>
            </div>
            {loadError && items.length === 0 ? null : items.length === 0 && !bankingTxFiltersActive ? (
              <p className="p-6 text-sm text-slate-400 banking-dark:text-zinc-500">
                No hay movimientos en este período. Amplía el rango Desde / hasta.
              </p>
            ) : (
          <BankingTxFilterUICtx.Provider value={bankingTxFilterUICtxValue}>
            <div className={BANKING_MAIN_TX_TOOLBAR_CLASS}>
              <p className="text-xs text-slate-400 banking-dark:text-zinc-500">
                {bankingTxTotalPages > 1 ? (
                  <>
                    Página{" "}
                    <strong className="tabular-nums text-slate-800 banking-dark:text-zinc-200">{bankingTxPage}</strong>/
                    <strong className="tabular-nums text-slate-800 banking-dark:text-zinc-200">{bankingTxTotalPages}</strong>
                    {" · "}
                  </>
                ) : null}
                <strong className="tabular-nums text-slate-800 banking-dark:text-zinc-200">{bankingTxTotal}</strong> movimientos
                {filteredBankingTxItems.length !== items.length && items.length > 0 ? (
                  <>
                    {" · "}
                    <strong className="tabular-nums text-slate-700 banking-dark:text-zinc-300">{filteredBankingTxItems.length}</strong>
                    {" / "}
                    <strong className="tabular-nums text-slate-800 banking-dark:text-zinc-200">{items.length}</strong>
                    <span className="text-slate-500 banking-dark:text-zinc-500"> en esta página</span>
                  </>
                ) : null}
              </p>
              {tabRefreshing ? (
                <span
                  className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 banking-dark:text-zinc-400"
                  role="status"
                  aria-live="polite"
                >
                  <span
                    className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-slate-400 banking-dark:bg-amber-900/70"
                    aria-hidden
                  />
                  Actualizando datos…
                </span>
              ) : null}
              {bankingTxFiltersActive ? (
                <button
                  type="button"
                  onClick={clearBankingTxFilters}
                  className={bankingToolbarGhostBtnClass}
                >
                  Limpiar filtros
                </button>
              ) : null}
            </div>
            {filteredBankingTxItems.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <p className="text-sm font-medium text-slate-800 banking-dark:text-zinc-200">
                  Ningún resultado con estos filtros
                </p>
                <p className="mt-1 text-xs text-slate-400 banking-dark:text-zinc-500">
                  Ajusta los filtros en los encabezados de la tabla o pulsa «Limpiar filtros». El período Desde / hasta no se modifica.
                </p>
                <button
                  type="button"
                  onClick={clearBankingTxFilters}
                  className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:hover:bg-zinc-800"
                >
                  Limpiar filtros
                </button>
              </div>
            ) : (
              <>
                <div
                  ref={bankingTxScrollRef}
                  className="banking-table-scroll max-h-[min(65vh,560px)] overflow-auto border-t border-slate-300 banking-dark:border-zinc-800"
                >
                  <table
                    className="w-full table-fixed border-collapse text-[12px]"
                    style={{ minWidth: bankingTableMinWidthPx }}
                  >
                    <colgroup>
                      {orderedVisibleBankingTxColumns.map((colKey) => (
                        <col key={colKey} style={{ width: BANKING_TX_COL_WIDTH[colKey] }} />
                      ))}
                      <col style={{ width: "5rem" }} />
                    </colgroup>
                    <thead className={`${BANKING_MAIN_TX_THEAD_CLASS} sticky top-0 z-10`}>
                      <tr>
                        {orderedVisibleBankingTxColumns.map((colKey) => (
                          <BankingTxColumnHeader key={colKey} colKey={colKey} />
                        ))}
                        <th
                          className="px-1.5 py-3 text-center text-[12px] font-semibold uppercase tracking-wide text-slate-600 banking-dark:text-zinc-300 sm:px-2"
                          aria-label="Acciones"
                        />
                      </tr>
                    </thead>
                    <BankingVirtualizedMainTxTableBody
                      scrollRef={bankingTxScrollRef}
                      rows={filteredBankingTxItems}
                      orderedVisibleBankingTxColumns={orderedVisibleBankingTxColumns}
                      openEdit={openEdit}
                      removeRow={removeRow}
                    />
                  </table>
                </div>
                <div className={BANKING_MAIN_TX_FOOTER_CLASS}>
                  <p className="text-[12px] leading-snug text-slate-400 banking-dark:text-zinc-500">
                    Hasta <strong className="text-slate-800 banking-dark:text-zinc-200">{BANKING_TX_PAGE_SIZE}</strong> movimientos por página.
                    {filterAccountIds.length > 0 ? (
                      <span className="text-slate-500 banking-dark:text-zinc-500">
                        {" "}
                        {filterAccountIds.length === 1
                          ? "Cuenta acotada en servidor."
                          : "Cuentas acotadas en servidor."}
                      </span>
                    ) : null}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <button
                      type="button"
                      disabled={loading || bankingTxPage <= 1}
                      onClick={() => void goBankingTxPage(bankingTxPage - 1)}
                      className={bankingToolbarGhostBtnMdClass}
                    >
                      Anterior
                    </button>
                    <span className="text-xs tabular-nums text-slate-600 banking-dark:text-zinc-400">
                      Página <strong className="text-slate-800 banking-dark:text-zinc-200">{bankingTxPage}</strong> /{" "}
                      <strong className="text-slate-800 banking-dark:text-zinc-200">{bankingTxTotalPages}</strong>
                    </span>
                    <button
                      type="button"
                      disabled={loading || bankingTxPage >= bankingTxTotalPages}
                      onClick={() => void goBankingTxPage(bankingTxPage + 1)}
                      className={bankingToolbarGhostBtnMdClass}
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </>
            )}
            {headerFilterOpen && headerFilterPopoverPos
              ? createPortal(
                  <div
                    ref={filterPopoverPanelRef}
                    role="dialog"
                    aria-label={`Filtro: ${BANKING_TX_COLUMN_LABELS[headerFilterOpen]}`}
                    className="banking-theme rounded-xl border border-slate-300 bg-white p-3 shadow-xl shadow-slate-900/10 ring-1 ring-slate-300 banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:shadow-black/40 banking-dark:ring-zinc-700"
                    style={{
                      position: "fixed",
                      top: headerFilterPopoverPos.top,
                      left: headerFilterPopoverPos.left,
                      width: headerFilterPopoverPos.width,
                      zIndex: 95,
                    }}
                  >
                    <div className="max-h-[min(70vh,420px)] overflow-y-auto pr-1 tx-scroll">
                      <BankingTxHeaderFilterFields colKey={headerFilterOpen} />
                    </div>
                  </div>,
                  document.body,
                )
              : null}
          </BankingTxFilterUICtx.Provider>
            )}
          </>
        )}
      </div>

        </div>
      </section>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-[2px] banking-dark:bg-black/65 banking-dark:backdrop-blur-[3px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="banking-tx-modal-title"
          onClick={(e) => {
            if (e.target !== e.currentTarget || saving) return;
            closeMovementModal();
          }}
        >
          <div className="banking-theme tx-scroll max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-300 bg-white p-6 shadow-2xl shadow-teal-900/10 banking-dark:border-zinc-600 banking-dark:bg-zinc-950 banking-dark:shadow-black/50">
            <h3 id="banking-tx-modal-title" className="text-base font-semibold text-slate-900 banking-dark:text-zinc-100">
              {editing ? "Editar movimiento" : "Nuevo movimiento"}
            </h3>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className={bankingModalFieldLabelClass}>Fecha de la transacción</span>
                <input
                  type="date"
                  value={fecha}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFecha(v);
                    setAccountingMonthYm(v.slice(0, 7));
                  }}
                  onClick={pickDate}
                  className={dateInputClass}
                />
              </label>

              <label className="block">
                <span className={bankingModalFieldLabelClass}>Producto o cuenta</span>
                <select
                  value={accountId === "" ? "" : String(accountId)}
                  onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")}
                  className={bankingModalControlClass}
                >
                  {accountOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={bankingModalFieldLabelClass}>Descripción</span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={bankingModalControlClass}
                  placeholder="Ej. Supermercado, transferencia…"
                  required
                />
              </label>

              <label className="block">
                <span className={bankingModalFieldLabelClass}>Monto (positivo = ingreso, negativo = egreso)</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={bankingModalControlClass}
                  placeholder="Ej. -12000 o -12.000 (miles con punto)"
                  title="Formato Chile: miles con punto (ej. 4.572). Decimales con coma (ej. 1.234,50). También puedes usar sin separadores."
                />
              </label>

              <div ref={categoryMenuRef} className="space-y-1.5">
                <span id="banking-tx-category-label" className={bankingModalFieldLabelClass}>
                  Categoría
                </span>
                <button
                  ref={categoryTriggerRef}
                  type="button"
                  aria-expanded={categoryMenuOpen}
                  aria-haspopup="listbox"
                  aria-labelledby="banking-tx-category-label"
                  disabled={categoryOptions.length === 0}
                  onClick={() => {
                    if (categoryOptions.length === 0) return;
                    setSubcategoryMenuOpen(false);
                    setCategoryMenuOpen((open) => {
                      const next = !open;
                      if (next) setCategoryPickerSearch("");
                      return next;
                    });
                  }}
                  className={bankingModalCategoryTriggerClass}
                >
                  <span
                    className={`min-w-0 flex-1 truncate font-semibold ${selectedCategory ? "text-slate-800 banking-dark:text-zinc-50" : "text-slate-500 banking-dark:text-zinc-400"}`}
                  >
                    {selectedCategory?.name ?? "Selecciona categoría"}
                  </span>
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden
                    className={`h-5 w-5 shrink-0 text-slate-500 transition banking-dark:text-amber-200/75 ${categoryMenuOpen ? "rotate-180" : ""}`}
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.24 4.496a.75.75 0 01-1.08 0l-4.24-4.497a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>

              {categoryId !== "" && (
                <div ref={subcategoryMenuRef} className="space-y-1.5">
                  <span id="banking-tx-subcategory-label" className={bankingModalFieldLabelClass}>
                    Subcategoría
                  </span>
                  <button
                    ref={subcategoryTriggerRef}
                    type="button"
                    aria-expanded={subcategoryMenuOpen}
                    aria-haspopup="listbox"
                    aria-labelledby="banking-tx-subcategory-label"
                    disabled={subOptions.length === 0}
                    onClick={() => {
                      if (subOptions.length === 0) return;
                      setCategoryMenuOpen(false);
                      setSubcategoryMenuOpen((open) => {
                        const next = !open;
                        if (next) setSubcategoryPickerSearch("");
                        return next;
                      });
                    }}
                    className={bankingModalCategoryTriggerClass}
                  >
                    <span
                      className={`min-w-0 flex-1 truncate font-semibold ${selectedSubcategoryRow ? "text-slate-800 banking-dark:text-zinc-50" : "text-slate-500 banking-dark:text-zinc-400"}`}
                    >
                      {selectedSubcategoryRow?.name ?? "Selecciona subcategoría"}
                    </span>
                    <svg
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden
                      className={`h-5 w-5 shrink-0 text-slate-500 transition banking-dark:text-amber-200/75 ${subcategoryMenuOpen ? "rotate-180" : ""}`}
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.24 4.496a.75.75 0 01-1.08 0l-4.24-4.497a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              )}

              {isOwnAccountsTransfer && !editing && (
                <label className="block">
                  <span className={bankingModalFieldLabelClass}>¿A qué producto va la transferencia?</span>
                  <select
                    value={transferDestinationAccountId === "" ? "" : String(transferDestinationAccountId)}
                    onChange={(e) =>
                      setTransferDestinationAccountId(e.target.value ? Number(e.target.value) : "")
                    }
                    className={bankingModalControlClass}
                    disabled={transferDestinationOptions.length === 0}
                  >
                    <option value="">Selecciona cuenta destino…</option>
                    {transferDestinationOptions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <p className={`mt-1.5 ${bankingModalHelperTextClass}`}>
                    No puede ser la cuenta de este movimiento ni una tarjeta de crédito. Se creará un segundo
                    movimiento en la cuenta destino con el monto de signo contrario.
                  </p>
                  {transferDestinationOptions.length === 0 && (
                    <p className="mt-1 text-[12px] text-amber-800/90 banking-dark:text-amber-200/90">
                      No hay otra cuenta disponible. Crea otra cuenta (no tarjeta) en Cuentas.
                    </p>
                  )}
                </label>
              )}

              <div ref={scopeMenuRef} className="relative space-y-1.5">
                <span id="banking-tx-scope-label" className={bankingModalFieldLabelClass}>
                  Tipo de movimiento
                </span>
                <button
                  ref={scopeTriggerRef}
                  type="button"
                  aria-expanded={scopeMenuOpen}
                  aria-haspopup="listbox"
                  aria-labelledby="banking-tx-scope-label"
                  onClick={() => setScopeMenuOpen((o) => !o)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium shadow-sm ring-1 transition focus:outline-none focus:ring-2 ${
                    isShared
                      ? "border-violet-200 bg-violet-100 text-violet-900 ring-violet-200 focus:ring-violet-400/45 banking-dark:border-violet-800/55 banking-dark:bg-violet-950/55 banking-dark:text-violet-200 banking-dark:ring-violet-800/55 banking-dark:focus:ring-violet-600/35"
                      : "border-teal-200 bg-teal-100 text-teal-900 ring-teal-200 focus:ring-teal-400/45 banking-dark:border-teal-800/55 banking-dark:bg-teal-950/50 banking-dark:text-teal-200/95 banking-dark:ring-teal-800/55 banking-dark:focus:ring-teal-600/35"
                  }`}
                >
                  <span>
                    <span className="block text-[13px] font-semibold">
                      {isShared ? "Compartido" : "Personal"}
                    </span>
                    <span
                      className={`mt-0.5 block text-[12px] font-normal ${
                        isShared
                          ? "text-violet-800/90 banking-dark:text-violet-400/90"
                          : "text-teal-800/90 banking-dark:text-teal-400/90"
                      }`}
                    >
                      {isShared
                        ? "Divide el monto entre varias personas"
                        : "Solo aplica a tus finanzas"}
                    </span>
                  </span>
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden
                    className={`h-5 w-5 shrink-0 opacity-75 transition ${
                      isShared
                        ? "text-violet-700 banking-dark:text-violet-300/90"
                        : "text-teal-700 banking-dark:text-teal-300/85"
                    } ${scopeMenuOpen ? "rotate-180" : ""}`}
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.24 4.496a.75.75 0 01-1.08 0l-4.24-4.497a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {isShared && (
                  <div className="space-y-4 border-t border-slate-300 pt-4 banking-dark:border-zinc-700">
                    <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-50/80 banking-dark:border-zinc-600 banking-dark:bg-zinc-900/80">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-slate-300 bg-white banking-dark:border-zinc-700 banking-dark:bg-zinc-900">
                            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 banking-dark:text-zinc-400">
                              Personas
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 banking-dark:text-zinc-400">
                              Monto P/P
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="align-middle banking-dark:bg-zinc-950">
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                value={splitParticipants}
                                onChange={(e) => setSplitParticipants(e.target.value)}
                                className="w-[4.25rem] rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center font-mono text-sm text-slate-800 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 [color-scheme:light] banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:focus:border-amber-600/55 banking-dark:focus:ring-amber-500/15"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-800 banking-dark:text-zinc-200">
                              {amountPerPersonLabel}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <SiNoField
                      label="¿Gasto compartido pagado?"
                      value={sharedExpenseSettled}
                      onChange={setSharedExpenseSettled}
                    />
                  </div>
                )}
              </div>

              {isCreditCardAccount && (
                <SiNoField
                  label="¿Movimiento TC pagado?"
                  value={creditCardChargePaid}
                  onChange={setCreditCardChargePaid}
                />
              )}

              {isEditingProvision && (
                <SiNoField
                  label="Provisión reversada"
                  value={provisionReversalOnSave}
                  onChange={setProvisionReversalOnSave}
                />
              )}

              <div ref={accountingMonthWrapRef} className="block">
                <span id="banking-tx-accounting-month-label" className={bankingModalFieldLabelClass}>
                  Mes contable
                </span>
                <div
                  ref={accountingMonthTriggerRef}
                  role="group"
                  aria-labelledby="banking-tx-accounting-month-label"
                  className="mt-1.5 flex min-h-[42px] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none shadow-sm transition hover:border-slate-300 focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-400/20 [color-scheme:light] banking-dark:border-zinc-600 banking-dark:bg-zinc-900 banking-dark:text-zinc-200 banking-dark:hover:border-zinc-500 banking-dark:focus-within:border-amber-600/55 banking-dark:focus-within:ring-amber-500/15"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 text-left text-slate-800 transition hover:bg-teal-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/60 banking-dark:text-zinc-200 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-amber-100 banking-dark:focus-visible:ring-amber-500/35"
                      aria-label={`Mes: ${ACCOUNTING_MONTH_ABBR_ES[accountingYmParts.m - 1]}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setAccountingPickMode((prev) => (prev === "month" ? null : "month"));
                      }}
                    >
                      {ACCOUNTING_MONTH_ABBR_ES[accountingYmParts.m - 1]}
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-2 py-1 tabular-nums text-slate-800 transition hover:bg-teal-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/60 banking-dark:text-zinc-200 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-amber-100 banking-dark:focus-visible:ring-amber-500/35"
                      aria-label={`Año: ${accountingYmParts.y}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setAccountingPickMode((prev) => (prev === "year" ? null : "year"));
                      }}
                    >
                      {accountingYmParts.y}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-slate-500 outline-none transition hover:bg-teal-50 hover:text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-300/60 banking-dark:text-zinc-400 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-amber-200/90 banking-dark:focus-visible:ring-amber-500/35"
                    aria-label="Elegir mes"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAccountingPickMode((prev) => (prev === "month" ? null : "month"));
                    }}
                  >
                    <IconCalendar className="h-5 w-5" />
                  </button>
                </div>
                <span className={`mt-1 block ${bankingModalHelperTextClass}`}>
                  Por defecto coincide con el mes de la fecha de la transacción (útil para filtros y reportes). Pulsa el
                  mes o el ícono para los meses; pulsa el año para elegir año.
                </span>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => closeMovementModal()}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 banking-dark:border-zinc-600 banking-dark:bg-zinc-800 banking-dark:text-zinc-100 banking-dark:hover:bg-zinc-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={
                  saving ||
                  accountId === "" ||
                  categoryId === "" ||
                  subcategoryId === "" ||
                  subOptions.length === 0 ||
                  (isOwnAccountsTransfer &&
                    !editing &&
                    (transferDestinationAccountId === "" || transferDestinationOptions.length === 0))
                }
                onClick={() => void saveModal()}
                className="rounded-xl border border-teal-400/80 bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:from-teal-600 hover:to-emerald-600 disabled:opacity-40 banking-dark:border-amber-600/45 banking-dark:bg-gradient-to-r banking-dark:from-amber-600 banking-dark:to-amber-500 banking-dark:text-zinc-950 banking-dark:hover:from-amber-500 banking-dark:hover:to-amber-400 banking-dark:hover:border-amber-500/50"
              >
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Registrar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {scopeMenuOpen &&
        scopePanelBox !== null &&
        createPortal(
          <div
            ref={scopePanelRef}
            role="listbox"
            style={{
              position: "fixed",
              top: scopePanelBox.top,
              left: scopePanelBox.left,
              width: scopePanelBox.width,
              zIndex: 9999,
            }}
            className="banking-theme overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl shadow-slate-900/10 ring-1 ring-slate-300 banking-dark:border-amber-900/45 banking-dark:bg-zinc-900 banking-dark:shadow-black/45 banking-dark:ring-amber-950/35"
          >
            <div className="grid gap-2 p-2 sm:grid-cols-2">
              <button
                type="button"
                role="option"
                aria-selected={!isShared}
                className={`rounded-xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-teal-400/50 banking-dark:focus:ring-teal-600/35 ${
                  !isShared
                    ? "border-teal-300 bg-teal-100 ring-2 ring-teal-300 banking-dark:border-teal-800/55 banking-dark:bg-teal-950/50 banking-dark:ring-teal-700/50"
                    : "border-slate-300 bg-white hover:border-teal-200 hover:bg-teal-50/50 banking-dark:border-zinc-600 banking-dark:bg-zinc-950 banking-dark:hover:border-teal-800/45 banking-dark:hover:bg-teal-950/20"
                }`}
                onClick={() => {
                  setIsShared(false);
                  setScopeMenuOpen(false);
                }}
              >
                <span className="block text-sm font-semibold text-teal-900 banking-dark:text-teal-200/95">
                  Personal
                </span>
                <span className="mt-1 block text-[12px] leading-snug text-teal-800/85 banking-dark:text-teal-400/85">
                  Movimiento individual
                </span>
              </button>
              <button
                type="button"
                role="option"
                aria-selected={isShared}
                className={`rounded-xl border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-violet-400/50 banking-dark:focus:ring-violet-600/30 ${
                  isShared
                    ? "border-violet-300 bg-violet-100 ring-2 ring-violet-300 banking-dark:border-violet-800/55 banking-dark:bg-violet-950/55 banking-dark:ring-violet-800/55"
                    : "border-slate-300 bg-white hover:border-violet-200 hover:bg-violet-50/50 banking-dark:border-zinc-600 banking-dark:bg-zinc-950 banking-dark:hover:border-violet-800/45 banking-dark:hover:bg-violet-950/25"
                }`}
                onClick={() => {
                  setIsShared(true);
                  setScopeMenuOpen(false);
                }}
              >
                <span className="block text-sm font-semibold text-violet-900 banking-dark:text-violet-200">
                  Compartido
                </span>
                <span className="mt-1 block text-[12px] leading-snug text-violet-800/85 banking-dark:text-violet-400/85">
                  Reparto entre personas
                </span>
              </button>
            </div>
          </div>,
          document.body,
        )}

      {categoryMenuOpen &&
        categoryPanelBox !== null &&
        createPortal(
          <div
            ref={categoryPanelRef}
            role="listbox"
            aria-labelledby="banking-tx-category-label"
            style={{
              position: "fixed",
              top: categoryPanelBox.top,
              left: categoryPanelBox.left,
              width: categoryPanelBox.width,
              zIndex: 10000,
            }}
            className="banking-theme flex max-h-[min(60vh,24rem)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-300 banking-dark:border-amber-900/45 banking-dark:bg-zinc-900 banking-dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.65)] banking-dark:ring-amber-950/35"
          >
            <div className="shrink-0 border-b border-slate-300 bg-white px-2 pb-2 pt-2 banking-dark:border-amber-900/35 banking-dark:bg-zinc-800">
              <input
                ref={categorySearchInputRef}
                type="search"
                autoComplete="off"
                enterKeyHint="search"
                value={categoryPickerSearch}
                onChange={(e) => setCategoryPickerSearch(e.target.value)}
                placeholder="Buscar categoría…"
                aria-label="Filtrar categorías por texto"
                className={bankingPickerSearchInputClass}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <div className={bankingPickerListScrollClass}>
              {categoryOptionsFiltered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-500 banking-dark:text-zinc-400">
                  Sin coincidencias. Prueba con otras letras o borra el filtro.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5 px-1.5 pb-1.5 pt-0.5 banking-dark:bg-zinc-900/98">
                  {categoryOptionsFiltered.map((c) => {
                    const sel = c.id === categoryId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="option"
                        aria-selected={sel}
                        className={`rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                          sel
                            ? "bg-teal-50 text-teal-900 ring-1 ring-teal-200/80 banking-dark:bg-amber-600/35 banking-dark:text-zinc-50 banking-dark:ring-amber-400/45"
                            : "text-slate-800 hover:bg-slate-50 banking-dark:text-zinc-100 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-50"
                        }`}
                        onClick={() => {
                          setCategoryId(c.id);
                          setCategoryMenuOpen(false);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {subcategoryMenuOpen &&
        subcategoryPanelBox !== null &&
        createPortal(
          <div
            ref={subcategoryPanelRef}
            role="listbox"
            aria-labelledby="banking-tx-subcategory-label"
            style={{
              position: "fixed",
              top: subcategoryPanelBox.top,
              left: subcategoryPanelBox.left,
              width: subcategoryPanelBox.width,
              zIndex: 10002,
            }}
            className="banking-theme flex max-h-[min(60vh,24rem)] flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-300 banking-dark:border-amber-900/45 banking-dark:bg-zinc-900 banking-dark:shadow-[0_24px_48px_-12px_rgba(0,0,0,0.65)] banking-dark:ring-amber-950/35"
          >
            <div className="shrink-0 border-b border-slate-300 bg-white px-2 pb-2 pt-2 banking-dark:border-amber-900/35 banking-dark:bg-zinc-800">
              <input
                ref={subcategorySearchInputRef}
                type="search"
                autoComplete="off"
                enterKeyHint="search"
                value={subcategoryPickerSearch}
                onChange={(e) => setSubcategoryPickerSearch(e.target.value)}
                placeholder="Buscar subcategoría…"
                aria-label="Filtrar subcategorías por texto"
                className={bankingPickerSearchInputClass}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <div className={bankingPickerListScrollClass}>
              {subOptionsFiltered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-500 banking-dark:text-zinc-400">
                  Sin coincidencias. Prueba con otras letras o borra el filtro.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5 px-1.5 pb-1.5 pt-0.5 banking-dark:bg-zinc-900/98">
                  {subOptionsFiltered.map((s) => {
                    const sel = s.id === subcategoryId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="option"
                        aria-selected={sel}
                        className={`rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                          sel
                            ? "bg-teal-50 text-teal-900 ring-1 ring-teal-200/80 banking-dark:bg-amber-600/35 banking-dark:text-zinc-50 banking-dark:ring-amber-400/45"
                            : "text-slate-800 hover:bg-slate-50 banking-dark:text-zinc-100 banking-dark:hover:bg-zinc-800 banking-dark:hover:text-zinc-50"
                        }`}
                        onClick={() => {
                          setSubcategoryId(s.id);
                          setSubcategoryMenuOpen(false);
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {accountingPickMode &&
        accountingMonthPanelBox !== null &&
        createPortal(
          <div
            ref={accountingMonthPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label={accountingPickMode === "month" ? "Elegir mes" : "Elegir año"}
            style={{
              position: "fixed",
              top: accountingMonthPanelBox.top,
              left: accountingMonthPanelBox.left,
              width: accountingMonthPanelBox.width,
              zIndex: 10001,
            }}
            className="banking-theme overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl shadow-slate-900/10 ring-1 ring-slate-300 banking-dark:border-amber-900/45 banking-dark:bg-zinc-900 banking-dark:ring-amber-950/35 banking-dark:shadow-black/45"
          >
            {accountingPickMode === "month" ? (
              <div className="grid grid-cols-3 gap-1 p-2 banking-dark:bg-zinc-950">
                {ACCOUNTING_MONTH_ABBR_ES.map((abbr, idx) => {
                  const mi = idx + 1;
                  const sel = accountingYmParts.m === mi;
                  return (
                    <button
                      key={abbr}
                      type="button"
                      className={`rounded-lg px-2 py-2 text-sm font-medium transition ${
                        sel
                          ? "bg-teal-100 text-teal-900 ring-2 ring-teal-300 banking-dark:bg-amber-600/35 banking-dark:text-zinc-50 banking-dark:ring-amber-400/45"
                          : "text-slate-800 hover:bg-slate-50 banking-dark:text-zinc-100 banking-dark:hover:bg-zinc-800"
                      }`}
                      onClick={() => {
                        setAccountingMonthYm(buildYm(accountingYmParts.y, mi));
                        setAccountingPickMode(null);
                      }}
                    >
                      {abbr}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="tx-scroll max-h-56 overflow-y-auto p-2 banking-dark:bg-zinc-950">
                <div className="grid grid-cols-4 gap-1">
                  {accountingYearRange(accountingYmParts.y).map((yy) => {
                    const sel = yy === accountingYmParts.y;
                    return (
                      <button
                        key={yy}
                        type="button"
                        className={`rounded-lg px-2 py-2 text-sm tabular-nums transition ${
                          sel
                            ? "bg-teal-100 text-teal-900 ring-2 ring-teal-300 banking-dark:bg-amber-600/35 banking-dark:text-zinc-50 banking-dark:ring-amber-400/45"
                            : "text-slate-800 hover:bg-slate-50 banking-dark:text-zinc-100 banking-dark:hover:bg-zinc-800"
                        }`}
                        onClick={() => {
                          setAccountingMonthYm(buildYm(yy, accountingYmParts.m));
                          setAccountingPickMode(null);
                        }}
                      >
                        {yy}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    <BankingConfirmDialog
      open={deleteConfirm != null}
      title="Eliminar movimiento"
      message={deleteConfirm?.message ?? ""}
      confirmLabel="Eliminar"
      cancelLabel="Cancelar"
      busy={deleteBusy}
      onCancel={() => {
        if (!deleteBusy) setDeleteConfirm(null);
      }}
      onConfirm={() => void confirmDeleteRow()}
    />
    </div>
    </div>
  );
}
