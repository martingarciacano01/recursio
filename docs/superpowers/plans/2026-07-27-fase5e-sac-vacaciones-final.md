# Fase 5E — SAC, vacaciones y liquidación final — Plan de ejecución

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalizar SAC, vacaciones y liquidación final a todos los convenios/LCT (no solo UOCRA), y activar el botón "Generar liquidación final" que hoy está deshabilitado en la ficha del legajo (Fase 5D, Task 49).

**Architecture:** `packages/motor/src/especiales.ts` (nuevo) aporta las fórmulas puras genéricas (régimen LCT); `packages/motor/src/uocra.ts` (ya existe, sin tocar su lógica) sigue cubriendo el régimen 22.250. La Edge Function `liquidar-periodo` rama por `nom_periodos.tipo` y por `nom_convenios.regimen` para elegir qué motor usar. La UI reutiliza el `SelectorPeriodo` y el botón ya cableado en `FichaLegajoPage`.

**Tech Stack:** TypeScript (motor), Deno (Edge Function), React 19, Vitest.

---

## Contexto que hay que conocer antes de empezar

- `packages/motor/src/uocra.ts` YA implementa, para régimen 22.250: `calcularFondoDesempleo`, `calcularSAC` (50% de la mejor remuneración del semestre, sin proporcionalidad), `calcularSACProporcional`, `diasVacacionesPorAntiguedad`, `calcularVacacionesNoGozadas`, `calcularLiquidacionFinal` (solo vacaciones no gozadas + SAC proporcional, SIN indemnización — el régimen 22.250 no tiene indemnización por despido, la cubre el fondo de desempleo). **No modificar este archivo** — Fase 5E lo reusa vía import, no lo reemplaza.
- `nom_periodos.tipo` tiene hoy el CHECK `('mensual','quincenal','quincena_1','quincena_2','sac','final')` (ver `supabase/migrations/0017_uocra_quincenal.sql`). Vamos a AMPLIAR (no romper) agregando `'sac_1'`, `'sac_2'`, `'vacaciones'`. `'sac'` y `'final'` genéricos quedan (compatibilidad con períodos ya creados).
- `nom_legajo` ya tiene `fecha_baja`, `motivo_baja`, `liquidacion_final_id` (migración `0018`) y `antiguedad_reconocida` (migración `0028`). `fecha_ingreso` vive en la tabla de Presencio expuesta por `nom_v_personal`.
- `nom_convenios` — verificar si ya tiene una columna que distinga régimen UOCRA (22.250) de LCT genérico. Si no existe, Task 34 la agrega (`regimen TEXT DEFAULT 'lct' CHECK (regimen IN ('lct','22250'))`) y hay que setear `'22250'` en el convenio UOCRA existente vía UPDATE en la misma migración (buscar por `nombre ILIKE 'UOCRA%'`).
- `supabase/functions/liquidar-periodo/index.ts` (459 líneas) ya resuelve `basico_periodo` por modalidad (Fase 5B) y ya soporta `personal_ids?: string[]` para liquidar un subconjunto (Fase 5B Task 7) — la liquidación final de una sola persona reusa ese mecanismo.
- `src/pages/LiquidacionPage.jsx` ya tiene un form "Nuevo período" con `<select>` de tipo (hoy: mensual/quincenal/sac/final) que hace `insert` directo a `nom_periodos` vía Supabase client — Task 36 solo agrega opciones al `<select>`, no crea un flujo nuevo.
- `src/pages/FichaLegajoPage.jsx:99-113` ya tiene el botón "Generar liquidación final" **deshabilitado** con `title="Disponible al completar la Fase 5E..."`, visible cuando `legajo?.fechaBaja` está presente y `legajo?.liquidacionFinalId` es null (Fase 5D Task 49). Task 37 lo activa.

---

## Task 30: Migración 0030 — tipos de período especiales + régimen de convenio

**Files:**
- Create: `supabase/migrations/0030_periodos_especiales_regimen.sql`

- [ ] **Step 1:** Verificar si `nom_convenios` ya tiene una columna de régimen:

```bash
grep -n "regimen" supabase/migrations/*.sql
```

Si NO aparece ninguna columna `regimen` en `nom_convenios`, seguir con el Step 2 tal cual. Si ya existe, ajustar el Step 2 para no duplicar la columna (solo el ALTER de `nom_periodos` y el UPDATE de UOCRA).

- [ ] **Step 2:** Crear la migración:

```sql
-- 0030_periodos_especiales_regimen.sql
-- Amplía nom_periodos.tipo para distinguir SAC 1er/2do semestre y
-- vacaciones (antes solo había 'sac' genérico). Agrega el régimen del
-- convenio (LCT genérico vs. 22.250 UOCRA) para que liquidar-periodo
-- sepa qué motor de especiales usar (packages/motor/src/especiales.ts
-- vs. packages/motor/src/uocra.ts, ya existente).

ALTER TABLE nom_periodos DROP CONSTRAINT IF EXISTS nom_periodos_tipo_check;
ALTER TABLE nom_periodos ADD CONSTRAINT nom_periodos_tipo_check
  CHECK (tipo IN ('mensual','quincenal','quincena_1','quincena_2','sac','sac_1','sac_2','vacaciones','final'));

ALTER TABLE nom_convenios
  ADD COLUMN IF NOT EXISTS regimen TEXT NOT NULL DEFAULT 'lct' CHECK (regimen IN ('lct','22250'));

UPDATE nom_convenios SET regimen = '22250' WHERE nombre ILIKE 'UOCRA%' AND regimen = 'lct';

COMMENT ON COLUMN nom_convenios.regimen IS 'lct: SAC/vacaciones/final genéricos (Ley 20.744). 22250: régimen de la construcción (Ley 22.250) — sin indemnización por despido, ver packages/motor/src/uocra.ts';
```

- [ ] **Step 3:** Pedir al usuario que la aplique en Supabase. Commit: `feat(db): migracion 0030 tipos de periodo especiales y regimen de convenio`

---

## Task 31: Motor `packages/motor/src/especiales.ts` — SAC, vacaciones y final LCT [⚙️ esfuerzo medio]

**Files:**
- Create: `packages/motor/src/especiales.ts`
- Create: `packages/motor/src/especiales.test.ts`

- [ ] **Step 1: Test que falla — SAC LCT (art. 121, mejor remuneración mensual del semestre)**

```ts
// packages/motor/src/especiales.test.ts
import { describe, it, expect } from 'vitest'
import { calcularSAC, calcularVacaciones, calcularLiquidacionFinal } from './especiales'

describe('calcularSAC (LCT, art. 121)', () => {
  it('semestre completo: mejor bruto / 2', () => {
    const r = calcularSAC({ mejoresBrutosPorMes: [500000, 620000, 480000, 600000, 610000, 590000], diasTrabajadosSemestre: 182, diasSemestre: 182 })
    expect(r).toBe(310000) // 620000 / 2
  })
  it('proporcional a dias trabajados del semestre (ingreso a mitad de semestre)', () => {
    const r = calcularSAC({ mejoresBrutosPorMes: [600000, 650000, 600000], diasTrabajadosSemestre: 91, diasSemestre: 182 })
    expect(r).toBeCloseTo(650000 / 2 * (91 / 182), 2) // 162500
  })
  it('sin meses liquidados en el semestre da 0', () => {
    expect(calcularSAC({ mejoresBrutosPorMes: [], diasTrabajadosSemestre: 91, diasSemestre: 182 })).toBe(0)
  })
})
```

- [ ] **Step 2:** Run `npx vitest run packages/motor/src/especiales.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación mínima de `calcularSAC`**

```ts
// packages/motor/src/especiales.ts
// Reglas del régimen LCT (Ley 20.744) generalizadas a cualquier convenio
// que NO sea 22.250 (ver packages/motor/src/uocra.ts para ese régimen).
// Funciones puras: no leen DB, reciben todo resuelto (mismo patrón que
// uocra.ts y asistencia.ts).

export interface SACInput {
  mejoresBrutosPorMes: number[] // bruto (remunerativo + no remunerativo) de cada mes liquidado en el semestre
  diasTrabajadosSemestre: number
  diasSemestre?: number // normalmente 182 o 183
}

// Art. 121 LCT: 50% de la mejor remuneración mensual, normal y habitual,
// devengada en el semestre, proporcional a los días trabajados si el
// semestre no se trabajó completo (ingreso/egreso a mitad de semestre).
export function calcularSAC(input: SACInput): number {
  const { mejoresBrutosPorMes, diasTrabajadosSemestre, diasSemestre = 182 } = input
  if (mejoresBrutosPorMes.length === 0) return 0
  const mejorBruto = Math.max(...mejoresBrutosPorMes)
  return (mejorBruto / 2) * (diasTrabajadosSemestre / diasSemestre)
}
```

- [ ] **Step 4:** Run → PASS.

- [ ] **Step 5: Test que falla — vacaciones LCT (art. 150, 4 tramos de antigüedad + jornalizado)**

```ts
describe('calcularVacaciones (LCT, art. 150)', () => {
  it('menos de 5 años: 14 dias, modalidad mensual', () => {
    const r = calcularVacaciones({ antiguedadAnios: 3, diasTrabajadosAnio: 365, sueldoMensual: 500000, modalidad: 'mensual' })
    expect(r.dias).toBe(14)
    expect(r.montoDia).toBe(20000) // 500000 / 25
    expect(r.total).toBe(280000) // 14 * 20000
  })
  it('5 a 9 años: 21 dias', () => {
    expect(calcularVacaciones({ antiguedadAnios: 7, diasTrabajadosAnio: 365, sueldoMensual: 500000, modalidad: 'mensual' }).dias).toBe(21)
  })
  it('10 a 19 años: 28 dias', () => {
    expect(calcularVacaciones({ antiguedadAnios: 15, diasTrabajadosAnio: 365, sueldoMensual: 500000, modalidad: 'mensual' }).dias).toBe(28)
  })
  it('20 años o mas: 35 dias', () => {
    expect(calcularVacaciones({ antiguedadAnios: 25, diasTrabajadosAnio: 365, sueldoMensual: 500000, modalidad: 'mensual' }).dias).toBe(35)
  })
  it('menos de 6 meses de antiguedad: 1 dia cada 20 trabajados', () => {
    const r = calcularVacaciones({ antiguedadAnios: 0.3, diasTrabajadosAnio: 100, sueldoMensual: 500000, modalidad: 'mensual' })
    expect(r.dias).toBe(5) // floor(100 / 20)
  })
  it('modalidad jornalizada usa valorHora * 8 como valor dia', () => {
    const r = calcularVacaciones({ antiguedadAnios: 3, diasTrabajadosAnio: 365, modalidad: 'hora', valorHora: 2500 })
    expect(r.montoDia).toBe(20000) // 2500 * 8
    expect(r.total).toBe(280000) // 14 * 20000
  })
})
```

- [ ] **Step 6:** Run → FAIL (`calcularVacaciones` no existe).

- [ ] **Step 7: Implementación de `calcularVacaciones`**

```ts
export interface VacacionesInput {
  antiguedadAnios: number
  diasTrabajadosAnio: number
  modalidad: 'mensual' | 'quincenal' | 'hora'
  sueldoMensual?: number // requerido si modalidad !== 'hora'
  valorHora?: number // requerido si modalidad === 'hora'
}

export interface VacacionesResultado {
  dias: number
  montoDia: number
  total: number
}

// Días de vacaciones por antigüedad (art. 150 LCT). Reexportado desde
// uocra.ts porque la escala es idéntica en ambos regímenes — no duplicar
// la tabla de tramos en dos archivos (DRY).
export { diasVacacionesPorAntiguedad } from './uocra'
import { diasVacacionesPorAntiguedad as diasPorAntiguedad } from './uocra'

export function calcularVacaciones(input: VacacionesInput): VacacionesResultado {
  const dias = input.antiguedadAnios < 0.5
    ? Math.floor(input.diasTrabajadosAnio / 20)
    : diasPorAntiguedad(input.antiguedadAnios)
  const montoDia = input.modalidad === 'hora'
    ? (input.valorHora ?? 0) * 8
    : (input.sueldoMensual ?? 0) / 25
  return { dias, montoDia, total: dias * montoDia }
}
```

- [ ] **Step 8:** Run → PASS.

- [ ] **Step 9: Test que falla — liquidación final LCT por motivo de baja**

```ts
describe('calcularLiquidacionFinal (LCT)', () => {
  const base = {
    diasTrabajadosMes: 15, sueldoMensual: 600000,
    sacProporcional: 50000, vacacionesNoGozadas: 84000,
    antiguedadAnios: 3, mejorRemuneracionMensualNormal: 600000,
  }

  it('renuncia: solo rubros comunes, sin indemnizacion ni preaviso', () => {
    const r = calcularLiquidacionFinal({ ...base, motivoBaja: 'renuncia' })
    expect(r.indemnizacionAntiguedad).toBe(0)
    expect(r.preaviso).toBe(0)
    expect(r.total).toBe(base.sacProporcional + base.vacacionesNoGozadas + (base.sueldoMensual / 30 * base.diasTrabajadosMes))
  })

  it('despido sin causa, antiguedad 3 anios: 3 sueldos de indemnizacion + 1 mes de preaviso (< 5 anios)', () => {
    const r = calcularLiquidacionFinal({ ...base, motivoBaja: 'despido_sin_causa' })
    expect(r.indemnizacionAntiguedad).toBe(1800000) // 3 * 600000
    expect(r.preaviso).toBe(600000) // 1 mes, antiguedad < 5 anios
  })

  it('despido sin causa, antiguedad 6 anios: preaviso de 2 meses (>= 5 anios)', () => {
    const r = calcularLiquidacionFinal({ ...base, motivoBaja: 'despido_sin_causa', antiguedadAnios: 6, mejorRemuneracionMensualNormal: 600000 })
    expect(r.indemnizacionAntiguedad).toBe(3600000) // 6 * 600000
    expect(r.preaviso).toBe(1200000) // 2 meses
  })

  it('fraccion de antiguedad mayor a 3 meses redondea el anio hacia arriba para la indemnizacion', () => {
    const r = calcularLiquidacionFinal({ ...base, motivoBaja: 'despido_sin_causa', antiguedadAnios: 3.4, mejorRemuneracionMensualNormal: 600000 })
    expect(r.indemnizacionAntiguedad).toBe(2400000) // ceil(3.4) = 4 * 600000
  })

  it('despido con causa: igual que renuncia, sin indemnizacion ni preaviso', () => {
    const r = calcularLiquidacionFinal({ ...base, motivoBaja: 'despido_con_causa' })
    expect(r.indemnizacionAntiguedad).toBe(0)
    expect(r.preaviso).toBe(0)
  })
})
```

- [ ] **Step 10:** Run → FAIL (`calcularLiquidacionFinal` no existe).

- [ ] **Step 11: Implementación de `calcularLiquidacionFinal`**

```ts
export type MotivoBaja = 'renuncia' | 'despido_sin_causa' | 'despido_con_causa' | 'fin_obra' | 'mutuo_acuerdo' | 'fallecimiento'

export interface LiquidacionFinalInputLCT {
  motivoBaja: MotivoBaja
  diasTrabajadosMes: number
  sueldoMensual: number
  sacProporcional: number
  vacacionesNoGozadas: number
  antiguedadAnios: number
  mejorRemuneracionMensualNormal: number // base del art. 245 LCT
}

export interface LiquidacionFinalResultadoLCT {
  diasTrabajadosMes: number
  montoDiasTrabajadosMes: number
  sacProporcional: number
  vacacionesNoGozadas: number
  indemnizacionAntiguedad: number
  preaviso: number
  total: number
}

// Régimen LCT (Ley 20.744), a diferencia de 22.250 (uocra.ts):
// - despido_sin_causa: indemnización por antigüedad (art. 245, 1 sueldo
//   por año o fracción > 3 meses, base = mejor remuneración mensual
//   normal y habitual) + preaviso (art. 231: 1 mes si antigüedad < 5
//   años, 2 meses si >= 5 años).
// - renuncia / despido_con_causa / fin_obra / mutuo_acuerdo / fallecimiento:
//   sin indemnización ni preaviso — solo los rubros comunes.
export function calcularLiquidacionFinal(input: LiquidacionFinalInputLCT): LiquidacionFinalResultadoLCT {
  const montoDiasTrabajadosMes = (input.sueldoMensual / 30) * input.diasTrabajadosMes
  let indemnizacionAntiguedad = 0
  let preaviso = 0

  if (input.motivoBaja === 'despido_sin_causa') {
    const aniosEnteros = Math.floor(input.antiguedadAnios)
    const fraccion = input.antiguedadAnios - aniosEnteros
    const aniosIndemnizables = fraccion > 0.25 ? aniosEnteros + 1 : Math.max(aniosEnteros, 1)
    indemnizacionAntiguedad = aniosIndemnizables * input.mejorRemuneracionMensualNormal
    preaviso = input.antiguedadAnios >= 5 ? input.mejorRemuneracionMensualNormal * 2 : input.mejorRemuneracionMensualNormal
  }

  const total = montoDiasTrabajadosMes + input.sacProporcional + input.vacacionesNoGozadas + indemnizacionAntiguedad + preaviso
  return {
    diasTrabajadosMes: input.diasTrabajadosMes, montoDiasTrabajadosMes,
    sacProporcional: input.sacProporcional, vacacionesNoGozadas: input.vacacionesNoGozadas,
    indemnizacionAntiguedad, preaviso, total,
  }
}
```

- [ ] **Step 12:** Run `npx vitest run packages/motor/src/especiales.test.ts` → PASS (10 tests).

- [ ] **Step 13:** `npx vitest run` completo → PASS, sin regresiones. Commit: `feat(motor): especiales.ts — SAC, vacaciones y liquidacion final del regimen LCT`

---

## Task 32: Edge Function `liquidar-periodo` — rama por tipo de período especial [⚙️ esfuerzo medio]

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts`

- [ ] **Step 1: Leer el archivo completo antes de tocarlo** (459 líneas — ya resuelve `basico_periodo`, `personal_ids`, consolidación quincenal UOCRA; no romper ese camino, que sigue siendo el default para `tipo IN ('mensual','quincenal','quincena_1','quincena_2')`).

- [ ] **Step 2: Agregar la rama de períodos especiales.** Justo después de cargar `periodo` (línea ~65, tras el chequeo de `periodo.estado === 'cerrado'`), agregar:

```ts
const ESPECIALES = ['sac', 'sac_1', 'sac_2', 'vacaciones', 'final']
if (ESPECIALES.includes(periodo.tipo)) {
  return await liquidarPeriodoEspecial(supabase, periodo, body)
}
```

- [ ] **Step 3: Implementar `liquidarPeriodoEspecial`** (nueva función en el mismo archivo, debajo del handler principal). Resuelve, por cada legajo objetivo (todos los activos de la empresa, o solo `body.personal_ids` si viene — reusa el mismo parámetro que Task 7 de la Fase 5B):

```ts
async function liquidarPeriodoEspecial(supabase: any, periodo: any, body: any) {
  const personalIds: string[] | undefined = body.personal_ids
  let queryLegajos = supabase.from('nom_legajo').select('*, nom_convenios(regimen)').eq('empresa_id', periodo.empresa_id)
  if (personalIds?.length) queryLegajos = queryLegajos.in('personal_id', personalIds)
  const { data: legajos, error: errLegajos } = await queryLegajos
  if (errLegajos) return jsonError(errLegajos.message)

  const resultados = []
  const omitidos: { personal_id: string; nombre: string; motivo: string }[] = []

  for (const legajo of legajos || []) {
    if (periodo.tipo === 'final' && legajo.personal_id && personalIds && !personalIds.includes(legajo.personal_id)) continue

    // Brutos mensuales del semestre para SAC: liquidaciones ya cerradas de
    // esa persona en el semestre correspondiente (enero-junio o julio-diciembre).
    const [anio, mesFin] = [periodo.fecha_hasta.slice(0, 4), Number(periodo.fecha_hasta.slice(5, 7))]
    const semestreDesde = mesFin <= 6 ? `${anio}-01-01` : `${anio}-07-01`
    const { data: liqsSemestre } = await supabase.from('nom_liquidaciones')
      .select('bruto, nom_periodos!inner(fecha_desde, tipo)')
      .eq('personal_id', legajo.personal_id)
      .gte('nom_periodos.fecha_desde', semestreDesde).lte('nom_periodos.fecha_desde', periodo.fecha_hasta)
      .in('nom_periodos.tipo', ['mensual', 'quincenal', 'quincena_1', 'quincena_2'])
    const mejoresBrutosPorMes = (liqsSemestre || []).map((l: any) => Number(l.bruto))

    const esUocra = legajo.nom_convenios?.regimen === '22250'
    let montoSAC = 0, montoVacaciones = 0
    if (periodo.tipo === 'sac' || periodo.tipo === 'sac_1' || periodo.tipo === 'sac_2') {
      montoSAC = esUocra
        ? calcularSACUocra(mejoresBrutosPorMes)
        : calcularSACLCT({ mejoresBrutosPorMes, diasTrabajadosSemestre: 182, diasSemestre: 182 })
    }
    if (periodo.tipo === 'vacaciones') {
      // requiere antiguedadAnios y sueldoMensual del legajo/categoria vigente — completar
      // con la misma resolución de básico vigente ya usada en el flujo mensual (Task 2 de 5A).
    }
    if (periodo.tipo === 'final') {
      // requiere legajo.fecha_baja y legajo.motivo_baja; branch esUocra usa uocra.calcularLiquidacionFinal,
      // sino especiales.calcularLiquidacionFinal (LCT) con los rubros ya resueltos arriba.
    }

    const bruto = montoSAC + montoVacoaciones // ver Step 4: nombres reales de import
    const { data: liq, error: errLiq } = await supabase.from('nom_liquidaciones').upsert({
      empresa_id: periodo.empresa_id, periodo_id: periodo.id, personal_id: legajo.personal_id,
      bruto, neto: bruto, estado: 'preliminar',
    }, { onConflict: 'periodo_id,personal_id' }).select().single()
    if (errLiq) { omitidos.push({ personal_id: legajo.personal_id, nombre: '', motivo: errLiq.message }); continue }

    if (periodo.tipo === 'final') {
      await supabase.from('nom_legajo').update({ liquidacion_final_id: liq.id }).eq('id', legajo.id)
    }
    resultados.push({ personalId: legajo.personal_id, bruto, neto: bruto })
  }

  await supabase.from('nom_periodos').update({ estado: 'abierto', calculo_estado: 'listo' }).eq('id', periodo.id)
  return new Response(JSON.stringify({ liquidadas: resultados.length, omitidos, advertencias: [], completo: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
}
```

**Nota para quien ejecute esta tarea:** el bloque de arriba deja explícito qué falta resolver (vacaciones y final necesitan el sueldo/categoría vigente del legajo, que ya se resuelve en el flujo mensual — reusar `resolverBasico`/`resolverCategoriaVigente` existentes en el archivo en vez de reimplementarlos). No commitear hasta que los 3 tipos (`sac_*`, `vacaciones`, `final`) completen su cálculo real sin dejar ramas vacías — completar seleccionando el patrón exacto que ya usa el flujo mensual del mismo archivo para resolver escala vigente por legajo.

- [ ] **Step 4:** Importar en el header del archivo las funciones del motor (el `deno.json`/import map de la función ya resuelve `packages/motor` — verificar cómo importa el resto del archivo, ej. `import { evaluar } from '../../../packages/motor/src/interprete.ts'`, y replicar el mismo patrón relativo para `especiales.ts` y `uocra.ts`).

- [ ] **Step 5:** `npx vitest run` (motor sigue testeado por separado; esta función no tiene test unitario propio, se prueba manualmente — Step 6). Commit: `feat(liquidar): periodos especiales sac/vacaciones/final ramifican por regimen del convenio`

- [ ] **Step 6:** Usuario despliega: `supabase functions deploy liquidar-periodo` y prueba manualmente creando un período `final` para un legajo de prueba con `fecha_baja` cargada.

---

## Task 33: UI — alta de período especial + botón de liquidación final activo

**Files:**
- Modify: `src/pages/LiquidacionPage.jsx` (opciones del `<select>` de tipo de período)
- Modify: `src/pages/FichaLegajoPage.jsx` (activar el botón, ya presente y deshabilitado desde la Fase 5D Task 49)
- Modify: `src/store/liquidacionStore.js` (nueva acción si hace falta pasar `personal_ids` desde la ficha)
- Test: `src/pages/__tests__/FichaLegajoPage.test.jsx`

- [ ] **Step 1: Test que falla — click en "Generar liquidación final" dispara la creación del período + cálculo**

```js
// agregar a src/pages/__tests__/FichaLegajoPage.test.jsx
it('click en "Generar liquidacion final" crea el periodo tipo final y llama a calcularPeriodo', async () => {
  legajosMock.current = [{ id: 'leg1', personalId: 'p1', fechaBaja: '2026-06-30', motivoBaja: 'renuncia', liquidacionFinalId: null }]
  render(<FichaLegajoPage />)
  await screen.findByText('editor-datos')
  fireEvent.click(screen.getByRole('button', { name: 'Generar liquidación final' }))
  await waitFor(() => {
    expect(crearPeriodoFinalMock).toHaveBeenCalledWith('p1', '2026-06-30')
  })
  legajosMock.current = []
})
```

Agregar el mock correspondiente arriba del archivo (junto a los otros `vi.mock`):

```js
const { crearPeriodoFinalMock } = vi.hoisted(() => ({ crearPeriodoFinalMock: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('../../store/liquidacionStore', () => ({
  useLiquidacionStore: () => ({ crearPeriodoFinal: crearPeriodoFinalMock }),
}))
```

- [ ] **Step 2:** Run `npx vitest run src/pages/__tests__/FichaLegajoPage.test.jsx` → FAIL (el botón sigue `disabled`, no hay `crearPeriodoFinal` en el store).

- [ ] **Step 3: `liquidacionStore.js` — acción `crearPeriodoFinal`.**

```js
// agregar a src/store/liquidacionStore.js dentro de useLiquidacionStore
crearPeriodoFinal: async (personalId, fechaBaja) => {
  const empresaId = (await supabase.auth.getSession()).data.session?.user?.user_metadata?.empresa_id
  const { data: periodo, error: errPeriodo } = await supabase.from('nom_periodos').insert({
    empresa_id: empresaId, tipo: 'final', fecha_desde: fechaBaja, fecha_hasta: fechaBaja, estado: 'abierto',
  }).select().single()
  if (errPeriodo) return { ok: false, error: errPeriodo.message }
  const { data, error } = await invocarConReintento({ periodoId: periodo.id, personal_ids: [personalId] })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
},
```

**Nota:** verificar cómo el resto del store obtiene `empresaId` (buscar el patrón real con `grep -n "empresa_id\|empresaId" src/store/liquidacionStore.js` — no asumir `user_metadata`, usar el mismo mecanismo que ya usa `calcularPeriodo` o el que reciba como parámetro desde el componente, que ya tiene `empresaActiva.id` disponible).

- [ ] **Step 4: `FichaLegajoPage.jsx` — activar el botón.**

```jsx
const crearPeriodoFinal = useLiquidacionStore((s) => s.crearPeriodoFinal)
const [generandoFinal, setGenerandoFinal] = useState(false)
const [errorFinal, setErrorFinal] = useState('')

const handleGenerarFinal = async () => {
  setErrorFinal('')
  setGenerandoFinal(true)
  const r = await crearPeriodoFinal(personalId, legajo.fechaBaja)
  setGenerandoFinal(false)
  if (!r.ok) { setErrorFinal(r.error); return }
  cargarLegajos(empresaActiva.id) // refresca liquidacionFinalId
}
```

Reemplazar el botón deshabilitado por:

```jsx
{legajo?.fechaBaja && !legajo?.liquidacionFinalId && (
  <button className="btn btn-primary btn-sm" onClick={handleGenerarFinal} disabled={generandoFinal}>
    {generandoFinal ? 'Generando…' : 'Generar liquidación final'}
  </button>
)}
{errorFinal && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorFinal}</span>}
```

- [ ] **Step 5:** Run → PASS.

- [ ] **Step 6: `LiquidacionPage.jsx` — opciones de período especial en el `<select>` de "Nuevo período".** Ubicar el bloque (ya existe, ver contexto arriba) y agregar:

```jsx
<option value="sac_1">SAC 1º semestre</option>
<option value="sac_2">SAC 2º semestre</option>
<option value="vacaciones">Vacaciones</option>
```

junto a las opciones ya existentes (`mensual`, `quincenal`, `sac`, `final`).

- [ ] **Step 7:** `npx vitest run` completo → PASS, sin regresiones. Commit: `feat(legajo): boton "Generar liquidacion final" operativo + alta de sac_1/sac_2/vacaciones`

---

## Verificación final de la sub-fase (Tasks 30-33)

- [ ] `npx vitest run` completo en verde, sin regresiones (base: 220 tests al cierre de la Fase 5D).
- [ ] Migración 0030 aplicada por el usuario en Supabase; Edge Function `liquidar-periodo` redesplegada.
- [ ] Prueba manual: dar de baja un legajo de prueba (Fase 5D), click en "Generar liquidación final" desde la ficha, confirmar que aparece la liquidación en la pestaña "Liquidaciones" y que el botón desaparece (por `liquidacionFinalId` seteado).
- [ ] Prueba manual: crear un período `sac_1` y confirmar que liquida un monto no nulo para una persona con liquidaciones mensuales previas en el semestre.
- [ ] Nota para el usuario: el recibo (Task 12/5J) todavía no rotula especialmente "SAC 1º semestre 2026" ni "Liquidación final" en el encabezado — eso es la Task 22 del plan maestro original, que puede sumarse como ajuste menor de UI sobre `reciboLayout.js` una vez validado el cálculo, y queda fuera del alcance de esta sub-fase.
