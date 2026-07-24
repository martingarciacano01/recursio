# Recursio — Fase 5: Correcciones y mejoras integrales — Plan de ejecución

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir los 2 bugs reportados (convenios/categorías duplicados y liquidación en $0) e implementar el paquete completo de mejoras: recibo doble copia según modelo AR, rediseño de legajo (tabs, familiares, sanciones, documentación, ausencias, alta/baja), básicos por hora/mensual/quincenal, fuera de convenio, base configurable de aportes/contribuciones, filtros y CSV en liquidación, SAC/vacaciones/liquidación final, gestión de convenios y paritarias, Superadmin (logo, convenios, estado de servicios), Dashboard con indicadores e IA de paritarias. Además: usuarios y roles con alcances (sitio/regional/empresa) para que el circuito preliquidación de RRHH → revisión de referentes → emisión de recibos sea operable de punta a punta, endurecimiento de seguridad (RLS testeada, auditoría de accesos) y escala a 500+ empleados con grandes históricos.

**Architecture:** Se extiende lo existente: React 19 + Vite + Zustand (repo `recursio`, rama `dev`), Supabase compartido con Presencio (tablas `nom_*`, RLS por `empresa_id`), motor puro en `packages/motor`, Edge Function `liquidar-periodo`, PDFs con jsPDF. Migraciones nuevas desde `0018`.

**Tech Stack:** React 19, Vite, Zustand, react-router-dom 7, lucide-react, date-fns, jsPDF, @supabase/supabase-js 2, Supabase Edge Functions (Deno), Vitest.

---

## Instrucciones para el agente ejecutor (leer antes de la Tarea 1)

1. **Modelo:** Claude Sonnet 5, **esfuerzo bajo**. Una tarea por sesión/subagente. Las tareas marcadas **[⚙️ esfuerzo medio]** (motor, PDF, Edge Function, IA) conviene correrlas con esfuerzo medio.
2. **Fuentes de verdad:** `docs/Recursio_Diseno.md` (funcional), `docs/Recursio_Plan_Ejecucion_Sonnet5.md` (reglas base, fases 0–4 ya ejecutadas), `docs/2026-07-21-resumen-sesion-fase3-fase4.md` (estado actual). Ante ambigüedad: preguntar al usuario, no inventar.
3. **TDD siempre:** test que falla → verificar que falla (`npx vitest run <archivo>`) → implementación mínima → test pasa → commit. Nunca marcar tarea completa con tests fallando. Suite completa (`npx vitest run`) verde antes de cada commit final de tarea (base actual: 122 tests).
4. **Migraciones:** SOLO en `supabase/migrations/NNNN_nombre.sql`, numeradas desde **0018**, idempotentes (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). RLS por `empresa_id = auth_empresa_id()` en el MISMO archivo que crea cada tabla. El usuario las aplica en Supabase (avisarle en el paso correspondiente); no asumir aplicadas.
5. **Regeneración por sub-fase:** la FASE 5A está bite-sized y se ejecuta tal cual. **Al iniciar 5B, 5C, 5D, 5E, 5F, 5G, 5H o 5I, regenerar el detalle bite-sized de esa sub-fase con la skill `superpowers:writing-plans`** (en 5B, las Tasks 3 y 4 ya están casi completas; expandir 5–9) usando este documento como spec, y presentarlo al usuario antes de ejecutar. Este documento fija archivos, esquemas SQL, fórmulas y criterios de aceptación: no cambiarlos al regenerar.
6. **Datos sensibles:** sin `persist` en stores de sueldos; buckets privados, URLs firmadas ≤ 5 min; nunca loguear CBU/CUIL/montos.
7. **No tocar Presencio.** Nunca borrar archivos sin consentimiento del usuario. No enviar mails ni usar API keys sin su consentimiento.
8. **Idioma:** UI en español (Argentina). Código y comentarios en el estilo del repo.
9. **Entorno:** si un commit deja locks de git (`index.lock`, `tmp_obj_*`), pedirle al usuario que los borre desde su Mac (ver nota en `docs/2026-07-21-resumen-sesion-fase3-fase4.md`). `npm run build` puede fallar por I/O del sandbox: pedir al usuario confirmación local.
10. **Deploy:** cada cambio a `supabase/functions/liquidar-periodo` requiere `supabase functions deploy liquidar-periodo` (lo corre el usuario; recordárselo). **Ya hay un deploy pendiente de la Fase 4.**

## Orden y dependencias

| Sub-fase | Contenido | Depende de |
|---|---|---|
| 5A | Bugs: convenios duplicados + liquidación en $0 | — (PRIMERO, todo lo demás asume liquidación funcionando) |
| 5B | Motor/liquidación: modalidad de básico, fuera de convenio, base aportes, filtros+CSV, períodos, código de concepto | 5A |
| 5C | Recibo doble copia + logo empresa | 5B (usa `codigo_recibo` y `nom_empresa_config`) |
| 5D | Legajo: filtros, rediseño ficha, familiares, sanciones, documentación, ausencias, alta/baja | 5A (independiente de 5B/5C) |
| 5E | SAC, vacaciones, liquidación final | 5B (modalidad de básico) y 5D (fecha_baja) |
| 5F | Convenios/paritarias, Superadmin, Dashboard, IA | 5C (logo/config empresa) |
| 5G | Usuarios, roles y circuito de aprobación operable (preliquidación → revisión → emisión) | 5A |
| 5H | Seguridad: tests RLS ejecutables, auditoría de accesos, endurecimiento | 5G (roles definidos) |
| 5I | Escala: 500+ empleados, históricos, liquidación por lotes, paginación | 5A (idealmente antes del primer piloto grande) |

**Orden recomendado de ejecución:** 5A → 5B → **5G** (sin esto la app no cumple el circuito RRHH→referentes→recibos) → 5I Tasks 35–36 (lotes e índices, antes de cargar una empresa grande) → 5C → 5D → 5E → **5H** (gate obligatorio antes de producción real) → 5F → resto de 5I.

---

# FASE 5A — Corrección de bugs (bite-sized)

## Task 1: Convenios duplicados y categorías repetidas al editar legajo

**Causa raíz:** `EditorDatosLegajo.jsx` lista TODOS los `nom_convenios` visibles por RLS (los globales con `empresa_id NULL` **más** el clon de la empresa creado por `clonar_convenio`), por eso aparecen dos "UOCRA". Y `nom_categorias` se versiona por `(convenio_id, nombre, vigencia_desde)`: el selector muestra una opción por **versión**, no por categoría.

**Regla de negocio:** el convenio personalizado (clonado) **pisa** al global del mismo nombre en todos los selectores. De categorías se muestra una sola fila por nombre: la de `vigencia_desde` más reciente que sea ≤ hoy (si todas son futuras, la más próxima).

**Files:**
- Create: `src/utils/convenios.js`
- Create: `src/utils/__tests__/convenios.test.js`
- Modify: `src/components/legajo/EditorDatosLegajo.jsx` (queries y selects de convenio/categoría)
- Modify: `src/pages/ConfiguracionPage.jsx` (selector de convenio: aplicar el mismo filtro)

- [ ] **Step 1: Test que falla**

```js
// src/utils/__tests__/convenios.test.js
import { describe, it, expect } from 'vitest'
import { filtrarConveniosVisibles, categoriasVigentes } from '../convenios'

describe('filtrarConveniosVisibles', () => {
  it('oculta el convenio global cuando existe clon de la empresa con el mismo nombre', () => {
    const convenios = [
      { id: 'g1', empresa_id: null, nombre: 'UOCRA' },
      { id: 'e1', empresa_id: 'emp-1', nombre: 'UOCRA' },
      { id: 'g2', empresa_id: null, nombre: 'Comercio' },
    ]
    expect(filtrarConveniosVisibles(convenios).map((c) => c.id)).toEqual(['e1', 'g2'])
  })
  it('sin clones devuelve los globales tal cual', () => {
    const convenios = [{ id: 'g1', empresa_id: null, nombre: 'UOCRA' }]
    expect(filtrarConveniosVisibles(convenios)).toHaveLength(1)
  })
})

describe('categoriasVigentes', () => {
  it('devuelve una sola fila por nombre: la vigente más reciente', () => {
    const cats = [
      { id: 'a', nombre: 'Oficial', vigencia_desde: '2026-01-01' },
      { id: 'b', nombre: 'Oficial', vigencia_desde: '2026-06-01' },
      { id: 'c', nombre: 'Ayudante', vigencia_desde: '2026-01-01' },
    ]
    const r = categoriasVigentes(cats, '2026-07-21')
    expect(r.map((c) => c.id).sort()).toEqual(['b', 'c'])
  })
  it('si todas las versiones son futuras, devuelve la más próxima', () => {
    const cats = [
      { id: 'x', nombre: 'Oficial', vigencia_desde: '2026-09-01' },
      { id: 'y', nombre: 'Oficial', vigencia_desde: '2026-08-01' },
    ]
    expect(categoriasVigentes(cats, '2026-07-21').map((c) => c.id)).toEqual(['y'])
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/utils/__tests__/convenios.test.js` → Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementación mínima**

```js
// src/utils/convenios.js
// El convenio personalizado de la empresa "pisa" al global homónimo.
export function filtrarConveniosVisibles(convenios) {
  const nombresPropios = new Set(
    convenios.filter((c) => c.empresa_id).map((c) => c.nombre)
  )
  return convenios.filter((c) => c.empresa_id || !nombresPropios.has(c.nombre))
}

// nom_categorias versiona por (convenio, nombre, vigencia_desde): para un
// selector debe quedar UNA fila por nombre — la vigente más reciente <= hoy,
// o la futura más próxima si todavía no hay ninguna vigente.
export function categoriasVigentes(categorias, hoy = new Date().toISOString().slice(0, 10)) {
  const porNombre = new Map()
  for (const c of categorias) {
    const prev = porNombre.get(c.nombre)
    if (!prev) { porNombre.set(c.nombre, c); continue }
    const cVig = c.vigencia_desde <= hoy
    const prevVig = prev.vigencia_desde <= hoy
    const gana =
      (cVig && !prevVig) ||
      (cVig && prevVig && c.vigencia_desde > prev.vigencia_desde) ||
      (!cVig && !prevVig && c.vigencia_desde < prev.vigencia_desde)
    if (gana) porNombre.set(c.nombre, c)
  }
  return [...porNombre.values()]
}
```

- [ ] **Step 4:** Run → PASS. Commit: `fix(legajo): helpers para deduplicar convenios clonados y versiones de categoria`

- [ ] **Step 5: Aplicar en `EditorDatosLegajo.jsx`**
  - La query de convenios debe traer `empresa_id`: `supabase.from('nom_convenios').select('id, nombre, empresa_id').order('nombre')` y pasar el resultado por `filtrarConveniosVisibles`.
  - La query de categorías debe traer `vigencia_desde`: `select('id, nombre, vigencia_desde')` y pasar por `categoriasVigentes`.
  - El texto de solo-lectura (`Convenio: …`) debe resolver el nombre buscando en la lista SIN filtrar (el legajo puede apuntar a un id oculto por el filtro): mantener una lista `todosConvenios` para ese lookup y usar la filtrada solo en el `<select>`.

- [ ] **Step 6: Aplicar en `ConfiguracionPage.jsx`** el mismo `filtrarConveniosVisibles` en el selector de convenio (y en cualquier otro selector de convenios que exista en `src/components/config/`; buscar con `grep -rn "nom_convenios" src/`).

- [ ] **Step 7:** Test de componente existente en `src/components/legajo/__tests__/` sigue verde; agregar caso que renderee el select con un global+clon homónimos y asserte una sola opción "UOCRA". `npx vitest run` completo → PASS. Commit: `fix(legajo): convenio personalizado pisa al global y categorias sin versiones duplicadas`

## Task 2: La liquidación no calcula valores ($0 / personas que no aparecen) [⚙️ esfuerzo medio]

**Causas probables (confirmar en diagnóstico, en este orden):**
1. La Edge Function desplegada está **desactualizada** (el deploy de la consolidación quincenal de Fase 4 quedó pendiente).
2. El legajo apunta a una `categoria_id` del convenio **global**, pero la escala real se cargó en el convenio **clonado** (o viceversa). `liquidar-periodo` busca el básico por `(convenio_id de la fila de categoría, nombre)` → no encuentra versión → `basico = 0` **en silencio**.
3. `nom_categorias.basico = 0` (escala nunca cargada para ese convenio) o `vigencia_desde` posterior al período.
4. El legajo se **saltea en silencio** (`continue`) por CUIL/CBU/convenio/categoría faltante y el usuario no ve por qué.

**Fix de fondo (además del diagnóstico): nada de $0 silenciosos.** La función debe (a) resolver el básico contra el convenio **del legajo**, con fallback al convenio de la fila de categoría, y (b) devolver `advertencias` por persona que la UI muestre.

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts`
- Modify: `src/store/liquidacionStore.js`
- Modify: `src/pages/LiquidacionPage.jsx`
- Test: `src/store/__tests__/liquidacionStore.test.js` (o el existente del store)

- [ ] **Step 1: Diagnóstico (no tocar código todavía).** Pedir al usuario que corra en SQL Editor y pegue resultados:

```sql
-- ¿A qué convenio/categoría apuntan los legajos y qué básico vigente hay?
SELECT l.id, l.convenio_id AS conv_legajo, c.convenio_id AS conv_categoria,
       c.nombre AS categoria, co.nombre AS convenio, co.empresa_id,
       (SELECT basico FROM nom_categorias v
        WHERE v.convenio_id = c.convenio_id AND v.nombre = c.nombre
          AND v.vigencia_desde <= CURRENT_DATE
        ORDER BY v.vigencia_desde DESC LIMIT 1) AS basico_vigente
FROM nom_legajo l
JOIN nom_categorias c ON c.id = l.categoria_id
JOIN nom_convenios co ON co.id = l.convenio_id;

-- ¿Legajos incompletos que se saltean?
SELECT id, cuil IS NULL AS sin_cuil, cbu IS NULL AS sin_cbu,
       convenio_id IS NULL AS sin_convenio, categoria_id IS NULL AS sin_categoria
FROM nom_legajo;
```

Anotar hallazgos en el commit message final. Si `conv_legajo <> conv_categoria`, la causa es la nº 2.

- [ ] **Step 2:** Confirmar con el usuario que despliegue la versión actual: `supabase functions deploy liquidar-periodo`. Re-probar. Si ya calcula, igual seguir con los pasos 3–7 (robustez).

- [ ] **Step 3: Fix en la Edge Function — resolución de básico por convenio del legajo + advertencias.** En `index.ts`:
  - Reemplazar el mapa `basicoPorCategoria` (clave `categoria_id`) por clave compuesta `${convenioId}:${nombreCategoria}` y resolver así:

```ts
// clave de escala: convenio del LEGAJO + nombre de la categoría a la que apunta
// (si el legajo quedó apuntando a la fila del convenio global tras clonar,
// la escala cargada en el clon igual se encuentra)
async function resolverBasico(supabase: any, convenioId: string, nombre: string, fechaHasta: string) {
  const { data } = await supabase.from('nom_categorias').select('basico')
    .eq('convenio_id', convenioId).eq('nombre', nombre)
    .lte('vigencia_desde', fechaHasta)
    .order('vigencia_desde', { ascending: false }).limit(1)
  return data?.length ? Number(data[0].basico) : null
}
```

  Por persona: intentar `resolverBasico(legajo.convenio_id, nombreCat)`; si `null`, fallback `resolverBasico(cat.convenio_id, nombreCat)`; si sigue `null` o es `0`, agregar advertencia `"sin escala vigente para '<categoria>' al <fecha> (convenio <nombre>)"`. Aplicar el mismo criterio a `nom_no_remunerativos`.
  - Reemplazar el `continue` silencioso de legajos incompletos por acumulación en `omitidos`:

```ts
const omitidos: { personal_id: string; nombre: string; motivo: string }[] = []
// ...
if (!legajo?.cuil || !legajo?.cbu || !legajo?.convenio_id || !legajo?.categoria_id) {
  const faltan = [!legajo?.cuil && 'CUIL', !legajo?.cbu && 'CBU',
    !legajo?.convenio_id && 'convenio', !legajo?.categoria_id && 'categoría'].filter(Boolean).join(', ')
  omitidos.push({ personal_id: persona.id, nombre: persona.nombre, motivo: `legajo incompleto: falta ${faltan}` })
  continue
}
```

  - Incluir en la respuesta JSON: `{ resultados, omitidos, advertencias }` (advertencias: array `{ personal_id, mensaje }`).

- [ ] **Step 4: Store.** En `liquidacionStore.js` guardar `omitidos` y `advertencias` de la respuesta; test unitario del mapeo (mock de respuesta con 1 omitido y 1 advertencia → estado esperado).

- [ ] **Step 5: UI.** En `LiquidacionPage.jsx`, banner amarillo colapsable arriba de la tabla: "⚠ N personas no liquidadas / M advertencias" con el detalle (nombre + motivo). Sin omitidos ni advertencias, no se muestra.

- [ ] **Step 6:** `npx vitest run` → PASS. Commit: `fix(liquidacion): basico por convenio del legajo, advertencias y omitidos visibles`

- [ ] **Step 7:** Usuario despliega la función y recalcula el período de prueba. **Criterio de aceptación:** bruto/aportes/contribuciones/neto ≠ $0 para un legajo completo con escala cargada, y toda persona faltante aparece explicada en el banner.

- [ ] **Step 8 (dato, si el diagnóstico dio causa 2):** ofrecer al usuario el SQL de corrección de punteros (NO ejecutarlo sin su ok):

```sql
UPDATE nom_legajo l SET categoria_id = nueva.id, convenio_id = clon.id
FROM nom_categorias vieja
JOIN nom_convenios glob ON glob.id = vieja.convenio_id AND glob.empresa_id IS NULL
JOIN nom_convenios clon ON clon.nombre = glob.nombre AND clon.empresa_id = l.empresa_id
JOIN nom_categorias nueva ON nueva.convenio_id = clon.id AND nueva.nombre = vieja.nombre
WHERE l.categoria_id = vieja.id;
```

*(Nota: revisar sintaxis del UPDATE con self-join al ejecutarlo; la intención es re-apuntar legajos del convenio global al clon de su empresa.)*

---

# FASE 5B — Motor y liquidación (bite-sized)

## Task 3: Migración 0018 — columnas de legajo, modalidad y código de recibo

**Files:**
- Create: `supabase/migrations/0018_legajo_baja_modalidad.sql`

- [ ] **Step 1:** Crear la migración completa:

```sql
-- 0018_legajo_baja_modalidad.sql
-- Alta/baja del legajo, fuera de convenio, dirección ampliada,
-- modalidad de básico por categoría y código imprimible de concepto.

ALTER TABLE nom_legajo
  ADD COLUMN IF NOT EXISTS fecha_baja DATE,
  ADD COLUMN IF NOT EXISTS motivo_baja TEXT
    CHECK (motivo_baja IN ('renuncia','despido_sin_causa','despido_con_causa','fin_obra','mutuo_acuerdo','fallecimiento') OR motivo_baja IS NULL),
  ADD COLUMN IF NOT EXISTS liquidacion_final_id UUID REFERENCES nom_liquidaciones(id),
  ADD COLUMN IF NOT EXISTS fuera_convenio BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sueldo_convenido NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS localidad TEXT,
  ADD COLUMN IF NOT EXISTS provincia TEXT,
  ADD COLUMN IF NOT EXISTS codigo_postal TEXT;

-- modalidad del básico de la escala: por hora (jornal), mensual o quincenal
ALTER TABLE nom_categorias
  ADD COLUMN IF NOT EXISTS modalidad TEXT NOT NULL DEFAULT 'hora'
    CHECK (modalidad IN ('hora','mensual','quincenal'));

-- código corto que se imprime en el recibo (ej. '0015'), editable por empresa
ALTER TABLE nom_conceptos
  ADD COLUMN IF NOT EXISTS codigo_recibo TEXT;

COMMENT ON COLUMN nom_legajo.fuera_convenio IS 'true: liquida por sueldo_convenido, sin convenio/categoría';
COMMENT ON COLUMN nom_categorias.modalidad IS 'hora=jornal x horas trabajadas; mensual=monto fijo por mes; quincenal=monto fijo por quincena';
```

- [ ] **Step 2:** Pedir al usuario que la aplique en Supabase. Commit: `feat(db): migracion 0018 baja, fuera de convenio, modalidad y codigo de recibo`

## Task 4: Modalidad del básico (hora / mensual / quincenal) [⚙️ esfuerzo medio]

Hoy el motor asume jornal por hora. Regla nueva para la variable `basico_periodo` (el monto base del período):

- `hora`: `basico * horas_trabajadas` (comportamiento actual).
- `mensual`: período `mensual` → `basico`; período quincenal → `basico / 2`; se descuentan faltas injustificadas a razón de `basico / 30` por día.
- `quincenal`: período quincenal → `basico`; período `mensual` → `basico * 2`; descuento por falta `basico / 15`.

**Files:**
- Modify: `packages/motor/src/formulas.ts` (exponer variable `basico_periodo`)
- Create: `packages/motor/src/basico.ts` + `packages/motor/src/basico.test.ts`
- Modify: `supabase/functions/liquidar-periodo/index.ts` (leer `modalidad` de la fila de categoría vigente y calcular `basico_periodo` con la función nueva; pasarla en `variablesBase`)
- Modify: `src/components/config/TabEscalas.jsx` (columna/selector Modalidad al crear/editar filas de escala)

- [ ] **Step 1:** Test de `calcularBasicoPeriodo({ modalidad, basico, tipoPeriodo, horasTrabajadas, faltasInjustificadas })` cubriendo los 6 cruces modalidad×tipo de período y el descuento por faltas. Escribir los casos con montos exactos (ej. mensual 600000, quincena_1, 2 faltas → `600000/2 - 2*(600000/30) = 260000`).
- [ ] **Step 2:** FAIL → implementar función pura en `basico.ts` → PASS.
- [ ] **Step 3:** Edge Function: al resolver el básico vigente (Task 2) traer también `modalidad`, calcular `basico_periodo` y agregarla a `variablesBase`. Los conceptos globales que hoy usan `basico_convenio * horas` deben migrar a `basico_periodo` (revisar seeds en `0005_conceptos_y_reglas.sql` y `nom_conceptos` clonados: incluir UPDATE de fórmulas en una migración `0019_formulas_basico_periodo.sql` idempotente).
- [ ] **Step 4:** UI TabEscalas con el selector; test de componente. Suite completa PASS. Commit + recordar deploy.

## Task 5: Fuera de convenio — sueldo convenido como base

Para legajos con `fuera_convenio = true`: no exigir convenio/categoría; `basico_periodo` sale de `sueldo_convenido` con modalidad `mensual`; aportes y contribuciones calculan sobre esa base (los conceptos de aportes/contribuciones "generales" deben estar asociados a un pseudo-convenio o aplicarse cuando el legajo no tiene convenio — decisión: los conceptos con `convenio_id NULL` y `empresa_id` de la empresa aplican a fuera de convenio; agregar esa rama al filtro de conceptos de la Edge Function).

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts` (no saltear legajos `fuera_convenio` sin convenio; base = sueldo_convenido)
- Modify: `src/components/legajo/EditorDatosLegajo.jsx` (checkbox "Fuera de convenio" + input Sueldo convenido mensual; si está activo, deshabilitar convenio/categoría)
- Test: caso en `packages/motor` si se agrega lógica pura; test de componente del editor

- [ ] Pasos TDD análogos a Task 4 (test del filtro de conceptos y de la base; luego UI). **Criterio:** un legajo fuera de convenio con sueldo 1.000.000 liquida bruto 1.000.000 en período mensual (sin faltas) y sus aportes/contribuciones se calculan sobre esa base. Commit + deploy.

## Task 6: Base de aportes y contribuciones configurable (remunerativo vs rem+no rem)

El motor **ya soporta** `config.base: 'remunerativo' | 'no_remunerativo' | 'ambos'` (`packages/motor/src/formulas.ts`). Solo falta exponerlo:

**Files:**
- Modify: `src/components/config/TabAportes.jsx` y `src/components/config/FormularioConcepto.jsx`: selector "Calcula sobre: Solo remunerativo / Remunerativo + no remunerativo" que mapea a `config.base = 'remunerativo' | 'ambos'`.
- Test: test de componente que verifica el mapeo al guardar.

- [ ] TDD sobre el mapeo; verificar con un concepto de contribución al 18% sobre ambos en un caso con no remunerativo > 0. Commit.

## Task 7: Filtros de liquidación + export CSV

**Files:**
- Modify: `src/pages/LiquidacionPage.jsx`: input búsqueda por nombre + select de obra/sitio (obras desde `nom_v_personal.obra_id`; traer nombres de obra vía la vista si existe el campo, sino mostrar el id — verificar columnas reales de `nom_v_personal` antes). El filtro es client-side sobre las filas ya liquidadas Y además `liquidar-periodo` debe aceptar `personal_ids?: string[]` opcional para liquidar solo un subconjunto.
- Create: `src/utils/csv.js` — `exportarCSV(filas, columnas, nombreArchivo)` reutilizable (extraer la lógica ya escrita en `ReportesPage.jsx` para no duplicar).
- Modify: `src/pages/ReportesPage.jsx` (usar el util), botón "Descargar CSV" en LiquidacionPage con columnas: legajo, nombre, CUIL, categoría, horas, extras, bruto, no rem, aportes, contribuciones, neto.
- Test: `src/utils/__tests__/csv.test.js` (escapado de comas/comillas/acentos, BOM UTF-8 para Excel).

- [ ] TDD del util → refactor ReportesPage → UI filtros → `personal_ids` en la Edge Function → suite PASS → commit + deploy.

## Task 8: Selector de períodos e históricos

**Files:**
- Modify: `src/pages/LiquidacionPage.jsx` (o extraer `src/components/SelectorPeriodo.jsx`)

- [ ] Reemplazar el selector plano por uno agrupado: año → mes → chips de período (`Mensual`, `1ª quincena`, `2ª quincena`, y los especiales de la Fase 5E) con badge de estado (`abierto`, `calculado`, `en aprobación`, `cerrado` — usar los estados reales de `nom_periodos`; verificar con `grep -n "estado" supabase/migrations/0007_periodos_liquidaciones.sql`). Períodos cerrados abren en solo lectura con sus liquidaciones históricas. Test de componente con 3 períodos de meses distintos. Commit.

## Task 9: Código de concepto en pantalla y recibo

**Files:**
- Modify: `src/components/config/FormularioConcepto.jsx` (campo "Código de recibo", ej. 0015)
- Modify: `src/pages/LiquidacionPage.jsx` (detalle expandible muestra `codigo_recibo — nombre`)
- Modify: generador de recibo (columna `Cod` — se termina en Task 12)
- Create: migración `0020_codigos_recibo_seed.sql`: asignar códigos default a los conceptos globales existentes (0015 horas normales, 0043 hs feriado, 0191 asistencia perfecta, 0300 jubilación, 0302 ley 19032, 0310 obra social, 0316 retención sindical — según el modelo de recibo provisto; para el resto, correlativo 09xx)

- [ ] TDD (helper de render `etiquetaConcepto(c) => c.codigo_recibo ? `${c.codigo_recibo} ${c.nombre}` : c.nombre`), migración, UI. Commit.

---

# FASE 5C — Recibo de sueldo modelo AR + logo (regenerar bite-sized al iniciar)

## Task 10: Migración 0021 — configuración de empresa y storage de logos

```sql
-- 0021_empresa_config.sql
CREATE TABLE IF NOT EXISTS nom_empresa_config (
  empresa_id    UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  razon_social  TEXT,
  cuit          TEXT,
  domicilio     TEXT,
  logo_path     TEXT,          -- path en bucket nom-logos
  updated_at    TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_empresa_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY nom_empresa_config_rw ON nom_empresa_config
  USING (empresa_id = auth_empresa_id())
  WITH CHECK (empresa_id = auth_empresa_id());
-- (más policy de Superadmin siguiendo el patrón de 0008_superadmin_bypass.sql)
```

Bucket privado `nom-logos` (creación documentada para que el usuario la haga en el panel o vía SQL de storage siguiendo el patrón de buckets existente en Presencio). URL firmada ≤ 5 min para previsualizar.

## Task 11: Superadmin — carga de logo y datos del empleador

`src/pages/SuperAdminPage.jsx`: sección "Empresa" con razón social, CUIT, domicilio y upload de logo (PNG/JPG ≤ 500 KB, validar client-side). El logo y los datos alimentan el recibo. También editable por el rol admin de la empresa desde Configuración (decidir con el usuario si va en ambos lados; default: ambos).

## Task 12: Recibo doble copia según modelo [⚙️ esfuerzo medio]

Referencia visual: recibo UOCRA provisto por el usuario (copia empleador + copia empleado **en la misma hoja**). Especificación:

- **Layout:** A4 **apaisado**, dos mitades idénticas lado a lado (izquierda = "Firma Empleador", derecha = "Firma Empleado"). Única diferencia: el pie derecho agrega la leyenda *"Recibí el importe neto y duplicado de la presente liquidación en pago de mi remuneración correspondiente al período indicado."*
- **Encabezado (cada mitad):** logo (si hay) + razón social, domicilio, CUIT (de `nom_empresa_config`); título "RECIBO DE REMUNERACIONES"; `Período: <1ª/2ª quincena|mes> MM/AAAA`.
- **Bloque empleado:** Legajo, Apellido y Nombres, CUIL, Fecha Ing., Sector (CCT del convenio), Sueldo/Jornal (el básico vigente con su modalidad).
- **Bloque depósito/categoría:** Último depósito (Fecha, Período, Banco — de `nom_legajo.banco`; fecha/período del pago anterior si existe, sino "—"), Categoría, Función.
- **Tabla de conceptos:** columnas `Cod | Concepto | Unidades | Hab. C/Desc. | Hab. S/Desc. | Deducciones`. Mapeo: remunerativo → Hab. C/Desc.; no_remunerativo → Hab. S/Desc.; descuento y aporte → Deducciones; `Unidades` = horas o cantidad del concepto. `Cod` = `codigo_recibo`.
- **Pie:** TOTALES por columna, NETO, `113300 OS DE <obra social>` si aplica, "Lugar y Fecha de Pago", "Son Pesos: <monto en letras>", "Recibo Leyes 17250, 20744 y 21297", línea de firma.
- **Número de recibo y hash:** mantener la integración existente con `emitir_recibo`/SHA-256 (Fase 4).

**Files:**
- Create: `src/utils/numeroALetras.js` + test (casos: 0, 95 centavos, 2393.95 → "Dos mil trescientos noventa y tres Pesos con 95/100", 1000000, 1001, 21, 16, 100, 101)
- Create: `src/utils/reciboPdf.js` (función pura `generarReciboPDF(datos)` que recibe todo resuelto y devuelve el jsPDF doc; sin llamadas a Supabase adentro — testeable)
- Modify: `src/pages/LiquidacionPage.jsx` (botón existente "Emitir recibo PDF" usa el generador nuevo)

Implementación de referencia para `numeroALetras` (completar decenas/centenas al ejecutar, con los tests de arriba como contrato):

```js
const U = ['','un','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciséis','diecisiete','dieciocho','diecinueve','veinte']
// 21-29: 'veintiuno'... ; decenas: treinta..noventa con ' y '; centenas: cien/ciento, quinientos, setecientos, novecientos
// miles: 'mil' (no 'un mil'); millones: 'un millón'/'N millones'
export function numeroALetras(monto) {
  const entero = Math.floor(monto)
  const centavos = Math.round((monto - entero) * 100)
  return `${capitalizar(enLetras(entero))} Pesos con ${String(centavos).padStart(2,'0')}/100`
}
```

**Criterio de aceptación:** el PDF de un legajo con los conceptos del modelo reproduce la estructura de la imagen provista (verificación visual del usuario) y el monto en letras coincide con el neto.

---

# FASE 5D — Legajo completo (regenerar bite-sized al iniciar)

## Task 13: Filtros en `LegajosPage.jsx`
Búsqueda por nombre y documento (CUIL/DNI, matcheo parcial sin guiones) + select estado Activo/Inactivo/Todos (estado = `fecha_baja IS NULL` combinado con el estado de Presencio en `nom_v_personal.estado`). Client-side. Test del helper de filtrado.

## Task 14: Rediseño de `FichaLegajoPage.jsx`
Reemplazar el listado plano por: **header** (nombre, CUIL, categoría/convenio, chip Activo/Baja + fechas alta/baja, semáforo de completitud existente) + **pestañas**: `Datos` (personales, dirección: domicilio/localidad/provincia/CP, bancarios, laborales) · `Familiares` · `Documentación` · `Sanciones` · `Ausencias` · `Liquidaciones` (histórico de la persona). Reusar `SeccionColapsable`/`SemaforoLegajo`/`DocumentosLegajo` existentes dentro de las pestañas. Grid de dos columnas con etiqueta arriba y valor abajo (estilo ficha), no lista plana.

## Task 15: Familiares (la tabla `nom_familiares` ya existe — migración 0004; verificar columnas con `sed -n '/nom_familiares/,/);/p' supabase/migrations/0004_legajo_completo.sql`)
CRUD en la pestaña: nombre, parentesco (cónyuge/hijo/a/otro), fecha de nacimiento → edad calculada, DNI. Si falta alguna columna en la tabla, agregarla en migración `0022_legajo_extras.sql`.

## Task 16: Sanciones (la tabla `nom_sanciones_personal` ya existe — 0004)
Pestaña con contador visible ("Sanciones (3)"), alta con: Fecha, Tipo (apercibimiento/suspensión/otro), Descripción, Aplicación (texto: cómo/cuándo se aplica, ej. días de suspensión). Orden descendente por fecha.

## Task 17: Documentación configurable por cliente
Ya existen `tipos_documento` con `ambito` (0006) y `DocumentosLegajo.jsx`. Completar: CRUD de tipos requeridos en Configuración (pestaña "Documentación": el cliente define su checklist, ej. DNI, Alta firmada, Examen preocupacional), upload al bucket privado `nom-docs` (crear si no existe, patrón Task 10), estado por legajo (pendiente/cargado) que alimenta el semáforo y el indicador de Dashboard (Task 25).

## Task 18: Ausencias desde Presencio
Pestaña que lee `nom_v_ausencias` de la persona, separadas en **Justificadas** y **Injustificadas** con totales del año. Solo lectura (la fuente es Presencio). Verificar antes qué columnas expone la vista (`sed -n '/nom_v_ausencias/,/;/p' supabase/migrations/0001_vistas_contrato.sql`).

## Task 19: Alta y baja
- Fecha de alta: ya existe `fecha_ingreso` — mostrarla/editarla en Datos.
- Baja: acción "Dar de baja" (fecha + motivo del CHECK de la 0018). Un legajo con baja queda Inactivo, no aparece en liquidaciones ordinarias posteriores a la fecha, y muestra botón **"Generar liquidación final"** (deshabilitado con tooltip "disponible al completar Fase 5E" hasta que exista la Task 22; la liquidación final puede hacerse días después de registrar la baja y se vincula vía `nom_legajo.liquidacion_final_id`).

---

# FASE 5E — SAC, vacaciones y liquidación final (regenerar bite-sized al iniciar) [⚙️ esfuerzo medio]

Ya existe `packages/motor/src/uocra.ts` (SAC mejor remuneración del semestre, fondo de desempleo, vacaciones no gozadas, final 22.250). Esta fase **generaliza** a todos los convenios/LCT sin romper lo de UOCRA.

## Task 20: Motor `packages/motor/src/especiales.ts` + `especiales.test.ts`
Funciones puras (todas reciben datos, no leen DB):
- `calcularSAC({ mejoresBrutosPorMes, semestre, diasTrabajadosSemestre, diasSemestre })` → `mejorBruto / 2 * (diasTrabajadosSemestre / diasSemestre)`. Base: **mejor remuneración mensual bruta devengada** del semestre (art. 121 LCT). Reusar/extraer lo común con `uocra.ts` (DRY: si `uocra.ts` ya lo hace igual, mover a `especiales.ts` y reexportar).
- `calcularVacaciones({ antiguedadAnios, diasTrabajadosAnio, sueldoMensual, modalidad, valorHora })` → días por antigüedad LCT art. 150 (<5: 14; ≥5 y <10: 21; ≥10 y <20: 28; ≥20: 35; antigüedad < 6 meses: 1 día cada 20 trabajados). Valor día mensualizado = `sueldoMensual / 25`; jornalizado = `valorHora * 8`. Devuelve `{ dias, montoDia, total, plusSobreSac: total/12? NO — sin extras }` → devolver `{ dias, montoDia, total }`.
- `calcularLiquidacionFinal({ motivoBaja, fechaBaja, ... })` → rubros según motivo: siempre `dias_trabajados_mes`, `sac_proporcional`, `vacaciones_no_gozadas` (+ SAC s/vacaciones no gozadas); si `despido_sin_causa` (régimen LCT, no UOCRA): `indemnizacion_antiguedad` (1 sueldo por año o fracción > 3 meses, base mejor remuneración mensual normal y habitual), `preaviso` (1 mes < 5 años, 2 meses ≥ 5) e `integracion_mes` si aplica. Para convenio UOCRA usar el camino existente de `uocra.ts` (régimen 22.250: fondo de desempleo, sin indemnización).

Tests dorados con montos exactos calculados a mano en el propio test (mínimo 8 casos: SAC completo, SAC proporcional, vacaciones 4 tramos de antigüedad, final por renuncia, final despido sin causa).

## Task 21: Períodos especiales + Edge Function
Migración `0023_periodos_especiales.sql`: `nom_periodos.tipo` admite además `'sac_1'|'sac_2'|'vacaciones'|'final'` (ALTER del CHECK; verificar el CHECK actual en 0007/0017 antes de escribirlo). `liquidar-periodo`: rama por tipo — para `sac_*` busca los brutos mensuales del semestre en `nom_liquidaciones` cerradas; para `final` recibe `personal_id` único y `motivo_baja` del legajo. Deploy.

## Task 22: UI
- Alta de período especial en el selector (Task 8): "Liquidar SAC Jun/Dic", "Vacaciones", con confirmación.
- Botón "Generar liquidación final" en la ficha (Task 19): crea período `final` para esa persona, liquida, muestra detalle de rubros y guarda `liquidacion_final_id`.
- Recibo (Task 12) rotula el período especial ("SAC 1º semestre 2026", "Liquidación final").

---

# FASE 5F — Convenios, Superadmin, Dashboard e IA (regenerar bite-sized al iniciar)

## Task 23: Otros convenios + bucket de paritarias
- CRUD de convenios propios en Configuración (crear convenio vacío: nombre, régimen, descripción; luego cargar categorías/escalas con las pestañas existentes).
- Migración `0024_paritarias.sql`: tabla `nom_paritarias_docs (id, empresa_id NULL para globales, convenio_id, titulo, archivo_path, vigencia_desde, created_at)` + RLS. Bucket privado `nom-paritarias`. UI: subir PDF de paritaria asociado a un convenio, listar y descargar (URL firmada).

## Task 24: Superadmin ampliado
`SuperAdminPage.jsx`, tres secciones nuevas:
- **Empresa/logo** (hecho en Task 11 — solo enlazar).
- **Convenios globales:** CRUD de `nom_convenios (empresa_id NULL)` y sus escalas/no remunerativos/conceptos: agregar convenio nuevo, cargar nueva vigencia de escala (reusa componentes de Configuración apuntando a filas globales — cuidado con RLS: requiere las policies de Superadmin de 0008; verificar y extender en migración si falta).
- **Estado de servicios:** tarjetas con ping real — Supabase DB (`select 1` vía una tabla liviana), Edge Function `liquidar-periodo` (request OPTIONS/health), Storage (list de un bucket), Resend (mostrar "no configurado" si no hay API key; **no** enviar mails de prueba sin consentimiento del usuario). Estado: ✔ operativo / ✖ error / — no configurado.

## Task 25: Dashboard con indicadores
`DashboardPage.jsx`: tarjetas: **Legajos incompletos** (reusar lógica del semáforo; link filtrado a LegajosPage), **Próximo cierre** (días hasta fin de quincena/mes según períodos abiertos), **Período en curso** (estado + pendientes de aprobación de la Fase 3), **Escalas desactualizadas** (>90 días sin nueva vigencia — reusar la alerta de ReportesPage), **Documentación faltante** (Task 17), **Bajas del mes sin liquidación final**. Cada tarjeta con test de su helper de cálculo (funciones puras en `src/utils/dashboard.js`).

## Task 26: IA para carga de paritarias [⚙️ esfuerzo medio — experimental, al final]
- Edge Function nueva `supabase/functions/analizar-paritaria/index.ts`: recibe `{ paritaria_doc_id }`, descarga el PDF del bucket, llama a la API de Anthropic (`ANTHROPIC_API_KEY` como secret de Supabase — pedirla al usuario, no inventarla) pidiendo JSON estricto: `{ convenio, vigencias: [{ vigencia_desde, categorias: [{ nombre, basico }], no_remunerativos: [...] }] }`.
- UI en la pestaña de paritarias: botón "Analizar con IA" → muestra tabla **propuesta vs. valores actuales** (diff por categoría) → el usuario revisa y confirma → recién ahí se insertan las filas nuevas en `nom_categorias`/`nom_no_remunerativos` (nunca aplicar sin confirmación explícita).
- Test: parser/validador del JSON de respuesta (función pura, casos: respuesta válida, categorías desconocidas, montos no numéricos → rechazar con mensaje claro).

## Task 27: Pasada UX + verificación integral
- Checklist UX liquidador AR: montos con separador de miles es-AR (`Intl.NumberFormat('es-AR')` en TODA la app — grep de `toFixed(` y unificar), períodos siempre "1ª quincena Julio 2026", acciones destructivas con confirmación, loading states, mensajes de error en español.
- Verificación final: suite completa verde; `npm run build` confirmado por el usuario en su Mac; deploy de las dos Edge Functions; prueba de punta a punta con un recibo real de Asset contrastado contra el modelo y contra Presencio (checklist manual pendiente de fases anteriores); revisar que ninguna tabla nueva quedó sin RLS (`grep -L "ENABLE ROW LEVEL SECURITY" supabase/migrations/00{18..24}*.sql` debe ser vacío para las que crean tablas).

---

# FASE 5G — Usuarios, roles y circuito de aprobación operable (regenerar bite-sized al iniciar) [⚙️ esfuerzo medio]

**Contexto:** la Fase 3 dejó el backend de aprobaciones (migraciones 0014/0015: `nom_flujos`, `nom_flujo_pasos`, `nom_flujo_instancias`, `nom_aprobaciones`, `nom_usuarios_empresas`, RPCs `iniciar_flujo`/`avanzar_flujo`), `TabFlujo.jsx`, `AprobacionesPage.jsx` y el botón "Enviar a aprobación". **Lo que falta para que el circuito RRHH → referentes → recibos sea usable en serio:** no hay ABM de usuarios ni forma de asignar roles desde la app, el Sidebar solo distingue `superadmin` (cualquier usuario de la empresa ve y toca todo), no hay alcances por sitio/región, no hay notificaciones, y no se validó el circuito de punta a punta. Esta sub-fase es el corazón del producto según el diseño (§3.4, §3.5, §5-pantalla-5 de `Recursio_Diseno.md`).

## Task 28: Roles de Nómina y ABM de usuarios

**Modelo de roles (validar nombres con el usuario antes de migrar):**

| Rol | Puede |
|---|---|
| `admin` (empresa) | Todo en su empresa, incluida configuración y usuarios |
| `rrhh` | Legajos, preliquidación, enviar a aprobación, recibos, reportes. NO configura flujos/usuarios |
| `revisor_interno` | Bandeja de aprobación de sus pasos + lectura de liquidaciones |
| `aprobador_pagos` | Bandeja del paso final + reporte de pago |
| `revisor_externo` | SOLO bandeja de sus pasos (multi-empresa, sin acceso al resto) — ya existe en 0014 |
| `supervisor` | SOLO lectura de legajos/liquidaciones de su alcance (sitio/región) |
| `consulta` | Lectura general sin exportar |

**Files:**
- Create: `supabase/migrations/0025_roles_nomina.sql`:
  - Ampliar `nom_usuarios_empresas.rol` CHECK a `('admin','rrhh','revisor_interno','aprobador_pagos','revisor_externo','supervisor','consulta')`.
  - Columnas `alcance_tipo TEXT CHECK (alcance_tipo IN ('empresa','region','sitio')) DEFAULT 'empresa'` y `alcance_id UUID` (obra/sitio de Presencio vía `nom_v_personal.obra_id`; para `region`, tabla liviana `nom_regiones (id, empresa_id, nombre)` + `nom_regiones_obras (region_id, obra_id)`).
  - Helper SQL `has_rol_nomina(roles TEXT[]) RETURNS BOOLEAN` (SECURITY DEFINER STABLE, consulta `nom_usuarios_empresas` para `auth.uid()` + `auth_empresa_id()`; superadmin siempre true) — se usa en TODAS las policies nuevas.
  - RPC `whoami_nomina()` que devuelve `{ roles: [{rol, alcance_tipo, alcance_id}] }` — el cliente NUNCA deriva roles de metadata editable (mismo patrón que `whoami()` de authStore).
- Create: `src/pages/UsuariosPage.jsx` (o pestaña "Usuarios" en Configuración, visible solo `admin`/superadmin): listar usuarios vinculados, asignar/quitar roles y alcances, vincular revisor externo por email de un usuario ya existente en Auth (NO crear cuentas ni enviar invitaciones por mail sin consentimiento explícito del usuario de la app).
- Modify: `src/store/authStore.js` (cargar `rolesNomina` vía `whoami_nomina()`).
- Test: helper de permisos puro `src/utils/permisos.js` — `puede(rolesNomina, accion)` con matriz de la tabla de arriba; tests por acción.

## Task 29: Gating de UI y RLS por rol (backend = frontend)

Regla de oro del diseño (§2.3): *"Permisos backend = permisos UI. Nunca solo control de UI."*

- **UI:** `Sidebar.jsx` y rutas por rol usando `puede()`: `revisor_externo` aterriza y solo ve Aprobaciones; `aprobador_pagos` ve Aprobaciones + Reportes; `supervisor`/`consulta` sin botones de escritura ni export; `rrhh` sin Configuración de flujos/usuarios. `ProtectedRoute` acepta prop `accion` y redirige si no puede.
- **RLS — migración `0026_rls_roles.sql`:** revisar TODAS las tablas `nom_*` y reemplazar las policies `FOR ALL ... empresa_id = auth_empresa_id()` por: SELECT amplio por empresa (+ alcance para supervisor donde aplique) y escritura restringida con `has_rol_nomina(...)`. Matriz mínima:

| Tabla(s) | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `nom_legajo`, familiares, sanciones, documentos | admin, rrhh, consulta, supervisor (su alcance) | admin, rrhh |
| `nom_convenios/categorias/conceptos/parametros/no_remunerativos` | todos los roles internos | admin, rrhh |
| `nom_periodos`, `nom_liquidaciones`, items | admin, rrhh, consulta, revisores en período con instancia en su paso, supervisor (su alcance) | admin, rrhh (solo período no aprobado) |
| `nom_flujos`, pasos | admin, rrhh (lectura) | admin |
| `nom_usuarios_empresas` | admin | admin |
| `nom_aprobaciones` | participantes del flujo | solo vía RPC `avanzar_flujo` |

- El alcance del supervisor se resuelve con `EXISTS` sobre `nom_usuarios_empresas` + (si `sitio`) `nom_v_personal.obra_id = alcance_id` / (si `region`) join a `nom_regiones_obras`.
- Test: casos nuevos en la suite RLS (se vuelven ejecutables en Task 32).

## Task 30: Circuito end-to-end operable (preliquidación → revisión → emisión)

- **Estados del período atados al flujo:** `borrador` (RRHH preliquida y recalcula libremente) → `en_revision` (al enviar a aprobación: se bloquea el recálculo — trigger o CHECK en la RPC + botón deshabilitado) → `aprobado` → `recibos_emitidos` → `cerrado`. Un rechazo vuelve a `borrador` conservando historial. Verificar los estados actuales de `nom_periodos`/`nom_flujo_instancias` y mapear sin romper datos existentes (migración de datos si hace falta).
- **Bandeja del referente (`AprobacionesPage.jsx`) con contexto para decidir:** además de aprobar/rechazar con comentario (ya existe), agregar por persona: **variación vs. período anterior** (% y $ sobre neto y bruto, badge rojo si |Δ| > 20% — el control nº1 de un referente), detalle de conceptos expandible (reusar el de LiquidacionPage), y el historial de `nom_aprobaciones` de la instancia visible.
- **Emisión de recibos como paso final:** botón "Emitir recibos del período" (rol admin/rrhh) habilitado SOLO con flujo en `aprobado`; corre `emitir_recibo` para todas las liquidaciones (numeración + hash ya existentes de Fase 4), pasa el período a `recibos_emitidos`.
- **Prueba guiada de punta a punta** con el usuario como criterio de aceptación: RRHH preliquida quincena → referente rechaza una persona con comentario → RRHH corrige y reenvía → aprueba → aprobador de pagos confirma → se emiten recibos numerados. Documentar el resultado en `docs/`.

## Task 31: Notificaciones del flujo (Task 25 pendiente de Fase 3)

- Edge Function `supabase/functions/notificar-flujo/index.ts`: al avanzar/rechazar un paso, notifica a los usuarios del rol del paso siguiente. Canal 1 (siempre): **notificaciones in-app** — tabla `nom_notificaciones (id, empresa_id, usuario_id, tipo, titulo, cuerpo, leida, created_at)` con RLS por usuario + campanita en el Layout con badge de no leídas. Canal 2 (opcional): email vía Resend SOLO si el usuario de la app configura la API key en Superadmin y **da consentimiento explícito para enviar mails**; templates es-AR sin montos en el asunto ni el cuerpo (solo "tenés N recibos pendientes de revisión en <empresa>").
- Test: función pura que arma destinatarios y cuerpo a partir de (paso, instancia, usuarios) — sin red.

---

# FASE 5H — Seguridad y confidencialidad (regenerar bite-sized al iniciar) [⚙️ esfuerzo medio]

La información salarial es sensible (Ley 25.326; §7 del diseño). Gate obligatorio antes de usar la app en producción con datos reales.

## Task 32: Suite de RLS cruzada EJECUTABLE (hoy está en `skip`)
- `tests/rls/` ya existe con patrón `skip` sin credenciales. Armar con el usuario las credenciales de test (proyecto Supabase de staging o usuarios de prueba dedicados), documentar setup en `tests/rls/README.md`, y correr en CI como gate.
- Casos mínimos: usuario de empresa A no lee legajos/liquidaciones/recibos/documentos/notificaciones de empresa B; `revisor_externo` solo ve períodos con instancia en su paso y nada más (ni legajos ni configuración); `supervisor` de sitio X no ve personal del sitio Y; `consulta` no puede escribir en ninguna tabla; `anon` no lee nada `nom_*`; storage: usuario de A no obtiene URL firmada de un recibo de B.

## Task 33: Auditoría de acceso a datos sensibles
- Migración `0028_auditoria_accesos.sql`: `nom_accesos_log (id, empresa_id, usuario_id, recurso TEXT CHECK (recurso IN ('recibo_pdf','export_csv','liquidacion_detalle','libro_sueldos')), recurso_id UUID, detalle TEXT, created_at)`, RLS: INSERT vía RPC `registrar_acceso()`; SELECT solo admin/superadmin.
- Registrar en: descarga/emisión de recibo PDF, todo export CSV (liquidación, reportes, libro), apertura de detalle de liquidación por rol no-RRHH. Vista "Accesos" en Superadmin con filtros por usuario/fecha.
- **Exports CSV restringidos** a admin/rrhh (gating por `puede()` + el propio log).

## Task 34: Endurecimiento
- **GRANTs y policies:** barrido de `FOR ALL` amplios (queda resuelto en 0026, verificar que ninguna tabla nueva de 5C–5F lo reintroduzca). `grep -rn "FOR ALL" supabase/migrations/` y justificar cada uno.
- **Storage:** buckets `nom-logos`, `nom-docs`, `nom-paritarias`, `nom-recibos` privados con policy por `empresa_id` en el path (`<empresa_id>/...`); URLs firmadas ≤ 5 min en todo el código (`grep -rn "createSignedUrl" src/` y verificar TTL).
- **Edge Functions:** validar JWT + rol (`has_rol_nomina`) al inicio de `liquidar-periodo`, `notificar-flujo` y `analizar-paritaria` (hoy valida empresa; agregar rol); ningún `console.log` con CUIL/CBU/montos (barrido); errores al cliente sin detalles internos de SQL.
- **Frontend:** confirmar cero `persist` en stores con datos salariales (`grep -rn "persist" src/store/`); no poner CUIL/DNI/ids sensibles en query params de rutas; `vercel.json` con headers `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **RPCs SECURITY DEFINER:** checklist de las existentes (`clonar_convenio`, `avanzar_flujo`, `iniciar_flujo`, `emitir_recibo`, `siguiente_numero_recibo`, `anular_liquidacion`, `whoami_nomina`, `registrar_acceso`): todas validan empresa+rol en el cuerpo, `SET search_path = public`, sin SQL dinámico concatenado.

---

# FASE 5I — Escala: 500+ empleados y grandes históricos (regenerar bite-sized al iniciar) [⚙️ esfuerzo medio]

Hoy `liquidar-periodo` hace ~4 queries **por persona** (fichajes, ausencias) más 3 **por categoría** en loop: con 500 empleados son >2.000 round-trips y la función se corta por timeout. Las páginas cargan todo sin paginar. Esta sub-fase hace viable una empresa de 500+ con supervisores de sitio/regionales/empresa (los alcances vienen de 5G).

## Task 35: `liquidar-periodo` por lotes, sin N+1, con progreso y reanudable
- **Batch de lecturas:** 1 query de fichajes del período para TODOS los `personal_ids` (chunks de 100 con `.in()`), 1 de ausencias, 1 de adelantos (ya está), escalas/no remunerativos resueltos de una sola vez con `IN` sobre pares (convenio, nombre) y filtrado de vigencia en memoria. Cero queries dentro del loop por persona.
- **Procesamiento por lotes de 50** con upsert de liquidaciones al cerrar cada lote (idempotente por `(periodo_id, personal_id)` — verificar UNIQUE, agregarla en migración `0027_indices_escala.sql` si falta).
- **Progreso y reanudación:** columnas `nom_periodos.calculo_estado ('pendiente','calculando','completo','error')`, `calculo_procesados`, `calculo_total`; la función acepta `{ reanudar: true }` y saltea personas ya liquidadas en esta corrida; UI con barra de progreso por polling cada 2 s. Si el batch excede el límite de tiempo de Edge Functions, la UI re-invoca con `reanudar` hasta `completo` (self-chaining simple, sin colas externas).
- Test: funciones puras de armado de lotes y merge de escalas; test de idempotencia (correr dos veces = mismo resultado, sin duplicados).

## Task 36: Índices y paginación server-side
- Migración `0027_indices_escala.sql`: `nom_liquidaciones (periodo_id, personal_id)` UNIQUE, `nom_liquidacion_items (liquidacion_id)`, `nom_categorias (convenio_id, nombre, vigencia_desde DESC)`, `nom_no_remunerativos (convenio_id, categoria_nombre, vigencia_desde DESC)`, `nom_legajo (empresa_id, fecha_baja)`, `nom_notificaciones (usuario_id, leida)`, `nom_accesos_log (empresa_id, created_at DESC)`, `nom_aprobaciones (instancia_id)`.
- **Paginación:** `LegajosPage` y `LiquidacionPage` con `.range()` de a 100 + contador (`count: 'estimated'`), búsqueda server-side con `ilike` (los filtros de Tasks 7 y 13 pasan a server-side cuando la empresa supera 200 legajos; client-side por debajo — helper único `usePaginado`). AprobacionesPage igual si el paso tiene >100 personas.
- Criterio: con el seed de carga (Task 38) ninguna pantalla tarda >2 s en el primer render de datos.

## Task 37: Recibos masivos sin bloquear el navegador
- Generación jsPDF **bajo demanda por persona** (ya emitidos: no regenerar — persistir el PDF en bucket `nom-recibos/<empresa_id>/<periodo>/<personal_id>.pdf` al emitir, con su hash ya calculado).
- "Descargar todos": arma un ZIP (JSZip) desde los PDFs del bucket en lotes de 25 con progreso; para 500 recibos el trabajo pesado ya está hecho en la emisión, la descarga es streaming de archivos existentes.
- La emisión masiva (Task 30) también procesa por lotes de 25 con progreso y es reanudable (misma técnica que Task 35).

## Task 38: Históricos grandes y prueba de carga
- **Agregados por período:** al cerrar un período, guardar en `nom_periodos` los totales (bruto, aportes, contribuciones, neto, cantidad de personas) — Dashboard y Reportes históricos leen agregados, nunca recorren `nom_liquidacion_items` de períodos viejos.
- **Selector de períodos (Task 8)** carga solo el año visible (query por rango, no todo el historial).
- Create: `scripts/seed-carga.sql` — seed sintético: 600 legajos, 3 sitios, 24 períodos liquidados (~14.400 liquidaciones, ~150k items) en el proyecto de staging. Medir y anotar en `docs/`: tiempo de liquidación completa, p95 de carga de LiquidacionPage/LegajosPage/AprobacionesPage/Dashboard, tamaño del ZIP de recibos. Criterios: liquidación 600 personas < 5 min end-to-end con progreso visible; pantallas < 2 s.

---

## Cobertura contra el plan de implementación original (`Recursio_Diseno.md`)

| Ítem del diseño | Estado | Dónde |
|---|---|---|
| Legajo digital + documentación (§3.1, F1) | Hecho parcial → se completa | 5D |
| Motor fórmulas + escalas configurables (§3.2, §4, F2) | Hecho → bugs y extensiones | 5A, 5B |
| Liquidación y recibos numerados con hash (§3.3) | Hecho → recibo modelo AR | 5C |
| Flujo de aprobación configurable (§3.4, F3) | Backend hecho, **circuito no operable** | **5G** |
| Roles y usuarios externos, RLS específica (§3.5) | Tablas hechas, **sin ABM ni gating ni alcances** | **5G** |
| Notificaciones email (F3, quedó pendiente) | No hecho | 5G Task 31 |
| UOCRA quincenal + reportes (F4) | Hecho → deploy pendiente | 5A Task 2 |
| SAC/vacaciones/final (§4.6) | UOCRA hecho → generalizar | 5E |
| Tests RLS como gate de CI (§9.2) | En `skip` | **5H Task 32** |
| Logs de acceso a recibos (§7) | No hecho | 5H Task 33 |
| Casos dorados UOCRA contra escala real (F4, pendiente) | No hecho | agregar a 5E Task 20 (fixtures con escala publicada) |
| Validación recibos reales Asset vs Presencio (F4, pendiente) | No hecho | 5C Task 12 / Task 27 |
| Portal del empleado (F5 futura) | **Fuera de alcance v1** (diseño §8) — confirmar con usuario | — |
| Libro de Sueldos Digital / SICOSS (F6 futura) | **Fuera de alcance v1** (diseño §8) — confirmar con usuario | — |

## Decisiones y supuestos tomados (validar con el usuario si difiere)

1. **Convenio personalizado pisa al global** ocultándolo en selectores (no se borra el global: sigue siendo la base para futuros clones de otras empresas).
2. **Recibo:** A4 apaisado, dos copias lado a lado en una hoja, según el modelo provisto.
3. **Modalidad del básico** vive en la escala (`nom_categorias.modalidad`), no en el legajo; fuera de convenio siempre mensual.
4. **Base rem+no rem** se implementa con el `config.base='ambos'` que el motor ya soporta (sin migración).
5. **SAC** = 50% de la mejor remuneración mensual bruta devengada del semestre, proporcional por días; **vacaciones** LCT (día = sueldo/25); **final** con indemnizaciones solo si `despido_sin_causa` y régimen LCT (UOCRA mantiene 22.250 sin indemnización, ya implementado).
6. **IA de paritarias** nunca escribe valores sin confirmación explícita del usuario en la UI.
7. Migraciones reservadas: 0018 legajo/modalidad, 0019 fórmulas basico_periodo, 0020 códigos de recibo, 0021 empresa_config, 0022 legajo extras (si hace falta), 0023 períodos especiales, 0024 paritarias, 0025 roles nómina, 0026 RLS por rol, 0027 índices/UNIQUE de escala, 0028 auditoría de accesos. Si al ejecutar alguna no hace falta, dejar el número sin usar y anotar en el commit.
8. **Roles:** se extiende `nom_usuarios_empresas` (ya existente) en vez de crear otra tabla de roles; los roles se resuelven server-side (`whoami_nomina()`), nunca de metadata del cliente. Alcances: empresa/región/sitio para `supervisor` (y opcionalmente `rrhh` regional).
9. **Notificaciones:** in-app siempre; email solo con Resend configurado y consentimiento explícito del usuario, sin montos en los mails.
10. **Escala:** sin colas externas ni workers — batch + reanudación dentro de Edge Functions y paginación server-side alcanzan para 500–1000 empleados; si un cliente supera eso, recién ahí evaluar pg_cron/colas.
11. **Períodos aprobados son inmutables:** el recálculo se bloquea desde `en_revision` en adelante; correcciones = rechazo (vuelve a borrador) o anulación auditada (`anular_liquidacion`, Fase 4).
