# Login con Google (Épica A — Mejora de Auth)

## 1. Resumen
Se agrega "Continuar con Google" como método de inicio de sesión/registro en Zendo Finance, adicional al email/password actual (no lo reemplaza). El punto crítico de esta entrega no es el flujo de un usuario nuevo — es que los **usuarios actuales**, que ya tienen historial largo de transacciones y usan su correo Gmail como email de cuenta, puedan empezar a usar Google para entrar **sin perder acceso a su cuenta ni duplicar datos**. Esta épica es independiente de la Épica B (recuperación de cuenta), que queda en el backlog.

## 2. Objetivo de negocio y métrica de éxito
- **Objetivo:** reducir fricción de registro/login ofreciendo Google como alternativa, sin poner en riesgo a la base de usuarios actual.
- **KPI / métrica:** que funcione correctamente para los usuarios actuales — en concreto, **cero incidentes de pérdida de acceso, pérdida de historial, o creación de cuentas duplicadas** para usuarios existentes que empiecen a usar Google con el mismo correo de su cuenta actual. Este es el criterio de éxito primario de la entrega, por encima de cualquier métrica de adopción.

## 3. Usuario objetivo
- **Persona A — Usuario nuevo:** se registra por primera vez en Zendo Finance, usando Google en vez de crear una contraseña.
- **Persona B — Usuario existente (foco principal de esta épica):** ya tiene cuenta con email/password, historial largo de transacciones y servicios activos (banking y/o investments), y su email de cuenta coincide con su Gmail actual. Empieza a usar el botón "Continuar con Google" esperando entrar a SU cuenta de siempre.

## 4. Alcance

### Incluye (in scope)
- Botón "Continuar con Google" en login y en registro.
- Flujo OAuth 2.0 estándar con Google.
- **Vinculación automática:** si el email de la cuenta de Google coincide con un email ya registrado en Zendo Finance (y Google confirma que está verificado), se vincula a la cuenta existente — mismo `user_id`, mismo historial, mismos servicios activos.
- Creación de cuenta nueva vía Google cuando el email no existe aún en el sistema.
- Coexistencia: un usuario puede seguir usando email/password aunque también tenga Google vinculado.

### No incluye (out of scope)
- Reemplazo del login email/password (sigue existiendo para todos).
- Recuperación de contraseña / reseteo por email (Épica B, spec separada).
- Otros proveedores de login (Apple, Facebook, etc.).
- Cambiar el email de una cuenta ya existente a través de este flujo.
- Mobile nativo (el producto es 100% web hoy).

## 5. Plataformas y consideraciones técnicas

| Aspecto | Web (única plataforma) |
|---|---|
| Layout/responsive | Botón de Google en las pantallas de login/registro existentes, respetando las guías de marca de Google |
| Offline / conectividad | No aplica — requiere conexión, como el resto del login |
| Permisos (cámara, ubicación, notif.) | No aplica. Scopes de Google limitados a `email` y `profile` — nunca pedir acceso a Gmail, Drive u otros datos |
| Navegación | Login/registro existentes; agregar indicador de método vinculado en `Profile.tsx` |
| Otros | Verificación del `id_token` de Google debe ser **server-side**, nunca confiar en lo que reporta el frontend |

## 6. User Stories

### US-01 — Vinculación automática para usuario existente (CRÍTICA — es el corazón del KPI de esta entrega)
- **Historia:** Como usuario actual con historial de transacciones, quiero iniciar sesión con Google usando el mismo correo de mi cuenta existente, para acceder a mi cuenta sin perder mi historial ni crear una cuenta duplicada.
- **Prioridad:** Must (máxima prioridad de toda la épica)
- **Criterios de aceptación:**
  - [ ] Dado que ya tengo una cuenta con email/password, cuando inicio sesión con Google usando el mismo correo y Google confirma que el email está verificado (`email_verified: true`), entonces el sistema vincula mi identidad de Google a mi cuenta EXISTENTE (mismo `user_id`), sin crear una cuenta nueva.
  - [ ] Dado que mi cuenta ya está vinculada, cuando inicio sesión de nuevo con Google, entonces accedo a la misma cuenta con todo mi historial de transacciones, categorías y servicios activos (banking/investments) intactos.
  - [ ] Dado que tengo cuenta vinculada, cuando quiero entrar, entonces puedo seguir usando también mi email/password original — ambos métodos coexisten para la misma cuenta.
  - [ ] Dado que el email de mi cuenta de Google NO está verificado por Google, cuando intento iniciar sesión, entonces el sistema rechaza la vinculación automática y muestra un mensaje pidiendo verificar el email en Google primero.
- **Edge cases / errores a contemplar:**
  - Coincidencia de email con distintas mayúsculas/minúsculas → normalizar a lowercase antes de comparar.
  - Usuario intenta vincular Google a una cuenta que ya tiene Google vinculado con OTRO email → rechazar con mensaje claro, no sobrescribir.
  - La vinculación debe ser atómica (transacción de base de datos) para evitar condiciones de carrera si el usuario hace doble clic o abre dos pestañas a la vez.
  - Este flujo debe probarse explícitamente con una cuenta que tenga historial real de transacciones antes de considerarse terminado — no basta con probar con una cuenta vacía.

### US-02 — Registro de usuario nuevo vía Google
- **Historia:** Como usuario nuevo, quiero poder registrarme con mi cuenta de Google, para no tener que crear y recordar una contraseña.
- **Prioridad:** Must
- **Criterios de aceptación:**
  - [ ] Dado que no tengo cuenta en Zendo Finance, cuando hago clic en "Continuar con Google" y autorizo el acceso, entonces se crea una cuenta nueva usando el email de mi cuenta Google, sin pedirme contraseña.
  - [ ] Dado que me registro vía Google, cuando completo el flujo, entonces quedo autenticado (JWT emitido) y soy dirigido al flujo normal de onboarding, igual que un registro tradicional.
  - [ ] Dado que cancelo el consentimiento de Google a mitad de camino, cuando vuelvo a la app, entonces veo un mensaje claro de que el registro no se completó, sin dejar una cuenta a medias en la base de datos.
- **Edge cases / errores a contemplar:**
  - El email de Google ya existe pero NO estaba verificado en nuestra base (caso raro) → tratar según la misma lógica de US-01, no crear duplicado.

### US-03 — Login recurrente con Google
- **Historia:** Como usuario que ya vinculó su cuenta con Google, quiero iniciar sesión con un clic, para entrar rápido sin escribir contraseña.
- **Prioridad:** Must
- **Criterios de aceptación:**
  - [ ] Dado que mi cuenta ya está vinculada, cuando hago clic en "Continuar con Google", entonces accedo directo a mi cuenta sin pasos adicionales.
  - [ ] Dado que soy usuario recurrente, cuando inicio sesión, entonces recibo el mismo JWT y comportamiento de sesión que con login tradicional (mismo expiry, mismo almacenamiento en `localStorage` vía `auth.ts`).

### US-04 — Visibilidad del método de acceso en el perfil
- **Historia:** Como usuario, quiero ver en mi perfil qué métodos de acceso tengo activos, para entender cómo puedo entrar a mi cuenta.
- **Prioridad:** Should
- **Criterios de aceptación:**
  - [ ] Dado que tengo cuenta vinculada con Google, cuando entro a mi perfil, entonces veo un indicador "Cuenta vinculada con Google (tu-email@gmail.com)".
  - [ ] Dado que solo tengo email/password, cuando entro a mi perfil, entonces no veo ese indicador.
- **Edge cases / errores a contemplar:**
  - Ofrecer "vincular con Google" desde el perfil para quien ya tiene cuenta y no vinculó en el login queda fuera de esta entrega (Could, evaluar después).

## 7. Requisitos no funcionales
- **Seguridad:** el `id_token` de Google se valida siempre server-side (firma, `audience`/`client_id` correcto, `email_verified`). El `client_secret` de Google nunca vive en el frontend. Nunca loguear tokens ni credenciales, consistente con `docs/invariants.md`.
- **Privacidad:** scopes limitados a `email` y `profile` — no se solicita acceso a Gmail, Drive ni Calendar.
- **Accesibilidad:** el botón de Google debe seguir las guías de marca oficiales de Google (Google Sign-In branding guidelines) y ser operable por teclado.
- **Performance:** no aplica cambio relevante — el flujo OAuth es comparable en latencia al login tradicional.

## 8. Datos y modelos (alto nivel)
- Se extiende el modelo de usuario existente (no se crea modelo nuevo) con campos para: `google_id` (el `sub` del token de Google) y posiblemente permitir `password` nulo para cuentas creadas 100% vía Google.
- Migración idempotente para agregar estas columnas, siguiendo el patrón manual ya usado en el proyecto (no Alembic).
- Validar que ningún flujo existente (ej. cambio de contraseña) asuma que `password` siempre tiene un valor.

## 9. Dependencias y riesgos
- **Dependencia externa:** Google Cloud Console — crear proyecto OAuth 2.0, configurar `client_id`/`client_secret`, y registrar los dominios de redirect autorizados (dev y producción).
- **Riesgo #1 (el más importante de esta entrega):** si la lógica de vinculación por email falla, un usuario actual puede perder acceso a su historial o terminar con una cuenta duplicada. Dado que este es justo el KPI definido, este riesgo debe probarse explícitamente con datos realistas (cuenta de prueba con historial, no una cuenta vacía) antes de pasar a producción.
- **Riesgo — passwords nulos:** si se permite registro 100% vía Google, hay que auditar que ningún endpoint existente rompa al encontrar `password = null`.
- **Riesgo — email no verificado:** mitigado por el AC de US-01, pero depende de que el developer efectivamente valide el claim `email_verified` del token — no asumir que todo email de Google está verificado.

## 10. Definición de "Hecho" (Definition of Done)
- [ ] Google OAuth configurado con `client_id`/`client_secret` en variables de entorno (nunca en código)
- [ ] Verificación server-side del `id_token` (firma, audiencia, `email_verified`)
- [ ] Vinculación automática probada con una cuenta de prueba que YA tenía historial de transacciones — sin pérdida de datos ni duplicados
- [ ] Las 4 user stories cumplen sus criterios de aceptación
- [ ] Botón de Google sigue las guías de marca oficiales
- [ ] Migración idempotente aplicada y verificada
- [ ] `./scripts/verify.sh` pasa, lint y build de frontend en verde
- [ ] PR abierto contra `main`, checks `backend-smoke` y `frontend` en verde

---

## Anexo — Cómo habilitar Google OAuth (tarea del dueño del proyecto, no del Developer)

Esto requiere acceso admin a Google Cloud Console y debes hacerlo tú (o quien tenga esos permisos) antes o en paralelo al desarrollo — el Developer necesita el `Client ID` y `Client Secret` que resultan de este proceso.

1. **Crea el proyecto** en console.cloud.google.com (selector de proyectos, arriba a la izquierda).
2. **Configura la pantalla de consentimiento OAuth** en APIs & Services > OAuth consent screen: tipo "External", nombre de la app, email de soporte y contacto. En Scopes, agrega solo `email` y `profile` — nada más.
3. **Crea las credenciales** en APIs & Services > Credentials > "Create Credentials" > "OAuth client ID", tipo "Web application".
4. **Configura orígenes y redirects autorizados:** agrega tu dominio de producción y el de desarrollo en "Authorized JavaScript origins", y la URL exacta de callback en "Authorized redirect URIs" (coordínala con el Developer antes de guardar, debe coincidir con lo que implemente en el backend).
5. **Guarda el Client ID y Client Secret** de forma segura (gestor de contraseñas o variables de entorno) — nunca en el código ni en git.
6. **Pasa de "Testing" a "Production"** en la pantalla de consentimiento cuando estés listo para que todos tus usuarios (no solo los que agregues como test users) puedan usarlo. Como solo se piden scopes básicos, normalmente no requiere el proceso largo de verificación de Google.


```
Diseña la incorporación del botón "Continuar con Google" en las pantallas de
login y registro existentes de Zendo Finance (no rediseñes las pantallas
completas, solo integra el nuevo elemento).

Respeta las guías de marca oficiales de Google para el botón de Google Sign-In
(no lo reestilices con la paleta salvia/dorado del proyecto — el botón de
Google debe verse como un botón de Google, es un requisito de sus guidelines).

Diseña también un indicador simple en Profile.tsx que muestre "Cuenta
vinculada con Google (email@ejemplo.com)" cuando aplique, siguiendo el estilo
visual ya existente en esa pantalla.

No hay estado "vacío" ni gráficos en esta entrega — es una mejora de flujo de
autenticación, mantenlo simple y consistente con el login actual.
```

## Prompt sugerido para el Developer Agent

```
Implementa la Épica A (Login con Google) siguiendo la spec adjunta
(docs/spec-login-google.md).

PASO 0 — Antes de tocar código:
1. Lee AGENTS.md (raíz), backend/AGENTS.md y docs/invariants.md — presta
   especial atención a las reglas de nunca loguear secretos/tokens.
2. Confirma con Google Cloud Console (o pídeme las credenciales) el client_id
   y client_secret antes de empezar — no los inventes ni los dejes hardcodeados.

ADVERTENCIA CRÍTICA — esto es lo más importante de toda la tarea:
La vinculación automática por email (US-01) es el criterio de éxito de esta
entrega. NO la des por terminada solo probándola con una cuenta vacía o de
prueba recién creada. Antes de marcarla como lista, prueba explícitamente el
flujo completo con una cuenta que tenga historial real de transacciones
(usa un dump de staging o una cuenta de prueba con datos poblados) y confirma
que, tras vincular Google, el usuario conserva TODO su historial, categorías
y servicios activos — cero pérdida de datos, cero duplicados. Si tienes dudas
sobre cómo hacer esta prueba de forma segura, pregúntame antes de proceder.

Backend:
- Extiende el modelo de usuario con google_id (y password nullable si aplica),
  vía migración idempotente (no Alembic).
- Verifica el id_token de Google server-side: firma, audience, email_verified.
- Lógica de matching: normaliza email a lowercase antes de comparar contra
  cuentas existentes.
- Endpoint(s) nuevos para el flujo OAuth (callback/exchange), protegidos según
  corresponda.

Frontend:
- Botón "Continuar con Google" en login y registro, según diseño de Claude
  Design (compáralo contra la spec antes de codear, igual que hicimos con
  Analítica de Banking).
- Indicador de cuenta vinculada en Profile.tsx.
- Llamadas solo vía api.ts/auth.ts.

Al terminar:
1. cd backend && python -c "import main"
2. cd frontend && npm run lint && npm run build
3. ./scripts/verify.sh
4. Antes de abrir PR, confirma conmigo que probaste el escenario de cuenta
   existente con historial real, no solo cuentas nuevas.
5. Abre PR contra main (no push directo), checks backend-smoke y frontend
   en verde.
```
