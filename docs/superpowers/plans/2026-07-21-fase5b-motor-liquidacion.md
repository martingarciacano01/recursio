# Fase 5B — Motor y liquidación (bite-sized) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modalidad de básico (hora/mensual/quincenal), legajos fuera de convenio, base de aportes configurable (verificación — ya implementado), filtros + export CSV en Liquidación, selector de períodos agrupado, y código de concepto imprimible en pantalla/recibo.

**Architecture:** Extiende `packages/motor` (funciones puras, TDD con vitest) y `supabase/functions/liquidar-periodo/index.ts` (Edge Function Deno). El front (React 19 + Zustand) consume vía los stores existentes (`liquidacionStore`, `conceptosStore`, `escalasStore`). Migraciones nuevas idempotentes en `supabase/migrations/`, numeradas desde 0018 (las apilca el usuario en Supabase).

**Tech Stack:** React 19, Vite, Zustand, TypeScript (motor), Deno (Edge Function), Vitest, Supabase JS.

**Nota de partida (relevamiento hecho antes de escribir este plan):** el motor ya soporta `config.base: 'remunerativo'|'no_remunerativo'|'ambos'|'acumulado_mensual'` (`packages/motor/src/formulas.ts`) y el selector de `FormularioConcepto.jsx` ya expone las 4 opciones — la Task 6 original ("exponer selector") ya está hecha; se deja como tarea de **verificación con test dorado**, no de implementación. El util de CSV (`src/utils/exportCsv.js`, con `armarCsv`/`exportarCsv`, separador `;`, BOM UTF-8, ya usado en `ReportesPage.jsx`) también existe — la Task 7 reutiliza ese util en vez de crearlo de nuevo.

---

## Orden de tareas

1. Task 3 — Migración 0018 (columnas de legajo/categoría/concepto)
2. Task 4 — Modalidad del básico (hora/mensual/quincenal)
3. Task 5 — Fuera de convenio
4. Task 6 — Verificación: base de aportes configurable
5. Task 7 — Filtros de liquidación + CSV
6. Task 8 — Selector de períodos agrupado
7. Task 9 — Código de concepto en pantalla y recibo

---

## Task 3: Migración 0018 — columnas de legajo, modalidad y código de recibo

**Files:**
- Create: `supabase/migrations/0018_legajo_baja_modalidad.sql`

- [ ] **Step 1: Crear la migración**

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

- [ ] **Step 2:** Avisar al usuario que la aplique en el SQL Editor de Supabase (no asumir aplicada — el resto de las tareas de esta fase la dan por hecha).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0018_legajo_baja_modalidad.sql
git commit -m "feat(db): migracion 0018 baja, fuera de convenio, modalidad y codigo de recibo"
```

---

## Task 4: Modalidad del básico (hora / mensual / quincenal) [⚙️ esfuerzo medio]

Hoy el motor asume jornal por hora (`basico_convenio * horas_trabajadas` vía la fórmula del concepto "básico"). Regla nueva para una variable **`basico_periodo`** que reemplaza a `basico_convenio` como base del concepto "básico":

- `hora`: `basico * horas_trabajadas` (comportamiento actual, sin cambios).
- `mensual`: período `mensual` → `basico`; período `quincenal` → `basico / 2`; descuento por falta injustificada: `basico / 30` por día.
- `quincenal`: período `quincenal` → `basico`; período `mensual` → `basico * 2`; descuento por falta injustificada: `basico / 15` por día.

**Files:**
- Create: `packages/motor/src/basico.ts`
- Create: `packages/motor/src/basico.test.ts`
- Modify: `supabase/functions/liquidar-periodo/index.ts` (leer `modalidad` de la categoría vigente, calcular `basico_periodo`, agregarlo a `variablesBase`)
- Create: `supabase/migrations/0019_formulas_basico_periodo.sql`
- Modify: `src/components/config/TabEscalas.jsx` (selector Modalidad)
- Modify: `src/store/escalasStore.js` (`categoriaFromDB`/`guardarVigencias` deben leer/escribir `modalidad`)
- Test: `src/store/__tests__/escalasStore.test.js`

- [ ] **Step 1: Test que falla**

```ts
// packages/motor/src/basico.test.ts
import { describe, it, expect } from 'vitest'
import { calcularBasicoPeriodo } from './basico'

describe('calcularBasicoPeriodo', () => {
  it('hora: basico * horas trabajadas (sin cambios de comportamiento)', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'hora', basico: 1500, tipoPeriodo: 'mensual', horasTrabajadas: 176, faltasInjustificadas: 0 })
    expect(r).toBeCloseTo(264000, 2)
  })

  it('mensual, período mensual, sin faltas: paga el basico completo', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'mensual', basico: 600000, tipoPeriodo: 'mensual', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r).toBeCloseTo(600000, 2)
  })

  it('mensual, período quincenal: la mitad del basico', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'mensual', basico: 600000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r).toBeCloseTo(300000, 2)
  })

  it('mensual, período quincenal, 2 faltas injustificadas: descuenta basico/30 por dia', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'mensual', basico: 600000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 2 })
    expect(r).toBeCloseTo(600000 / 2 - 2 * (600000 / 30), 2) // 260000
  })

  it('quincenal, período quincenal, sin faltas: paga el basico completo', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'quincenal', basico: 300000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r).toBeCloseTo(300000, 2)
  })

  it('quincenal, período mensual: el doble del basico', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'quincenal', basico: 300000, tipoPeriodo: 'mensual', horasTrabajadas: 0, faltasInjustificadas: 0 })
    expect(r).toBeCloseTo(600000, 2)
  })

  it('quincenal, período quincenal, 1 falta injustificada: descuenta basico/15', () => {
    const r = calcularBasicoPeriodo({ modalidad: 'quincenal', basico: 300000, tipoPeriodo: 'quincenal', horasTrabajadas: 0, faltasInjustificadas: 1 })
    expect(r).toBeCloseTo(300000 - 300000 / 15, 2) // 280000
  })

  it('modalidad desconocida: lanza error explicito (nunca $0 silencioso)', () => {
    expect(() => calcularBasicoPeriodo({ modalidad: 'semanal', basico: 100, tipoPeriodo: 'mensual', horasTrabajadas: 0, faltasInjustificadas: 0 }))
      .toThrow(/modalidad desconocida/)
  })
})
```

- [ ] **Step 2:** Run `npx vitest run packages/motor/src/basico.test.ts` → Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementación mínima**

```ts
// packages/motor/src/basico.ts
export interface ParamsBasicoPeriodo {
  modalidad: 'hora' | 'mensual' | 'quincenal'
  basico: number
  tipoPeriodo: 'mensual' | 'quincenal' | string
  horasTrabajadas: number
  faltasInjustificadas: number
}

// Base del concepto "básico" según cómo se pactó el sueldo en la escala
// (jornal por hora, mensual fijo, o quincenal fijo) versus el tipo de
// período que se está liquidando. Nunca devuelve 0 en silencio ante una
// modalidad no contemplada: lanza para que el llamador lo reporte.
export function calcularBasicoPeriodo(p: ParamsBasicoPeriodo): number {
  if (p.modalidad === 'hora') {
    return p.basico * p.horasTrabajadas
  }
  if (p.modalidad === 'mensual') {
    const base = p.tipoPeriodo === 'quincenal' ? p.basico / 2 : p.basico
    return base - p.faltasInjustificadas * (p.basico / 30)
  }
  if (p.modalidad === 'quincenal') {
    const base = p.tipoPeriodo === 'mensual' ? p.basico * 2 : p.basico
    return base - p.faltasInjustificadas * (p.basico / 15)
  }
  throw new Error(`modalidad desconocida: ${p.modalidad}`)
}
```

- [ ] **Step 4:** Run `npx vitest run packages/motor/src/basico.test.ts` → Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/motor/src/basico.ts packages/motor/src/basico.test.ts
git commit -m "feat(motor): calcularBasicoPeriodo para modalidad hora/mensual/quincenal"
```

- [ ] **Step 6: Migración de fórmulas — el concepto "básico" pasa a usar `basico_periodo`**

```sql
-- 0019_formulas_basico_periodo.sql
-- Los conceptos "básico" que usaban basico_convenio * horas_trabajadas
-- (jornal fijo) ahora usan basico_periodo, ya resuelto por
-- calcularBasicoPeriodo según la modalidad de la categoría — así un mismo
-- código de concepto sirve para jornal por hora, mensual o quincenal sin
-- tener que reescribir la fórmula por convenio.
UPDATE nom_conceptos
SET formula = 'basico_periodo'
WHERE codigo = 'basico' AND formula = 'basico_convenio * horas_trabajadas';

UPDATE nom_conceptos
SET formula = 'basico_periodo'
WHERE codigo = 'basico' AND formula = 'basico_convenio';
```

  Pedir al usuario que confirme (con `SELECT codigo, formula FROM nom_conceptos WHERE codigo = 'basico';`) qué fórmula tienen realmente cargados los conceptos "básico" existentes antes de aplicar — si hay una tercera variante no cubierta por el UPDATE, ajustar el WHERE con esa fórmula exacta.

- [ ] **Step 7: Edge Function — calcular y exponer `basico_periodo`.** En `supabase/functions/liquidar-periodo/index.ts`:
  - Modificar `resolverBasico` (agregado en la Fase 5A) para además devolver `modalidad`: cambiar el `select('basico')` a `select('basico, modalidad')` y el tipo de retorno a `{ basico: number; modalidad: string } | null`.
  - Ajustar `basicoCacheado`/`cacheBasico` para cachear el objeto completo.
  - Tras resolver `basico` (ver Fase 5A), importar `calcularBasicoPeriodo` desde `../../../packages/motor/src/basico.ts` y calcular:

```ts
const basicoPeriodo = basico
  ? calcularBasicoPeriodo({
      modalidad: basico.modalidad as 'hora' | 'mensual' | 'quincenal',
      basico: basico.basico,
      tipoPeriodo: periodo.tipo === 'mensual' ? 'mensual' : 'quincenal',
      horasTrabajadas: asistencia.horasTrabajadas,
      faltasInjustificadas: asistencia.faltasInjustificadas,
    })
  : 0
```

  - Agregar `basico_periodo: basicoPeriodo` a `variablesBase`.

- [ ] **Step 8: UI — selector de modalidad en `TabEscalas.jsx`.**
  - `src/store/escalasStore.js`: agregar `modalidad: r.modalidad` a `categoriaFromDB`, y que `guardarVigencias` acepte `filas: [{ nombre, valor, modalidad }]` e incluya `modalidad: f.modalidad` en el insert.
  - Test en `src/store/__tests__/escalasStore.test.js`:

```js
it('categoriaFromDB incluye la modalidad', () => {
  const row = { id: 'c1', convenio_id: 'v1', nombre: 'Oficial', basico: 1000, vigencia_desde: '2026-01-01', modalidad: 'mensual' }
  expect(categoriaFromDB(row).modalidad).toBe('mensual')
})
```

  - `TabEscalas.jsx`: agregar un `<select>` de modalidad (hora/mensual/quincenal) junto a cada fila nueva en el formulario de alta de vigencia (dentro de `TablaVigencias` o como prop nueva `conModalidad` — revisar `TablaVigencias.jsx` antes de decidir si el cambio va ahí o se envuelve en `TabEscalas`).

- [ ] **Step 9:** `npx vitest run` completo → PASS. Commit + recordar `supabase functions deploy liquidar-periodo`.

```bash
git add packages/motor/src/basico.ts supabase/functions/liquidar-periodo/index.ts supabase/migrations/0019_formulas_basico_periodo.sql src/store/escalasStore.js src/store/__tests__/escalasStore.test.js src/components/config/TabEscalas.jsx
git commit -m "feat(liquidacion): modalidad de basico hora/mensual/quincenal end-to-end"
```

---

## Task 5: Fuera de convenio — sueldo convenido como base

Para legajos con `fuera_convenio = true` (columna agregada en Task 3): no exigir convenio/categoría; `basico_periodo` sale de `sueldo_convenido` con modalidad `mensual`; los conceptos con `convenio_id NULL` y `empresa_id` de la empresa (los "globales" de esa empresa) aplican.

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts` (no saltear legajos `fuera_convenio` sin convenio/categoría; base = `sueldo_convenido`; incluir conceptos con `convenio_id === null`)
- Modify: `src/components/legajo/EditorDatosLegajo.jsx` (checkbox "Fuera de convenio" + input "Sueldo convenido mensual"; si está activo, deshabilitar convenio/categoría)
- Test: `packages/motor/src/basico.test.ts` (ya cubre la modalidad `mensual`; no requiere caso nuevo — el caso nuevo es de integración en la Edge Function y de UI)
- Test: `src/components/legajo/__tests__/EditorDatosLegajo.test.jsx` (agregar caso)

- [ ] **Step 1: Edge Function — no saltear legajos fuera de convenio.** En el loop principal, cambiar la condición de omisión:

```ts
// antes: if (!legajo?.cuil || !legajo?.cbu || !legajo?.convenio_id || !legajo?.categoria_id) { ...omitir... }
const incompleto = !legajo?.cuil || !legajo?.cbu ||
  (!legajo?.fuera_convenio && (!legajo?.convenio_id || !legajo?.categoria_id)) ||
  (legajo?.fuera_convenio && !legajo?.sueldo_convenido)
if (incompleto) {
  const faltan = [
    !legajo?.cuil && 'CUIL', !legajo?.cbu && 'CBU',
    !legajo?.fuera_convenio && !legajo?.convenio_id && 'convenio',
    !legajo?.fuera_convenio && !legajo?.categoria_id && 'categoría',
    legajo?.fuera_convenio && !legajo?.sueldo_convenido && 'sueldo convenido',
  ].filter(Boolean).join(', ')
  omitidos.push({ personal_id: persona.id, nombre: persona.nombre, motivo: `legajo incompleto: falta ${faltan}` })
  continue
}
```

- [ ] **Step 2: Edge Function — básico y conceptos para fuera de convenio.** Justo antes de armar `variablesBase`, ramificar:

```ts
let basicoPeriodo: number
let conceptosLegajo: ConceptoConConvenio[]
if (legajo.fuera_convenio) {
  basicoPeriodo = calcularBasicoPeriodo({
    modalidad: 'mensual', basico: Number(legajo.sueldo_convenido),
    tipoPeriodo: periodo.tipo === 'mensual' ? 'mensual' : 'quincenal',
    horasTrabajadas: asistencia.horasTrabajadas, faltasInjustificadas: asistencia.faltasInjustificadas,
  })
  // Fuera de convenio: aplican los conceptos "generales" de la empresa
  // (sin convenio asociado) — no los de ningún convenio con categorías.
  conceptosLegajo = conceptosMotor.filter((c) => c.convenioId === null)
} else {
  const nombreCategoria = nombrePorCategoria.get(legajo.categoria_id) ?? ''
  // ... (básico existente de Task 4, sin cambios)
  conceptosLegajo = filtrarPorCategoria(
    conceptosMotor.filter((c) => c.convenioId === legajo.convenio_id),
    nombreCategoria
  )
}
```

  (Reordenar el bloque existente de resolución de `basico`/`nombreCategoria` de la Fase 5A/Task 4 para que solo corra en la rama `else`, ya que un legajo fuera de convenio no tiene `categoria_id`.)

- [ ] **Step 3: UI — checkbox en `EditorDatosLegajo.jsx`.**
  - Agregar al `form` inicial: `fueraConvenio: legajo?.fueraConvenio || false, sueldoConvenido: legajo?.sueldoConvenido || ''`.
  - Checkbox "Fuera de convenio" que, al tildarse, limpia `convenioId`/`categoriaId` y muestra un input numérico "Sueldo convenido mensual"; los `<select>` de convenio/categoría se deshabilitan (`disabled={form.fueraConvenio}`) cuando está tildado.
  - Verificar que `guardarLegajo` en `legajoStore.js` ya mapea cualquier campo del form a snake_case genéricamente o si hay que agregar `fuera_convenio`/`sueldo_convenido` al mapeo explícito (revisar `src/store/legajoStore.js` antes de escribir el código final).

- [ ] **Step 4: Test de componente**

```jsx
it('tildar "Fuera de convenio" deshabilita los selects de convenio/categoria', async () => {
  render(<EditorDatosLegajo legajo={{}} personalId="p1" empresaId="emp-1" />)
  fireEvent.click(screen.getByText('Editar'))
  fireEvent.click(screen.getByLabelText('Fuera de convenio'))
  expect(screen.getByLabelText('Convenio')).toBeDisabled()
  expect(screen.getByLabelText('Categoría')).toBeDisabled()
  expect(screen.getByPlaceholderText('Sueldo convenido mensual')).toBeInTheDocument()
})
```

  (Agregar `aria-label`/`htmlFor` a los `<select>` existentes si no los tienen, para que `getByLabelText` los encuentre — o usar `getByRole('combobox', { name: /convenio/i })` según lo que funcione al correr el test.)

- [ ] **Step 5:** `npx vitest run` → PASS. **Criterio de aceptación:** un legajo fuera de convenio con `sueldo_convenido = 1000000` liquida `basico_periodo = 1000000` en período mensual sin faltas, y sus conceptos globales (aportes/contribuciones con `convenio_id NULL`) se calculan sobre esa base. Commit + recordar deploy.

```bash
git add supabase/functions/liquidar-periodo/index.ts src/components/legajo/EditorDatosLegajo.jsx src/components/legajo/__tests__/EditorDatosLegajo.test.jsx
git commit -m "feat(liquidacion): legajos fuera de convenio liquidan por sueldo convenido"
```

---

## Task 6: Verificación — base de aportes y contribuciones configurable

El motor **ya soporta** `config.base: 'remunerativo' | 'no_remunerativo' | 'ambos' | 'acumulado_mensual'` (`packages/motor/src/formulas.ts`, función `generarFormula`), y `FormularioConcepto.jsx` **ya expone** el selector "sobre lo remunerativo / lo no remunerativo / remunerativo + no remunerativo / acumulado del mes" (usado por `TabAportes.jsx`). No hay nada que implementar: esta tarea es un test dorado que deja el comportamiento documentado y protegido de regresiones.

**Files:**
- Modify: `packages/motor/src/motor.test.ts` (agregar el caso dorado)

- [ ] **Step 1: Test dorado (ya debería pasar; si falla, hay una regresión a investigar antes de seguir)**

```ts
// agregar a packages/motor/src/motor.test.ts
import { generarFormula } from './formulas'

describe('liquidarConceptos — contribucion sobre base "ambos"', () => {
  it('18% sobre remunerativo + no remunerativo acumulados', () => {
    const basico = { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo' as const, orden: 1, formula: 'basico_periodo', imprimible: true }
    const sumaNoRem = { codigo: 'suma_no_rem', nombre: 'Suma no remunerativa', tipo: 'no_remunerativo' as const, orden: 2, formula: 'no_rem_convenio', imprimible: true }
    const contribucion = {
      codigo: 'contrib_18', nombre: 'Contribución 18%', tipo: 'aporte_patronal' as const, orden: 3,
      formula: generarFormula({ modo: 'porcentaje', porcentaje: 18, base: 'ambos' }), imprimible: true,
    }
    const r = liquidarConceptos([basico, sumaNoRem, contribucion], { basico_periodo: 100000, no_rem_convenio: 50000 })
    const item = r.items.find((i) => i.codigo === 'contrib_18')!
    expect(item.monto).toBeCloseTo((100000 + 50000) * 0.18, 2) // 27000
  })
})
```

- [ ] **Step 2:** Run `npx vitest run packages/motor/src/motor.test.ts` → Expected: PASS de entrada (si falla, es una regresión real: parar y reportar antes de seguir con el resto de la fase).

- [ ] **Step 3: Commit**

```bash
git add packages/motor/src/motor.test.ts
git commit -m "test(motor): caso dorado de contribucion sobre base remunerativo+no_remunerativo"
```

---

## Task 7: Filtros de liquidación + export CSV

**Files:**
- Modify: `src/pages/LiquidacionPage.jsx` (input búsqueda por nombre + filtro client-side; botón "Descargar CSV" con el util existente)
- Modify: `supabase/functions/liquidar-periodo/index.ts` (aceptar `personal_ids?: string[]` opcional para recalcular solo un subconjunto)
- Test: ya existe `src/utils/__tests__/exportCsv.test.js` cubriendo `armarCsv`/`exportarCsv` — no requiere test nuevo, solo integrarlo.

- [ ] **Step 1: Filtro de nombre (client-side).** En `LiquidacionPage.jsx`, agregar estado `const [busqueda, setBusqueda] = useState('')` y un `<input>` sobre la tabla:

```jsx
<input className="input" placeholder="Buscar por nombre…" value={busqueda}
  onChange={(e) => setBusqueda(e.target.value)} style={{ maxWidth: 260 }} />
```

  Filtrar antes del `.map` de la tabla:

```js
const liquidacionesFiltradas = liquidaciones.filter((l) => {
  const nombre = personalPorId.get(l.personalId) || ''
  return nombre.toLowerCase().includes(busqueda.toLowerCase())
})
```

  y usar `liquidacionesFiltradas` en vez de `liquidaciones` en el `.map` de filas (dejar `liquidaciones.length` para el conteo del período calculado, y `liquidacionesFiltradas.length` en el mensaje de la tabla si difiere).

- [ ] **Step 2: Botón "Descargar CSV".** Importar `exportarCsv` desde `../utils/exportCsv` y agregar:

```jsx
import { exportarCsv } from '../utils/exportCsv'

const descargarCsv = () => {
  exportarCsv(`liquidacion-${periodoActivo?.tipo}-${periodoActivo?.fecha_desde}.csv`, [
    { titulo: 'Legajo', valor: (l) => l.personalId.slice(0, 8) },
    { titulo: 'Nombre', valor: (l) => personalPorId.get(l.personalId) || l.personalId },
    { titulo: 'Horas', valor: (l) => l.detalleHoras?.horasTrabajadas ?? 0 },
    { titulo: 'HE 50%', valor: (l) => l.detalleHoras?.horasExtra50 ?? 0 },
    { titulo: 'HE 100%', valor: (l) => l.detalleHoras?.horasExtra100 ?? 0 },
    { titulo: 'Bruto', valor: (l) => l.bruto },
    { titulo: 'Aportes', valor: (l) => l.totalAportes },
    { titulo: 'Contribuciones', valor: (l) => l.totalContribuciones },
    { titulo: 'Neto', valor: (l) => l.neto },
  ], liquidacionesFiltradas)
}
```

  Botón junto a "Calcular": `<button className="btn btn-ghost btn-sm" onClick={descargarCsv} disabled={liquidacionesFiltradas.length === 0}>Descargar CSV</button>`.

- [ ] **Step 3: Edge Function — `personal_ids` opcional.** En `liquidar-periodo/index.ts`, leer del body:

```ts
const { periodoId, personalIds } = await req.json()
```

  y, al armar la query de `personal`, agregar el filtro si vino:

```ts
let queryPersonal = supabase.from('nom_v_personal').select('id, nombre').eq('empresa_id', periodo.empresa_id).eq('estado', 'activo')
if (Array.isArray(personalIds) && personalIds.length > 0) queryPersonal = queryPersonal.in('id', personalIds)
const { data: personal, error: errPersonal } = await queryPersonal
```

  Nota: la idempotencia actual borra **todas** las liquidaciones del período antes de reinsertar (`liquidacionesPrevias`); si se recalcula un subconjunto, ese borrado debe filtrarse también por `personalIds` cuando vino seteado, para no perder las liquidaciones de las personas no incluidas:

```ts
let queryPrevias = supabase.from('nom_liquidaciones').select('id').eq('periodo_id', periodoId)
if (Array.isArray(personalIds) && personalIds.length > 0) queryPrevias = queryPrevias.in('personal_id', personalIds)
const { data: liquidacionesPrevias } = await queryPrevias
```

- [ ] **Step 4:** `npx vitest run` → PASS (sin tests nuevos de motor; el cambio de la Edge Function es Deno, no corre en vitest — revisar manualmente el diff). Commit + recordar deploy.

```bash
git add src/pages/LiquidacionPage.jsx supabase/functions/liquidar-periodo/index.ts
git commit -m "feat(liquidacion): filtro por nombre, export CSV y recalculo parcial por personal_ids"
```

---

## Task 8: Selector de períodos e históricos

**Files:**
- Create: `src/components/SelectorPeriodo.jsx`
- Create: `src/components/__tests__/SelectorPeriodo.test.jsx`
- Modify: `src/pages/LiquidacionPage.jsx` (usar el componente nuevo en vez del `<select>` plano)

Estados reales de `nom_periodos.estado` (migración 0007): `'abierto' | 'en_flujo' | 'cerrado'` — el plan original mencionaba 4 estados; usar estos 3, que son los del CHECK real.

- [ ] **Step 1: Test que falla**

```jsx
// src/components/__tests__/SelectorPeriodo.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SelectorPeriodo from '../SelectorPeriodo'

const periodos = [
  { id: 'p1', tipo: 'mensual', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-30', estado: 'cerrado' },
  { id: 'p2', tipo: 'quincena_1', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-15', estado: 'abierto' },
  { id: 'p3', tipo: 'quincena_2', fecha_desde: '2026-07-16', fecha_hasta: '2026-07-31', estado: 'en_flujo' },
]

describe('SelectorPeriodo', () => {
  it('agrupa por año y mes, y muestra el badge de estado de cada periodo', () => {
    render(<SelectorPeriodo periodos={periodos} value="" onChange={vi.fn()} />)
    expect(screen.getByText('2026')).toBeInTheDocument()
    expect(screen.getByText('Julio')).toBeInTheDocument()
    expect(screen.getByText('Junio')).toBeInTheDocument()
    expect(screen.getAllByText(/cerrado|abierto|en_flujo/)).toHaveLength(3)
  })

  it('llama a onChange con el id del periodo elegido', () => {
    const onChange = vi.fn()
    render(<SelectorPeriodo periodos={periodos} value="" onChange={onChange} />)
    fireEvent.click(screen.getByText(/1ª quincena/i))
    expect(onChange).toHaveBeenCalledWith('p2')
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/components/__tests__/SelectorPeriodo.test.jsx` → Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementación mínima**

```jsx
// src/components/SelectorPeriodo.jsx
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const ETIQUETA_TIPO = {
  mensual: 'Mensual', quincena_1: '1ª quincena', quincena_2: '2ª quincena',
  sac: 'SAC', vacaciones: 'Vacaciones', final: 'Liquidación final',
}

// Agrupa períodos por año → mes (según fecha_desde) para el selector de
// Liquidación. Cada chip muestra tipo + badge de estado; un click llama a
// onChange(periodo.id). Períodos cerrados quedan igual de clickeables
// (la página que lo usa decide si abre en solo lectura).
export default function SelectorPeriodo({ periodos, value, onChange }) {
  const porAnio = new Map()
  for (const p of periodos) {
    const anio = p.fecha_desde.slice(0, 4)
    const mes = Number(p.fecha_desde.slice(5, 7)) - 1
    if (!porAnio.has(anio)) porAnio.set(anio, new Map())
    const porMes = porAnio.get(anio)
    if (!porMes.has(mes)) porMes.set(mes, [])
    porMes.get(mes).push(p)
  }
  const anios = [...porAnio.keys()].sort().reverse()

  return (
    <div>
      {anios.map((anio) => (
        <div key={anio} style={{ marginBottom: 8 }}>
          <strong>{anio}</strong>
          {[...porAnio.get(anio).keys()].sort((a, b) => b - a).map((mes) => (
            <div key={mes} style={{ marginLeft: 12, marginTop: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{MESES[mes]}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                {porAnio.get(anio).get(mes).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`btn btn-sm ${value === p.id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => onChange(p.id)}
                  >
                    {ETIQUETA_TIPO[p.tipo] || p.tipo}
                    <span className="badge badge-neutral" style={{ marginLeft: 6 }}>{p.estado}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4:** Run → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/SelectorPeriodo.jsx src/components/__tests__/SelectorPeriodo.test.jsx
git commit -m "feat(liquidacion): selector de periodos agrupado por anio/mes con badge de estado"
```

- [ ] **Step 6: Integrar en `LiquidacionPage.jsx`.** Reemplazar el `<select>` plano de períodos por `<SelectorPeriodo periodos={periodos} value={periodoSeleccionado} onChange={setPeriodoSeleccionado} />`. Si `periodoActivo?.estado === 'cerrado'`, ocultar el botón "Calcular" (o deshabilitarlo con tooltip "período cerrado: solo lectura") — la página ya carga las liquidaciones existentes del período vía `cargarLiquidaciones`, así que el histórico se ve igual sin recalcular.

- [ ] **Step 7:** `npx vitest run` completo → PASS. Commit.

```bash
git add src/pages/LiquidacionPage.jsx
git commit -m "feat(liquidacion): usar SelectorPeriodo y bloquear recalculo de periodos cerrados"
```

---

## Task 9: Código de concepto en pantalla y recibo

**Files:**
- Create: `src/utils/etiquetaConcepto.js`
- Create: `src/utils/__tests__/etiquetaConcepto.test.js`
- Modify: `src/components/config/FormularioConcepto.jsx` (campo "Código de recibo")
- Modify: `src/store/conceptosStore.js` (mapear `codigo_recibo` ↔ `codigoRecibo`)
- Modify: `src/pages/LiquidacionPage.jsx` (usar `etiquetaConcepto` en el detalle expandible)
- Create: `supabase/migrations/0020_codigos_recibo_seed.sql`

- [ ] **Step 1: Test que falla**

```js
// src/utils/__tests__/etiquetaConcepto.test.js
import { describe, it, expect } from 'vitest'
import { etiquetaConcepto } from '../etiquetaConcepto'

describe('etiquetaConcepto', () => {
  it('con codigo_recibo antepone el codigo', () => {
    expect(etiquetaConcepto({ codigo_recibo: '0015', concepto_nombre: 'Horas normales' })).toBe('0015 Horas normales')
  })
  it('sin codigo_recibo devuelve solo el nombre', () => {
    expect(etiquetaConcepto({ codigo_recibo: null, concepto_nombre: 'Horas normales' })).toBe('Horas normales')
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/utils/__tests__/etiquetaConcepto.test.js` → Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementación mínima**

```js
// src/utils/etiquetaConcepto.js
// `i` es una fila de nom_liquidacion_items (concepto_nombre, codigo_recibo
// vía join, o el propio concepto de nom_conceptos con nombre/codigoRecibo).
export function etiquetaConcepto(i) {
  const codigo = i.codigo_recibo ?? i.codigoRecibo
  const nombre = i.concepto_nombre ?? i.nombre
  return codigo ? `${codigo} ${nombre}` : nombre
}
```

- [ ] **Step 4:** Run → PASS. Commit.

```bash
git add src/utils/etiquetaConcepto.js src/utils/__tests__/etiquetaConcepto.test.js
git commit -m "feat(recibo): helper etiquetaConcepto para mostrar codigo_recibo + nombre"
```

- [ ] **Step 5: Migración de códigos default**

```sql
-- 0020_codigos_recibo_seed.sql
-- Códigos de recibo default para los conceptos globales existentes, según
-- el modelo de recibo provisto (UOCRA). El resto de los conceptos globales
-- sin código asignado explícitamente arriba recibe un correlativo 09xx.
UPDATE nom_conceptos SET codigo_recibo = '0015' WHERE codigo = 'basico' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0043' WHERE codigo = 'hs_feriado' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0191' WHERE codigo = 'presentismo' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0300' WHERE codigo = 'jubilacion' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0302' WHERE codigo = 'ley_19032' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0310' WHERE codigo = 'obra_social' AND convenio_id IS NULL AND codigo_recibo IS NULL;
UPDATE nom_conceptos SET codigo_recibo = '0316' WHERE codigo = 'retencion_sindical' AND convenio_id IS NULL AND codigo_recibo IS NULL;

-- Correlativo 09xx para el resto de los conceptos globales sin código.
WITH restantes AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY orden, codigo) AS n
  FROM nom_conceptos
  WHERE convenio_id IS NULL AND codigo_recibo IS NULL
)
UPDATE nom_conceptos c
SET codigo_recibo = '09' || LPAD(restantes.n::text, 2, '0')
FROM restantes
WHERE c.id = restantes.id;
```

  Nota para el usuario: revisar antes de correr si los `codigo` reales (`hs_feriado`, `ley_19032`, `retencion_sindical`, etc.) coinciden con los cargados en `nom_conceptos` (`SELECT codigo, nombre FROM nom_conceptos WHERE convenio_id IS NULL;`) — ajustar el WHERE de cada UPDATE si el nombre de código real difiere.

- [ ] **Step 6: UI — campo en `FormularioConcepto.jsx`.**
  - Agregar prop `codigoRecibo`/callback o, más simple, un input controlado en el propio formulario que se guarde junto con `config`/`formula` al llamar `onGuardar` (extender la firma a `onGuardar({ config, formula, categorias, codigoRecibo })`).
  - `TabAportes.jsx`/cualquier otro caller de `FormularioConcepto` debe pasar el nuevo campo a `guardarConcepto`.
  - `src/store/conceptosStore.js`: agregar `codigoRecibo: r.codigo_recibo` al mapper `conceptoFromDB` (verificar el nombre exacto del mapper con `grep -n "FromDB" src/store/conceptosStore.js`) y `codigo_recibo: c.codigoRecibo` al armar el insert/update en `guardarConcepto`.

- [ ] **Step 7: UI — mostrar en Liquidación.** En `LiquidacionPage.jsx`, en la tabla de detalle expandible (línea con `{i.concepto_nombre} <span>({i.concepto_codigo})</span>`), reemplazar por `{etiquetaConcepto(i)}` (importar el helper).

- [ ] **Step 8:** `npx vitest run` completo → PASS. Commit + recordar aplicar migraciones 0018/0019/0020 y `supabase functions deploy liquidar-periodo` si no se hizo en tareas previas.

```bash
git add src/components/config/FormularioConcepto.jsx src/store/conceptosStore.js src/pages/LiquidacionPage.jsx supabase/migrations/0020_codigos_recibo_seed.sql
git commit -m "feat(recibo): codigo de concepto editable y visible en liquidacion"
```

---

## Verificación final de la sub-fase

- [ ] `npx vitest run` completo en verde (base previa: 128 tests tras la Fase 5A; debería crecer con los tests de esta fase).
- [ ] Confirmar con el usuario que aplicó, en orden, las migraciones 0018, 0019 y 0020, y que corrió `supabase functions deploy liquidar-periodo`.
- [ ] Recalcular un período de prueba con al menos un legajo por convenio y uno fuera de convenio: ningún bruto debería quedar en $0 sin advertencia explicada en el banner.
