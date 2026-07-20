# Recursio — Plan de implementación

**Fecha:** 2026-07-06 (v2, decisiones incorporadas)
**Estado:** Diseño aprobado con ajustes
**Producto:** **Recursio** — aplicación ad hoc de gestión de nómina vinculada a Presencio

---

## 1. Resumen ejecutivo

Presencio Nómina es una segunda aplicación del ecosistema Presencio que toma las horas fichadas, el personal y las ausencias que ya viven en la base de Presencio y les agrega: legajo digital con documentación, motor de liquidación de sueldos configurable según normativa argentina (LCT + convenios colectivos, arrancando con UOCRA y fuera de convenio), flujos de aprobación de recibos configurables por empresa con participación de usuarios externos (estudio contable), y reportes de pago (CBU por persona) y de aportes/contribuciones al fisco.

**Decisiones ya tomadas con el usuario:**

| Decisión | Elección |
|---|---|
| Infraestructura | Mismo proyecto Supabase que Presencio; frontend separado (app ad hoc) |
| Motor de liquidación | Configurable genérico; convenios cargados como configuración |
| Convenios v1 | UOCRA (ley 22.250) + empleados fuera de convenio (LCT) |
| Usuarios externos | Usuarios del sistema con rol restringido, vinculados a una o varias empresas |
| Fisco | Reporte de aportes por período (sin integración ARCA/LSD en v1) |
| Portal empleado | No en v1; diseño preparado para agregarlo (fase futura) |
| Nombre / subdominio | **Recursio** (`recursio.presencio.app` o dominio propio, a definir en fase 0) |
| Cliente piloto | **Asset Construcciones** (sin estudio contable asociado — ver riesgo 7.7) |
| Periodicidad | UOCRA **quincenal** desde v1; fuera de convenio mensual |
| Reglas condicionales | El motor soporta reglas por concepto (ej. presentismo se pierde con >3 tardanzas o faltas injustificadas) — ver 4.3 |

---

## 2. Arquitectura

### 2.1 Principio: misma base, otro frontend

```
┌──────────────────┐        ┌─────────────────────┐
│  Presencio (app)  │        │ Presencio Nómina    │
│  fichajes, obras, │        │ legajo, liquidación,│
│  personal, ausenc.│        │ recibos, aprobación │
└────────┬─────────┘        └─────────┬───────────┘
         │      mismo proyecto        │
         ▼         Supabase           ▼
┌──────────────────────────────────────────────────┐
│  Postgres + RLS por empresa_id + Auth + Storage  │
│  tablas existentes  +  esquema nuevo `nomina.*`  │
└──────────────────────────────────────────────────┘
```

- **Repo nuevo** (`presencio-nomina`), mismo stack que Presencio: React 19 + Vite, Zustand, react-router-dom, lucide-react, recharts, date-fns, jsPDF, Supabase JS. Deploy en Vercel como subdominio (`nomina.presencio.app` o similar).
- **Mismo login**: Supabase Auth compartido. Un usuario logueado en Presencio entra a Nómina con la misma sesión (mismo dominio de auth). El acceso a la app se controla por rol/permiso, no por cuentas separadas.
- **Sin sincronización**: Nómina **lee** `personal`, `fichajes`, `ausencias`, `obras`, `empresas` directamente (solo lectura, vía RLS). Todo lo que escribe vive en tablas nuevas con prefijo/esquema propio.
- **Look & feel**: se extraen los tokens de diseño de Presencio (colores `color_primario`/`color_secundario` por empresa, tipografía, componentes de modales, tablas y badges) a una convención compartida. v1: copiar los componentes base; fase 2 opcional: paquete interno `@presencio/ui`.

### 2.2 Regla de oro de acoplamiento

Nómina **nunca escribe** en tablas de Presencio. La única excepción diseñada es el estado de lote (ver 5.4) que marca períodos de fichadas como "liquidados" — y eso se hace en una tabla propia (`nom_periodos`) que referencia fichajes por rango de fechas, no modificándolos. Presencio ya tiene bloqueo de lotes (fase 5), que se reutiliza.

### 2.3 Aplicación de las lecciones del code review de Presencio

El REVIEW-presencio.md marcó deudas que este proyecto no repite:

1. **Migraciones versionadas desde el día 1** en `supabase/migrations/` con numeración (no archivos sueltos en la raíz).
2. **Funciones SECURITY DEFINER auditadas**: toda RPC nueva valida `empresa_id` y rol dentro del cuerpo de la función.
3. **Permisos backend = permisos UI**: cada permiso del menú tiene su política RLS o chequeo en RPC equivalente. Nunca solo control de UI.
4. **Datos sensibles**: los datos salariales NO se persisten en localStorage (a diferencia del store actual de Presencio). El store de Nómina no usa `persist` para remuneraciones, CBU ni recibos.

---

## 3. Modelo de datos (tablas nuevas, prefijo `nom_`)

Todas con `empresa_id UUID REFERENCES empresas(id)`, RLS `empresa_id = auth_empresa_id()` (mismo patrón existente), índice por empresa y `created_at`.

### 3.1 Legajo y documentación

Se retoma la propuesta existente (`PROPUESTA_legajo_digital.md`) y se completa con los datos que la liquidación necesita:

- **`nom_legajo`** — extensión 1:1 de `personal`: CUIL, fecha de nacimiento, estado civil, domicilio, fecha de ingreso real (si difiere de `created_at`), categoría de convenio, CBU/alias, banco, obra social elegida, sindicato, situación SIPA, jornada (completa/parcial), modalidad de contratación.
- **`nom_familiares`** — cargas de familia (asignaciones familiares, ganancias): vínculo, CUIL, fecha nacimiento, documentación respaldatoria.
- **Documentación**: se **reutiliza** `tipos_documento` + `documentos_personal` de Presencio (ya tiene carga individual/grupal, vencimientos, alertas y "obligatorio para legajo"). Nómina agrega tipos propios (alta temprana ARCA, examen preocupacional, constancia CBU, F.572, etc.) marcados con `ambito = 'nomina'` para que Presencio pueda filtrarlos u ocultarlos.
- **`sanciones_personal`** — tal como está en la propuesta de legajo (se implementa acá si no se implementó antes en Presencio).

### 3.2 Configuración de liquidación

- **`nom_convenios`** — convenio (UOCRA, fuera de convenio, …): nombre, régimen (`lct` / `ley_22250`), parámetros generales. Los convenios "plantilla" son globales (empresa_id NULL, solo lectura); cada empresa los clona y ajusta.
- **`nom_categorias`** — categorías por convenio con básico vigente por período (histórico de escalas salariales, nunca se pisa un valor: se versiona por `vigencia_desde`).
- **`nom_conceptos`** — el corazón del motor. Cada concepto: código, nombre, tipo (`remunerativo` / `no_remunerativo` / `descuento` / `aporte_patronal` / `informativo`), fórmula (expresión declarativa, ver 4.2), orden de cálculo, imprimible en recibo sí/no, cuenta contable opcional.
- **`nom_conceptos_empresa`** — overrides y conceptos propios por empresa (presentismo propio, pagos a cuenta de futuros aumentos, premios).
- **`nom_parametros`** — valores con vigencia temporal: topes SIPA, alícuotas de contribuciones, % fondo de desempleo UOCRA, valor de asignaciones. Versionados por fecha.

### 3.3 Liquidación y recibos

- **`nom_periodos`** — período de liquidación por empresa: mes/quincena, tipo (`mensual`/`quincenal`/`sac`/`final`), rango de fechas de fichadas incluidas, estado (`abierto` → `en_flujo` → `cerrado`), snapshot de parámetros usados.
- **`nom_liquidaciones`** — una por persona por período: bruto, neto, total aportes, total contribuciones, estado dentro del flujo, JSON con el detalle de horas importadas de `fichajes` (snapshot inmutable: si después corrigen una fichada, la liquidación no cambia sola).
- **`nom_liquidacion_items`** — línea por concepto aplicado: concepto, cantidad, unidad, monto, base de cálculo. De acá sale el recibo.
- **`nom_recibos`** — PDF generado (Storage, bucket privado), número de recibo correlativo por empresa (secuencia), hash del PDF para integridad, versión (si se reliquida, se genera versión nueva y la anterior queda anulada con motivo).
- **`nom_pagos_adelantos`** — adelantos y pagos a cuenta registrados durante el mes, que el motor descuenta automáticamente.

### 3.4 Flujo de aprobación configurable

- **`nom_flujos`** — definición por empresa: lista ordenada de pasos. Cada paso: nombre, tipo (`generacion` / `revision_externa` / `aprobacion_final` / `pago`), rol o usuarios asignados, si permite aprobación masiva, si permite rechazo con vuelta atrás, notificación (email).
- **`nom_flujo_instancias`** — instancia del flujo por período: paso actual, historial de transiciones (quién, cuándo, comentario) — auditoría completa.
- **`nom_aprobaciones`** — aprobación/rechazo por liquidación individual o por lote, con comentario. Permite el caso "el dueño aprueba 45 recibos masivo y rechaza 2 con nota".

### 3.5 Roles y usuarios externos

Se extiende `usuarios_empresa` (o tabla puente nueva `nom_usuarios_empresas` si un contador atiende varias empresas):

- Rol nuevo **`revisor_externo`** (estudio contable): ve SOLO los períodos en el paso del flujo que tiene asignado, sin acceso a Presencio ni al resto de Nómina. RLS específica: `EXISTS (paso del flujo activo asignado a este usuario)`.
- Rol **`aprobador_pagos`** (dueño/financiero): ve recibos en estado `aprobacion_final`, reporte de pago y botones de confirmación masiva/individual.
- Un usuario externo puede estar vinculado a N empresas (el estudio contable con 10 clientes en Presencio lo gestiona con un solo login).

---

## 4. Motor de liquidación

### 4.1 Ciclo de una liquidación

1. **Importar horas**: al abrir período, una RPC agrega `fichajes` del rango (normales, extras al 50/100%, feriados, nocturnas según config de empresa) + `ausencias` (licencias pagas/no pagas, vacaciones) → snapshot en `nom_liquidaciones.detalle_horas`.
2. **Calcular**: por cada persona, el motor evalúa los conceptos de su convenio+categoría en orden: básico → adicionales de convenio → presentismo → horas extras → no remunerativos → adelantos → aportes del trabajador → neto. En paralelo calcula contribuciones patronales (no salen en el recibo pero sí en el reporte fiscal).
3. **Recibo preliminar** → entra al flujo de aprobación configurado.
4. **Recibo final**: aprobado el flujo, se genera PDF definitivo con numeración, se cierra el período y se emiten los reportes de pago y de aportes.

### 4.2 Fórmulas declarativas (decisión de diseño clave)

Los conceptos usan expresiones declarativas evaluadas por un intérprete propio acotado (sin `eval`), con variables predefinidas: `basico`, `horas_normales`, `horas_extra_50`, `horas_extra_100`, `dias_trabajados`, `antiguedad_anios`, `remunerativo_acumulado`, `tope_sipa`, etc.

Ejemplos:
- Presentismo comercio: `remunerativo_acumulado * 0.0833`
- Hora extra 50%: `(basico / 200) * 1.5 * horas_extra_50` (UOCRA usa divisor propio, parametrizado)
- Fondo desempleo UOCRA: `remunerativo_acumulado * (antiguedad_anios < 1 ? 0.12 : 0.08)`
- Jubilación: `min(remunerativo_acumulado, tope_sipa) * 0.11`

**Por qué así y no hardcodeado:** cada empresa tiene extras propios (pagos a cuenta, premios) y las escalas cambian cada pocos meses en Argentina; con fórmulas + parámetros versionados, actualizar un convenio es carga de datos, no deploy. **Por qué no un motor externo:** no existe librería argentina mantenida open source que cubra esto; las alternativas SaaS (ej. integrar un proveedor de payroll) matan el diferencial del producto.

### 4.3 Reglas condicionales por concepto

Además de la fórmula, cada concepto acepta una lista ordenada de **reglas** (`nom_concepto_reglas`): `condicion` (expresión booleana) → `formula`. Se evalúa la primera regla cuya condición sea verdadera; si ninguna aplica, se usa la fórmula base del concepto. Nuevas variables de asistencia calculadas del snapshot de fichadas: `tardanzas` (llegadas después del turno + tolerancia configurable por empresa), `minutos_tarde_total`, `faltas_injustificadas` (días hábiles del turno sin fichada ni ausencia aprobada), `faltas_justificadas`, `salidas_anticipadas`.

Ejemplo presentismo escalonado:

| Orden | Condición | Fórmula |
|---|---|---|
| 1 | `tardanzas > 3 or faltas_injustificadas > 0` | `0` |
| 2 | `tardanzas > 1` | `remunerativo_acumulado * 0.0833 * 0.5` |
| base | — | `remunerativo_acumulado * 0.0833` |

El mismo mecanismo sirve para topes de antigüedad, adicionales por zona, premios por productividad, etc. La UI de configuración muestra las reglas como filas ordenadas con editor de condición asistido (variables seleccionables), y la grilla de liquidación indica qué regla aplicó a cada persona (transparencia para el aprobador y para responder reclamos del empleado).

**Requisito sobre Presencio:** el cálculo de `tardanzas` necesita el turno/horario esperado por persona. Presencio ya maneja turno en `personal`; la vista contrato `nom_v_horas_periodo` debe exponer hora de entrada fichada + turno esperado por día.

### 4.4 Dónde corre el motor

En una **Edge Function de Supabase** (Deno/TS), no en el navegador. Motivos: cálculo auditable server-side, mismo resultado para todos los actores del flujo, y el intérprete no se expone al cliente. El front solo muestra resultados.

### 4.5 Validación del motor (crítico)

- Suite de **casos dorados**: liquidaciones reales verificadas contra recibos históricos de Asset Construcciones y contra la escala UOCRA publicada (mínimo 10 por convenio: quincena completa, con extras, con licencia, con adelanto, con pérdida de presentismo, ingreso en mitad de período, egreso, SAC, vacaciones) que corren como tests en CI. Un cambio de fórmula que rompa un caso dorado bloquea el deploy.
- Como Asset no tiene estudio contable asociado al proyecto, se contrata una **revisión puntual de un contador laboralista** al final de la fase 2 y de la fase 4 (validar fórmulas, formato de recibo y reporte de aportes). Costo acotado, riesgo legal cubierto.
- Comparación paralela: Asset corre 2 períodos en paralelo con su liquidación actual antes de pagar con Recursio.

### 4.6 SAC, vacaciones y liquidación final

- **SAC**: período especial semestral; el motor toma la mejor remuneración mensual del semestre (ya la tiene en `nom_liquidaciones`).
- **Vacaciones**: se reutiliza `ausencias` + el saldo por antigüedad ya implementado en Presencio (fase 6). Nómina liquida el plus vacacional (divisor 25) cuando la ausencia tipo vacaciones cae en el período.
- **Liquidación final**: tipo de período especial con conceptos propios (indemnizaciones LCT o fondo de desempleo 22.250 según régimen, vacaciones no gozadas, SAC proporcional). El alta/baja viene de `personal.estado` + `fecha_inactivacion` que Presencio ya gestiona.

---

## 5. Funcionalidades por pantalla (v1)

1. **Dashboard** — estado del período actual por empresa, pendientes del flujo, alertas de documentación vencida del legajo, costo laboral del mes vs. anterior (recharts, mismo estilo que Presencio).
2. **Legajos** — listado de `personal` (lectura de Presencio) + datos de `nom_legajo`; vista de legajo completo (datos, documentación, ausencias, sanciones, historial de recibos); exportación PDF; semáforo "legajo incompleto para liquidar" (sin CUIL o CBU no entra a liquidación).
3. **Configuración de nómina** — convenios y categorías (clonar plantilla, editar escalas con vigencias), conceptos por empresa, parámetros, definición del flujo de aprobación (builder simple: lista ordenada de pasos con responsables), asignación de convenio/categoría por empleado.
4. **Liquidación** — abrir período → importar horas (preview de fichadas con diferencias vs. mes anterior) → calcular → grilla de recibos preliminares con detalle por concepto → enviar al flujo. Reliquidar individual antes del cierre.
5. **Bandeja de aprobación** — la vista del revisor externo y del aprobador: lista de recibos del paso, detalle, aprobar/rechazar con comentario, acciones masivas. Es la única pantalla que ve el rol `revisor_externo`.
6. **Cierre y reportes** — reporte de pago (persona, CBU, banco, neto; export CSV/Excel para el banco), reporte de aportes y contribuciones por organismo (SIPA, obra social, ART, sindicato, fondo desempleo), libro de sueldos simple (art. 52 LPT como listado), historial de períodos cerrados.
7. **Usuarios** — gestión de usuarios de nómina y externos (invitación por email, mismo mecanismo de Presencio).

---

## 6. Fases de implementación

Cada fase termina con algo usable en producción. Estimaciones en semanas-persona de desarrollo con IA (estilo Presencio); un desarrollador + revisión contable externa.

### Fase 0 — Fundaciones (1 sem)
Repo, CI, Vercel, `supabase/migrations` versionadas, esqueleto de app con login compartido, layout con look & feel Presencio, RLS base de tablas `nom_*`, seed de convenios plantilla (estructura, sin valores).
**Criterio de salida:** usuario de Presencio entra a Nómina, ve el personal de su empresa en solo lectura.

### Fase 1 — Legajo digital (2 sem)
`nom_legajo`, `nom_familiares`, `sanciones_personal`, tipos de documento de nómina, vista legajo completo, export PDF, semáforo de completitud.
**Criterio de salida:** legajos completos y auditables; deuda que ya tenía Presencio saldada.
**Valor autónomo:** vendible por sí solo aunque el motor se demore.

### Fase 2 — Motor de liquidación: fuera de convenio (3,5 sem)
Motor de conceptos + intérprete de fórmulas **+ reglas condicionales (4.3) con variables de asistencia** + Edge Function + parámetros versionados. Convenio "fuera de convenio LCT" completo: básico, presentismo, extras, adelantos, aportes, contribuciones, SAC. Importación de horas desde `fichajes`. Recibo PDF preliminar (formato art. 140 LCT). Casos dorados en CI.
**Criterio de salida:** liquidación mensual completa de una empresa fuera de convenio, validada contra liquidación real de un contador.

### Fase 3 — Flujo de aprobación + externos (2,5 sem)
Builder de flujos, instancias, bandeja de aprobación, rol `revisor_externo` multi-empresa con RLS específica, notificaciones por email (Resend o SMTP de Supabase), aprobación masiva/individual, recibo final numerado con hash, auditoría de transiciones.
**Criterio de salida:** el circuito completo del ejemplo del usuario (horas → preliminar → estudio contable → dueño → pago) funcionando con una empresa piloto.

### Fase 4 — UOCRA quincenal + reportes de cierre (3 sem)
Convenio UOCRA como configuración: categorías/zonas, fondo de desempleo 22.250, divisores propios, **períodos quincenales** (quincena 1/2, SAC y cargas calculados a nivel mensual consolidando ambas quincenas), liquidación final sin indemnización. Reporte de pago con CBU (CSV/Excel), reporte de aportes por organismo, libro de sueldos listado, cierre de período con bloqueo.
**Criterio de salida:** Asset Construcciones liquidando UOCRA quincenal de punta a punta; 2 períodos de corrida paralela + revisión de contador laboralista contratado.

### Fase 5 (futura, fuera de v1) — Portal del empleado
Recibo digital con conformidad del empleado (Res. SRT/MTEySS de recibo digital), consulta de recibos históricos, solicitud de vacaciones (ya existe la mitad en Presencio). El modelo de datos v1 ya lo soporta: `nom_recibos` tiene hash + versionado, y `personal` ya se vincula a auth para el kiosko.

### Fase 6 (futura) — Exportación Libro de Sueldos Digital / SICOSS
Generación de archivos de importación para LSD de ARCA. Se decide tras validar demanda con los estudios contables usuarios.

**Total v1 (fases 0–4): ~12 semanas.**

---

## 7. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Error de cálculo en recibos | Legal/confianza — el peor riesgo del producto | Casos dorados en CI, corrida paralela 2 meses, revisión del estudio contable dentro del flujo (el sistema propone, el contador dispone), disclaimers contractuales |
| Escalas de convenio desactualizadas | Liquidaciones erróneas silenciosas | Parámetros con `vigencia_hasta`; el sistema alerta si se liquida con escala vencida y bloquea cierre sin confirmación explícita |
| Datos salariales sensibles | Ley 25.326, confidencialidad | RLS estricta, sin persistencia local, bucket privado con URLs firmadas cortas, logs de acceso a recibos, rol externo con vista mínima |
| RLS del rol externo mal diseñada | Un contador ve datos de empresa ajena | Política basada en tabla puente explícita + tests de RLS automatizados (suite que intenta accesos cruzados) |
| Scope creep normativo (ganancias 4ª categoría, cargas complejas) | v1 no termina nunca | Ganancias v1 = concepto manual informado por el estudio contable en su paso de revisión. Cálculo automático de ganancias explícitamente fuera de alcance v1 |
| Cambios en Presencio rompen la lectura | Acoplamiento entre apps | Vistas SQL estables (`nom_v_personal`, `nom_v_horas_periodo`) como contrato entre las dos apps; Presencio puede cambiar sus tablas mientras mantenga las vistas |
| Piloto sin estudio contable (7.7) | Nadie con incumbencia profesional valida recibos ni F.931 | Contador laboralista contratado por revisión puntual (fin de fases 2 y 4); flujo de aprobación configurable sin paso externo (revisión interna); Recursio genera reportes pero la presentación fiscal sigue siendo responsabilidad del empleador |

---

## 8. Fuera de alcance v1 (explícito)

- Cálculo automático de impuesto a las ganancias 4ª categoría (se registra como concepto manual).
- Presentación directa en ARCA (F.931, LSD) — solo reportes para que el estudio presente.
- Portal del empleado y firma digital de recibos.
- Convenios adicionales a UOCRA/fuera de convenio (Comercio queda como candidato natural para v1.1 dado HouseFit).
- Pagos bancarios automáticos (el sistema genera el archivo/reporte; el pago lo ejecuta la empresa en su banco).
- App móvil.

---

## 9. Revisión gstack

Plan sometido a las metodologías `plan-ceo-review` y `plan-eng-review` de gstack (github.com/garrytan/gstack). Resultado:

### 9.1 CEO review (estrategia y premisa)

- **Desafío de premisa — ¿app separada o módulo?** Sostenido: separada. El comprador del módulo de nómina (estudio contable/administración) no es el usuario de la app de fichaje (capataz/kiosko); mezclar datos salariales en el bundle de una app que corre en tablets de obra es riesgo innecesario. Además habilita pricing separado.
- **Apalancamiento de código existente:** alto — reutiliza auth, multitenancy, RLS, `documentos_personal`, `ausencias` + saldo de vacaciones, bloqueo de lotes y la propuesta de legajo ya escrita. Se estima >30% del alcance ya resuelto por Presencio.
- **10x:** el diferencial real no es liquidar (eso lo hacen Bejerman/Tango/estudios) sino el **circuito horas-fichadas → recibo → aprobación multiactor sin fricción**, que ningún competidor de PyME constructora tiene integrado con control de asistencia biométrico. El plan prioriza bien ese circuito (fase 3 antes que segundo convenio).
- **Alternativas consideradas:** (a) integrar un payroll de terceros vía API — descartado: no hay API argentina razonable y se pierde el diferencial; (b) módulo dentro de Presencio — descartado por lo anterior; (c) solo gestor de flujo sin motor — descartado por el usuario, aunque la fase 1 sola ya es vendible como fallback si el motor se retrasa.
- **Veredicto: PASS.** Riesgo principal señalado: subestimar la complejidad normativa de UOCRA (zonas, ítems regionales). Mitigado con corrida paralela y revisión contable en el flujo.

### 9.2 Eng review (factibilidad)

- **Reuso vs. reconstrucción:** correcto — no duplica documentación ni ausencias; extiende `usuarios_empresa` en vez de crear un auth paralelo.
- **Cambio mínimo:** el contrato por vistas SQL (`nom_v_*`) evita tocar Presencio casi por completo; único cambio en Presencio: marcar tipos de documento con `ambito`.
- **Chequeo de complejidad:** el intérprete de fórmulas es el punto de mayor complejidad accidental. Acotado: gramática mínima (aritmética, `min/max`, condicional ternario, variables predefinidas), sin loops, sin acceso a datos arbitrarios, ~300 líneas + tests. Alternativa si se complica: funciones TS nombradas por concepto (menos flexible, más simple) — decisión revisable al final de fase 2.
- **Arquitectura:** cálculo en Edge Function correcto (auditabilidad, secretos fuera del cliente). Señalado: definir idempotencia del cálculo (recalcular = borrar items y regenerar dentro de una transacción) y locking de período para evitar cálculos concurrentes.
- **Tests:** casos dorados como gate de CI es el mecanismo correcto para un dominio donde el bug es legal. Agregado por esta revisión: suite de tests de RLS cruzada (intentos de acceso entre empresas y desde rol externo) también como gate.
- **Performance:** volúmenes PyME (≤ 500 empleados/empresa) — sin riesgo; cálculo por lote < 30 s en Edge Function con procesamiento por chunks si hiciera falta.
- **Veredicto: DONE_WITH_CONCERNS.** Concerns: (1) validar el intérprete de fórmulas con el contador antes de fase 2 — que las fórmulas reales de UOCRA entren en la gramática propuesta; (2) definir con precisión el formato del recibo art. 140 LCT con un modelo real del estudio contable; (3) reparar el repo git de Presencio antes de crear las vistas contrato (bloqueante señalado en REVIEW-presencio.md).

### Decisiones abiertas — RESUELTAS (2026-07-06)

1. Nombre: **Recursio**.
2. Piloto: **Asset Construcciones**, sin estudio contable (mitigado con revisión puntual de contador contratado, ver 4.5 y riesgo 7.7).
3. **UOCRA quincenal en v1**; fuera de convenio mensual.
4. Nuevo requisito incorporado: **reglas condicionales por concepto** (sección 4.3).

### 9.3 Revisión crítica v2 (post-decisiones)

Pasada adversarial sobre el plan actualizado. Hallazgos y resoluciones:

1. **El flujo piloto ya no ejercita al revisor externo.** El circuito original asumía estudio contable; Asset no tiene. Resolución: el flujo default del piloto es interno (generación → revisión admin/RRHH → aprobación dueño → pago). El rol `revisor_externo` se implementa igual en fase 3 (es diferencial del producto para venderle a estudios), pero se marca como **no validado en producción** hasta tener un cliente con estudio. Riesgo aceptado y documentado.
2. **Consolidación mensual de quincenas.** Aportes, topes SIPA y SAC se calculan sobre el mes; con quincenas hay que consolidar quincena 1 + 2 antes de cerrar el mes. Resolución: la quincena 2 "cierra el mes" — recalcula cargas sobre el acumulado mensual y ajusta diferencias. Esto está ahora en fase 4 y explica la ampliación a 3 semanas.
3. **Calidad de datos de turnos.** `tardanzas` depende de que los turnos en Presencio estén bien cargados; un turno mal configurado quita presentismo indebidamente. Resolución: el preview de importación de horas (pantalla 4) muestra tardanzas/faltas detectadas por persona ANTES de calcular, con corrección manual auditada (quién ajustó qué). El número final que usa el motor es el confirmado, no el crudo.
4. **Gramática del intérprete.** Las reglas condicionales (4.3) ya requieren `or`, comparaciones y ternario — la gramática mínima propuesta las cubre sin ampliarse. Verificado contra los 3 ejemplos de fórmulas y la tabla de presentismo.
5. **Doble carga UOCRA histórica.** Los casos dorados dependen de recibos históricos de Asset; si Asset liquidaba mal, los casos dorados heredan el error. Resolución: los casos dorados se validan contra la escala UOCRA publicada + revisión del contador contratado, no solo contra recibos históricos.

**Veredicto v2: PASS.** Condición de arranque: acceso a 2-3 recibos históricos reales de Asset (anonimizables) antes de la fase 2.
