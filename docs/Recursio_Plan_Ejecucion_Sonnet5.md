# Recursio — Plan de ejecución para Claude Sonnet 5 (esfuerzo medio)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir Recursio, la app de nómina del ecosistema Presencio (legajo digital, motor de liquidación configurable AR, flujos de aprobación, reportes de pago y aportes), según el diseño aprobado en `Recursio_Diseno.md`.

**Architecture:** Frontend React 19 + Vite separado (repo `recursio`), mismo proyecto Supabase que Presencio (Postgres + RLS por `empresa_id`, Auth compartido, Storage privado). Tablas nuevas con prefijo `nom_`, lectura de Presencio solo vía vistas contrato `nom_v_*`. Motor de liquidación en Edge Function (Deno/TS) con intérprete de fórmulas declarativas + reglas condicionales.

**Tech Stack:** React 19, Vite, Zustand (sin persist para datos salariales), react-router-dom 7, lucide-react, recharts, date-fns, jsPDF, @supabase/supabase-js 2, Supabase Edge Functions (Deno), Vitest.

---

## Instrucciones para el agente ejecutor (leer antes de la Tarea 1)

1. **Modelo:** ejecutar con Claude Sonnet 5, esfuerzo medio. Una tarea por sesión/subagente; leé la tarea completa antes de tocar código.
2. **Documento de diseño:** `Recursio_Diseno.md` (misma carpeta) es la fuente de verdad funcional. Ante ambigüedad, ese documento manda; si tampoco resuelve, preguntar al usuario, no inventar.
3. **TDD siempre:** test que falla → verificar que falla → implementación mínima → test pasa → commit. Nunca marcar una tarea completa con tests fallando.
4. **Migraciones:** SOLO en `supabase/migrations/NNNN_nombre.sql`, numeradas, idempotentes (`IF NOT EXISTS`). Nunca SQL suelto en la raíz (lección del review de Presencio).
5. **Seguridad:** toda tabla nueva nace con RLS habilitada y política por `empresa_id = auth_empresa_id()` en el MISMO archivo de migración que la crea. Toda RPC `SECURITY DEFINER` valida empresa y rol en su cuerpo. Cada fase incluye tests de RLS cruzada.
6. **Datos sensibles:** el store de Zustand NO usa `persist` para liquidaciones, recibos, CBU ni remuneraciones. Buckets de Storage privados, URLs firmadas de ≤ 5 min.
7. **No tocar Presencio** salvo lo explícitamente listado en la Tarea 3 (vistas contrato) y `tipos_documento.ambito` (Tarea 12). Nunca borrar archivos sin consentimiento del usuario.
8. **Idioma:** UI y mensajes en español (Argentina). Código, tablas y comentarios en el estilo de Presencio (español).
9. **Commits frecuentes:** un commit por paso de implementación, mensajes `feat:`/`fix:`/`test:`/`chore:`.
10. **Expansión por fase:** este documento detalla la Fase 0 paso a paso y define las tareas de las fases 1–4 con archivos, esquemas y criterios. **Al iniciar cada fase ≥ 1, el agente DEBE regenerar el detalle bite-sized de esa fase con la skill `superpowers:writing-plans`**, usando este documento + el diseño como spec, y presentarlo al usuario antes de ejecutar.

---

# FASE 0 — Fundaciones (detallada paso a paso)

## Task 1: Scaffold del repo

**Files:**
- Create: repo `recursio/` (hermano de `fichaobra/`), `package.json`, `vite.config.js`, `eslint.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`, `.gitignore`, `.env.example`
- Create: `vercel.json` (copiar rewrites SPA de `fichaobra/vercel.json`)

- [ ] **Step 1:** Crear el proyecto: `npm create vite@latest recursio -- --template react` y `cd recursio && git init`.
- [ ] **Step 2:** Instalar dependencias exactas del stack:

```bash
npm i @supabase/supabase-js react-router-dom zustand lucide-react recharts date-fns jspdf
npm i -D vitest @vitest/coverage-v8 eslint eslint-plugin-react-hooks
```

- [ ] **Step 3:** Copiar de `fichaobra/`: `eslint.config.js`, estructura `src/{components,pages,store,lib,hooks,utils}`, y `.gitignore` agregando `.DS_Store` y `.env*`.
- [ ] **Step 4:** `.env.example` con `VITE_SUPABASE_URL=` y `VITE_SUPABASE_ANON_KEY=` (mismo proyecto que Presencio). Verificar: `npm run dev` levanta la página default.
- [ ] **Step 5:** Commit: `chore: scaffold recursio (react 19 + vite, stack presencio)`.

## Task 2: Cliente Supabase + sesión compartida

**Files:**
- Create: `src/lib/supabase.js`, `src/store/authStore.js`, `src/pages/LoginPage.jsx`, `src/components/ProtectedRoute.jsx`
- Test: `src/lib/__tests__/supabase.test.js`

- [ ] **Step 1:** Test que falla — el cliente expone `supabase.auth` y lee las env vars:

```js
// src/lib/__tests__/supabase.test.js
import { describe, it, expect } from 'vitest'
import { supabase } from '../supabase'

describe('supabase client', () => {
  it('se inicializa con auth disponible', () => {
    expect(supabase.auth).toBeDefined()
    expect(typeof supabase.from).toBe('function')
  })
})
```

Run: `npx vitest run` → Expected: FAIL (módulo no existe).

- [ ] **Step 2:** Implementar `src/lib/supabase.js` calcado del de Presencio (`fichaobra/src/lib/` — leerlo primero), mismas opciones de auth para que la sesión sea compartida entre apps.
- [ ] **Step 3:** `npx vitest run` → PASS. (Para tests, definir env vars dummy en `vitest.config` vía `define`.)
- [ ] **Step 4:** `authStore.js`: estado `{ session, usuario, empresa, rol }`, acciones `login(email, password)`, `logout()`, `cargarSesion()` que lee `user_metadata.empresa_id` y `rol` del JWT (mismo esquema que Presencio). **Sin `persist`.**
- [ ] **Step 5:** `LoginPage.jsx` (layout copiado del login de Presencio, logo Recursio placeholder) y `ProtectedRoute` que redirige a `/login` sin sesión. Verificar manualmente login con un usuario real de Presencio.
- [ ] **Step 6:** Commit: `feat: auth compartida con presencio (login + protected routes)`.

## Task 3: Vistas contrato en Supabase (única escritura sobre el proyecto compartido en esta fase)

**Files:**
- Create: `supabase/migrations/0001_vistas_contrato.sql`

- [ ] **Step 1:** Antes de crear las vistas, leer en `fichaobra/` los esquemas reales: `supabase-schema.sql`, `supabase-multitenancy.sql`, `supabase-fase6-vacaciones-aprobacion.sql` y confirmar nombres reales de columnas de `personal`, `fichajes`, `ausencias` (turno, horas, tipos). No asumir: verificar.
- [ ] **Step 2:** Migración con las tres vistas contrato (ajustar columnas a lo verificado):

```sql
-- 0001_vistas_contrato.sql — contrato de lectura Recursio→Presencio
CREATE OR REPLACE VIEW nom_v_personal AS
  SELECT p.id, p.empresa_id, p.nombre, p.dni, p.puesto, p.obra_id,
         p.turno, p.estado, p.created_at AS fecha_alta_sistema,
         p.fecha_inactivacion
  FROM personal p;

CREATE OR REPLACE VIEW nom_v_horas_dia AS
  SELECT f.empresa_id, f.personal_id, f.fecha,
         f.hora_entrada, f.hora_salida, f.horas_normales,
         f.horas_extra_50, f.horas_extra_100,
         p.turno AS turno_esperado
  FROM fichajes f JOIN personal p ON p.id = f.personal_id;

CREATE OR REPLACE VIEW nom_v_ausencias AS
  SELECT a.id, a.empresa_id, a.personal_id, a.tipo, a.fecha_desde,
         a.fecha_hasta, a.estado, a.comprobante_path
  FROM ausencias a;

-- Las vistas heredan RLS de las tablas base (security_invoker)
ALTER VIEW nom_v_personal  SET (security_invoker = true);
ALTER VIEW nom_v_horas_dia SET (security_invoker = true);
ALTER VIEW nom_v_ausencias SET (security_invoker = true);
```

- [ ] **Step 3:** Aplicar en Supabase (SQL editor o CLI). Verificar como usuario autenticado de una empresa: `select count(*) from nom_v_personal` devuelve solo su personal; con otro usuario de otra empresa, otro conteo. Documentar el resultado en el PR.
- [ ] **Step 4:** Commit: `feat: vistas contrato nom_v_* con security_invoker`.

## Task 4: Esquema base de nómina + RLS + tests de aislamiento

**Files:**
- Create: `supabase/migrations/0002_nomina_core.sql`
- Test: `tests/rls/nomina_core.rls.test.js` (integración contra Supabase con 2 usuarios de prueba de empresas distintas)

- [ ] **Step 1:** Migración con las tablas núcleo de esta fase (el resto llega en su fase): `nom_legajo`, `nom_convenios`, `nom_categorias`, `nom_parametros`. Todas con el patrón:

```sql
CREATE TABLE IF NOT EXISTS nom_legajo (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id   UUID NOT NULL UNIQUE,   -- 1:1 con personal (FK lógica vía vista)
  cuil          TEXT,
  fecha_nacimiento DATE,
  domicilio     TEXT,
  fecha_ingreso DATE,
  convenio_id   UUID,
  categoria_id  UUID,
  cbu           TEXT,
  banco         TEXT,
  obra_social   TEXT,
  jornada       TEXT DEFAULT 'completa' CHECK (jornada IN ('completa','parcial')),
  created_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_legajo ENABLE ROW LEVEL SECURITY;
CREATE POLICY nom_legajo_all ON nom_legajo FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id())
  WITH CHECK (empresa_id = auth_empresa_id());
CREATE INDEX IF NOT EXISTS nom_legajo_empresa_idx ON nom_legajo(empresa_id);
```

Repetir patrón para `nom_convenios` (con `empresa_id NULL` = plantilla global, política de SELECT `empresa_id IS NULL OR empresa_id = auth_empresa_id()`, escritura solo con `empresa_id` propio), `nom_categorias` (`convenio_id`, `nombre`, `basico`, `vigencia_desde DATE`, unique `(categoria, vigencia_desde)`), `nom_parametros` (`codigo`, `valor NUMERIC`, `vigencia_desde`, `vigencia_hasta`).

- [ ] **Step 2:** Test de RLS que falla (aún sin aplicar la migración): con service key crear 2 empresas + 2 usuarios de test; con el cliente del usuario A insertar un legajo; con el usuario B hacer `select` → debe devolver 0 filas; intentar `insert` con `empresa_id` de A desde B → debe fallar. Guardar como `tests/rls/nomina_core.rls.test.js` con Vitest (`test.skipIf(!process.env.SUPABASE_TEST_URL)` para no romper CI sin credenciales).
- [ ] **Step 3:** Aplicar migración, correr tests RLS → PASS.
- [ ] **Step 4:** Commit: `feat: esquema nomina core con rls + tests de aislamiento`.

## Task 5: Shell de la app con look & feel Presencio

**Files:**
- Create: `src/components/Layout.jsx`, `src/components/Sidebar.jsx`, `src/index.css`, `src/pages/DashboardPage.jsx` (placeholder con datos reales mínimos)
- Modify: `src/App.jsx` (router)

- [ ] **Step 1:** Leer `fichaobra/src/index.css`, `App.jsx` y el layout/sidebar reales de Presencio. Copiar variables CSS (colores por empresa `color_primario`/`color_secundario`), tipografía y componentes base (botones, tablas, badges, modales).
- [ ] **Step 2:** Router con rutas: `/login`, `/` (dashboard), `/legajos`, `/configuracion`, `/liquidacion`, `/aprobaciones`, `/reportes`, `/usuarios` — todas protegidas; las no implementadas muestran "Próximamente" con el layout completo.
- [ ] **Step 3:** Dashboard mínimo real: cantidad de personal activo (desde `nom_v_personal`) y legajos incompletos (join con `nom_legajo` sin CUIL/CBU). Verificar en navegador con la empresa de prueba.
- [ ] **Step 4:** Commit: `feat: shell recursio con look&feel presencio + dashboard minimo`.

## Task 6: Seed de convenios plantilla + deploy

**Files:**
- Create: `supabase/migrations/0003_seed_convenios.sql`, `scripts/seed-convenios.md` (documentación de la escala usada y su fuente)

- [ ] **Step 1:** Seed de `nom_convenios` plantilla (`empresa_id NULL`): "Fuera de convenio (LCT)" con categorías genéricas, y "UOCRA (Ley 22.250)" con categorías Oficial especializado / Oficial / Medio oficial / Ayudante / Sereno, `basico = 0` y `vigencia_desde = '1900-01-01'` (los valores reales de escala los carga el usuario en fase 4 — el seed define estructura, no montos, para no publicar valores desactualizados).
- [ ] **Step 2:** Deploy a Vercel (proyecto nuevo, env vars del Supabase compartido). Verificar login y dashboard en la URL de producción.
- [ ] **Step 3:** Commit + tag `fase-0`.

**CHECKPOINT FASE 0 — criterio de salida:** un usuario real de Presencio entra a Recursio con su misma cuenta, ve su personal en solo lectura y el conteo de legajos incompletos. Tests RLS verdes. Pedir revisión del usuario antes de seguir.

---

# FASE 1 — Legajo digital (tareas; expandir con writing-plans al iniciar)

**Migraciones:** `0004_legajo_completo.sql` — `nom_familiares` (vínculo, cuil, fecha_nacimiento, doc_path), `sanciones_personal` (según `PROPUESTA_legajo_digital.md`, sección 1: tipo, motivo, fecha, dias_suspension, doc_path, aplicada_por), tipos de documento de nómina en `tipos_documento` con columna nueva `ambito TEXT DEFAULT 'general'` (única modificación a una tabla de Presencio — coordinar con el usuario antes de aplicar).

| # | Tarea | Archivos clave | Criterio |
|---|---|---|---|
| 7 | Migración legajo completo + RLS + tests | `0004_legajo_completo.sql`, `tests/rls/legajo.rls.test.js` | Aislamiento entre empresas probado |
| 8 | Store de legajos (CRUD `nom_legajo`, familiares, sanciones) | `src/store/legajoStore.js` + tests unitarios de mappers | Mappers fromDB/toDB testeados |
| 9 | Página Legajos: listado con semáforo de completitud | `src/pages/LegajosPage.jsx`, `src/components/legajo/SemaforoLegajo.jsx` | "Incompleto para liquidar" si falta CUIL, CBU, convenio o categoría |
| 10 | Ficha de legajo (datos, familiares, sanciones, ausencias en lectura) | `src/components/legajo/FichaLegajo.jsx` | Secciones colapsables estilo Presencio |
| 11 | Carga de documentación (reutiliza `documentos_personal` vía Supabase, bucket privado) | `src/components/legajo/DocumentosLegajo.jsx` | Upload + badge vigente/por vencer/vencido |
| 12 | Export legajo PDF (jsPDF) | `src/utils/legajoPdf.js` + test de generación | PDF con las 5 secciones del diseño |

**CHECKPOINT FASE 1:** legajo completo de un empleado real de Asset cargado de punta a punta y exportado a PDF.

---

# FASE 2 — Motor de liquidación: fuera de convenio (expandir al iniciar)

**Componente crítico del producto. TDD estricto. El intérprete y el motor se desarrollan como paquete TS puro testeable sin Supabase (`packages/motor/`), luego se envuelve en la Edge Function.**

**Migraciones:** `0005_conceptos_y_reglas.sql` (`nom_conceptos`, `nom_conceptos_empresa`, `nom_concepto_reglas` con `orden`, `condicion TEXT`, `formula TEXT`), `0006_periodos_liquidaciones.sql` (`nom_periodos`, `nom_liquidaciones`, `nom_liquidacion_items`, `nom_pagos_adelantos`).

| # | Tarea | Archivos clave | Criterio |
|---|---|---|---|
| 13 | Intérprete de fórmulas (tokenizer + parser + eval; gramática: números, variables, `+ - * / ( )`, `min max round`, comparaciones, `and or not`, ternario `? :`) | `packages/motor/src/interprete.ts` + `interprete.test.ts` | 100% de los casos de la tabla de abajo; sin `eval`; error claro ante variable desconocida |
| 14 | Variables de asistencia desde snapshot de horas (tardanzas con tolerancia, faltas injustificadas, extras) | `packages/motor/src/asistencia.ts` + tests | Casos: tardanza vs tolerancia, falta con ausencia aprobada no cuenta |
| 15 | Motor de conceptos: orden de cálculo, acumuladores (`remunerativo_acumulado`), reglas condicionales primera-que-aplica | `packages/motor/src/motor.ts` + tests | Presentismo escalonado del diseño (4.3) calcula 0 / 50% / 100% según tardanzas |
| 16 | Casos dorados fuera de convenio (mínimo 10, fixtures JSON: entrada horas+config → recibo esperado) | `packages/motor/golden/*.json` + `golden.test.ts` | Validados contra 2-3 recibos históricos reales de Asset (pedir al usuario ANTES de esta tarea) |
| 17 | Edge Function `liquidar-periodo`: importa snapshot desde `nom_v_horas_dia`, corre el motor, escribe liquidaciones+items en transacción idempotente (borra y regenera), lock por período | `supabase/functions/liquidar-periodo/index.ts` | Reintento no duplica items; período cerrado rechaza recálculo |
| 18 | UI Configuración: conceptos y reglas (filas ordenadas, editor de condición con variables seleccionables) | `src/pages/ConfiguracionPage.jsx`, `src/components/config/EditorReglas.jsx` | Vista previa: evalúa la regla contra un empleado de ejemplo |
| 19 | UI Liquidación: abrir período → preview de horas/tardanzas con corrección manual auditada → calcular → grilla con detalle por concepto y qué regla aplicó | `src/pages/LiquidacionPage.jsx` | Reliquidar individual funciona |
| 20 | Recibo preliminar PDF (formato art. 140 LCT: datos empleador/empleado, conceptos, firmas) | `src/utils/reciboPdf.js` | Formato validado contra un recibo real |

**Casos mínimos del intérprete (Task 13):**

| Expresión | Variables | Resultado |
|---|---|---|
| `basico * 1.1` | basico=100 | 110 |
| `min(rem, tope) * 0.11` | rem=200, tope=150 | 16.5 |
| `tardanzas > 3 or faltas > 0` | tardanzas=2, faltas=1 | true |
| `antiguedad < 1 ? 0.12 : 0.08` | antiguedad=3 | 0.08 |
| `(basico / 200) * 1.5 * he50` | basico=400, he50=10 | 30 |
| `foo + 1` | — | Error: "variable desconocida: foo" |

**CHECKPOINT FASE 2:** liquidación mensual completa fuera de convenio igual al recibo histórico de referencia, centavo a centavo. **Gate externo:** revisión puntual de contador laboralista contratado.

---

# FASE 3 — Flujo de aprobación + usuarios externos (expandir al iniciar)

**Migraciones:** `0007_flujos.sql` (`nom_flujos`, `nom_flujo_pasos`, `nom_flujo_instancias`, `nom_aprobaciones`, extensión `usuarios_empresa` o tabla puente `nom_usuarios_empresas` para rol `revisor_externo` multi-empresa y `aprobador_pagos`).

| # | Tarea | Criterio |
|---|---|---|
| 21 | Modelo de flujos + RLS específica del revisor externo (solo ve períodos cuyo paso activo le está asignado) + tests RLS cruzados | Usuario externo de prueba NO ve otra empresa ni otros pasos |
| 22 | Builder de flujo en Configuración (lista ordenada de pasos, responsables, masivo sí/no) | Flujo default piloto: generación → revisión interna → aprobación dueño → pago |
| 23 | Transiciones como RPC `SECURITY DEFINER` con validación de rol+empresa+paso en el cuerpo; historial auditado | Rechazo con comentario vuelve el lote al paso anterior |
| 24 | Bandeja de aprobación (individual + masiva) | Aprobar 45 y rechazar 2 con nota funciona |
| 25 | Notificaciones por email al responsable del paso (Resend) | Email al pasar de paso; sin spam en reintentos |
| 26 | Recibo final: numeración correlativa por empresa (secuencia Postgres), hash SHA-256 del PDF, versionado/anulación | Reliquidar genera v2 y anula v1 con motivo |

**CHECKPOINT FASE 3:** circuito completo con el flujo interno de Asset en producción sobre una quincena de prueba.

---

# FASE 4 — UOCRA quincenal + cierre y reportes (expandir al iniciar)

**Migraciones:** `0008_uocra_quincenal.sql` (tipo de período `quincena_1|quincena_2`, campos de consolidación mensual en `nom_periodos`).

| # | Tarea | Criterio |
|---|---|---|
| 27 | Config UOCRA: categorías/zona, fondo desempleo 22.250 (12%/8% según antigüedad), divisores propios de convenio | Casos dorados UOCRA (10+) contra escala publicada vigente |
| 28 | Períodos quincenales; la quincena 2 consolida el mes (recalcula cargas/topes sobre acumulado y ajusta diferencias) | Suma Q1+Q2+ajuste = liquidación mensual equivalente |
| 29 | SAC (mejor remuneración del semestre) y liquidación final régimen 22.250 (sin indemnización; vacaciones no gozadas, SAC proporcional) | Caso dorado de egreso validado |
| 30 | Reporte de pago: persona, CBU, banco, neto; export CSV/Excel | Importable en home banking (formato validado con el usuario) |
| 31 | Reporte de aportes y contribuciones por organismo (SIPA, obra social, ART, sindicato, fondo desempleo) por período | Totales = suma de items de tipo aporte/contribución |
| 32 | Libro de sueldos (listado art. 52), cierre de período con bloqueo y alerta de escala vencida | Cerrar sin escala vigente exige confirmación explícita |

**CHECKPOINT FASE 4 / v1:** Asset liquida UOCRA quincenal + fuera de convenio mensual de punta a punta; 2 períodos de corrida paralela; revisión final del contador contratado. Tag `v1.0`.

---

## Autorrevisión del plan (hecha)

- **Cobertura del spec:** legajo (T7–12), motor+reglas condicionales (T13–20), flujo+externos (T21–26), UOCRA quincenal+reportes (T27–32), fundaciones y contrato de lectura (T1–6). Portal empleado y LSD quedan fuera de v1 según diseño.
- **Consistencia de nombres:** tablas `nom_*` coinciden con el documento de diseño; `nom_v_horas_dia` reemplaza a `nom_v_horas_periodo` del diseño (la agregación por período la hace la Edge Function; el nombre queda registrado acá como decisión).
- **Sin placeholders en Fase 0:** cada paso tiene código, comando o verificación concreta. Las fases 1–4 se expanden a este mismo nivel al iniciarse (regla 10 de las instrucciones), porque el detalle correcto depende de lo aprendido en las fases previas — expandirlas hoy produciría código especulativo.
- **Punto a verificar en Task 3 (no asumible):** nombres reales de columnas de `fichajes` (¿guarda `horas_extra_50/100` calculadas o solo timestamps?). Si solo hay timestamps, el cálculo de horas extra se mueve a `packages/motor/src/asistencia.ts` y la vista expone timestamps crudos. La tarea ya instruye verificar antes de crear la vista.
