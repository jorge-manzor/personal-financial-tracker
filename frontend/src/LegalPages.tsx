import type { ReactNode } from "react";

const UPDATED_AT = "28 de septiembre de 2026";
const CONTACT_EMAIL = "jmanzors@gmail.com";

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0d1117] px-4 py-12 text-[#c9d1d9]">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <svg viewBox="0 0 100 100" className="h-9 w-9 shrink-0" aria-hidden>
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
          <span className="text-lg font-semibold tracking-tight text-white">
            <span className="text-[#8FBFA6]">Zendo</span> Finance
          </span>
        </div>

        <h1 className="mb-1 text-2xl font-semibold text-white">{title}</h1>
        <p className="mb-8 text-xs text-[#6e7681]">Última actualización: {UPDATED_AT}</p>

        <div className="space-y-6 text-sm leading-relaxed text-[#c9d1d9]">{children}</div>

        <div className="mt-12 border-t border-[#21262d] pt-6 text-xs text-[#6e7681]">
          <a href="/" className="text-[#8FBFA6] hover:underline">
            ← Volver a Zendo Finance
          </a>
        </div>
      </div>
    </div>
  );
}

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-base font-semibold text-white">{children}</h2>;
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Política de Privacidad">
      <section>
        <p>
          Zendo Finance es una aplicación personal de seguimiento financiero (inversiones y cuentas/movimientos
          bancarios en pesos chilenos). Esta política describe qué datos recopilamos, para qué los usamos y qué
          opciones tienes sobre ellos.
        </p>
      </section>

      <section>
        <H2>1. Qué datos recopilamos</H2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-white">Cuenta:</span> tu email y, si te registras con email/contraseña, un hash
            de tu contraseña (nunca la guardamos en texto plano). Si usas &quot;Continuar con Google&quot;,
            guardamos el identificador único (<code>sub</code>) de tu cuenta de Google asociado a tu email — nunca
            tu contraseña de Google.
          </li>
          <li>
            <span className="text-white">Datos financieros que tú ingresas:</span> transacciones de inversión
            manuales, cuentas bancarias, movimientos, categorías y presupuestos que creas dentro de la app.
          </li>
          <li>
            <span className="text-white">Datos de Fintual (opcional):</span> si conectas tu cuenta de Fintual, la
            cookie de sesión que nos entregas para leer tus posiciones y movimientos en tu nombre.
          </li>
          <li>
            <span className="text-white">Datos técnicos mínimos:</span> nada de analítica de terceros ni
            publicidad; no usamos cookies de rastreo.
          </li>
        </ul>
      </section>

      <section>
        <H2>2. Para qué usamos tus datos</H2>
        <p>
          Únicamente para operar la aplicación: mostrarte tu propio dashboard, calcular métricas de tu portafolio
          y tus gastos, y sincronizar con Fintual cuando lo solicitas. No vendemos, compartimos ni usamos tus
          datos con fines publicitarios ni los entregamos a terceros salvo lo estrictamente necesario para el
          funcionamiento del servicio (ver sección 3).
        </p>
      </section>

      <section>
        <H2>3. Con quién se comparte información</H2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <span className="text-white">Google:</span> solo para verificar tu identidad al iniciar sesión con
            &quot;Continuar con Google&quot; (scopes limitados a <code>email</code> y <code>profile</code>).
            Nunca solicitamos acceso a tu Gmail, Drive ni Calendar.
          </li>
          <li>
            <span className="text-white">Fintual:</span> si conectas tu cuenta, usamos tu cookie de sesión
            únicamente para leer (no modificar) tus datos de inversión desde su plataforma.
          </li>
          <li>
            <span className="text-white">CMF Chile:</span> consultamos el tipo de cambio USD/CLP público; no les
            enviamos ningún dato tuyo.
          </li>
        </ul>
      </section>

      <section>
        <H2>4. Dónde se almacenan tus datos</H2>
        <p>
          Tus datos se guardan en una base de datos propia de la aplicación (no en servicios de terceros
          adicionales), protegida con autenticación y con acceso acotado por usuario: nadie más puede ver tus
          transacciones o cuentas.
        </p>
      </section>

      <section>
        <H2>5. Seguridad</H2>
        <p>
          Las contraseñas se almacenan con hash (bcrypt), las sesiones usan tokens JWT, y las credenciales de
          Fintual y los tokens de sesión nunca se registran en logs.
        </p>
      </section>

      <section>
        <H2>6. Tus derechos</H2>
        <p>
          Puedes solicitar en cualquier momento la eliminación de tu cuenta y de todos tus datos escribiendo a{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#8FBFA6] hover:underline">
            {CONTACT_EMAIL}
          </a>
          . Responderemos y eliminaremos la información en un plazo razonable.
        </p>
      </section>

      <section>
        <H2>7. Cambios a esta política</H2>
        <p>
          Si actualizamos esta política, cambiaremos la fecha al inicio de esta página. El uso continuado de la
          aplicación después de un cambio implica tu aceptación de la versión vigente.
        </p>
      </section>

      <section>
        <H2>8. Contacto</H2>
        <p>
          Para cualquier consulta sobre esta política o tus datos, escribe a{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#8FBFA6] hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Términos de Servicio">
      <section>
        <p>
          Al usar Zendo Finance aceptas estos términos. Léelos con atención antes de crear una cuenta.
        </p>
      </section>

      <section>
        <H2>1. Qué es Zendo Finance</H2>
        <p>
          Zendo Finance es una herramienta personal de seguimiento financiero (inversiones y cuentas/movimientos
          bancarios). No es un banco, no es un asesor financiero registrado y no ofrece asesoría de inversión.
          Toda decisión financiera que tomes usando la información mostrada en la app es tu responsabilidad.
        </p>
      </section>

      <section>
        <H2>2. Tu cuenta</H2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Eres responsable de mantener segura tu contraseña y el acceso a tu cuenta de Google vinculada.</li>
          <li>
            Puedes iniciar sesión con email/contraseña o con Google; ambos métodos coexisten para la misma
            cuenta cuando el email coincide.
          </li>
          <li>Eres responsable de la exactitud de los datos financieros que ingresas manualmente.</li>
        </ul>
      </section>

      <section>
        <H2>3. Datos de terceros (Fintual)</H2>
        <p>
          Si conectas tu cuenta de Fintual, autorizas a Zendo Finance a leer tus datos de inversión en tu nombre
          usando la cookie de sesión que tú mismo entregas. Puedes desconectarla en cualquier momento desde tu
          perfil.
        </p>
      </section>

      <section>
        <H2>4. Disponibilidad del servicio</H2>
        <p>
          Este es un proyecto personal/independiente. No garantizamos disponibilidad continua, ausencia de
          errores, ni conservación indefinida de los datos, aunque hacemos nuestro mejor esfuerzo por mantener el
          servicio estable y tus datos seguros.
        </p>
      </section>

      <section>
        <H2>5. Uso aceptable</H2>
        <p>
          No está permitido usar la aplicación para actividades ilegales, intentar acceder a cuentas de otros
          usuarios, ni realizar ingeniería inversa o abuso automatizado del servicio (scraping masivo, ataques,
          etc.).
        </p>
      </section>

      <section>
        <H2>6. Terminación</H2>
        <p>
          Puedes dejar de usar la aplicación y solicitar la eliminación de tu cuenta cuando quieras (ver Política
          de Privacidad). Nos reservamos el derecho de suspender cuentas que incumplan estos términos.
        </p>
      </section>

      <section>
        <H2>7. Cambios</H2>
        <p>
          Podemos actualizar estos términos ocasionalmente; la fecha al inicio de esta página indica la última
          revisión.
        </p>
      </section>

      <section>
        <H2>8. Contacto</H2>
        <p>
          Preguntas sobre estos términos:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#8FBFA6] hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </LegalLayout>
  );
}
