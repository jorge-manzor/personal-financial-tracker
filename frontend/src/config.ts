/** Sin barra final: evita `//auth/...` y redirects raros con el reverse proxy. */
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:8000").replace(/\/+$/, "");

/** Client ID de Google OAuth (público, va en el HTML del botón). Sin esto, el botón de Google no se muestra. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();
