# Liquidación con detalle real (asistencia + montos) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al calcular un período la pantalla de Liquidación muestre el período calculado, y por persona: horas trabajadas, horas extra 50/100, tardanzas, faltas injustificadas y justificadas, bruto, aportes del trabajador, contribuciones patronales y neto, con detalle expandible por concepto.

**Architecture:** La lógica de asistencia se extiende en el paquete puro `packages/motor` (TDD con vitest, sin Supabase). La Edge Function `liquidar-periodo` pasa a construir el snapshot diario con una función pura nueva (`construirDiasPeriodo`), resuelve las 3 variables que hoy son TODO (`basico_convenio`, `adelanto_monto`, `tope_sipa`) y persiste el resumen de asistencia en `nom_liquidaciones.detalle_horas` (JSONB ya existente) más una columna nueva `total_contribuciones`. La UI lee todo de `nom_liquidaciones` + `nom_liquidacion_items`.

**Tech Stack:** TypeScript puro en `packages/motor` (vitest), Deno Edge Function (supabase-js v2), React + zustand en `src/`, Postgres (proyecto Supabase compartido con Presencio, linkeado como `Presencio-dev`).

**Supuestos documentados (ajustables en Fase 4 / UOCRA):**
- Días laborables: lunes a viernes, entrada esperada 08:00, tolerancia 15 min.
- Jornada diaria: 8 h (`legajo.jornada = 'completa'`) o 4 h (`'parcial'`).
- Horas extra: excedente sobre la jornada diaria → 50%; todas las horas de domingo → 100%. Sábado se trata como día no esperado (no genera falta) y su excedente sobre jornada va al 50%.
- Horas trabajadas del día: primera `entrada` → última `salida`. Día con entrada sin salida: 0 h (jornada incompleta), pero no cuenta como falta.

**Prerequisito para ver montos ≠ 0:** las categorías seed tienen `basico = 0` a propósito (`0003_seed_convenios.sql`). Después de implementar, cargar la escala real, p. ej. en SQL Editor (ajustar valores/fechas — decide el usuario):

```sql
INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde)
SELECT convenio_id, nombre, 850000, DATE '2026-06-01'
FROM nom_categorias
WHERE id = (SELECT categoria_id FROM nom_legajo WHERE cuil IS NOT NULL LIMIT 1);
```

**Comandos de referencia:** tests: `npx vitest run packages/motor` (desde la raíz del repo). Lint: `npm run lint` si existe (ver `package.json`; si no existe el script, saltearlo). Deploy función: `supabase functions deploy liquidar-periodo`.

---

### Task 1: Extender `calcularAsistencia` (horas trabajadas, faltas justificadas, extras derivadas)

**Files:**
- Modify: `packages/motor/src/asistencia.ts`
- Test: `packages/motor/src/asistencia.test.ts`

Contexto: hoy `ResultadoAsistencia` solo tiene `tardanzas`, `faltasInjustificadas`, `horasExtra50`, `horasExtra100`, y las extras solo suman si el día ya las trae precalculadas (nunca pasa en producción). Los tests existentes van a necesitar los campos nuevos en sus expects.

- [ ] **Step 1: Agregar tests que fallan**

Agregar al final de `packages/motor/src/asistencia.test.ts`:

```ts
describe('horas trabajadas, faltas justificadas y extras derivadas', () => {
  it('suma horas trabajadas y deriva extra 50 sobre la jornada', () => {
    const r = calcularAsistencia(
      [
        { fecha: '2026-06-15', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', horasTrabajadas: 10, ausenciaAprobada: false },
        { fecha: '2026-06-16', horaEntradaEsperada: '08:00', horaEntradaReal: '08:05', horasTrabajadas: 8, ausenciaAprobada: false },
      ],
      15
    )
    expect(r.horasTrabajadas).toBe(18)
    expect(r.horasExtra50).toBe(2)
    expect(r.horasExtra100).toBe(0)
  })

  it('las horas de domingo van todas al 100%', () => {
    const r = calcularAsistencia(
      [{ fecha: '2026-06-21', horaEntradaEsperada: null, horaEntradaReal: '09:00', horasTrabajadas: 5, esDomingo: true, ausenciaAprobada: false }],
      15
    )
    expect(r.horasExtra100).toBe(5)
    expect(r.horasExtra50).toBe(0)
  })

  it('falta con ausencia aprobada cuenta como justificada, sin ausencia como injustificada', () => {
    const r = calcularAsistencia(
      [
        { fecha: '2026-06-15', horaEntradaEsperada: '08:00', horaEntradaReal: null, ausenciaAprobada: true },
        { fecha: '2026-06-16', horaEntradaEsperada: '08:00', horaEntradaReal: null, ausenciaAprobada: false },
      ],
      15
    )
    expect(r.faltasJustificadas).toBe(1)
    expect(r.faltasInjustificadas).toBe(1)
  })

  it('jornada parcial (4h) genera extra 50 sobre 4 horas', () => {
    const r = calcularAsistencia(
      [{ fecha: '2026-06-15', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', horasTrabajadas: 6, ausenciaAprobada: false }],
      15,
      4
    )
    expect(r.horasExtra50).toBe(2)
  })
})
```

- [ ] **Step 2: Correr tests y verificar que fallan**

Run: `npx vitest run packages/motor/src/asistencia.test.ts`
Expected: FAIL (los tests nuevos; `horasTrabajadas`/`faltasJustificadas` undefined).

- [ ] **Step 3: Implementar**

Reemplazar el contenido completo de `packages/motor/src/asistencia.ts` (se conserva la firma; parámetro nuevo `jornadaHoras` con default 8):

```ts
export interface DiaAsistencia {
  fecha: string
  horaEntradaEsperada: string | null // null = día no laborable (sáb/dom)
  horaEntradaReal: string | null
  ausenciaAprobada: boolean
  horasTrabajadas?: number
  esDomingo?: boolean
  horasExtra50?: number // si vienen precalculadas, tienen prioridad
  horasExtra100?: number
}

export interface ResultadoAsistencia {
  horasTrabajadas: number
  tardanzas: number
  faltasInjustificadas: number
  faltasJustificadas: number
  horasExtra50: number
  horasExtra100: number
}

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

export function calcularAsistencia(
  dias: DiaAsistencia[],
  toleranciaMinutos: number,
  jornadaHoras = 8
): ResultadoAsistencia {
  const resultado: ResultadoAsistencia = {
    horasTrabajadas: 0,
    tardanzas: 0,
    faltasInjustificadas: 0,
    faltasJustificadas: 0,
    horasExtra50: 0,
    horasExtra100: 0,
  }

  for (const dia of dias) {
    const horas = dia.horasTrabajadas ?? 0
    resultado.horasTrabajadas += horas

    if (dia.horasExtra50 !== undefined || dia.horasExtra100 !== undefined) {
      // Precalculadas (corrección manual futura): tienen prioridad.
      resultado.horasExtra50 += dia.horasExtra50 ?? 0
      resultado.horasExtra100 += dia.horasExtra100 ?? 0
    } else if (dia.esDomingo) {
      resultado.horasExtra100 += horas
    } else if (horas > jornadaHoras) {
      resultado.horasExtra50 += horas - jornadaHoras
    }

    if (dia.horaEntradaEsperada === null) continue // día no laborable: no hay falta ni tardanza

    if (dia.horaEntradaReal === null) {
      if (dia.ausenciaAprobada) resultado.faltasJustificadas += 1
      else resultado.faltasInjustificadas += 1
      continue
    }

    const esperado = aMinutos(dia.horaEntradaEsperada)
    const real = aMinutos(dia.horaEntradaReal)
    if (real > esperado + toleranciaMinutos) {
      resultado.tardanzas += 1
    }
  }

  return resultado
}
```

- [ ] **Step 4: Actualizar los expects de los tests preexistentes**

Los tests viejos de `asistencia.test.ts` que comparan el objeto resultado completo (p. ej. con `toEqual`) deben incluir ahora `horasTrabajadas: 0` y `faltasJustificadas: <n>` según el caso. Si comparan campo por campo, no tocar.

- [ ] **Step 5: Correr tests y verificar que pasan**

Run: `npx vitest run packages/motor/src/asistencia.test.ts`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add packages/motor/src/asistencia.ts packages/motor/src/asistencia.test.ts
git commit -m "feat(motor): horas trabajadas, faltas justificadas y extras derivadas en asistencia"
```

---

### Task 2: Función pura `construirDiasPeriodo` (snapshot diario desde fichajes crudos)

**Files:**
- Modify: `packages/motor/src/asistencia.ts` (agregar al final)
- Test: `packages/motor/src/asistencia.test.ts`

Contexto: hoy la Edge Function arma el snapshot inline y con dos bugs: solo mira `entrada` (nunca calcula horas) y los días SIN fichaje jamás entran al snapshot, por lo que las faltas nunca se cuentan. Esta función lo resuelve y queda testeable.

- [ ] **Step 1: Tests que fallan**

Agregar a `packages/motor/src/asistencia.test.ts` (el import pasa a incluir `construirDiasPeriodo`):

```ts
import { calcularAsistencia, construirDiasPeriodo } from './asistencia.ts'

describe('construirDiasPeriodo', () => {
  const fichajes = [
    { tipo: 'entrada', timestamp: '2026-06-15T08:33:00+00:00' },
    { tipo: 'salida', timestamp: '2026-06-15T18:33:00+00:00' },
    { tipo: 'entrada', timestamp: '2026-06-17T09:00:00+00:00' }, // sin salida
  ]

  it('enumera todos los días del rango y aparea entrada/salida', () => {
    // 2026-06-15 es lunes; rango lunes a viernes
    const dias = construirDiasPeriodo(fichajes, [], '2026-06-15', '2026-06-19')
    expect(dias).toHaveLength(5)
    expect(dias[0]).toMatchObject({ fecha: '2026-06-15', horaEntradaReal: '08:33', horasTrabajadas: 10, horaEntradaEsperada: '08:00' })
    expect(dias[1]).toMatchObject({ fecha: '2026-06-16', horaEntradaReal: null, horaEntradaEsperada: '08:00' })
    expect(dias[2]).toMatchObject({ fecha: '2026-06-17', horaEntradaReal: '09:00', horasTrabajadas: 0 })
  })

  it('marca fin de semana como no esperado y domingo con esDomingo', () => {
    const dias = construirDiasPeriodo([], [], '2026-06-20', '2026-06-21') // sáb y dom
    expect(dias[0].horaEntradaEsperada).toBeNull()
    expect(dias[0].esDomingo).toBe(false)
    expect(dias[1].horaEntradaEsperada).toBeNull()
    expect(dias[1].esDomingo).toBe(true)
  })

  it('marca ausencia aprobada en el rango', () => {
    const dias = construirDiasPeriodo([], [{ fecha_desde: '2026-06-16', fecha_hasta: '2026-06-16' }], '2026-06-15', '2026-06-17')
    expect(dias.map((d) => d.ausenciaAprobada)).toEqual([false, true, false])
  })

  it('integración: faltas y extras del período con calcularAsistencia', () => {
    const dias = construirDiasPeriodo(fichajes, [{ fecha_desde: '2026-06-16', fecha_hasta: '2026-06-16' }], '2026-06-15', '2026-06-19')
    const r = calcularAsistencia(dias, 15)
    expect(r.horasTrabajadas).toBe(10)
    expect(r.horasExtra50).toBe(2)
    expect(r.faltasJustificadas).toBe(1) // 16/06
    expect(r.faltasInjustificadas).toBe(2) // 18 y 19/06 (el 17 tiene entrada)
    expect(r.tardanzas).toBe(2) // 08:33 y 09:00
  })
})
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx vitest run packages/motor/src/asistencia.test.ts`
Expected: FAIL con "construirDiasPeriodo is not a function" (o import error).

- [ ] **Step 3: Implementar** (agregar al final de `packages/motor/src/asistencia.ts`)

```ts
export interface FichajeCrudo {
  tipo: string // 'entrada' | 'salida'
  timestamp: string // ISO
}

export interface AusenciaRango {
  fecha_desde: string
  fecha_hasta: string
}

// Snapshot diario del período: enumera TODOS los días del rango (los días
// sin fichaje también existen — si no, las faltas nunca se cuentan),
// aparea primera entrada / última salida y marca ausencias aprobadas.
export function construirDiasPeriodo(
  fichajes: FichajeCrudo[],
  ausencias: AusenciaRango[],
  fechaDesde: string,
  fechaHasta: string
): DiaAsistencia[] {
  const porFecha = new Map<string, { entrada: string | null; salida: string | null }>()
  for (const f of fichajes) {
    const fecha = f.timestamp.slice(0, 10)
    const hora = f.timestamp.slice(11, 16)
    const dia = porFecha.get(fecha) ?? { entrada: null, salida: null }
    if (f.tipo === 'entrada' && (dia.entrada === null || hora < dia.entrada)) dia.entrada = hora
    if (f.tipo === 'salida' && (dia.salida === null || hora > dia.salida)) dia.salida = hora
    porFecha.set(fecha, dia)
  }

  const dias: DiaAsistencia[] = []
  const d = new Date(fechaDesde + 'T00:00:00Z')
  const fin = new Date(fechaHasta + 'T00:00:00Z')
  while (d <= fin) {
    const fecha = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay() // 0 = domingo, 6 = sábado
    const laborable = dow >= 1 && dow <= 5
    const reg = porFecha.get(fecha)
    const horas = reg?.entrada && reg?.salida
      ? Math.max(0, (aMinutos(reg.salida) - aMinutos(reg.entrada)) / 60)
      : 0
    dias.push({
      fecha,
      horaEntradaEsperada: laborable ? '08:00' : null,
      horaEntradaReal: reg?.entrada ?? null,
      horasTrabajadas: Math.round(horas * 100) / 100,
      esDomingo: dow === 0,
      ausenciaAprobada: ausencias.some((a) => fecha >= a.fecha_desde && fecha <= a.fecha_hasta),
    })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dias
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx vitest run packages/motor`
Expected: PASS (todo el paquete, incluidos interprete/motor/golden).

- [ ] **Step 5: Commit**

```bash
git add packages/motor/src/asistencia.ts packages/motor/src/asistencia.test.ts
git commit -m "feat(motor): construirDiasPeriodo — snapshot diario con dias sin fichaje y pareo entrada/salida"
```

---

### Task 3: Migración `0011` — columna `total_contribuciones`

**Files:**
- Create: `supabase/migrations/0011_total_contribuciones.sql`

- [ ] **Step 1: Crear la migración**

```sql
-- 0011_total_contribuciones.sql
-- La UI de Liquidación muestra aportes del trabajador (ya existe
-- total_aportes) y contribuciones patronales a nivel fila sin necesidad
-- de traer los items. Se persiste el total al liquidar.
ALTER TABLE nom_liquidaciones
  ADD COLUMN IF NOT EXISTS total_contribuciones NUMERIC NOT NULL DEFAULT 0;
```

(Los GRANT existentes de 0007/0009 son a nivel tabla: cubren la columna nueva.)

- [ ] **Step 2: Aplicar**

Run: `supabase db push` (o pegar el SQL en el SQL Editor si se quiere evitar arrastrar la 0006 pendiente).
Expected: sin errores; `select total_contribuciones from nom_liquidaciones limit 1;` responde.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_total_contribuciones.sql
git commit -m "feat(db): columna total_contribuciones en nom_liquidaciones"
```

---

### Task 4: Edge Function — snapshot nuevo + variables reales (resuelve los 3 TODO)

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts`

Contexto: el archivo ya chequea errores de todas las lecturas (no reintroducir lecturas sin chequear `error`). Se reemplaza el bloque del loop de personas y se agregan lecturas previas al loop.

- [ ] **Step 1: Actualizar el import de asistencia**

Reemplazar:

```ts
import { calcularAsistencia, type DiaAsistencia } from '../../../packages/motor/src/asistencia.ts'
```

por:

```ts
import { calcularAsistencia, construirDiasPeriodo } from '../../../packages/motor/src/asistencia.ts'
```

- [ ] **Step 2: Agregar lecturas previas al loop** (insertar inmediatamente después del bloque que construye `legajoPorPersonal`)

```ts
  // ─── Variables que antes eran TODO ────────────────────────────────
  // tope_sipa vigente para el período (nom_parametros, versionado por vigencia)
  const { data: topeRows, error: errTope } = await supabase.from('nom_parametros').select('valor')
    .eq('empresa_id', periodo.empresa_id).eq('codigo', 'tope_sipa')
    .lte('vigencia_desde', periodo.fecha_hasta)
    .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${periodo.fecha_desde}`)
    .order('vigencia_desde', { ascending: false }).limit(1)
  // adelantos del período por persona
  const { data: adelantos, error: errAdel } = await supabase.from('nom_pagos_adelantos').select('personal_id, monto')
    .eq('empresa_id', periodo.empresa_id)
    .gte('fecha', periodo.fecha_desde).lte('fecha', periodo.fecha_hasta)
  if (errTope || errAdel) {
    const e = (errTope || errAdel)!
    return new Response(JSON.stringify({ error: `error al leer parametros/adelantos: ${e.message}`, code: e.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const topeSipa = Number(topeRows?.[0]?.valor ?? 999999999) // sin parámetro cargado: sin tope efectivo
  const adelantoPorPersona = new Map<string, number>()
  for (const a of adelantos || []) {
    adelantoPorPersona.set(a.personal_id, (adelantoPorPersona.get(a.personal_id) ?? 0) + Number(a.monto))
  }

  // basico vigente por categoría: legajo.categoria_id apunta a UNA fila de
  // nom_categorias, pero la escala se versiona por (convenio, nombre,
  // vigencia_desde) — hay que buscar la fila vigente al cierre del período.
  const categoriaIds = [...new Set((legajos || []).map((l: any) => l.categoria_id).filter(Boolean))]
  const basicoPorCategoria = new Map<string, number>()
  if (categoriaIds.length > 0) {
    const { data: cats, error: errCats } = await supabase.from('nom_categorias')
      .select('id, convenio_id, nombre').in('id', categoriaIds)
    if (errCats) {
      return new Response(JSON.stringify({ error: `error al leer categorias: ${errCats.message}`, code: errCats.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    for (const cat of cats || []) {
      const { data: vig } = await supabase.from('nom_categorias').select('basico')
        .eq('convenio_id', cat.convenio_id).eq('nombre', cat.nombre)
        .lte('vigencia_desde', periodo.fecha_hasta)
        .order('vigencia_desde', { ascending: false }).limit(1)
      basicoPorCategoria.set(cat.id, Number(vig?.[0]?.basico ?? 0))
    }
  }
```

- [ ] **Step 3: Reemplazar el armado del snapshot dentro del loop**

Borrar desde el comentario `// Construcción del snapshot diario…` hasta `const asistencia = calcularAsistencia([...porDia.values()], 15)` inclusive, y reemplazar por:

```ts
    const dias = construirDiasPeriodo(
      (fichajes || []).map((f: any) => ({ tipo: f.tipo, timestamp: f.timestamp })),
      (ausencias || []).map((a: any) => ({ fecha_desde: a.fecha_desde, fecha_hasta: a.fecha_hasta })),
      periodo.fecha_desde,
      periodo.fecha_hasta
    )
    const asistencia = calcularAsistencia(dias, 15, legajo.jornada === 'parcial' ? 4 : 8)
```

- [ ] **Step 4: Reemplazar `variablesBase`**

```ts
    const variablesBase = {
      basico_convenio: basicoPorCategoria.get(legajo.categoria_id) ?? 0,
      horas_trabajadas: asistencia.horasTrabajadas,
      tardanzas: asistencia.tardanzas,
      faltas_injustificadas: asistencia.faltasInjustificadas,
      faltas_justificadas: asistencia.faltasJustificadas,
      horas_extra_50: asistencia.horasExtra50,
      horas_extra_100: asistencia.horasExtra100,
      adelanto_monto: adelantoPorPersona.get(persona.id) ?? 0,
      tope_sipa: topeSipa,
    }
```

- [ ] **Step 5: Persistir `total_contribuciones`**

En el insert a `nom_liquidaciones`, agregar después de `total_aportes: r.resultado.totalDescuentos,`:

```ts
      total_contribuciones: r.resultado.items
        .filter((i) => i.tipo === 'aporte_patronal')
        .reduce((s, i) => s + i.monto, 0),
```

- [ ] **Step 6: Verificar sintaxis del bundle**

Run: `npx --yes esbuild supabase/functions/liquidar-periodo/index.ts --loader:.ts=ts --outfile=/tmp/out.js --format=esm && echo OK`
Expected: OK

- [ ] **Step 7: Deploy y prueba real**

```bash
supabase functions deploy liquidar-periodo
```

Luego en la app: Liquidación → elegir el período → Calcular. Expected: `liquidadas: 1`; en SQL Editor `select bruto, total_aportes, total_contribuciones, detalle_horas from nom_liquidaciones;` muestra `detalle_horas` con `horasTrabajadas` ≈ 23.78 para la quincena de prueba (23h47m) y faltas/tardanzas coherentes con el reporte de Presencio.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/liquidar-periodo/index.ts
git commit -m "feat(liquidar-periodo): snapshot con dias completos y variables reales (basico, adelantos, tope_sipa)"
```

---

### Task 5: Store — exponer los campos nuevos

**Files:**
- Modify: `src/store/liquidacionStore.js`

- [ ] **Step 1: Ampliar `liquidacionFromDB`**

Reemplazar la función por:

```js
export const liquidacionFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, periodoId: r.periodo_id, personalId: r.personal_id,
  bruto: r.bruto, neto: r.neto, estado: r.estado,
  totalAportes: r.total_aportes ?? 0,
  totalContribuciones: r.total_contribuciones ?? 0,
  detalleHoras: r.detalle_horas || null,
})
```

- [ ] **Step 2: Verificar que la app compila**

Run: `npm run dev` y abrir Liquidación. Expected: sin errores en consola.

- [ ] **Step 3: Commit**

```bash
git add src/store/liquidacionStore.js
git commit -m "feat(store): exponer detalle_horas y totales de aportes/contribuciones"
```

---

### Task 6: UI Liquidación — período calculado, columnas de asistencia/montos y detalle expandible

**Files:**
- Modify: `src/pages/LiquidacionPage.jsx`

- [ ] **Step 1: Estado y helpers nuevos**

Dentro del componente, junto a los `useState` existentes, agregar:

```jsx
  const [liqExpandida, setLiqExpandida] = useState(null)
  const [itemsPorLiq, setItemsPorLiq] = useState({})

  const periodoActivo = periodos.find((p) => p.id === periodoSeleccionado)
  const fmt = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtHs = (n) => `${(Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`

  const toggleDetalle = async (liqId) => {
    if (liqExpandida === liqId) { setLiqExpandida(null); return }
    setLiqExpandida(liqId)
    if (!itemsPorLiq[liqId]) {
      const { data } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', liqId)
      setItemsPorLiq((prev) => ({ ...prev, [liqId]: data || [] }))
    }
  }
```

- [ ] **Step 2: Cargar liquidaciones ya calculadas al elegir período**

Agregar este `useEffect` (después del `useEffect` existente):

```jsx
  useEffect(() => {
    setLiqExpandida(null)
    setItemsPorLiq({})
    if (periodoSeleccionado) cargarLiquidaciones(periodoSeleccionado)
  }, [periodoSeleccionado])
```

- [ ] **Step 3: Reemplazar el bloque de resultados** (todo el `{liquidaciones.length > 0 && (...)}` actual) por:

```jsx
      {liquidaciones.length > 0 && periodoActivo && (
        <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong>Período calculado:</strong>
          <span>{periodoActivo.tipo} — {periodoActivo.fecha_desde} a {periodoActivo.fecha_hasta}</span>
          <span className="badge badge-neutral">{periodoActivo.estado}</span>
          <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>{liquidaciones.length} liquidación(es)</span>
        </div>
      )}

      {liquidaciones.length > 0 && (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Persona</th><th>Horas</th><th>HE 50%</th><th>HE 100%</th>
                <th>Tardanzas</th><th>Faltas inj.</th><th>Faltas just.</th>
                <th>Bruto</th><th>Aportes</th><th>Contribuciones</th><th>Neto</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {liquidaciones.map((l) => {
                const dh = l.detalleHoras || {}
                const items = itemsPorLiq[l.id] || []
                const grupos = [
                  ['remunerativo', 'Remunerativos'],
                  ['no_remunerativo', 'No remunerativos'],
                  ['descuento', 'Aportes del trabajador'],
                  ['aporte_patronal', 'Contribuciones patronales'],
                  ['informativo', 'Informativos'],
                ]
                return (
                  <FragmentoLiquidacion key={l.id}>
                    <tr onClick={() => toggleDetalle(l.id)} style={{ cursor: 'pointer' }}>
                      <td>{personalPorId.get(l.personalId) || l.personalId}</td>
                      <td>{fmtHs(dh.horasTrabajadas)}</td>
                      <td>{fmtHs(dh.horasExtra50)}</td>
                      <td>{fmtHs(dh.horasExtra100)}</td>
                      <td>{dh.tardanzas ?? '—'}</td>
                      <td>{dh.faltasInjustificadas ?? '—'}</td>
                      <td>{dh.faltasJustificadas ?? '—'}</td>
                      <td>${fmt(l.bruto)}</td>
                      <td>${fmt(l.totalAportes)}</td>
                      <td>${fmt(l.totalContribuciones)}</td>
                      <td><strong>${fmt(l.neto)}</strong></td>
                      <td><span className="badge badge-neutral">{l.estado}</span></td>
                      <td>{liqExpandida === l.id ? '▾' : '▸'}</td>
                    </tr>
                    {liqExpandida === l.id && (
                      <tr>
                        <td colSpan={13} style={{ background: 'var(--bg-subtle, rgba(255,255,255,0.03))' }}>
                          {items.length === 0 ? 'Cargando detalle…' : grupos.map(([tipo, titulo]) => {
                            const delGrupo = items.filter((i) => i.tipo === tipo)
                            if (delGrupo.length === 0) return null
                            return (
                              <div key={tipo} style={{ margin: '0.5rem 0' }}>
                                <strong style={{ fontSize: '0.85rem' }}>{titulo}</strong>
                                <table className="table" style={{ marginTop: 4 }}>
                                  <tbody>
                                    {delGrupo.map((i) => (
                                      <tr key={i.id}>
                                        <td style={{ width: '55%' }}>{i.concepto_nombre} <span style={{ opacity: 0.6 }}>({i.concepto_codigo})</span></td>
                                        <td style={{ opacity: 0.6 }}>regla: {i.regla_aplicada}</td>
                                        <td style={{ textAlign: 'right' }}>${fmt(i.monto)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )
                          })}
                        </td>
                      </tr>
                    )}
                  </FragmentoLiquidacion>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
```

Y arriba del componente (fuera de `LiquidacionPage`), agregar:

```jsx
import { Fragment } from 'react'
const FragmentoLiquidacion = Fragment
```

(Nota: `Fragment` directo también sirve; el alias es solo legibilidad. El import de `Fragment` va junto al `import { useEffect, useState } from 'react'` existente: `import { Fragment, useEffect, useState } from 'react'`.)

- [ ] **Step 4: Verificación visual**

Run: `npm run dev` → Liquidación → elegir período → Calcular.
Expected: banner con el período (tipo, fechas, estado); fila con Horas ≈ 23,78 h, tardanzas/faltas coherentes con Presencio; click en la fila despliega conceptos agrupados con regla aplicada. Con la escala en 0, los montos son $0,00 — cargar el básico real (ver prerequisito) y recalcular para ver bruto/aportes/neto ≠ 0.

- [ ] **Step 5: Lint/tests del repo**

Run: `npx vitest run` y (si existe el script) `npm run lint`.
Expected: PASS / sin errores nuevos.

- [ ] **Step 6: Commit**

```bash
git add src/pages/LiquidacionPage.jsx
git commit -m "feat(liquidacion): periodo calculado, resumen de asistencia y detalle por concepto en la grilla"
```

---

### Task 7: Verificación final punta a punta

- [ ] **Step 1:** `npx vitest run` → PASS completo.
- [ ] **Step 2:** `supabase functions deploy liquidar-periodo` (si no se hizo en Task 4) y recalcular el período real desde la UI.
- [ ] **Step 3:** Contrastar contra Presencio (Reportes, misma quincena): total horas (23h47m ≈ 23,78 h), tardanzas y faltas deben ser consistentes con los supuestos documentados (lun–vie 08:00, tolerancia 15). Diferencias esperables: Presencio no computa faltas de la misma forma — anotar cualquier discrepancia para revisión, no "ajustar" el motor para que coincida sin entender por qué.
- [ ] **Step 4:** Cargar escala real en `nom_categorias` (SQL del prerequisito, valores del usuario) y recalcular → bruto/aportes/contribuciones/neto ≠ 0.
- [ ] **Step 5:** Commit final si quedó algo pendiente y push: `git push origin dev`.
