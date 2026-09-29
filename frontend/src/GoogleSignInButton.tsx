import { useEffect, useRef, useState } from "react";
import { GOOGLE_CLIENT_ID } from "./config";
import { postJson } from "./api";
import { setToken } from "./auth";

// Tipos mínimos de la API global que inyecta https://accounts.google.com/gsi/client.
interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: string;
      theme: string;
      size: string;
      text: string;
      shape: string;
      logo_alignment?: string;
      locale?: string;
      width?: number;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdApi } };
  }
}

/**
 * Botón "Continuar con Google" (Google Identity Services): el script global entrega un
 * `credential` (id_token) directo al frontend, sin exchange server-to-server ni client_secret.
 * El backend valida ese id_token en `/auth/google` (firma, audience, email_verified).
 */
export function GoogleSignInButton({ onSuccess }: { onSuccess: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    async function handleCredential(response: GoogleCredentialResponse) {
      setError(null);
      try {
        const data = await postJson<{ access_token: string }>("/auth/google", {
          credential: response.credential,
        });
        if (cancelled) return;
        setToken(data.access_token);
        onSuccess();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "No se pudo iniciar sesión con Google");
      }
    }

    function tryInit() {
      const gid = window.google?.accounts?.id;
      const el = containerRef.current;
      if (!gid || !el) return false;
      gid.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => void handleCredential(response),
      });
      el.innerHTML = "";
      // "outline" (blanco) evita que el logo "G" multicolor de Google (que trae su propio
      // fondo blanco fijo, parte de las guías de marca) se vea como un recuadro suelto sobre
      // un botón oscuro — con todo el botón blanco, el logo queda integrado de forma natural.
      gid.renderButton(el, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "center",
        locale: "es",
        width: Math.round(el.getBoundingClientRect().width) || 360,
      });
      return true;
    }

    if (tryInit()) return;
    // El script <script src="https://accounts.google.com/gsi/client"> puede cargar después del mount.
    const interval = window.setInterval(() => {
      if (tryInit()) window.clearInterval(interval);
    }, 200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [onSuccess]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <div ref={containerRef} className="w-full" />
      {error && <p className="text-center text-sm text-[#f85149]">{error}</p>}
    </div>
  );
}
