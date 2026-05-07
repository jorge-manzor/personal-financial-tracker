const STORAGE_KEY = "zendo_finance_token";
const LEGACY_STORAGE_KEY = "monitro_token";

function readTokenFromStorage(): string | null {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v) return v;
  const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy) {
    localStorage.setItem(STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return legacy;
  }
  return null;
}

export function getToken(): string | null {
  return readTokenFromStorage();
}

export function setToken(token: string): void {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

/** Limpia sesión y notifica a la app (p. ej. tras 401). Idempotente. */
export function logoutSession(): void {
  clearToken();
  try {
    window.dispatchEvent(new CustomEvent("zendo:auth-logout"));
  } catch {
    /* no window en tests */
  }
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
