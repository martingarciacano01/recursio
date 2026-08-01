# Plan Maestro v3 — Llevar Recursio a producción en una PYME constructora

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Autor:** auditoría integral del 2026-07-31 (2ª pasada exhaustiva). Reemplaza la v1.
> **v3:** agrega el plan del **importador de paritarias con IA** (plan propio `2026-07-29-importador-paritarias-ia.md`, integrado en la Fase 5 con los conflictos resueltos).
> **Estado:** ninguna tarea ejecutada. Documento nuevo.

**Goal:** Que Recursio pueda liquidar sueldos reales de una PYME constructora: segura, con cálculos **legalmente correctos**, robusta, usable por gente no técnica, con cumplimiento fiscal manejable y con las paritarias UOCRA cargadas sin trabajo manual. **SICOSS queda fuera de alcance por decisión del usuario** (el F.931 lo presenta el estudio contable manualmente).

**Architecture:** Ocho frentes independientes:
1. **Seguridad** — RLS por rol + validación de Edge Functions (el único gate real de datos).
2. **Correctitud del motor** — errores de cálculo detectados (SAC, vacaciones, tope SIPA, redondeo, feriados). Sin esto los recibos son ilegales.
3. **Robustez del frontend** — race conditions y manejo de errores que pueden mostrar sueldos equivocados o trabar la app.
4. **UX/UI** — los flujos de mayor riesgo (aprobar, usuarios, cierre) hoy son ciegos o rotos.
5. **Importador de paritarias IA** — subir un acta en PDF/Word, Haiku extrae básicos y sumas no remunerativas, y el usuario revisa un diff antes de que se escriba una sola fila. Plan detallado ya escrito en `2026-07-29-importador-paritarias-ia.md`; esta fase lo integra y corrige sus conflictos.
6. **Fiscal** — manual hasta nuevo aviso; SiRADIG/Ganancias opcionales a futuro.
7. **Operación** — CI, Node, bundle, emails, README.
8. **Futuro post-v1** — portal empleado, SICOSS si un cliente lo exige.

**Tech Stack:** Postgres/Supabase (RLS, RPC SECURITY DEFINER), Deno (Edge Functions), React 19 + Zustand, Vitest, Vite 8, GitHub Actions, Vercel.

---

# PARTE A — Explicación para el dueño de la app (resumen simple)

Esta parte es para vos. La Parte B es para que Sonnet 5 la implemente.

## La novedad más importante de esta segunda revisión

La primera revisión encontró problemas de **seguridad** (un usuario puede liquidar la nómina de otra empresa) y de **datos** (migraciones sin aplicar). La segunda revisión, más profunda, encontró **errores en el cálculo de los sueldos** que hacen que los recibos estén mal:

| Qué encontré (en criollo) | Qué significa en pesos |
|---|---|
| **El SAC (aguinaldo) de un obrero UOCRA paga la MITAD de lo que corresponde.** El motor toma la mejor "quincena" y la divide por 2, cuando el SAC es 50% de la mejor remuneración **mensual**. | Ej.: sueldo mensual $1.500.000 → SAC correcto $750.000; la app paga $375.000. |
| **Las vacaciones no gozadas en la liquidación final pagan la licencia completa del año aunque el trabajador se vaya en marzo.** La ley exige proporcionalidad (días trabajados / 365). | Ej.: 2 años de antigüedad, egreso 15-mar: la ley dice ~4 días; la app paga 21. ~$670.000 de más. |
| **El tope de aportes (SIPA) se aplica por quincena, no por mes.** Un sueldo mensual por arriba del tope queda con cada quincena "bajo el tope" y la retención se duplica. | Ej.: $3.000.000/mes → la app retiene $330.000 cuando lo legal es $270.304. ~$60.000 retenidos de más, por persona, por mes. |
| **No se redondean los centavos al guardar.** Los montos se guardan con "ruido" de decimales (250519.17329999997 en vez de 250519.17). La base no coincide con el recibo impreso y los reportes suman el error. | Diferencia de centavos por concepto, que se acumula en aportes y costo laboral. |
| **No hay feriados nacionales.** Un feriado entre semana se cuenta como día normal: si no trabaja, se descuenta como falta injustificada; si trabaja, no se paga el recargo del 100%. | Multas por no pagar recargos de feriados trabajados. |

**Conclusión: los números del motor hoy NO cierran con la ley.** Es el bloqueante #1 junto con la seguridad. No se puede liquidar un peso real hasta corregir esto y validar con un contador.

## Todo lo demás, en orden

| # | Qué encontré | Qué hacemos |
|---|---|---|
| 1 | Cualquier persona con cuenta puede liquidar los sueldos de cualquier empresa (la función de cálculo no pregunta quién la llama). | La función exige login + que el período sea de tu empresa + rol Admin/RRHH. |
| 2 | El backend no distingue roles: un "solo lectura" puede borrar liquidaciones. | Migración RLS por rol (0026). La matriz ya está en `permisos.js`. |
| 3 | Los DNI/libretas de los legajos están en un cajón común: cualquier logueado lee los de todas las empresas. | Regla por carpeta de empresa (una línea de SQL). |
| 4 | El alta de usuarios está rota (siempre da error 403). | Arreglar `invitar-usuario`. |
| 5 | Migraciones sin aplicar: sin una de ellas **la liquidación da $0**. | Verificar y aplicar 0031→0042 en orden. |
| 6 | **La pantalla de liquidación puede mostrar los sueldos de OTRO período** (race condition): si cambiás el selector mientras calcula, la respuesta vieja pisa a la nueva. | Guardia de secuencia: la respuesta que llega tarde se descarta. |
| 7 | **No hay protección contra errores**: un registro corrupto deja la app en blanco; si Supabase está caído, el botón "Calcular" queda trabado para siempre y el login no funciona. | ErrorBoundary + manejo de errores de red en todas las acciones. |
| 8 | **Volver a calcular un período ya emitido sobrescribe los recibos en silencio** (mismo número, montos nuevos). El hash del recibo no incluye el número. | Congelar o versionar (anular + v+1) los recibos emitidos. |
| 9 | El aprobador firma a ciegas (sin montos); los usuarios aparecen como código raro; no hay confirmaciones (toasts); login sin "olvidé mi contraseña"; sin guía de primeros pasos; cierre de período duplicado y uno no controla paritarias. | Fase UX/UI (ver tabla anterior). |
| 10 | SICOSS **no se implementa** (decisión tuya): el F.931 lo presenta el estudio contable con los reportes que la app ya exporta. | Documentar el flujo manual; SiRADIG/Ganancias quedan opcionales a futuro. |
| 11 | No hay CI; el build requiere Node 22 (tu máquina corre Node 18 y falla); bundle de 1 MB sin separar; el repo tiene 95 cambios sin commitear (incluidas migraciones y la PWA); sin backups automáticos. | CI, .nvmrc real, separar bundle, commitear todo, runbook de backups. |
| 12 | Las paritarias UOCRA se cargan a mano (o no se cargan). Ya existe un plan con código listo para subir el acta en PDF/Word y que Haiku extraiga básicos y no remunerativos con revisión humana del diff. | Fase 5: integrar el plan `2026-07-29-importador-paritarias-ia.md` (renumerando la migración `0039` → `0045` y agregándole la validación de auth que el plan original no tenía). |
| 13 | **Vos reportaste que "si agrego algo remunerativo, los conceptos que calculan sobre el remunerativo lo hacen sobre el sueldo básico, no sobre TODO el remunerativo". Es cierto (verificado): los adicionales nuevos se insertan con un orden posterior a los descuentos, y el motor acumula en orden → jubilación/obra social/contribuciones no ven el adicional.** Además pediste: horas extras configurables (con/sin tope por quincena o mes), que los feriados vengan de Presencio (que ya los cuenta) en vez de una tabla propia, y que el sistema soporte otros convenios además de UOCRA. | Fase 2: **nueva Task 2.11** (descuentos y aportes sobre el remunerativo TOTAL del período, no sobre el parcial) + **Task 2.12** (config de horas extras y tope por empresa) + **Task 2.5 se reescribe** para leer los feriados de Presencio. Fase 5: el importador se parametriza por CCT (no solo 76/75). |

## El orden en una frase

Primero **seguridad** (1-4), en paralelo **que los números den bien** (5 + los 5 errores de cálculo + el bug de base de cálculo del punto 13), después **robustez** (6-8), después **UX** (9), después **importar paritarias con IA** (12, opcional pero de alto valor), y de fondo **operación** (11).

---

# PARTE B — Plan de implementación para Sonnet 5

## Hallazgos del relevamiento (2026-07-31, 2ª pasada) — leer antes de la Fase 1

### Seguridad (verificados en la 1ª pasada, sin cambios)
1. **`liquidar-periodo` no valida identidad/rol/empresa** (`index.ts:71`, cliente `SUPABASE_SERVICE_ROLE_KEY`, cero `getUser`/`has_rol_nomina`). Cross-tenant explotable. Agravado por **no existir `supabase/config.toml`** → `verify_jwt` inverificable.
2. **La migración `0026_rls_roles.sql` nunca se escribió.** 32 policies `FOR ALL`; `has_rol_nomina` (0025) sin usar en policies.
3. **Storage `nom-documentos`** valida solo `bucket_id` (`0032:71-72`) → DNI/libretas cross-tenant.
4. **`invitar-usuario` roto (403 siempre)** — valida rol con cliente service-role → `auth.uid()` NULL.
5. **`nom_no_remunerativos`** sin `is_superadmin()` en su policy (0012). **`quincena_pareja`** ejecutable por `public`.
6. **`vercel.json`** sin security headers. Suite RLS en `tests/rls/` siempre skipeada.

### Correctitud del motor (NUEVO — 2ª pasada, los más graves)
7. **C1 SAC UOCRA = la mitad.** `index.ts:986` pasa `Math.max(...brutos)` de **cada liquidación** (quincenas ≈ M/2) a `calcularSACProporcionalUocra` que divide por 2 → 25% del mes. Fix: consolidar quincenas por mes y pasar el máximo mensual.
8. **C2 Vacaciones no gozadas = licencia completa.** `especiales.ts:59-67` usa `diasVacacionesPorAntiguedad` (14/21/28/35) sin multiplicar por `diasTrabajadosAnio/365`. El código calcula `diasTrabajadosAnioFinal` (`index.ts:1042`) pero solo lo usa para <6 meses. Fix en ambos regímenes (UOCRA `uocra.ts:41-51` y LCT).
9. **C3 Tope SIPA por quincena, no por mes.** Fórmulas seed usan `min(remunerativo_acumulado, tope_sipa)` (`0029:22-33`, `0037:64-95`) y `remunerativo_acumulado` arranca en 0 por quincena (`motor.ts:91`). El mecanismo de consolidación mensual existe (`index.ts:591-603`, `codigosConsolidadosPorAcumuladoMensual`) pero es código muerto (ninguna migración usa `base:'acumulado_mensual'` ni `remunerativo_quincena1`). Fix: activarlo en Q2 (restar lo ya retenido en Q1).
10. **C4 Sin redondeo a centavos en producción.** `motor.ts:119` guarda flotantes crudos; los golden tests redondean (`golden/conceptos-fuera-convenio.ts:17-19`) y prueban fórmulas DISTINTAS a las seed → el verde no valida producción. Fix: redondear en `liquidarConceptos` y alinear golden con fórmulas reales.
11. **C5 Sin feriados nacionales.** `asistencia.ts:114-127` solo sáb/dom son no laborables; feriado = día normal (falta injustificada si no trabaja, sin recargo 100% si trabaja). Existe el concepto seed `hs_feriado` (código `0043`) sin cálculo asociado.
12. **M1 Reliquidar sobrescribe recibos emitidos.** Upsert por `periodo_id,personal_id` (`index.ts:617-656`) sin versionado; migración `0016` documenta v+1/anulación pero no se implementa.
13. **M2 Hash del recibo débil.** `reciboHash.js` hashea el PDF **antes** de imprimir el número y jsPDF embebe metadata → hash no reproducible ni autentica el número.
14. **M3 Golden tests solo fuera de convenio.** M4 vacaciones gozadas paga solo básico×8 (sin normal y habitual). M5/M7 horas extra y presentismo UOCRA sin conceptos seed. M6 zona horaria en tardanzas (`asistencia.ts:94-95` slice del ISO crudo; timestamptz UTC → 3h de tardanza espuria). M8 días de baja = día calendario. M9 `round(1.005)→1.00` (`interprete.ts:368`).

### Robustez del frontend (NUEVO — 2ª pasada)
15. **C1 race condition:** `LiquidacionPage.jsx:159-163` calcula y recién después carga con el closure viejo; `cargarLiquidaciones` (store `liquidacionStore.js:127-138`) sin guardia de secuencia → puede mostrar/exportar/emitir recibos del período equivocado. `legajoStore.js:89-92` YA tiene el patrón `seq` a replicar.
16. **C2 sin ErrorBoundary** (`main.jsx:7-11`): un registro mal formado → pantalla blanca para todos. **C3** `calcularPeriodo`/`crearPeriodoFinal`/`crearPeriodoVacaciones` sin `try/catch` (`liquidacionStore.js:59-125`): Supabase caído → `calculando` true para siempre + períodos huérfanos en `nom_periodos`. **C4** `login`/`cargarSesion` sin catch (`authStore.js:83-139`): pantalla en blanco perpetua con Supabase degradado.
17. **M1** `seleccionadas`/`busqueda` no se resetean al cambiar período (`LiquidacionPage.jsx:60-63`). **M2** stale state al cambiar de empresa (sin `seq`). **M3** error de carga deja datos viejos visibles. **M4** `key={index}` en filas editables (`TabFlujo.jsx:64`, `EditorReglas.jsx:47`). **M5** `URL.revokeObjectURL` inmediato aborta descargas en Safari (`LiquidacionPage.jsx:244-249`, `exportCsv.js:38-43`). **M6** fallback de `whoami` a `user_metadata` editable (`authStore.js:55-81`). **M7** `new Function` en preview de fórmulas (`EditorReglas.jsx:17-28`). **M8** la mayoría de stores sin `try/catch`. **M9** `AprobacionesPage.jsx:11` carga sin filtro de empresa.

### Repo / build / PWA (NUEVO — 2ª pasada)
18. **Vulnerabilidad npm:** `react-router 7.12.0–8.2.0` HIGH `GHSA-qwww-vcr4-c8h2` (CSRF en RSC). Instalada 7.18.2. **NO explotable acá** (SPA pura, sin RSC). Fix real: migrar a `react-router@8.3.0` (no hay `react-router-dom@8.x`). No urgente.
19. **Build:** requiere Node ≥20.19/22.12 (`.nvmrc` 22.23.1; sistema corre 18.20.8 y el build FALLA). Bundle principal **1 MB** sin vendor splitting (`vite.config.js` sin `manualChunks`); jspdf/jszip ya van lazy. `packages/motor` no es workspace (tiene su propio node_modules).
20. **PWA:** service worker correcto — **no cachea datos sensibles** (solo shell estático; Supabase y `/api/`,`/rest/` excluidos, `sw.js:56-59`). Menores: assets viejos sin evictar; cachea el HTML de `/` sin validar `respuesta.ok`.
21. **Working tree:** 95 cambios sin commitear; **migraciones 0036–0042, PWA completa y scripts de sync están UNTRACKED** → el repo no es reproducible. Sin CI. Sin backups automáticos (todo manual vía `psql`). `README` es el template de Vite. `.git_broken/` y `.git_broken2/` son residuos.
22. **Plan del importador de paritarias IA ya escrito pero no implementado** (`docs/superpowers/plans/2026-07-29-importador-paritarias-ia.md`, 7 tasks con código listo). Al integrarlo hay que corregir tres cosas: (a) **renumerar la migración** `0039_importaciones_paritarias.sql` → `0045` (0039 ya está ocupada por `basico_unidad_base`); (b) **la Edge Function no valida JWT/empresa/rol** (toma `empresa_id` del body y escribe `nom_importaciones` con service-role → cross-tenant); (c) **la policy del bucket `paritarias` valida solo `bucket_id`**, sin aislar por empresa (mismo bug de `nom-documentos`, hallazgo 3). Pendientes de decisión: permiso `importar_paritaria` (el plan usa `['admin','rrhh']`; alinear con `editar_configuracion` = `['admin']` si se prefiere), y `ANTHROPIC_API_KEY` como secret.

### Nuevos pedidos del usuario (2026-07-31, con revisión del artículo e-sueldos UOCRA)
23. **BUG confirmado — los conceptos que calculan sobre el remunerativo lo hacen sobre el básico, no sobre TODO el remunerativo.** El motor evalúa los conceptos en orden ascendente de `orden` y expone `remunerativo_acumulado` como el acumulado PARCIAL hasta ese punto (`motor.ts:88-101`). Los seeds ordenan así: `basico` orden 10, descuentos 100-103, contribuciones patronales 200-205 (`0031_seed_conceptos_base.sql`). Un adicional nuevo se crea con `orden = Math.max(...delConvenio.map(c => c.orden)) + 1` (`TabAdicionales.jsx:25`) → queda con orden ~206, DESPUÉS de los descuentos → cuando se evalúa `jubilacion` (orden 100), `remunerativo_acumulado` todavía no contiene el adicional. **Fix:** cambiar el orden de evaluación para que TODOS los conceptos con `config.base='remunerativo'`/`'ambos'` (descuentos y contribuciones) calculen sobre el remunerativo TOTAL del período (suma de básico + todos los adicionales + HE + presentismo), sin depender del orden de inserción de la UI. Ver Task 2.11.
24. **Configurable si la empresa contabiliza horas extras o no (topeando horas trabajadas contra horas máximas por quincena/mes).** Hoy la jornada está hardcodeada: `index.ts:548` pasa `legajo.jornada === 'parcial' ? 4 : 8` a `calcularAsistencia`, y `asistencia.ts:26-30` usa `jornadaHoras = 8` por defecto → las horas que superan la jornada se pagan como extra siempre. **Mejores prácticas relevadas** (Waiki Sueldos, Mercans, FiscalPyME): tope de 12 h diarias, 12 h entre jornadas, 35 h semanales; avisos antes de liquidar cuando una asignación rompe el tope; saldos de banco de horas; CCT parametrizable. **Fix:** agregar config de empresa (flag `contabilizar_horas_extras` + tope por quincena/mes + jornada por convenio) y que `calcularAsistencia` topee cuando corresponda. Ver Task 2.12.
25. **Feriados: NO crear tabla propia `nom_feriados` — tomarlos de Presencio.** El usuario confirmó que "Presencio ya cuenta los feriados; la info de horas viene de ahí y Recursio debería traerla de ahí (no inventar tabla propia)". Presencio guarda los feriados en `empresas.config_json -> 'moduloHorasProyecto' -> 'feriados'` como `[{fecha:'yyyy-MM-dd', nombre}]` (verificado en `024_rpc_puede_fichar.sql:87-103` y `fichaobra/src/utils/diasHabiles.js`). **Problema:** las vistas contrato `0001_vistas_contrato.sql` (nom_v_personal/horas_dia/ausencias) NO exponen la tabla `empresas` → hoy Recursio no puede leerlos. **Fix:** agregar una vista contrato nueva (p.ej. `nom_v_empresa_config`) que exponga `config_json->moduloHorasProyecto` con `security_invoker=true`, y que `liquidar-periodo` la lea vía service-role (que ya bypasea RLS). Reemplaza la Task 2.5 original (seed ARCA).
26. **Multi-tenant: otros convenios además de UOCRA.** El usuario aclaró que el sistema debe poder cargar otros CCT (UOCRA otras ramas, UTHGRA, etc.). `nom_convenios` ya es multi-tenant (`0002:44-51`: `empresa_id NULL` = plantilla, NOT NULL = clon de empresa) y `regimen` CHECK solo `('lct','22250')` normalizado por 0030. **Restricciones actuales:** el importador de paritarias está acotado a UOCRA (zona A/B/C, categorías 76/75); los motores `uocra.ts`/`especiales.ts` cubren solo 2 regímenes; `jornada` del legajo CHECK solo `('completa','parcial')` (`0002:31`). **Fix:** parametrizar el importador por convenio (categorías, zonas, jornada) y dejar explícito que agregar un CCT nuevo = datos de convenio, no código.
27. **Adicionales UOCRA del artículo e-sueldos que faltan modelar.** El artículo `https://e-sueldos.com/liquidar-sueldos-de-uocra/` detalla particularidades que hoy no tienen concepto seed: **jornada 9 h/día, 44 h/semana** (el motor usa 8 h fijas); **pausa paga de 20 min que integra la remuneración** (hora trabajada); **asistencia perfecta 20%** del básico + zona desfavorable; **zona desfavorable** (adicional por escala geográfica); **trabajos insalubres** (categoría de 6 h paga 8 h); **título habilitante**; **gasto de traslado** (no remunerativo: 4 h/2,5 h equivalentes); **vestimenta** (no remunerativo: 2 jornales semestrales, >6 meses antigüedad); **tarea específica** (10-25%). Ver Task 2.13.

**Numeración de migraciones disponibles:** `0043` (storage F1), `0044` (accesos_log F1), `0045` (importador paritarias F5), `0046` (vista contrato feriados Presencio — F2), `0047` (config horas extras empresa — F2).

**Convención:** migraciones reusan el patrón existente (policies + REVOKE/GRANT, funciones `SECURITY DEFINER` con `SET search_path`). Cada task termina con commit y verificación.

---

## Orden y dependencias

| Fase | Contenido | Depende de |
|---|---|---|
| **0** | Preparación y baseline (commit, migraciones, Node, baseline tests) | — |
| **1** | Seguridad (Edge Functions, RLS, storage, invitar-usuario, suite RLS) | 0 |
| **2** | **Correctitud del motor** (SAC, vacaciones, tope mensual, redondeo, feriados, extras/presentismo, idempotencia, hash) | 0 |
| **3** | Robustez del frontend (race conditions, ErrorBoundary, errores de red) | 0 |
| **4** | UX/UI para PYME | 3 |
| **5** | **Importador de paritarias con IA** (Haiku extrae el acta, el usuario revisa el diff) | 0; el servidor copia el patrón de auth de Task 1.1 y el de storage de Task 1.3 |
| **6** | Fiscal (manual; SiRADIG/Ganancias opcionales) | 2 |
| **7** | Operación y repo (CI, Node, bundle, emails, README) | 0; CI desde Fase 1 |
| **8** | Futuro post-v1 | 6 |

Fases 1, 2, 3 y 5 son independientes entre sí (solo dependen de 0) → paralelizables. La Fase 5 (importador) toca base solo a través de la RPC `aplicar_paritaria` que valida empresa; su parte servidor (Edge Function) debe seguir el patrón de auth de la Fase 1. La Fase 6 (fiscal) es secuencial y opcional.

---

## Fase 0 — Preparación y baseline [⚙️ esfuerzo bajo]

### Task 0.1: Commitear el working tree en orden lógico

**Por qué:** 95 cambios sin commitear, incluidas 7 migraciones (0036–0042), la PWA completa y los scripts. El repo hoy no es reproducible.

- [ ] **Step 1:** `git status --short` y agrupar por tema (motor, migraciones, PWA, scripts, UI, utilidades).
- [ ] **Step 2:** Commitear por tema siguiendo el estilo del historial (`feat:`/`fix:`/`test:`/`chore:`).
- [ ] **Step 3:** Verificar que nada sensible salga (`.env*`, `scripts/.dumps/`) y que `dist/` siga fuera.
- [ ] **Step 4:** `git push` a `origin/dev` si el usuario lo autoriza.
- [ ] **Step 5:** Verificación: `git status` limpio.

**Criterio de aceptación:** un checkout fresco reproduce el repo completo (incluida la PWA y las migraciones 0036–0042).

### Task 0.2: Alinear Node y verificar migraciones aplicadas [⚙️ esfuerzo bajo]

- [ ] **Step 1:** Asegurar Node 22 (`nvm use 22.23.1` según `.nvmrc`). Verificar `node -v`.
- [ ] **Step 2:** Conectar a la base real (dev y prod) y listar migraciones aplicadas (`select * from supabase_migrations.schema_migrations;`).
- [ ] **Step 3:** Aplicar las faltantes 0031–0042 en orden (`supabase db push` por rango).
- [ ] **Step 4:** Verificar seed: `nom_convenios` no vacío, concepto `basico` presente, `tope_sipa` en `nom_parametros`.
- [ ] **Step 5:** Commit del checklist en `docs/RUNBOOK-DE-MIGRACIONES.md`.

**Criterio de aceptación:** Node 22 activo; migraciones aplicadas = repo; seed completo.

### Task 0.3: Baseline de lint y tests [⚙️ esfuerzo bajo]

- [ ] **Step 1:** `npm run lint` y `npm test`. Documentar errores.
- [ ] **Step 2:** Corregir errores (no warnings) o justificar. Evaluar la regla nueva `react-hooks/set-state-in-effect`.
- [ ] **Step 3:** Verificación: `npm run lint` y `npm test` verdes. Commit.

---

## Fase 1 — Seguridad (bloqueante) [⚙️ esfuerzo medio-alto]

> Referencia: `docs/superpowers/plans/2026-07-28-fase5h-seguridad.md` (plan detallado ya escrito). Esta fase lo subsumee.

### Task 1.1: `liquidar-periodo` valida JWT + empresa + rol [⚙️ esfuerzo medio]

**Files:** Modify `supabase/functions/liquidar-periodo/index.ts` · Reference `invitar-usuario/index.ts` (patrón `getUser`).

- [ ] **Step 1:** Al inicio del handler (tras `OPTIONS`), validar `Authorization` con cliente anon y `auth.getUser()` (patrón ya codificado en `fase5h-seguridad.md:59-82`). 401 si no hay token/usuario.
- [ ] **Step 2:** Tras cargar `periodo`, validar vínculo: `nom_usuarios_empresas` con `usuario_id` y `empresa_id = periodo.empresa_id`, rol ∈ `['admin','rrhh']`, o superadmin. 403 si no aplica. (Código en `fase5h-seguridad.md:84-104`. Verificar criterio real de superadmin en `0008_superadmin_bypass.sql`.)
- [ ] **Step 3:** Reemplazar `errPeriodo.message`/`errPeriodo.code` por mensajes genéricos + log server-side (todas las ocurrencias con `grep -n "errPeriodo.message\|errPeriodo.code"`).
- [ ] **Step 4:** Test: crear `tests/edge/liquidar-periodo.test.ts` con mocks (401/403/200). Correr vitest.
- [ ] **Step 5:** Commit. Deploy manual del usuario + prueba: período propio OK, período ajeno → 403.

**Criterio de aceptación:** la función no opera sin JWT, no opera sobre empresas ajenas y exige rol `admin`/`rrhh` (o superadmin).

### Task 1.2: Migración `0026_rls_roles.sql` — RLS por rol [⚙️ esfuerzo alto]

**Files:** Create `supabase/migrations/0026_rls_roles.sql` · Reference `fase5h-seguridad.md` Task 2 (matriz `:133-162`), `permisos.js:5-20`, `0008_superadmin_bypass.sql`.

- [ ] **Step 1:** Mapear acciones de la matriz a tablas (ej. `calcular_liquidacion` → `nom_periodos`/`nom_liquidaciones`/`nom_liquidacion_items`; `editar_legajos` → `nom_legajo`/`nom_familiares`/`nom_sanciones_personal`/`nom_legajo_adicionales`; `editar_configuracion` → `nom_empresa_config`/`nom_parametros`/`nom_conceptos` de empresa).
- [ ] **Step 2:** Escribir la migración: `DROP` de las `FOR ALL`; SELECT amplio (`is_superadmin() OR empresa_id = auth_empresa_id()`); INSERT/UPDATE/DELETE gated con `has_rol_nomina(ARRAY[...])`; convenios globales solo lectura; **red de seguridad**: owner de la empresa queda `admin` (`fase5h-seguridad.md:164-181`).
- [ ] **Step 3:** `nom_no_remunerativos`: agregar `is_superadmin()` a su policy (hoy sin bypass, `0012:15-25`). `quincena_pareja`: `REVOKE ... FROM public` + `GRANT ... TO authenticated` (`0017:28`).
- [ ] **Step 4:** `npm test` completo; aplicar en dev.
- [ ] **Step 5:** Commit.

**Criterio de aceptación:** rol `consulta` lee pero no escribe; `admin` escribe; superadmin bypassa; owner sin vínculos queda `admin`.

### Task 1.3: Storage `nom-documentos` aislado por empresa [⚙️ esfuerzo bajo]

**Files:** Create `supabase/migrations/0043_storage_ruta_empresa.sql`.

- [ ] **Step 1:** Reemplazar la policy `nom_documentos_storage_rw` (`0032:71-72`) por `USING/WITH CHECK (bucket_id='nom-documentos' AND storage.foldername(name)[1] = (select auth_empresa_id())::text)`. Si `auth_empresa_id()` no está en el `search_path` de storage, crear helper `SECURITY STABLE`.
- [ ] **Step 2:** Probar: `createSignedUrl` de empresa B desde usuario de A → falla.
- [ ] **Step 3:** Commit.

**Criterio de aceptación:** upload/get/delete solo sobre la carpeta de la propia empresa.

### Task 1.4: Arreglar `invitar-usuario` [⚙️ esfuerzo medio]

**Files:** Modify `supabase/functions/invitar-usuario/index.ts`.

- [ ] **Step 1:** Validar rol/empresa con cliente ANON + `Authorization` del llamante (no service-role). Mantener service-role solo para Auth Admin y el upsert final (que ya valida origen).
- [ ] **Step 2:** Validar `email` (formato) y `rol` contra la lista de roles.
- [ ] **Step 3:** Verificar flujo real de invitación + `consulta` recibe 403. Commit.

**Criterio de aceptación:** el admin invita por email; roles no-admin reciben 403.

### Task 1.5: Suite RLS ejecutable + CI [⚙️ esfuerzo medio]

**Files:** Modify `tests/rls/*.test.js` · Modify (Fase 7) `.github/workflows/ci.yml`.

- [ ] **Step 1:** Quitar `describe.skipIf`; usar env vars `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON` con usuarios/empresas dedicados; cada test limpia lo que crea.
- [ ] **Step 2:** Job `rls` en CI (Task 7.1). Commit.

**Criterio de aceptación:** la suite corre (no skipped) y verifica aislamiento A/B.

### Task 1.6: Endurecimiento [⚙️ esfuerzo bajo]

**Files:** Modify `vercel.json` · Create `supabase/migrations/0044_accesos_log.sql`.

- [ ] **Step 1:** Headers en `vercel.json` (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`).
- [ ] **Step 2:** Auditoría de accesos (`nom_accesos_log` + RPC `registrar_acceso`, diseño en `fase5h-seguridad.md` Task 4); conectar a emisión/descarga de recibos y vista de legajo.
- [ ] **Step 3:** Commit.

**Criterio de aceptación:** headers presentes; cada acceso a recibo/legajo logueado.

---

## Fase 2 — Correctitud del motor (bloqueante de negocio) [⚙️ esfuerzo alto]

> **La prioridad #1 del negocio.** Los hallazgos 7–14 y 23–27 de la Parte B. Cada fix con test primero (red/green). El gate final es la validación con contador laboralista (Task 2.9). **Task 2.11** (base sobre remunerativo total) es el bug que reportó el usuario y debe salir antes que las demás.

### Task 2.1: SAC UOCRA = 50% de la mejor remuneración MENSUAL [⚙️ esfuerzo medio]

**Files:** Modify `supabase/functions/liquidar-periodo/index.ts` (~`:915-920`, `:986`) · Reference `packages/motor/src/uocra.ts:32-35`.

- [ ] **Step 1:** Agrupar `brutosDelSemestre` por mes (sumar quincenas del mismo mes) y pasar el máximo **mensual** a `calcularSACProporcionalUocra`.
- [ ] **Step 2:** Test de motor: caso UOCRA quincenal 6 meses → SAC = 50% de la mejor mes (no de la mejor quincena).
- [ ] **Step 3:** Commit: `fix(motor): SAC UOCRA sobre mejor remuneración mensual`.

**Criterio de aceptación:** SAC de un jornalizado quincenal = 50% de la mejor mes del semestre.

### Task 2.2: Vacaciones no gozadas proporcionales (art. 152 LCT) [⚙️ esfuerzo medio]

**Files:** Modify `packages/motor/src/especiales.ts:59-67` y `packages/motor/src/uocra.ts:41-51` · Modify `index.ts:1059-1073`.

- [ ] **Step 1:** `dias = diasVacacionesPorAntiguedad(antiguedad) * diasTrabajadosAnio / 365` en ambos regímenes, usando el `diasTrabajadosAnioFinal` ya calculado en `index.ts:1042`.
- [ ] **Step 2:** Tests: egreso 15-mar con 2 años → 21×74/365 ≈ 4,26 días; <6 meses sigue con proporcional de la ley.
- [ ] **Step 3:** Commit.

**Criterio de aceptación:** la liquidación final prorratea vacaciones no gozadas por días trabajados en el año.

### Task 2.3: Tope SIPA mensual en quincenales (activar consolidación) [⚙️ esfuerzo medio-alto]

**Files:** Modify `index.ts:212-248` y `:582-603` (ya esbozado) · Modify seeds de fórmulas o motor.

- [ ] **Step 1:** En Q2, las fórmulas con tope (`jubilacion`, `ley_19032`, `obra_social`) deben calcular sobre `min(remunerativo_acumulado + remunerativo_quincena1, tope_sipa)` y restar lo ya retenido en Q1. Activar el mecanismo `codigosConsolidadosPorAcumuladoMensual` o setear `base:'acumulado_mensual'` en los conceptos seed.
- [ ] **Step 2:** Test: bruto mensual $3.000.000 con tope → retención mensual total = `min(3.000.000; tope) × 11%` repartida entre Q1 y Q2.
- [ ] **Step 3:** Commit.

**Criterio de aceptación:** la suma Q1+Q2 de cada descuento con tope no supera el tope mensual.

### Task 2.4: Redondeo a centavos en producción + golden alineados [⚙️ esfuerzo medio]

**Files:** Modify `packages/motor/src/motor.ts:119` · Modify `packages/motor/golden/conceptos-fuera-convenio.ts` y `golden.test.ts`.

- [ ] **Step 1:** Redondear cada monto de concepto a 2 decimales dentro de `liquidarConceptos` (helper `redondearCentavos`).
- [ ] **Step 2:** Reemplazar las fórmulas doradas de prueba por las **fórmulas seed reales** (sin `round()` manual) para que el golden valide producción.
- [ ] **Step 3:** Tests: `250519.17329999997` → `250519.17`.
- [ ] **Step 4:** Commit.

**Criterio de aceptación:** la base guarda montos idénticos al recibo impreso (a centavos).

### Task 2.5: Feriados desde Presencio (NO tabla propia) [⚙️ esfuerzo medio]

**Files:** Create `supabase/migrations/0046_vista_feriados_presencio.sql` · Modify `packages/motor/src/asistencia.ts:114-127` · Modify `index.ts`.

> **Decisión del usuario (2026-07-31):** Presencio ya cuenta los feriados; la info de horas viene de ahí y Recursio debe traerla de ahí, no inventar una tabla `nom_feriados`. Presencio los guarda en `empresas.config_json -> 'moduloHorasProyecto' -> 'feriados'` como `[{fecha:'yyyy-MM-dd', nombre}]` (`024_rpc_puede_fichar.sql:87-103`, `diasHabiles.js`). El contrato de vistas actual (`0001`) NO expone `empresas`, así que primero hay que exponerlo.

- [ ] **Step 1:** Migración `0046`: vista contrato nueva `nom_v_empresa_config` (o `nom_v_empresa_feriados`) con `security_invoker = true`, exponiendo `empresas.id`, `config_json -> 'moduloHorasProyecto' -> 'feriados'` (y `diasLaborables` por si aplica). GRANT a `authenticated`/`service_role` como en `0001b`/`0009`. No tocar el esquema de `empresas` (regla del plan).
- [ ] **Step 2:** `liquidar-periodo` lee los feriados de esa vista (service-role) y se los pasa a `construirDiasPeriodo`: los días feriados no cuentan falta injustificada; si se trabaja, disparan el concepto `hs_feriado`/recargo 100%.
- [ ] **Step 3:** Tests: feriado no trabajado no descuenta; feriado trabajado suma recargo. Caso con `feriados: []` (empresa sin configurar) → se comporta como hoy (solo sáb/dom no laborables) y se loguea.
- [ ] **Step 4:** Commit: `fix(motor): feriados desde Presencio (config_json moduloHorasProyecto)`.

**Criterio de aceptación:** los feriados vienen de `empresas.config_json` de Presencio (sin tabla propia); no figuran como faltas y pagan recargo cuando corresponde.

### Task 2.6: Idempotencia de recibos emitidos + hash [⚙️ esfuerzo medio]

**Files:** Modify `index.ts:617-656` · Modify `src/utils/reciboHash.js`, `reciboPdf.js:180`.

- [ ] **Step 1:** Si una liquidación ya tiene `numero_recibo`, el recálculo del período debe bloquearse (mensaje claro) o anular la versión previa (`anular_liquidacion`) y crear v+1. Decidir con el usuario; recomendado: bloquear recálculo una vez emitido.
- [ ] **Step 2:** Hash del PDF final (con número) y/o contenido determinista (fijar metadata de jsPDF). Verificar que dos regeneraciones del mismo recibo den el mismo hash.
- [ ] **Step 3:** Tests de `reciboHash`. Commit.

**Criterio de aceptación:** no existen dos montos distintos bajo un mismo `numero_recibo`; el hash autentica el recibo final.

### Task 2.7: Horas extra y presentismo UOCRA + hora de la zona horaria [⚙️ esfuerzo medio-alto]

**Files:** Create seed de conceptos UOCRA (`hora_extra_50/100`, `presentismo`) · Modify `asistencia.ts:94-95` (zona horaria) · `index.ts` variables.

- [ ] **Step 1:** Corregir `asistencia.ts` para extraer fecha/hora con la zona del establecimiento (Argentina UTC-3), no slice del ISO crudo.
- [ ] **Step 2:** Conceptos seed UOCRA: HE con base `valor_hora × 1.5/2 × horas_extra_50/100`; presentismo 0/50/100% (patrón de reglas existente). **Jornada UOCRA = 9 h/día, 44 h/semana** (artículo e-sueldos, hallazgo 27) — usar `jornada_horas` de Task 2.12, no el hardcode 8.
- [ ] **Step 3:** Decidir con el usuario/contador el divisor de la hora extra para mensual y quincenal.
- [ ] **Step 4:** Tests (2 HE 50%, 1 HE 100%, presentismo con 1 y 2 tardanzas). Commit.

**Criterio de aceptación:** el recibo UOCRA incluye HE y presentismo correctos; tardanzas sin desvío de 3h por zona.

### Task 2.8: Golden tests UOCRA + casos reales [⚙️ esfuerzo medio]

**Files:** Create `packages/motor/golden/fixtures/` (UOCRA) · Modify `golden.test.ts`.

- [ ] **Step 1:** Fixtures con casos UOCRA quincenales: básico por jornada, HE, presentismo, SAC, tope mensual, liquidación final con vacaciones proporcionales.
- [ ] **Step 2:** Extender `golden.test.ts` con las fórmulas seed reales.
- [ ] **Step 3:** Commit.

**Criterio de aceptación:** los casos UOCRA cierran dentro de $1 contra cálculo manual.

### Task 2.9: Gate externo — validación con contador laboralista [⚙️ esfuerzo medio, no código]

- [ ] **Step 1:** Conseguir 5–10 recibos UOCRA reales (Asset/piloto) y armar fixtures.
- [ ] **Step 2:** Emitir un recibo con la app y que un contador laboralista valide contra su cálculo manual (documentar resultado en `docs/`).
- [ ] **Step 3:** Corregir divergencias que surjan (volver a tasks 2.1–2.8 si aplica).

**Criterio de aceptación:** un contador laboralista valida por escrito que el recibo cierra. **Este es el gate real antes de liquidar sueldos de verdad.**

### Task 2.10: Fixes menores del motor [⚙️ esfuerzo bajo]

- [ ] **Step 1:** `interprete.ts:368` `round` con flotantes → `Math.round((x + Number.EPSILON) * 100) / 100`.
- [ ] **Step 2:** `tope_sipa` con `valor` vacío → `Number('')===0` topea todo en $0 (`index.ts:267,807`): validar parseo.
- [ ] **Step 3:** Vacaciones gozadas de jornalizados con remuneración normal y habitual (`especiales.ts:53-57`), no solo básico×8.
- [ ] **Step 4:** Días trabajados del mes de baja = días calendario − ausencias injustificadas del tramo (`index.ts:1043-1046`).
- [ ] **Step 5:** Tests + commit.

### Task 2.11: Descuentos y contribuciones sobre el remunerativo TOTAL del período (bug reportado por el usuario) [⚙️ esfuerzo medio-alto]

**Files:** Modify `packages/motor/src/motor.ts:88-101` (`liquidarConceptos`) · Modify `src/components/config/TabAdicionales.jsx:25` si aplica · Tests.

> **Bug (hallazgo 23):** un concepto nuevo con `config.base='remunerativo'` insertado con `orden=max+1` (p.ej. 206, después de descuentos 100-103 y contribuciones 200-205) NO entra en `remunerativo_acumulado` cuando se evalúan jubilación/obra social/contribuciones. Es un problema de ORDEN de evaluación: el motor depende del `orden` que asigna la UI.

- [ ] **Step 1:** Test que falla: básico (10) + adicional remunerativo (206) + jubilación 11% (100) → esperado 11% de (básico+adicional); hoy da 11% de solo básico.
- [ ] **Step 2:** Cambiar `liquidarConceptos` para separar la evaluación en dos pasadas: **pasada 1** todos los conceptos remunerativos/no remunerativos (en orden) acumulando el total; **pasada 2** descuentos y aportes patronales calculando sobre el acumulado COMPLETO (básico + adicionales + HE + presentismo). Mantener el orden para el recibo, pero la base de cálculo ya no depende de él.
- [ ] **Step 3:** Evaluar el impacto en `remunerativo_acumulado` de conceptos encadenados (ej. presentismo % del acumulado): decidir si la pasada 2 usa `remunerativo_total` (nueva variable) o si se reordena por `tipo`. Verificar que `basico_periodo`, SAC y consolidación mensual (Task 2.3) no se rompen.
- [ ] **Step 4:** Test de regresión: dos adicionales + HE + presentismo + jubilación/OS → base = suma de todos los remunerativos. Golden UOCRA (Task 2.8) cubre el caso.
- [ ] **Step 5:** Commit: `fix(motor): descuentos y contribuciones sobre remunerativo total del período`.

**Criterio de aceptación:** agregar cualquier adicional remunerativo desde la UI lo suma a la base de jubilación/OS/contribuciones, sin reordenar conceptos a mano.

### Task 2.12: Config de horas extras y tope por empresa [⚙️ esfuerzo medio]

**Files:** Create `supabase/migrations/0047_config_horas_extras.sql` · Modify `supabase/functions/liquidar-periodo/index.ts:548` y `:264-273` · Modify `packages/motor/src/asistencia.ts:26-30` · Tests.

> **Pedido del usuario (hallazgo 24):** configurable si la empresa contabiliza horas extras o no, topeando horas trabajadas contra horas máximas por quincena/mes. Mejores prácticas: tope 12 h diarias, 12 h entre jornadas, 35 h semanales; aviso antes de liquidar; jornada por convenio (UOCRA = 9 h/día, 44 h/semana).

- [ ] **Step 1:** Migración `0047`: tabla `nom_config_horas` (empresa_id PK, `contabilizar_horas_extras BOOLEAN DEFAULT true`, `tope_horas_diarias NUMERIC`, `tope_horas_semanales NUMERIC`, `tope_horas_quincena NUMERIC`, `tope_horas_mes NUMERIC`, `jornada_horas NUMERIC`, updated_at) + RLS por `auth_empresa_id()` (patrón `nom_empresa_config` 0021). Alternativa si se prefiere menos tablas: columnas en `nom_empresa_config`.
- [ ] **Step 2:** `liquidar-periodo` carga la config y la pasa a `calcularAsistencia`: si `contabilizar_horas_extras=false`, las horas que exceden `tope_horas_quincena/mes` no se pagan como extra (se topean). `jornadaHoras` sale de la config (por convenio) en vez del hardcode `parcial?4:8`.
- [ ] **Step 3:** Aviso (warning) en la respuesta si alguna persona supera el tope, para mostrarlo antes de liquidar.
- [ ] **Step 4:** Tests: con extras true → HE 50/100 se pagan; con false y exceso → horas topeadas; tope diario 12 h; jornada UOCRA 9 h.
- [ ] **Step 5:** UI: toggle "contabilizar horas extras" + campos de tope en Configuración → Empresa (tab `TabEmpresa.jsx`). Commit.

**Criterio de aceptación:** la empresa elige si paga horas extra y con qué tope, sin cambiar código; el aviso de exceso aparece antes de liquidar.

### Task 2.13: Adicionales UOCRA del artículo e-sueldos [⚙️ esfuerzo medio]

**Files:** Seed de conceptos/adicionales UOCRA (convenio 76/75) · Validate contra `docs/fixtures/` · Tests.

> **Del artículo e-sueldos (hallazgo 27):** jornada 9 h/día, 44 h/semana (convenio); pausa paga 20 min (hora trabajada); asistencia perfecta 20% (básico + zona desfavorable); zona desfavorable (por escala geográfica); trabajos insalubres (6 h → paga 8 h); título habilitante; gasto de traslado (no remunerativo, 4 h/2,5 h equivalentes); vestimenta (no remunerativo, 2 jornales semestrales, >6 meses antigüedad); tarea específica (10-25%).

- [ ] **Step 1:** Modelar como conceptos seed (convenio UOCRA) los que son fijos: `zona_desfavorable` (% del básico), `trabajo_insalubre` (adicional 6h→8h), `tarea_especifica` (10-25%). Los de asignación por persona (asistencia perfecta, título habilitante, traslado, vestimenta) ya se soportan con `nom_legajo_adicionales` (0040) + `base:'basico'` (formulas.ts:28) — validar con un ejemplo.
- [ ] **Step 2:** Asistencia perfecta 20%: no es un concepto seed fijo (depende de inasistencias) — definir con el contador si entra como regla en `presentismo` (Task 2.7) o como adicional por legajo.
- [ ] **Step 3:** Validar cada adicional contra el artículo y el contador (Task 2.9). Tests por concepto.
- [ ] **Step 4:** Commit.

**Criterio de aceptación:** los adicionales UOCRA del artículo están modelados y validados; un jornal con zona desfavorable e insalubridad cierra contra cálculo manual.

---

## Fase 3 — Robustez del frontend (bloqueante de integridad)

### Task 3.1: Guardia de secuencia en liquidación (race condition C1) [⚙️ esfuerzo medio]

**Files:** Modify `src/store/liquidacionStore.js:127-138` y `src/pages/LiquidacionPage.jsx:108-112,159-163`.

- [ ] **Step 1:** Contador `seq` en `cargarLiquidaciones` y `calcularPeriodo` (patrón de `legajoStore.js:89-92`): descartar respuestas obsoletas.
- [ ] **Step 2:** Deshabilitar `SelectorPeriodo` mientras `calculando`; `handleCalcular` verifica que el período sigue siendo el seleccionado antes de aplicar.
- [ ] **Step 3:** Resetear `seleccionadas` y `busqueda` al cambiar de período (`M1`).
- [ ] **Step 4:** Test de la página (existe `LiquidacionPage.test.jsx` como patrón) simulando respuestas desordenadas. Commit.

**Criterio de aceptación:** cambiar de período durante el cálculo nunca muestra/exporta/emite datos del período equivocado.

### Task 3.2: ErrorBoundary global + estados de error consistentes [⚙️ esfuerzo medio]

**Files:** Create `src/components/ErrorBoundary.jsx` · Modify `src/main.jsx`.

- [ ] **Step 1:** ErrorBoundary de clase alrededor de `<App/>` con pantalla de error + botón "Recargar". Log del error a consola (y reporter si existe en el futuro).
- [ ] **Step 2:** Mappers de stores defensivos: validar la forma de fila antes de acceder (evitar throw en render) — al menos en `liquidacionStore`, `legajoStore`, `aprobacionesStore`.
- [ ] **Step 3:** Commit.

**Criterio de aceptación:** un registro corrupto muestra un error recuperable, no pantalla blanca.

### Task 3.3: `try/catch` en acciones que pueden trabarse [⚙️ esfuerzo medio]

**Files:** `src/store/liquidacionStore.js:59-125`, `authStore.js:83-139`, y resto de stores (M8).

- [ ] **Step 1:** `calcularPeriodo`/`crearPeriodoFinal`/`crearPeriodoVacaciones`: `try/catch`; en catch `set({calculando:false, error})`, borrar best-effort el período recién insertado si falla (evita huérfanos), retornar `{ok:false,error}`.
- [ ] **Step 2:** `login` y `cargarSesion`: `try/catch`; en catch `cargando:false` y mensaje "no se pudo contactar el servidor". `LoginPage` revierte `Ingresando…`.
- [ ] **Step 3:** Repasar los demás stores (`documentosStore`, `empresaConfigStore`, `flujosStore`, `aprobacionesStore`, etc.) con el mismo patrón.
- [ ] **Step 4:** Tests de stores (ya existen `liquidacionStore.test.js`, `authStore.test.js`). Commit.

**Criterio de aceptación:** con Supabase caído, ninguna pantalla queda trabada para siempre ni se crean períodos huérfanos.

### Task 3.4: Robustez de datos y navegación [⚙️ esfuerzo bajo]

**Files:** Múltiples (ver hallazgos 17).

- [ ] **Step 1:** M2 — `seq`/cancelación en `LiquidacionPage` (empresa), `ReportesPage`, `LiquidacionesIndividuales`.
- [ ] **Step 2:** M3 — limpiar datos viejos al fallar la carga (o indicar "datos del período anterior").
- [ ] **Step 3:** M4 — `key` estable por fila en `TabFlujo.jsx:64` y `EditorReglas.jsx:47`.
- [ ] **Step 4:** M5 — `URL.revokeObjectURL` diferido (`setTimeout 1000`) en `LiquidacionPage` y `exportCsv`.
- [ ] **Step 5:** M6 — ante fallo de `whoami`, resolver perfil restrictivo (rol null, roles []) en vez de `user_metadata`.
- [ ] **Step 6:** M7 — reemplazar `new Function` de preview por un parser mínimo reutilizando `packages/motor/src/interprete.ts` (que ya es seguro, sin eval).
- [ ] **Step 7:** M9 — `AprobacionesPage` filtra por `empresaActiva?.id` y depende de él.
- [ ] **Step 8:** B6 — resetear `documentosStore` al cambiar de legajo. Commit por grupo.

**Criterio de aceptación:** sin datos de otra empresa/legajo/período visibles por stale state; sin descargas abortadas.

---

## Fase 4 — UX/UI para PYME

### Task 4.1: Aprobaciones con detalle visible [⚙️ esfuerzo medio]

**Files:** Modify `src/pages/AprobacionesPage.jsx` y `src/store/aprobacionesStore.js`.

- [ ] **Step 1:** Resumen por instancia: total bruto, descuentos, neto, cantidad de liquidaciones (agregado de `nom_liquidaciones` por `periodo_id`).
- [ ] **Step 2:** Link "Ver detalle" → `/liquidacion?periodo=<id>`.
- [ ] **Step 3:** Rechazo con comentario obligatorio. Paginación (`usePaginado.js`). Recarga al volver al foco (hoy solo en mount).
- [ ] **Step 4:** Tests + commit.

**Criterio de aceptación:** el aprobador ve los importes antes de decidir; el rechazo exige motivo.

### Task 4.2: Usuarios identificables + confirmación de quita [⚙️ esfuerzo bajo]

**Files:** Modify `src/store/usuariosStore.js` y `src/pages/UsuariosPage.jsx`.

- [ ] **Step 1:** Traer el email real: RPC `listar_usuarios_empresa(empresa_id)` SECURITY DEFINER cruzando `auth.users.email` (validando rol admin), o guardar el email en el vínculo al invitar.
- [ ] **Step 2:** Mostrar email en vez de `usuarioId.slice(0,8)` (`UsuariosPage.jsx:62`). Confirmación antes de "Quitar". Estado vacío.
- [ ] **Step 3:** Commit.

### Task 4.3: Toasts globales [⚙️ esfuerzo medio]

**Files:** Create `src/components/Toast.jsx` + `src/store/toastStore.js` · Modify `App.jsx`/`Layout.jsx` y páginas de acción.

- [ ] **Step 1:** Store de toasts (`push`, autoDismiss 5s, `aria-live="polite"`).
- [ ] **Step 2:** Conectar: enviar a aprobación, aprobar/rechazar, guardar escala/empresa, cerrar período, emitir recibos, invitar usuario, clonar convenio. Reemplazar mensajes temporales de `TabEmpresa.jsx:25,109` y `UsuariosPage.jsx:52`.
- [ ] **Step 3:** Tests + commit.

### Task 4.4: Recuperación de contraseña [⚙️ esfuerzo bajo]

**Files:** Modify `src/pages/LoginPage.jsx` · Configurar redirect en Supabase.

- [ ] **Step 1:** `supabase.auth.resetPasswordForEmail(email)` + respuesta genérica ("si la cuenta existe, recibirás un email").
- [ ] **Step 2:** Configurar URL de redirect en el dashboard. Commit.

### Task 4.5: Onboarding de primeros pasos [⚙️ esfuerzo medio-alto]

**Files:** Create utilidad `progresoOnboarding()` (patrón `legajoCompletitud.js`) + banner en `DashboardPage`/`ConfiguracionPage`.

- [ ] **Step 1:** Hitos: empresa → clonar convenio → escalas básicas → documentación → flujo de aprobación → primera alta → primer período.
- [ ] **Step 2:** Banner con progreso y navegación al tab correspondiente; desaparece al completar.
- [ ] **Step 3:** Tests + commit.

### Task 4.6: Unificar cierre de período [⚙️ esfuerzo bajo]

**Files:** Modify `LiquidacionPage.jsx:143-151` · Extraer `verificarEscalaVigente()` de `ReportesPage.jsx:116-150` a `src/utils/`.

- [ ] **Step 1:** Helper compartido (puro, testeable).
- [ ] **Step 2:** `handleCerrarPeriodo` con validación de escala vencida + confirmación. Un solo punto de cierre.
- [ ] **Step 3:** Commit.

### Task 4.7: Pulidos de accesibilidad y estados vacíos [⚙️ esfuerzo medio]

**Files:** Dashboard (tarjetas semánticas + navegar con período preseleccionado), LiquidacionPage (filas `aria-expanded`, estado vacío, separar "Borrar período"), modales (`AsistenteAlta`, `BorrarPeriodo` focus trap + Escape), `index.css` (clase `select` inexistente usada en `LegajosPage.jsx:98`), `Layout.jsx` (sidebar `inert` en móvil), formularios con `<form onSubmit>` y labels `htmlFor`.

- [ ] **Step 1–N:** Aplicar por archivo (detalle en hallazgos de UX de la 1ª pasada y en B3/B4 del informe de frontend).
- [ ] **Step N+1:** Commit por grupo.

---

## Fase 5 — Importador de paritarias con IA [⚙️ esfuerzo medio-alto]

> **Plan fuente:** `docs/superpowers/plans/2026-07-29-importador-paritarias-ia.md` (código completo ya escrito, tests incluidos). Esta fase lo integra al plan maestro **con tres correcciones obligatorias** (hallazgo 22):
> 1. La migración se **renumera** de `0039` a `0045` (0039 ya está ocupada por `basico_unidad_base`).
> 2. La Edge Function `importar-paritaria` **valida JWT + empresa + rol** antes de actuar (patrón de Task 1.1). El plan original tomaba `empresa_id` del body y escribía con service-role → cross-tenant.
> 3. La policy del bucket `paritarias` **aísla por empresa** (`storage.foldername(name)[1] = auth_empresa_id()`), igual que Task 1.3.
>
> **Objetivo:** subir un acta en PDF/Word → Haiku extrae básicos y no remunerativos → el usuario revisa un diff fila por fila → recién ahí `aplicar_paritaria()` escribe. La extracción nunca escribe sola; la propuesta guarda lo que salió del modelo y `aplicado` lo que confirmó el humano (evidencia de revisión).
>
> **No implementar por las suyas (fuera de alcance del importador):** versionar `nom_conceptos` (aportes/contribuciones/adicionales no tienen vigencia → importarlos pisaría historia), pago SNR por mitades, aporte solidario 2%, columna `zona` en `nom_categorias`.
>
> **Multi-CCT (hallazgo 26):** el sistema es multi-tenant; el importador debe funcionar para otros convenios además de UOCRA 76/75. Parametrizar por convenio: categorías a extraer, zonas, jornada. No hardcodear CCT 76/75 en el prompt ni en el parseo.

### Task 5.1: Utilidades puras — normalización, emparejamiento, zona, diff, validación [⚙️ esfuerzo medio]

**Files:** Create `src/utils/importarParitaria.js` · Create `src/utils/__tests__/importarParitaria.test.js`.

- [ ] **Step 1:** Escribir el test (normalizarNombre con pre-paso `½ → medio` ANTES de descartar símbolos — regresión crítica: sin el pre-paso "½ Oficial" matchea "Oficial" y paga de menos sin avisar; `emparejarCategorias` con alias curados a mano, sin distancia de edición; `filtrarPorZona`; `construirDiff` con `deltaPct null` cuando el vigente es 0 y `sospechoso` >100% o básico ≤0; `validarPropuesta`). Código en `2026-07-29-importador-paritarias-ia.md` Task 1-2.
- [ ] **Step 2:** Verificar que falla (`npx vitest run src/utils/__tests__/importarParitaria.test.js`).
- [ ] **Step 3:** Implementación mínima (copiar el código del plan fuente: `importarParitaria.js` completo).
- [ ] **Step 4:** Verificar que pasa (14 tests). Commit.

**Criterio de aceptación:** "½ Oficial" cae en "Medio oficial"; lo no reconocido va a `huerfanas` sin adivinar; básicos ≤0 se marcan sospechosos y deseleccionados.

### Task 5.2: Migración `0045` — tabla de importaciones, bucket y RPC transaccional [⚙️ esfuerzo medio]

**Files:** Create `supabase/migrations/0045_importaciones_paritarias.sql`.

- [ ] **Step 1:** Copiar la migración del plan fuente (`0039_importaciones_paritarias.sql`), **renumerando el nombre a `0045`**: tabla `nom_importaciones` (empresa_id, convenio_id, archivo_path/nombre, zona, propuesta JSONB, aplicado JSONB, usuario_id) + RLS con `auth_empresa_id()`/`is_superadmin()` + bucket privado `paritarias` + RPC `aplicar_paritaria` SECURITY DEFINER.
- [ ] **Step 2:** **Corrección #3:** la policy del bucket NO puede ser solo `bucket_id = 'paritarias'` (eso deja las actas de todas las empresas visibles para cualquiera logueado). Usar `USING (bucket_id = 'paritarias' AND storage.foldername(name)[1] = (select auth_empresa_id())::text)` y `WITH CHECK` equivalente (mismo patrón que Task 1.3).
- [ ] **Step 3:** **Corrección #1 en el RPC:** `aplicar_paritaria` ya valida `v_convenio.empresa_id IS DISTINCT FROM v_empresa` → OK. Verificar además que `p_importacion_id` pertenezca a la empresa (evita marcar como aplicada una importación ajena): `SELECT ... INTO ... FROM nom_importaciones WHERE id = p_importacion_id AND empresa_id = v_empresa; IF NOT FOUND THEN RAISE EXCEPTION 'importacion inexistente o ajena';`.
- [ ] **Step 4:** Parsear con sqlglot, aplicar contra dev, probar la RPC con una vigencia descartable (`2099-01-01`) y limpiar. Commit.

**Criterio de aceptación:** `nom_importaciones` aislada por empresa; `aplicar_paritaria` falla para convenio o importación de otra empresa; la prueba de vigencia `2099-01-01` se limpia sola.

### Task 5.3: Edge Function `importar-paritaria` con auth [⚙️ esfuerzo medio]

**Files:** Create `supabase/functions/importar-paritaria/index.ts`.

- [ ] **Step 1:** Copiar la función del plan fuente (PDF crudo como bloque `document`, DOCX vía `zipjs`, `tool_choice` forzado `cargar_paritaria`, prompt con reglas de formato argentino, `claude-haiku-4-5-20251001`). **Parametrizar el CCT** (hallazgo 26): el prompt recibe `convenio.codigo`/categorías en vez de asumir 76/75, y el parseo de zonas es por convenio.
- [ ] **Step 2:** **Corrección #2 (seguridad):** anteponer validación JWT/empresa/rol con el patrón de Task 1.1: cliente anon + `auth.getUser()`; 401 sin token; cargar `empresa_id`/`convenio_id` del body y validar vínculo en `nom_usuarios_empresas` (usuario_id + empresa_id) con rol ∈ `['admin','rrhh']` o superadmin (mismo criterio que `liquidar-periodo`); 403 si no. El path del archivo usa `empresa_id` del **JWT validado**, no del body.
- [ ] **Step 3:** `npx supabase secrets set ANTHROPIC_API_KEY=<key>` (nunca en `.env.local`). Desplegar `npx supabase functions deploy importar-paritaria`.
- [ ] **Step 4:** Probar con el acta real `docs/fixtures/acta-76-75-junio-2026.pdf` (esperado: 3 tramos 2026-06/07/08 y 5 categorías con básicos > 0). Commit.

**Criterio de aceptación:** sin JWT → 401; empresa ajena o rol consulta → 403; con rol admin/rrhh → propuesta con 3 tramos.

### Task 5.4: Store + permiso + pestaña UI [⚙️ esfuerzo medio]

**Files:** Create `src/store/importacionesStore.js` · Modify `src/utils/permisos.js:19` + `src/utils/__tests__/permisos.test.js` · Create `src/components/config/TabImportarParitaria.jsx` + test · Modify `src/pages/ConfiguracionPage.jsx:31`.

- [ ] **Step 1:** Store (plan fuente Task 5): `analizar` (FileReader → base64 → `supabase.functions.invoke('importar-paritaria')`), `aplicar` (`supabase.rpc('aplicar_paritaria')`), `limpiar`. Sin `persist` (trae remuneraciones). Agregar los `try/catch` de red que exige la Fase 3.
- [ ] **Step 2:** Permiso `importar_paritaria` (plan fuente Task 5b). ⚠ **Decisión pendiente con el usuario:** el plan usa `['admin','rrhh']`; si se prefiere alinear con `editar_configuracion` (`['admin']`), cambiar el array y el test. El gating real es la RLS de `nom_categorias` + validación en `aplicar_paritaria`.
- [ ] **Step 3:** `TabImportarParitaria.jsx` (plan fuente Task 6): 4 estados (cargar archivo → leyendo → diff por tramo con checkboxes y badge "revisar" → aplicar por vigencia), categorías no reconocidas separadas, avisos de `validarPropuesta`.
- [ ] **Step 4:** Enganchar la pestaña en `ConfiguracionPage.jsx` gating por `puede(rolesNomina, 'importar_paritaria')`. Correr toda la suite (`npm test`). Commit.

**Criterio de aceptación:** admin/rrhh ven la pestaña y aplican; consulta ve el cartel de sin permiso; destildar una fila la excluye al confirmar.

### Task 5.5: Verificación end-to-end con el acta real [⚙️ esfuerzo medio, no código]

- [ ] **Step 1:** En la app, Configuración → Convenios → convenio propio → Importar paritaria → zona A → subir `docs/fixtures/acta-76-75-junio-2026.pdf`. Esperado: 3 tramos, 5 categorías emparejadas, "½ Oficial" en Medio oficial, 0 huérfanas.
- [ ] **Step 2:** Aplicar solo la vigencia 2026-06-01; verificar 5 filas en `nom_categorias` y que las vigencias anteriores siguen intactas.
- [ ] **Step 3:** Verificar en `nom_importaciones` que `tramos_propuestos = 3` y `tramos_aplicados = 1` (evidencia de revisión humana).
- [ ] **Step 4:** Probar rechazo de `.txt` renombrado a `.pdf` → error legible, sin filas nuevas. Commit final.

---

## Fase 6 — Fiscal (manual; sin SICOSS)

**Decisión del usuario (2026-07-31): SICOSS NO se implementa.** El F.931 lo presenta el estudio contable manualmente a partir de los reportes que la app ya exporta. Queda documentar el flujo y dejar SiRADIG/Ganancias como opcionales.

### Task 6.1: Documentar el flujo fiscal manual [⚙️ esfuerzo bajo]

- [ ] **Step 1:** Doc corto (`docs/FISCAL-FLOW.md`): cómo el estudio genera el reporte de aportes/contribuciones (ReportesPage → CSV), cómo lo vuelca al F.931 en el portal de ARCA, y la cadencia (mensual, dentro del día 10 del mes siguiente o el plazo vigente).
- [ ] **Step 2:** Validar la cadencia y el detalle con el estudio contable de la PYME.
- [ ] **Step 3:** Commit del doc.

### Task 6.2 (opcional, diferida): Import SiRADIG [⚙️ medio-alto]

**Solo si el usuario lo pide más adelante.** Según `docs/2026-07-29-plan-f931-siradig-ganancias.md` §3: tablas `nom_siradig_presentaciones/items`, `parsearSiradig.js`, `ImportarSiradig.jsx`, `TabGanancias.jsx`, acción `ver_ganancias` en `permisos.js`.

### Task 6.3 (opcional, diferida): Motor de Ganancias RG 4003 [⚙️ alto]

**Solo si el usuario lo pide más adelante.** Requiere `nom_ganancias_acumulado` inmutable, escala art. 94, 3 liquidaciones reales como golden. Sin esto, Ganancias sigue siendo concepto manual (como hoy).

---

## Fase 7 — Operación y repo

### Task 7.1: CI en GitHub Actions [⚙️ esfuerzo medio]

**Files:** Create `.github/workflows/ci.yml`.

- [ ] **Step 1:** Jobs: `lint` (`npm run lint`), `test` (`npx vitest run`), `rls` (con credenciales vía secrets), `build` (smoke).
- [ ] **Step 2:** Usar `actions/setup-node@v4` con `node-version: 22`.
- [ ] **Step 3:** Commit.

**Criterio de aceptación:** un push rompe la CI ante errores de lint/tests/RLS/build.

### Task 7.2: Bundle y performance [⚙️ esfuerzo medio]

**Files:** Modify `vite.config.js`, `src/App.jsx`.

- [ ] **Step 1:** `React.lazy` + `Suspense` por ruta (las páginas pesadas, mínimo `DashboardPage` que arrastra recharts).
- [ ] **Step 2:** `build.rollupOptions.output.manualChunks` para separar vendor (react, supabase, recharts, zustand). Objetivo: chunk principal < 300 kB gzip.
- [ ] **Step 3:** Verificar con `npm run build` que el chunk principal baja. Commit.

### Task 7.3: Emails de notificación del flujo [⚙️ esfuerzo medio]

**Files:** Edge Function de notificación (patrón Resend de `invitar-usuario`) o hook en `avanzar_flujo`.

- [ ] **Step 1:** Avisar al responsable del siguiente paso ("Tenés una liquidación para aprobar"). Fallback silencioso sin API key.
- [ ] **Step 2:** Commit.

### Task 7.4: README, motor como workspace, config.toml, limpieza [⚙️ esfuerzo bajo]

- [ ] **Step 1:** README real (qué es, cómo correr, estructura, deploy). Commit.
- [ ] **Step 2:** Declarar `packages/motor` en `workspaces` de `package.json` (hoy tiene su propio node_modules/lock).
- [ ] **Step 3:** Crear `supabase/config.toml` mínimo y reproducible (auth, storage, `verify_jwt = true` en edge functions).
- [ ] **Step 4:** Borrar `.git_broken/` y `.git_broken2/` (residuos) con OK del usuario.
- [ ] **Step 5:** Backups: doc + opción de `pg_dump` programado (Supabase dashboard daily backups o script en cron del dueño). Documentar en README.

### Task 7.5 (no urgente): Migrar de `react-router-dom` a `react-router@8.3.0`

- [ ] **Step 1:** Cuando el equipo lo decida: cambiar imports (`react-router-dom` → `react-router`), `npm audit` queda en 0 highs. Verificar rutas/lazy. Commit.

---

## Fase 8 — Futuro post-v1 (opcional)

- **Portal del empleado** — el empleado ve sus recibos y firma digital (fase original del master plan, fuera de v1).
- **SICOSS** — revertido a futuro, solo si un cliente lo exige (hoy decisión: no).
- **LSD** — descartado por Decreto 407/2026.

---

## Resumen de esfuerzo estimado

| Fase | Esfuerzo | Prioridad |
|---|---|---|
| 0 — Preparación | ½ día | Bloqueante |
| 1 — Seguridad | 3–5 días | Bloqueante |
| 2 — Correctitud del motor | 7–10 días + gate contador | **Bloqueante (números ilegales hoy)** |
| 3 — Robustez frontend | 3–5 días | Alta (integridad de datos) |
| 4 — UX/UI | 5–7 días | Alta (no bloqueante) |
| 5 — Importador de paritarias IA | 2–3 días | Alta (no bloqueante) |
| 6 — Fiscal | ½ día (doc) | Baja (manual) |
| 7 — Operación | 2–3 días | Paralela desde Fase 1 |
| 8 — Futuro | N/A | Post-v1 |

**Camino crítico a producción:** Fase 0 → Fase 1 (seguridad) + Fase 2 (motor correcto, **empezando por Task 2.11 — base sobre remunerativo total — y 2.1 SAC**) → **gate externo: contador laboralista + recibos reales UOCRA** → recién ahí liquidaciones reales. Fase 3 en paralelo con 1 y 2. Fase 4 después de 3. Fase 5 (importador) en paralelo desde el fin de Task 1.1. Fiscal manual ya mismo.
