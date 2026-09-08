# Analítica de Gasto — Vista General (Release 1 de 3)

## 1. Resumen
Nueva sección **Analítica** dentro del servicio Banking de Zendo Finance. Esta primera entrega (Release 1 de 3) da al usuario una vista general de su comportamiento de gasto: distribución por categoría, top categorías con variación, evolución mensual de ingresos/egresos y balance neto acumulado del mes en curso. Es la base sobre la que se construirán Release 2 (Compromisos: deuda TC + metas de ahorro) y Release 3 (Insights automáticos por umbral), que dependen de los agregados que esta entrega calcula.

## 2. Objetivo de negocio y métrica de éxito
- **Objetivo:** ayudar a los usuarios a controlar y reducir su gasto dándoles visibilidad accionable sobre sus patrones.
- **KPI / métrica:** % de usuarios con servicio `banking` activo que abren la sección Analítica al menos 1 vez por semana.

## 3. Usuario objetivo
- **Persona:** usuario con servicio `banking` activo que ya registra movimientos regularmente en Zendo Finance.
- **Contexto de uso:** dispositivo de escritorio o laptop (web), sesión autenticada, probablemente revisando sus finanzas a fin de mes o al recibir su sueldo.
- **Dependencia implícita:** sin historial de movimientos, esta vista no aporta valor — los estados vacíos deben comunicar esto claramente, no mostrarse rotos.

## 4. Alcance

### Incluye (in scope)
- Distribución de egresos por categoría, mes seleccionable.
- Top 5 categorías de mayor gasto con variación % vs. mes anterior.
- Evolución de ingresos vs. egresos, últimos 6–12 meses.
- Balance neto acumulado del mes en curso.
- Nueva ruta protegida por gate `me.services.banking`.

### No incluye (out of scope)
- Deuda TC, provisiones y metas de ahorro (Release 2).
- Alertas/insights automáticos (Release 3).
- Comparativa año contra año.
- Exportación o compartir de la vista analítica.
- Mobile nativo (el producto es 100% web hoy).
- Machine learning o detección de patrones — Release 3 usará reglas simples por umbral, no ML.

## 5. Plataformas y consideraciones técnicas

| Aspecto | Web (única plataforma) |
|---|---|
| Layout/responsive | Debe funcionar en desktop (uso principal) y adaptarse razonablemente a tablet/mobile web, aunque no es el foco |
| Offline / conectividad | No aplica — requiere conexión, igual que el resto de Banking |
| Permisos (cámara, ubicación, notif.) | No aplica |
| Navegación | Nueva entrada en `AppSidebar.tsx`, visible solo si `me.services.banking` está activo |
| Otros | Debe reutilizar **Recharts** (ya usado en el proyecto) para consistencia técnica; debe respetar `docs/design-colors.md` (paleta salvia/dorado, tokens claro/oscuro, semántica emerald/rose para ingreso/egreso) |

## 6. User Stories

### US-01 — Distribución de gasto por categoría
- **Historia:** Como usuario con Banking activo, quiero ver cómo se distribuye mi gasto por categoría en el mes seleccionado, para identificar rápido en qué se me va la plata.
- **Prioridad:** Must
- **Criterios de aceptación:**
  - [ ] Dado que tengo movimientos de egreso en el mes actual, cuando entro a Analítica, entonces veo un gráfico (dona o barras) con el gasto agrupado por categoría.
  - [ ] Dado que cambio el mes/año seleccionado, cuando se actualiza, entonces el gráfico refleja el nuevo período sin recargar toda la página.
  - [ ] Dado que no tengo movimientos en el período seleccionado, cuando entro a Analítica, entonces veo un estado vacío con mensaje explicativo (no un gráfico roto o en blanco).
  - [ ] Dado que veo el estado vacío, cuando hago clic en el CTA "Ir a Movimientos", entonces soy llevado a la pantalla de Movimientos bancarios existente para registrar mis primeros movimientos.
- **Edge cases / errores a contemplar:**
  - Movimientos sin categoría asignada → agrupar como "Sin categoría".
  - Categorías con gasto = $0 en el período → no se muestran (evitar ruido visual).
  - Transferencias entre cuentas propias del usuario → deben excluirse del cálculo de "gasto" (no son egresos reales); confirmar con el equipo si `BankingTransaction` ya distingue esto.
  - **Pago de tarjeta de crédito** (movimiento desde cuenta corriente/efectivo hacia la cuenta de TC para saldar lo cargado) → también debe excluirse del cálculo de "gasto". El gasto real ya quedó registrado cuando se hizo el cargo original en la TC; contar el pago del total como un egreso adicional duplica el gasto. **Riesgo abierto:** no está confirmado si este movimiento ya se modela como un caso particular de "transferencia entre cuentas propias" (y por lo tanto ya queda cubierto por la regla anterior) o si es un tipo de movimiento distinto que necesita su propia lógica de exclusión — validar con el developer antes de implementar US-01 y US-02.
  - **Nota de diseño (actualizada tras revisión de mockup):** el estado vacío NO debe incluir un botón de "Importar cartola" — esa lógica no existe aún en el producto. El único CTA es "Ir a Movimientos".

### US-02 — Top categorías con variación vs. mes anterior
- **Historia:** Como usuario, quiero ver mis categorías de mayor gasto del mes y cuánto variaron respecto al mes anterior, para detectar tendencias antes de que se conviertan en un problema.
- **Prioridad:** Must
- **Criterios de aceptación:**
  - [ ] Dado que tengo datos del mes actual y el anterior, cuando veo el listado, entonces se muestran hasta 5 categorías ordenadas por monto descendente, cada una con % de variación vs. mes anterior.
  - [ ] Dado que una categoría es nueva este mes (no existía el mes anterior), cuando se calcula la variación, entonces se muestra como "nueva" en vez de un porcentaje engañoso.
  - [ ] Dado que no hay histórico suficiente (usuario nuevo), cuando se muestra el top, entonces se omite la comparación y se indica que aún no hay suficiente historial.
- **Edge cases / errores a contemplar:**
  - Menos de 5 categorías con gasto → mostrar solo las que existen, sin forzar el número.
  - Variación negativa (bajó el gasto) → tratarla como algo positivo visualmente, siguiendo la semántica emerald/rose ya definida.

### US-03 — Evolución mensual de ingresos vs. egresos
- **Historia:** Como usuario, quiero ver la evolución de mis ingresos y egresos en los últimos meses, para entender si mi comportamiento financiero mejora o empeora en el tiempo.
- **Prioridad:** Must
- **Criterios de aceptación:**
  - [ ] Dado que tengo movimientos históricos, cuando entro a Analítica, entonces veo un gráfico de líneas o barras con ingresos y egresos de los últimos 6 meses (idealmente configurable a 12).
  - [ ] Dado que un mes no tiene movimientos, cuando se grafica, entonces se muestra como $0 y no se omite el mes (para no romper la continuidad del eje temporal).
  - [ ] Dado que el usuario tiene menos de 6 meses de historial, cuando se grafica, entonces se muestran solo los meses disponibles.
- **Edge cases / errores a contemplar:**
  - Usuario activó Banking a mitad de mes → ese mes se incluye con los datos parciales que tenga, sin prorratear.

### US-04 — Balance neto acumulado del mes en curso
- **Historia:** Como usuario, quiero ver mi balance neto acumulado del mes en curso, para saber en tiempo real si voy en verde o en rojo.
- **Prioridad:** Should
- **Criterios de aceptación:**
  - [ ] Dado que tengo movimientos en el mes en curso, cuando entro a Analítica, entonces veo una tarjeta con el balance neto (ingresos − egresos) acumulado a la fecha.
  - [ ] Dado que el balance es negativo, cuando se muestra, entonces usa la semántica de color rose ya definida para egreso/negativo (y emerald si es positivo).
  - [ ] Dado que es inicio de mes y aún no hay movimientos, cuando se muestra, entonces el balance parte en $0 sin error visual.

## 7. Requisitos no funcionales
- **Performance:** las agregaciones no deben recalcularse de forma pesada en cada carga. Evaluar si conviene un cache de agregados (similar al patrón `PriceCache`/`PortfolioValueCache` ya usado en inversiones) dado el volumen potencial de movimientos por usuario.
- **Seguridad / privacidad de datos:** mismos guards que el resto de Banking — `require_banking_user` y filtrado estricto por `user_id`; ningún dato cruzado entre usuarios.
- **Accesibilidad:** los gráficos de categorías no deben depender solo del color para diferenciarse (agregar labels o leyenda); verificar contraste en modo claro/oscuro contra `docs/design-colors.md`.
- **Internacionalización:** no aplica — copy en español, moneda única CLP, consistente con el resto del producto.

## 8. Datos y modelos (alto nivel)
- No se requieren modelos nuevos en esta fase: se reutilizan `BankingTransaction`, `BankingCategory` y `BankingSubcategory` existentes.
- Se sugiere un endpoint de agregación nuevo (ej. `GET /banking/analytics/category-summary?month=YYYY-MM` y `GET /banking/analytics/monthly-trend?meses=6|12`) en vez de traer movimientos crudos al frontend y agregarlos ahí — evita problemas de performance ya conocidos en la tabla principal de movimientos.
- **Actualizado tras mockup de Claude Design:** `GET /banking/analytics/monthly-trend` debe devolver, además de la serie mensual de ingresos/egresos, estos campos derivados sobre el rango solicitado (agregados aprobados como parte del alcance de esta entrega, no como scope creep silencioso):
  - `ingreso_promedio`, `egreso_promedio`, `ahorro_promedio` (promedios simples sobre los meses del rango).
  - `mejor_mes`: el mes del rango con mayor balance neto (ingresos − egresos), con su label (ej. "Oct 2026").
- Decisión técnica del developer: si conviene cachear estos agregados o calcularlos on-the-fly, según volumen real de datos.

## 9. Dependencias y riesgos
- **Dependencia de datos históricos:** usuarios nuevos verán vistas vacías o parciales; contemplado en US-01 y US-03, pero debe validarse en QA.
- **Riesgo — archivo caliente:** `banking_service.py` no debe reescribirse para esto. La lógica de agregación debería vivir en un módulo nuevo (ej. `banking_analytics_service.py`), siguiendo el mismo patrón de separación ya usado en `bankingTx*.ts(x)` del frontend.
- **Riesgo — definición de "gasto":** si `BankingTransaction` no distingue ya (a) transferencias internas entre cuentas propias y (b) pagos de tarjeta de crédito, de los egresos reales, esto puede sesgar todos los gráficos de esta entrega — en particular, un pago de TC no excluido duplicaría el gasto que ya se contó cuando se hizo el cargo original. Validar ambos casos con el developer antes de implementar.
- **Dependencia de secuencia:** Release 2 y 3 reutilizan los agregados que esta entrega calcula; cambios en la forma de estos endpoints después de esta fase pueden requerir retrabajo en releases futuras.

## 10. Definición de "Hecho" (Definition of Done)
- [ ] Endpoints de agregación implementados y visibles en `/docs` (OpenAPI)
- [ ] Filtrado por `user_id` verificado — sin leaks entre usuarios
- [ ] Las 4 user stories cumplen sus criterios de aceptación
- [ ] Estados vacíos y edge cases manejados sin errores visuales
- [ ] Diseño visual aprobado (Claude Design), respetando `docs/design-colors.md`
- [ ] `npm run lint` y `npm run build` pasan; `./scripts/verify.sh` pasa
- [ ] Nueva ruta en `App.tsx` con gate `me.services.banking`; entrada en `AppSidebar.tsx`
- [ ] PR abierto contra `main` (no push directo); checks `backend-smoke` y `frontend` en verde

---

## Prompt sugerido para Claude Design

```
Diseña las pantallas de la nueva sección "Analítica" dentro de Banking en Zendo Finance,
una app de finanzas personales en español (moneda CLP).

Debes respetar estrictamente la paleta ya documentada en docs/design-colors.md:
- Acento primario: salvia #8FBFA6 (botones, tabs activos)
- Acento secundario: dorado #C79A56 (detalles decorativos)
- Ingreso/positivo: emerald-600 (claro) / emerald-400 (oscuro)
- Egreso/negativo: rose-600 (claro) / rose-400 (oscuro)
- Tokens de fondo/borde/texto claro y oscuro según la tabla del documento
- La pantalla cuelga de /banking/*, así que usa la variante Tailwind `banking-dark:`
  para el modo oscuro, no `isDark` explícito.

Los gráficos se implementarán con Recharts, así que diseña pensando en tipos de
gráfico compatibles (dona, barras, líneas).

Pantallas a diseñar (Release 1 — Vista General):
1. Distribución de gasto por categoría del mes (gráfico tipo dona o barras) con
   selector de mes/año.
2. Listado de top 5 categorías con mayor gasto, mostrando monto y variación %
   vs. mes anterior (badge de color según suba/baje).
3. Gráfico de evolución de ingresos vs. egresos, últimos 6-12 meses (líneas o
   barras agrupadas).
4. Tarjeta de balance neto acumulado del mes en curso.
5. Estado vacío para cuando el usuario no tiene movimientos suficientes.

Todo en una sola pantalla/scroll, no en tabs separados. Sigue el estilo visual
ya existente en BankingSettingsPage.tsx y Profile.tsx (tarjetas con bordes suaves,
tipografía y espaciado consistentes).
```

## Prompt sugerido para el Developer Agent

```
Implementa Release 1 de la sección "Analítica" dentro del servicio Banking de
Zendo Finance, siguiendo la spec adjunta (docs/spec-analitica-banking-release-1.md).

PASO 0 — Antes de tocar código, compara el diseño contra la spec:
Tienes acceso al proyecto "Zendo Finance — Design System" vía el MCP de Claude
Design. Lee templates/analitica-banking/AnaliticaBanking.dc.html en vivo desde
ahí (no uses una copia exportada si existe una desactualizada en el repo) y
compáralo contra docs/spec-analitica-banking-release-1.md. Dime explícitamente:
- Si el estado vacío todavía muestra el botón "Importar cartola": ese botón
  quedó obsoleto tras la última revisión de la spec. El estado vacío debe
  tener un único CTA: "Ir a Movimientos" (link a /banking/transactions), no
  "Importar cartola" (esa lógica no existe en el producto). Si el diseño no
  refleja esto, avísame antes de implementar — no lo corrijas por tu cuenta
  ni lo implementes tal cual está en el mockup viejo.
- Cualquier otra discrepancia entre el mockup y la spec (campos, textos, o
  los datos derivados nuevos: ingreso/egreso/ahorro promedio y mejor mes).

IMPORTANTE — Frontend: el diseño visual YA está aprobado en Claude Design.
NO diseñes ni inventes estructura de UI nueva: tu trabajo en el frontend es
traducir ese archivo a BankingAnalyticsPage.tsx, respetando exactamente su
estructura, textos, estados (con-datos/vacío, claro/oscuro) e interacciones
(toggles Dona/Barras, 6M/12M, Barras/Líneas) — salvo el ajuste del CTA de
estado vacío señalado arriba. Si algo más no está claro o no calza con la
spec, pregunta antes de asumir.

Antes de codear (backend):
1. Lee AGENTS.md (raíz), backend/AGENTS.md, frontend/AGENTS.md y docs/domain-banking.md.
2. NO reescribas banking_service.py completo — crea un módulo nuevo
   banking_analytics_service.py para la lógica de agregación.
3. Confirma cómo BankingTransaction distingue (o no) transferencias internas y
   pagos de tarjeta de crédito de los egresos reales, antes de implementar los
   cálculos de US-01 y US-02. Un pago de TC no excluido duplica el gasto que
   ya se contó cuando se hizo el cargo original.

Backend:
- Endpoints nuevos bajo /banking/analytics/*, protegidos con BankingUser
  (require_banking_user), filtrados siempre por user_id.
- Ejemplo: GET /banking/analytics/category-summary?month=YYYY-MM,
  GET /banking/analytics/monthly-trend
- Documentar en schemas.py con response_model tipado.

Frontend:
- Nueva página en frontend/src/ (ej. BankingAnalyticsPage.tsx), lazy-loaded
  como el resto de Banking.
- Ruta en App.tsx con gate me.services.banking; entrada en AppSidebar.tsx.
- Usa Recharts para los gráficos, siguiendo el mockup de Claude Design.
- Llamadas solo vía api.ts/auth.ts, nunca fetch crudo.
- Copy en español, tipos compartidos en types.ts.

Implementa las 4 user stories (US-01 a US-04) con todos sus criterios de
aceptación y edge cases documentados en la spec. Maneja estados vacíos
explícitamente — no dejes gráficos rotos si no hay datos.

Al terminar:
1. cd backend && python -c "import main"
2. cd frontend && npm run lint && npm run build
3. ./scripts/verify.sh
4. Abre PR contra main (no push directo) y verifica que backend-smoke y
   frontend pasen en CI antes de pedir review.
```
