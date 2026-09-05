import { Link } from "react-router-dom";

export function NoServicesPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#30363d] bg-[#161b22]"
        aria-hidden
      >
        <svg viewBox="0 0 100 100" className="h-8 w-8" aria-hidden>
          <path
            d="M70.08,47.01 A27,27 0 1 0 55.41,78.47"
            fill="none"
            stroke="#8FBFA6"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M55.41,78.47 C59.64,76.5 60.57,63.25 63,62 C65.43,60.76 67.5,73 70,71 C72.5,69 75.33,56.17 78,50 C80.67,43.83 83.87,38.27 86,34"
            fill="none"
            stroke="#C79A56"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="86" cy="34" r="7" fill="#C79A56" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-white">No tienes servicios activos</h2>
      <p className="mt-2 text-sm leading-relaxed text-[#8b949e]">
        Activa al menos una funcionalidad en tu perfil para ver contenido aquí. Más adelante podrás sumar otros
        servicios además del portafolio de inversiones.
      </p>
      <Link
        to="/profile#servicios"
        className="mt-8 inline-flex items-center justify-center rounded-lg border border-[#30363d] bg-[#21262d] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#30363d]"
      >
        Ir a servicios
      </Link>
    </div>
  );
}
