/** Sin barra final: evita `//auth/...` y redirects raros con el reverse proxy. */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:8000").replace(/\/+$/, "");
