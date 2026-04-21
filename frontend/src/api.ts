import { API_BASE } from "./config";
import { authHeaders } from "./auth";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const ah = authHeaders();
  if (ah.Authorization) headers.set("Authorization", ah.Authorization);
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    cache: init?.cache ?? "no-store",
  });
}

async function readJsonBody<T>(r: Response, pathForErrors: string): Promise<T> {
  const text = await r.text();
  const trimmed = text.trim();
  if (!trimmed) {
    if (r.status === 304) {
      throw new Error(
        "Respuesta sin cuerpo (304). Prueba recargar sin caché o revisa el API; si persiste, avísanos.",
      );
    }
    throw new Error(
      `Respuesta vacía del servidor en ${pathForErrors} (${r.status}). Si VITE_API_BASE apunta al sitio estático en lugar del API, corrígelo y vuelve a hacer build.`,
    );
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(
      `Respuesta no JSON en ${pathForErrors} (${r.status}): ${trimmed.slice(0, 160)}${trimmed.length > 160 ? "…" : ""}`,
    );
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (r.status === 401) {
    throw new Error("401");
  }
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return readJsonBody<T>(r, path);
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const r = await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 401) throw new Error("401");
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { detail?: string | { msg: string }[] } | null;
    let msg = `Error ${r.status}`;
    if (j?.detail != null) {
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    }
    throw new Error(msg);
  }
  return readJsonBody<T>(r, path);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.status === 401) throw new Error("401");
  if (!r.ok) {
    const j = (await r.json().catch(() => null)) as { detail?: string | { msg: string }[] } | null;
    let msg = `Error ${r.status}`;
    if (j?.detail != null) {
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    }
    throw new Error(msg);
  }
  return readJsonBody<T>(r, path);
}
