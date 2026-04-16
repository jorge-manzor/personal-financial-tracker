import { Link } from "react-router-dom";

export function NoServicesPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#30363d] bg-[#161b22] text-2xl" aria-hidden>
        ◻️
      </div>
      <h2 className="text-lg font-semibold text-white">No tenés servicios activos</h2>
      <p className="mt-2 text-sm leading-relaxed text-[#8b949e]">
        Activá al menos una funcionalidad en tu perfil para ver contenido aquí. Más adelante podrás sumar otros
        servicios además del portafolio de inversiones.
      </p>
      <Link
        to="/profile"
        className="mt-8 inline-flex items-center justify-center rounded-lg border border-[#30363d] bg-[#21262d] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#30363d]"
      >
        Ir al perfil
      </Link>
    </div>
  );
}
