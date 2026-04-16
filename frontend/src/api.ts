import { API_BASE } from "./config";
import { authHeaders } from "./auth";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const ah = authHeaders();
  if (ah.Authorization) headers.set("Authorization", ah.Authorization);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init);
  if (r.status === 401) {
    throw new Error("401");
  }
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json() as Promise<T>;
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
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
  return r.json() as Promise<T>;
}
