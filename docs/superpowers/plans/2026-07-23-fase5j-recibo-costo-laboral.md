# Fase 5J — Recibo con costo laboral empleador/empleado (formato modelo AR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el recibo actual (A4 apaisado doble-copia) por una planilla vertical de una hoja que replica **exactamente** el modelo de referencia: bloque COSTO TOTAL EMPLEADOR con contribuciones patronales y derivados del CCT (columnas Concepto/Unidad/Base/Monto), bloque SUELDO BRUTO con remunerativos/no remunerativos/descuentos, fila COMPOSICIÓN SALARIAL, SUELDO NETO en números y letras, el "Detalle de la composición salarial" por organismo (Empleador/Trabajador) y el gráfico de torta del Costo Total Empleador.

**Architecture:** La segregación empleador/empleado **ya existe** a nivel de dato: el motor (`packages/motor/src/motor.ts`) emite ítems `aporte_patronal` (empleador), `descuento` (trabajador), `remunerativo` y `no_remunerativo`, y `nom_liquidaciones` ya guarda `total_contribuciones` y `total_aportes`. Lo que falta es (1) que cada ítem lleve la **unidad** (`10,77 %`, `30`, `1`) y la **base** sobre la que se calculó (`nom_liquidacion_items` no las persiste hoy), (2) metadata de **agrupación de recibo** por concepto (sección del modelo + organismo del detalle inferior), (3) datos de cabecera faltantes (antigüedad reconocida, fecha de pago) y (4) un `reciboPdf.js` reescrito al layout vertical con tabla manual y torta dibujada en jsPDF. El grupo y el detalle se guardan en `nom_conceptos.config` (JSONB, sin migración de columnas) y el motor los **copia al ítem liquidado** para que el PDF sea un snapshot inmutable. Nada de esto toca el esquema compartido con Presencio.

**Tech Stack:** React 19, Vite, jsPDF (ya en el repo), Supabase (Postgres + Edge Functions Deno), Vitest, motor puro en `packages/motor` (TypeScript, sin dependencias del cliente).

**Decisiones tomadas (sesión 2026-07-23):**
- Este formato **reemplaza** el recibo actual (no se conserva el A4 apaisado doble-copia).
- Los conceptos y alícuotas se toman de los **conceptos configurables** de cada empresa; los valores del modelo (SIPA 10,77 %, INSSJP 1,59 %, OSECAC, INACAP, FAECyS, etc.) se cargan como **datos semilla** iniciales.

---

## Instrucciones para el ejecutor (subagente)

Este plan lo ejecuta un subagente con capacidad de razonamiento limitada. Seguí estas reglas al pie de la letra; **no infieras ni improvises**:

1. **Directorio de trabajo:** todo comando `git`, `npx vitest`, `node` y `npm` se corre desde la **raíz del repo** `recursio/` (donde está `package.json`). Las rutas de este plan son relativas a esa raíz.
2. **Una tarea por vez, en orden.** No empieces la Tarea N+1 hasta que los tests de la Tarea N pasen y hayas commiteado. El orden es: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.
3. **TDD estricto:** escribí el test, corrélo y confirmá que **falla** por el motivo esperado, después implementá, después confirmá que **pasa**. No saltees el paso "verificar que falla".
4. **No reimportes lo ya importado.** Cuando una tarea dice "agregar al final de un archivo de test", usá los `import` que ya están al tope del archivo; no dupliques líneas `import`.
5. **Copiá el código de este plan textualmente.** Los bloques de código son el contrato. Si algo no compila, revisá que lo copiaste completo antes de cambiarlo. No renombres funciones, props ni columnas.
6. **Migraciones SQL (Tareas 1 y 9):** vos NO tenés credenciales de Supabase. Creá el archivo `.sql`, commiteálo, y en el reporte final avisá explícitamente: "el usuario debe aplicar las migraciones 0028 y 0029 en el SQL Editor de Supabase". No intentes aplicarlas ni corras `supabase db push`.
7. **No toques el esquema compartido con Presencio** (`empresas`, `personal`, `fichajes`, vistas `nom_v_*`). Todas las columnas nuevas van en tablas `nom_*` propias de Nómina.
8. **Si un test no pasa después de copiar el código:** NO borres el test ni lo debilites. Releé el código actual del archivo que estás tocando (con `Read`), compará contra el bloque del plan, y ajustá tu edición — no el test.
9. **Comando de verificación global** (correr al final de cada tarea con código JS/TS): `npx vitest run <ruta del archivo de test de la tarea>`. En la Tarea 10 se corre la suite completa `npx vitest run`.
10. **Commits:** un commit por tarea, con el mensaje exacto que indica cada "Step Commit".

---

## Contexto del código existente (leer antes de empezar)

- `packages/motor/src/motor.ts` — `liquidarConceptos(conceptos, variablesBase)`. `Concepto` tiene `{codigo, nombre, tipo, orden, formula, reglas, imprimible, categorias}`. `ItemLiquidado` tiene `{codigo, nombre, tipo, monto, reglaAplicada}`. Acumula `remunerativoAcumulado`, `bruto`, `totalDescuentos`, `neto`.
- `packages/motor/src/interprete.ts` — `evaluar(formula, vars)` evalúa una fórmula (string) contra un mapa de variables numéricas. Devuelve `number` o `boolean`.
- `packages/motor/src/formulas.ts` — `generarFormula(config)` y `ConfigConcepto {modo, porcentaje, base, tope, monto}`. `BASES` mapea `remunerativo→remunerativo_acumulado`, `no_remunerativo→no_remunerativo_acumulado`, `ambos→(remunerativo_acumulado + no_remunerativo_acumulado)`, `acumulado_mensual→(remunerativo_acumulado + remunerativo_quincena1)`.
- `supabase/functions/liquidar-periodo/index.ts` — construye `conceptosMotor` (incluye `config`), llama `liquidarConceptos`, y hace `upsert` de `nom_liquidaciones` + `insert` de `nom_liquidacion_items` con `{concepto_codigo, concepto_nombre, tipo, monto, regla_aplicada}`.
- `src/utils/reciboPdf.js` — `generarReciboPdf({empresa, persona, periodo, items, neto, codigoRecibo})`. HOY: A4 apaisado, dos mitades. Se reescribe completo.
- `src/pages/LiquidacionPage.jsx` — `handleEmitirRecibo(l)` (línea ~93) arma `empresa`/`persona`/`items` y llama `generarReciboPdf`, luego `emitirRecibo(liqId, hash)` y `doc.save(...)`.
- `src/store/conceptosStore.js` — `conceptoFromDB`/`conceptoToDB` (mapea `config`). `src/store/empresaConfigStore.js` — `cuit, domicilio, nombre, logoUrl`.
- `src/components/config/FormularioConcepto.jsx` — UI estructurada que produce `config` (modo/porcentaje/base/tope/monto). Único lugar donde se editan conceptos.
- Esquema: `nom_liquidacion_items(concepto_codigo, concepto_nombre, tipo, monto, regla_aplicada)` (migración 0007). `nom_legajo` tiene `cuil, cbu, banco, fecha_ingreso, categoria_id, convenio_id, fuera_convenio, sueldo_convenido`. `nom_empresa_config(empresa_id, cuit, domicilio)` (migración 0021).

---

## File Structure

**Nuevos archivos:**
- `supabase/migrations/0028_recibo_costo_laboral.sql` — columnas `unidad_texto`, `base_calculo` en `nom_liquidacion_items`; `antiguedad_reconocida` en `nom_legajo`; `fecha_pago` en `nom_periodos`.
- `supabase/migrations/0029_seed_recibo_grupos.sql` — seed de `config.recibo` (grupo/detalle/unidad) y conceptos patronales faltantes del modelo.
- `src/utils/reciboLayout.js` — funciones puras que transforman `items` + cabecera en la estructura de secciones/totales/detalle/torta del recibo (sin jsPDF; testeable con Vitest).
- `src/utils/__tests__/reciboLayout.test.js`
- `src/utils/reciboPie.js` — helper que dibuja la torta en un `doc` de jsPDF (sectores por polígono-fan).
- `src/utils/__tests__/reciboPie.test.js`
- `scripts/generar-recibo-muestra.mjs` — genera un PDF de muestra desde datos fixture para comparar contra el modelo (verificación final).

**Archivos modificados:**
- `packages/motor/src/motor.ts` — `ItemLiquidado` gana `unidadTexto`, `baseCalculo`, `grupoRecibo`, `detalleRecibo`; `liquidarConceptos` los computa desde `concepto.config`.
- `packages/motor/src/motor.test.ts` — casos nuevos.
- `supabase/functions/liquidar-periodo/index.ts` — pasa `config` al motor (ya lo hace) y persiste `unidad_texto`/`base_calculo` en el insert de items.
- `src/store/conceptosStore.js` — `conceptoFromDB`/`conceptoToDB` ya mapean `config` completo (verificar; no requiere cambio si `config` se guarda entero).
- `src/components/config/FormularioConcepto.jsx` — campos nuevos: sección de recibo (grupo) y organismo (detalle).
- `src/components/config/__tests__/FormularioConcepto.test.jsx` — casos nuevos.
- `src/utils/reciboPdf.js` — reescritura completa al layout vertical.
- `src/utils/__tests__/reciboPdf.test.js` — reescritura de asserts.
- `src/pages/LiquidacionPage.jsx` — `handleEmitirRecibo` arma la estructura nueva (items con unidad/base/grupo/detalle, antigüedad, banco, fecha de pago, sueldo bruto).

---

## Modelo de datos del recibo (contrato entre tareas)

Cada `ItemLiquidado` (y cada fila `nom_liquidacion_items`) lleva, además de lo existente:

- `unidadTexto` / `unidad_texto` (TEXT): lo que va en la columna **UNIDAD** del modelo. Ej.: `"10,77 %"`, `"30"`, `"1"`, `"5,00 %"`.
- `baseCalculo` / `base_calculo` (NUMERIC): lo que va en la columna **BASE**. Ej.: `1239978.42`.
- `grupoRecibo` / persistido dentro de `config.recibo.grupo`, copiado al ítem como `grupo_recibo` (TEXT): sección del modelo. Valores:
  - `contribucion` → tabla COSTO TOTAL EMPLEADOR (SIPA, INSSJP, Asig. Fam., FNE, Obra social, ART variable, ART FFEP).
  - `cct` → sub-bloque COSTO DERIVADO DEL CCT (Seguro Vida, Seguro la Estrella, OSECAC, INACAP).
  - `remunerativo` → REMUNERATIVO del SUELDO BRUTO.
  - `no_remunerativo` → NO REMUNERATIVO.
  - `descuento` → DESCUENTOS.
- `detalleRecibo` / `config.recibo.detalle`, copiado al ítem como `detalle_recibo` (TEXT|null): organismo del "Detalle de la composición salarial" inferior. Valores: `sindical`, `seguridad_social`, `obra_social`, `inssjp`, `art`, `scvo`, o `null` (no participa del detalle).

La columna del detalle inferior (Empleador vs. Trabajador) se deriva del `tipo`: `aporte_patronal` → **Empleador**; `descuento` → **Trabajador**.

**Regla de fallback de unidad/base en el motor** (cuando el concepto no define fórmulas explícitas de unidad/base): si `config.modo === 'porcentaje'` → `baseCalculo` = valor de la expresión base (con tope aplicado si hay), `unidadTexto` = `"<porcentaje con coma> %"`. Si `config.modo === 'nominal'` → `baseCalculo` = `monto`, `unidadTexto` = `"1"`. Overrides opcionales por `config.recibo.unidadFormula` (string de fórmula → evaluada y formateada como cantidad) y `config.recibo.baseFormula` (string → evaluada como base).

---

## Task 1: Migración 0028 — columnas de recibo (unidad, base, antigüedad, fecha de pago)

**Files:**
- Create: `supabase/migrations/0028_recibo_costo_laboral.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0028_recibo_costo_laboral.sql
-- Datos que el recibo de costo laboral (modelo AR) necesita y que hoy no se
-- persisten. Ninguna de estas columnas toca el esquema compartido con
-- Presencio: nom_liquidacion_items, nom_legajo y nom_periodos son tablas
-- propias de Nómina.

-- Unidad (%, cantidad de días u "1") y base sobre la que se calculó cada
-- concepto: columnas UNIDAD y BASE del modelo. NULL en filas viejas.
ALTER TABLE nom_liquidacion_items
  ADD COLUMN IF NOT EXISTS unidad_texto  TEXT,
  ADD COLUMN IF NOT EXISTS base_calculo  NUMERIC,
  ADD COLUMN IF NOT EXISTS grupo_recibo  TEXT,
  ADD COLUMN IF NOT EXISTS detalle_recibo TEXT;

-- Antigüedad reconocida al ingreso (años previos computados aparte de la
-- fecha de ingreso). Cabecera del recibo: "Antigüedad Reconocida".
ALTER TABLE nom_legajo
  ADD COLUMN IF NOT EXISTS antiguedad_reconocida INTEGER NOT NULL DEFAULT 0;

-- Fecha de pago del período (cabecera "Período / Fecha Pago").
ALTER TABLE nom_periodos
  ADD COLUMN IF NOT EXISTS fecha_pago DATE;

COMMENT ON COLUMN nom_liquidacion_items.unidad_texto IS 'Columna UNIDAD del recibo: "10,77 %", "30", "1"';
COMMENT ON COLUMN nom_liquidacion_items.base_calculo IS 'Columna BASE del recibo: monto sobre el que se aplicó la unidad';
COMMENT ON COLUMN nom_liquidacion_items.grupo_recibo IS 'Sección del recibo: contribucion|cct|remunerativo|no_remunerativo|descuento';
COMMENT ON COLUMN nom_liquidacion_items.detalle_recibo IS 'Organismo del detalle inferior: sindical|seguridad_social|obra_social|inssjp|art|scvo|NULL';
```

- [ ] **Step 2:** Avisar al usuario que la aplique en Supabase (SQL Editor) — no se puede correr sin credenciales de servicio.
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0028_recibo_costo_laboral.sql
git commit -m "feat(db): migracion 0028 columnas de recibo costo laboral (unidad, base, antiguedad, fecha_pago)"
```

---

## Task 2: Motor — `ItemLiquidado` con unidad, base y grupos de recibo

**Files:**
- Modify: `packages/motor/src/motor.ts`
- Test: `packages/motor/src/motor.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar este bloque **al final** de `packages/motor/src/motor.test.ts`. El archivo ya importa al tope: `import { describe, it, expect } from 'vitest'` y `import { liquidarConceptos, filtrarPorCategoria, type Concepto } from './motor'`. **No repitas esos imports** — usá los existentes. Solo pegá el `describe` nuevo:

```ts
describe('unidad y base en ítems (recibo costo laboral)', () => {
  it('porcentaje: unidadTexto = "<pct> %" y baseCalculo = base evaluada', () => {
    const basico: Concepto = {
      codigo: 'BAS', nombre: 'Básico', tipo: 'remunerativo', orden: 1, formula: '1000', imprimible: true,
    }
    const jub: Concepto = {
      codigo: 'JUB', nombre: 'Jubilación', tipo: 'descuento', orden: 10,
      formula: 'remunerativo_acumulado * 0.11', imprimible: true,
      config: { modo: 'porcentaje', porcentaje: 11, base: 'remunerativo', recibo: { grupo: 'descuento', detalle: 'seguridad_social' } },
    }
    const r = liquidarConceptos([basico, jub], {})
    const item = r.items.find((i) => i.codigo === 'JUB')!
    expect(item.unidadTexto).toBe('11,00 %')
    expect(item.baseCalculo).toBe(1000)
    expect(item.grupoRecibo).toBe('descuento')
    expect(item.detalleRecibo).toBe('seguridad_social')
    expect(item.monto).toBeCloseTo(110)
  })

  it('nominal: unidadTexto = "1" y baseCalculo = monto', () => {
    const inacap: Concepto = {
      codigo: 'INA', nombre: 'INACAP', tipo: 'aporte_patronal', orden: 5, formula: '5481.25', imprimible: true,
      config: { modo: 'nominal', monto: 5481.25, recibo: { grupo: 'cct', detalle: null } },
    }
    const r = liquidarConceptos([inacap], {})
    const item = r.items[0]
    expect(item.unidadTexto).toBe('1')
    expect(item.baseCalculo).toBeCloseTo(5481.25)
    expect(item.grupoRecibo).toBe('cct')
    expect(item.detalleRecibo).toBeNull()
  })

  it('sin config: unidad/base/grupos quedan nulos', () => {
    const z: Concepto = { codigo: 'Z', nombre: 'Z', tipo: 'descuento', orden: 1, formula: '50', imprimible: true }
    const r = liquidarConceptos([z], {})
    expect(r.items[0].unidadTexto).toBeNull()
    expect(r.items[0].baseCalculo).toBeNull()
    expect(r.items[0].grupoRecibo).toBeNull()
    expect(r.items[0].detalleRecibo).toBeNull()
  })

  it('override: config.recibo.baseFormula/unidadFormula tienen prioridad', () => {
    const bas: Concepto = {
      codigo: 'BAS', nombre: 'Básico', tipo: 'remunerativo', orden: 1, formula: '36541.60 * 30', imprimible: true,
      config: { modo: 'nominal', recibo: { grupo: 'remunerativo', detalle: null, unidadFormula: '30', baseFormula: '36541.60' } },
    }
    const r = liquidarConceptos([bas], {})
    const item = r.items[0]
    expect(item.unidadTexto).toBe('30')
    expect(item.baseCalculo).toBeCloseTo(36541.6)
  })
})
```

- [ ] **Step 2: Correr los tests → deben fallar**

Run: `npx vitest run packages/motor/src/motor.test.ts`
Expected: FAIL (propiedades `unidadTexto`/`baseCalculo`/`grupoRecibo`/`detalleRecibo` no existen).

- [ ] **Step 3: Implementar en `packages/motor/src/motor.ts`**

Reemplazar la interfaz `Concepto`, `ItemLiquidado` y el cuerpo del `for` de `liquidarConceptos` así:

```ts
import { evaluar } from './interprete.ts'

export interface ConfigRecibo {
  grupo?: 'contribucion' | 'cct' | 'remunerativo' | 'no_remunerativo' | 'descuento'
  detalle?: 'sindical' | 'seguridad_social' | 'obra_social' | 'inssjp' | 'art' | 'scvo' | null
  unidadFormula?: string | null
  baseFormula?: string | null
}

export interface ConfigConceptoMotor {
  modo?: 'porcentaje' | 'nominal'
  porcentaje?: number
  base?: 'remunerativo' | 'no_remunerativo' | 'ambos' | 'acumulado_mensual'
  tope?: string | null
  monto?: number
  recibo?: ConfigRecibo
}

export interface Concepto {
  codigo: string
  nombre: string
  tipo: 'remunerativo' | 'no_remunerativo' | 'descuento' | 'aporte_patronal' | 'informativo'
  orden: number
  formula: string
  reglas?: Array<{ orden: number; condicion: string; formula: string }>
  imprimible: boolean
  categorias?: string[] | null
  config?: ConfigConceptoMotor | null
}

export interface ItemLiquidado {
  codigo: string
  nombre: string
  tipo: Concepto['tipo']
  monto: number
  reglaAplicada: number | 'base'
  unidadTexto: string | null
  baseCalculo: number | null
  grupoRecibo: ConfigRecibo['grupo'] | null
  detalleRecibo: ConfigRecibo['detalle'] | null
}

// Mismas claves que packages/motor/src/formulas.ts BASES — repetidas acá para
// no crear una dependencia del motor hacia el generador de fórmulas de la UI.
const BASES_EXPR: Record<string, string> = {
  remunerativo: 'remunerativo_acumulado',
  no_remunerativo: 'no_remunerativo_acumulado',
  ambos: '(remunerativo_acumulado + no_remunerativo_acumulado)',
  acumulado_mensual: '(remunerativo_acumulado + remunerativo_quincena1)',
}

// "10,77 %" — dos decimales, coma decimal (es-AR).
function formatPorcentaje(pct: number): string {
  return `${pct.toFixed(2).replace('.', ',')} %`
}

// Formatea una cantidad (unidad no porcentual): entero sin decimales si es
// entero, si no dos decimales con coma. Ej.: 30 → "30"; 36541.6 → "36541,60".
function formatCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')
}
```

Y dentro del `for`, después de calcular `monto` y antes del `items.push`, computar unidad/base/grupos:

```ts
    const monto = evaluar(formula, vars) as number

    const cfg = concepto.config ?? undefined
    const recibo = cfg?.recibo ?? undefined
    let unidadTexto: string | null = null
    let baseCalculo: number | null = null

    if (recibo?.baseFormula) {
      baseCalculo = evaluar(recibo.baseFormula, vars) as number
    } else if (cfg?.modo === 'porcentaje') {
      const baseExpr = BASES_EXPR[cfg.base ?? 'remunerativo'] ?? 'remunerativo_acumulado'
      const conTope = cfg.tope ? `min(${baseExpr}, ${cfg.tope})` : baseExpr
      baseCalculo = evaluar(conTope, vars) as number
    } else if (cfg?.modo === 'nominal') {
      baseCalculo = typeof cfg.monto === 'number' ? cfg.monto : monto
    }

    if (recibo?.unidadFormula) {
      unidadTexto = formatCantidad(evaluar(recibo.unidadFormula, vars) as number)
    } else if (cfg?.modo === 'porcentaje' && typeof cfg.porcentaje === 'number') {
      unidadTexto = formatPorcentaje(cfg.porcentaje)
    } else if (cfg?.modo === 'nominal') {
      unidadTexto = '1'
    }

    items.push({
      codigo: concepto.codigo,
      nombre: concepto.nombre,
      tipo: concepto.tipo,
      monto,
      reglaAplicada,
      unidadTexto,
      baseCalculo,
      grupoRecibo: recibo?.grupo ?? null,
      detalleRecibo: recibo?.detalle ?? null,
    })
```

- [ ] **Step 4: Correr los tests → deben pasar**

Run: `npx vitest run packages/motor/src/motor.test.ts`
Expected: PASS (todos, incluidos los casos previos del archivo).

- [ ] **Step 5: Commit**

```bash
git add packages/motor/src/motor.ts packages/motor/src/motor.test.ts
git commit -m "feat(motor): itemliquidado con unidad, base y grupos de recibo"
```

---

## Task 3: Edge Function — persistir unidad/base/grupos en los ítems

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts` (bloque `itemsLote`, ~línea 400)

- [ ] **Step 1: Localizar el insert de items**

En el `for (const loteResultados ...)`, el `itemsLote = loteResultados.flatMap(...)` mapea `i` a `{empresa_id, liquidacion_id, concepto_codigo, concepto_nombre, tipo, monto, regla_aplicada}`. El motor ahora expone `unidadTexto`, `baseCalculo`, `grupoRecibo`, `detalleRecibo` en cada `i`.

- [ ] **Step 2: Agregar las cuatro columnas al mapeo**

Reemplazar el objeto que produce cada ítem por:

```ts
      return r.resultado.items.map((i) => ({
        empresa_id: periodo.empresa_id, liquidacion_id: liqId, concepto_codigo: i.codigo,
        concepto_nombre: i.nombre, tipo: i.tipo, monto: i.monto, regla_aplicada: String(i.reglaAplicada),
        unidad_texto: i.unidadTexto ?? null,
        base_calculo: i.baseCalculo ?? null,
        grupo_recibo: i.grupoRecibo ?? null,
        detalle_recibo: i.detalleRecibo ?? null,
      }))
```

- [ ] **Step 3: Verificar el typecheck de la Edge Function**

Run: `npx tsc --noEmit -p packages/motor` (el motor) y revisar que `esbuild-check.js` no rompa: `node esbuild-check.js`
Expected: sin errores nuevos. (La Edge Function corre en Deno; el chequeo local es el bundle de esbuild ya existente en el repo.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/liquidar-periodo/index.ts
git commit -m "feat(liquidar): persistir unidad_texto, base_calculo y grupos en items"
```

---

## Task 4: FormularioConcepto — campos de sección y organismo de recibo

**Files:**
- Modify: `src/components/config/FormularioConcepto.jsx`
- Test: `src/components/config/__tests__/FormularioConcepto.test.jsx`

**Firma real del componente** (ya verificada — respetala): `export default function FormularioConcepto({ concepto, categorias, conMonto, onGuardar })`. Al guardar llama `onGuardar({ config, formula, categorias, codigoRecibo })` y `onGuardar` devuelve una promesa `{ ok, error? }`. El `config` se arma dentro de la función interna `guardar` así (código ACTUAL, es lo que vas a modificar):

```jsx
    const config = modo === 'nominal'
      ? { modo, monto: Number(monto) }
      : { modo, porcentaje: Number(porcentaje), base, tope: conTope ? 'tope_sipa' : null }
```

- [ ] **Step 1: Escribir el test que falla**

El archivo `src/components/config/__tests__/FormularioConcepto.test.jsx` ya existe y al tope importa `import { describe, it, expect } from 'vitest'` y `import { validarYGenerarFormula } from '../FormularioConcepto'`. Agregá al tope estas dos líneas de import nuevas (después de las existentes):

```jsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FormularioConcepto from '../FormularioConcepto'
```

Y agregá al final del archivo este `describe` nuevo:

```jsx
describe('FormularioConcepto — grupos de recibo', () => {
  it('guarda config.recibo.grupo y config.recibo.detalle', async () => {
    const onGuardar = vi.fn().mockResolvedValue({ ok: true })
    render(<FormularioConcepto concepto={null} categorias={null} conMonto={false} onGuardar={onGuardar} />)
    fireEvent.change(screen.getByLabelText('Sección del recibo'), { target: { value: 'descuento' } })
    fireEvent.change(screen.getByLabelText('Organismo (detalle inferior)'), { target: { value: 'seguridad_social' } })
    fireEvent.change(screen.getByPlaceholderText('%'), { target: { value: '11' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    const arg = onGuardar.mock.calls.at(-1)[0]
    expect(arg.config.recibo.grupo).toBe('descuento')
    expect(arg.config.recibo.detalle).toBe('seguridad_social')
  })
})
```

También agregá `vi` al import de vitest existente para que quede `import { describe, it, expect, vi } from 'vitest'`.

- [ ] **Step 2: Correr → falla**

Run: `npx vitest run src/components/config/__tests__/FormularioConcepto.test.jsx`
Expected: FAIL (no existen los selects con label "Sección del recibo"/"Organismo (detalle inferior)").

- [ ] **Step 3: Implementar los dos selects en `src/components/config/FormularioConcepto.jsx`**

3a. Agregar dos estados nuevos, justo después de la línea `const [codigoRecibo, setCodigoRecibo] = useState(concepto?.codigoRecibo || '')`:

```jsx
  const [grupoRecibo, setGrupoRecibo] = useState(cfg.recibo?.grupo || '')
  const [detalleRecibo, setDetalleRecibo] = useState(cfg.recibo?.detalle || '')
```

3b. Reemplazar el bloque actual que arma `config` dentro de `guardar`:

```jsx
    const config = modo === 'nominal'
      ? { modo, monto: Number(monto) }
      : { modo, porcentaje: Number(porcentaje), base, tope: conTope ? 'tope_sipa' : null }
```

por esta versión (inyecta `recibo`):

```jsx
    const recibo = { grupo: grupoRecibo || null, detalle: detalleRecibo || null }
    const config = modo === 'nominal'
      ? { modo, monto: Number(monto), recibo }
      : { modo, porcentaje: Number(porcentaje), base, tope: conTope ? 'tope_sipa' : null, recibo }
```

3c. En el JSX, insertar los dos selects justo **antes** del bloque `<div style={{ marginTop: 8 }}>` que contiene el input "Código de recibo (ej: 0015)":

```jsx
      <div style={{ marginTop: 8 }}>
        <label htmlFor="grupoRecibo" style={{ display: 'block', color: 'var(--text-secondary)' }}>Sección del recibo</label>
        <select id="grupoRecibo" className="input" style={{ width: 260 }} value={grupoRecibo} onChange={(e) => setGrupoRecibo(e.target.value)}>
          <option value="">— (no imprime en secciones de recibo) —</option>
          <option value="contribucion">Costo empleador (contribución)</option>
          <option value="cct">Costo derivado del CCT</option>
          <option value="remunerativo">Remunerativo</option>
          <option value="no_remunerativo">No remunerativo</option>
          <option value="descuento">Descuento</option>
        </select>
        <label htmlFor="detalleRecibo" style={{ display: 'block', color: 'var(--text-secondary)', marginTop: 6 }}>Organismo (detalle inferior)</label>
        <select id="detalleRecibo" className="input" style={{ width: 260 }} value={detalleRecibo} onChange={(e) => setDetalleRecibo(e.target.value)}>
          <option value="">— (no participa del detalle) —</option>
          <option value="sindical">Sindical</option>
          <option value="seguridad_social">Seguridad Social</option>
          <option value="obra_social">Obra Social</option>
          <option value="inssjp">INSSJP</option>
          <option value="art">ART</option>
          <option value="scvo">SCVO</option>
        </select>
      </div>
```

- [ ] **Step 4: Correr → pasa**

Run: `npx vitest run src/components/config/__tests__/FormularioConcepto.test.jsx`
Expected: PASS (los dos tests: `validarYGenerarFormula` existente y el nuevo).

- [ ] **Step 5: Verificar que `conceptosStore` preserva `config` entero**

`src/store/conceptosStore.js`: `conceptoToDB` hace `config: c.config ?? null` y `conceptoFromDB` lee `config: r.config ?? null` — `config` se guarda/lee como objeto JSONB completo, así que la clave `recibo` viaja sin cambios. **No requiere modificación.** (Confirmalo con `Read`; si estuviera reconstruyendo `config` campo por campo, ajustá para preservar `recibo` — pero hoy no lo hace.)

- [ ] **Step 6: Commit**

```bash
git add src/components/config/FormularioConcepto.jsx src/components/config/__tests__/FormularioConcepto.test.jsx
git commit -m "feat(config): seccion de recibo y organismo por concepto"
```

---

## Task 5: `reciboLayout.js` — armar las secciones del recibo desde los ítems

**Files:**
- Create: `src/utils/reciboLayout.js`
- Test: `src/utils/__tests__/reciboLayout.test.js`

Esta función pura toma los ítems liquidados (con `tipo`, `monto`, `unidadTexto`, `baseCalculo`, `grupoRecibo`, `detalleRecibo`) y devuelve la estructura que el PDF dibuja: secciones ordenadas, subtotales, composición salarial, detalle por organismo (Empleador/Trabajador) y datos de la torta.

- [ ] **Step 1: Escribir los tests que fallan**

```js
// src/utils/__tests__/reciboLayout.test.js
import { describe, it, expect } from 'vitest'
import { armarRecibo } from '../reciboLayout'

const items = [
  // Contribuciones patronales
  { codigo: 'SIPA', nombre: 'SIPA – Ley 24.241', tipo: 'aporte_patronal', monto: 133545.68, unidadTexto: '10,77 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
  { codigo: 'OS_EMP', nombre: 'Obra social', tipo: 'aporte_patronal', monto: 83008.93, unidadTexto: '6,00 %', baseCalculo: 1383482.10, grupoRecibo: 'contribucion', detalleRecibo: 'obra_social' },
  // CCT-derivado
  { codigo: 'OSECAC', nombre: 'Contribución Solidaria OSECAC', tipo: 'aporte_patronal', monto: 28000, unidadTexto: '1', baseCalculo: 28000, grupoRecibo: 'cct', detalleRecibo: 'sindical' },
  // Remunerativo
  { codigo: 'BAS', nombre: 'Sueldo Básico', tipo: 'remunerativo', monto: 1096248, unidadTexto: '30', baseCalculo: 36541.60, grupoRecibo: 'remunerativo', detalleRecibo: null },
  // No remunerativo
  { codigo: 'INR', nombre: 'Incremento No Remunerativo', tipo: 'no_remunerativo', monto: 100000, unidadTexto: '30', baseCalculo: 3333.33, grupoRecibo: 'no_remunerativo', detalleRecibo: null },
  // Descuentos
  { codigo: 'JUB', nombre: 'Jubilación', tipo: 'descuento', monto: 137168.03, unidadTexto: '11,00 %', baseCalculo: 1246982.10, grupoRecibo: 'descuento', detalleRecibo: 'seguridad_social' },
  { codigo: 'OS_TRAB', nombre: 'Obra social', tipo: 'descuento', monto: 41504.46, unidadTexto: '3,00 %', baseCalculo: 1383482.10, grupoRecibo: 'descuento', detalleRecibo: 'obra_social' },
]

describe('armarRecibo', () => {
  const r = armarRecibo(items)

  it('agrupa contribuciones y derivados del CCT por separado', () => {
    expect(r.contribuciones.map((i) => i.codigo)).toEqual(['SIPA', 'OS_EMP'])
    expect(r.cct.map((i) => i.codigo)).toEqual(['OSECAC'])
  })

  it('subtotal de contribuciones = contribuciones + cct', () => {
    expect(r.subtotalContribuciones).toBeCloseTo(133545.68 + 83008.93 + 28000)
  })

  it('sueldo bruto = remunerativos + no remunerativos', () => {
    expect(r.totalRemunerativo).toBeCloseTo(1096248)
    expect(r.totalNoRemunerativo).toBeCloseTo(100000)
    expect(r.sueldoBruto).toBeCloseTo(1196248)
  })

  it('total descuentos y neto', () => {
    expect(r.totalDescuentos).toBeCloseTo(137168.03 + 41504.46)
    expect(r.sueldoNeto).toBeCloseTo(1196248 - (137168.03 + 41504.46))
  })

  it('costo total empleador = sueldo bruto + subtotal contribuciones', () => {
    expect(r.costoTotalEmpleador).toBeCloseTo(1196248 + 133545.68 + 83008.93 + 28000)
  })

  it('detalle por organismo separa Empleador (aporte_patronal) de Trabajador (descuento)', () => {
    const segSocial = r.detalle.find((d) => d.organismo === 'seguridad_social')
    expect(segSocial.empleador).toBeCloseTo(133545.68)
    expect(segSocial.trabajador).toBeCloseTo(137168.03)
    const obraSocial = r.detalle.find((d) => d.organismo === 'obra_social')
    expect(obraSocial.empleador).toBeCloseTo(83008.93)
    expect(obraSocial.trabajador).toBeCloseTo(41504.46)
    const sindical = r.detalle.find((d) => d.organismo === 'sindical')
    expect(sindical.empleador).toBeCloseTo(28000)
    expect(sindical.trabajador).toBeCloseTo(0)
  })

  it('torta: sueldo neto + una porción por organismo empleador', () => {
    const labels = r.torta.map((s) => s.label)
    expect(labels[0]).toBe('Sueldo Neto')
    expect(labels).toContain('Seguridad Social')
    const sumaTorta = r.torta.reduce((s, x) => s + x.valor, 0)
    expect(sumaTorta).toBeCloseTo(r.costoTotalEmpleador)
  })
})
```

- [ ] **Step 2: Correr → falla**

Run: `npx vitest run src/utils/__tests__/reciboLayout.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `src/utils/reciboLayout.js`**

```js
// src/utils/reciboLayout.js
// Transforma los ítems liquidados en la estructura de secciones/totales que
// dibuja reciboPdf.js. Función pura, sin jsPDF: testeable en aislamiento.

const ORDEN_DETALLE = ['sindical', 'seguridad_social', 'obra_social', 'inssjp', 'art', 'scvo']
const ETIQUETA_DETALLE = {
  sindical: 'Sindical',
  seguridad_social: 'Seguridad Social',
  obra_social: 'Obra Social',
  inssjp: 'INSSJP',
  art: 'ART',
  scvo: 'SCVO',
}

const suma = (arr) => arr.reduce((s, i) => s + (Number(i.monto) || 0), 0)

export function armarRecibo(items) {
  const lista = items || []
  const contribuciones = lista.filter((i) => i.grupoRecibo === 'contribucion')
  const cct = lista.filter((i) => i.grupoRecibo === 'cct')
  const remunerativos = lista.filter((i) => i.grupoRecibo === 'remunerativo')
  const noRemunerativos = lista.filter((i) => i.grupoRecibo === 'no_remunerativo')
  const descuentos = lista.filter((i) => i.grupoRecibo === 'descuento')

  const subtotalContribuciones = suma(contribuciones) + suma(cct)
  const totalRemunerativo = suma(remunerativos)
  const totalNoRemunerativo = suma(noRemunerativos)
  const sueldoBruto = totalRemunerativo + totalNoRemunerativo
  const totalDescuentos = suma(descuentos)
  const sueldoNeto = sueldoBruto - totalDescuentos
  const costoTotalEmpleador = sueldoBruto + subtotalContribuciones

  // Detalle por organismo: empleador = aporte_patronal, trabajador = descuento.
  const detalle = ORDEN_DETALLE.map((org) => {
    const delOrg = lista.filter((i) => i.detalleRecibo === org)
    const empleador = suma(delOrg.filter((i) => i.tipo === 'aporte_patronal'))
    const trabajador = suma(delOrg.filter((i) => i.tipo === 'descuento'))
    return { organismo: org, etiqueta: ETIQUETA_DETALLE[org], empleador, trabajador }
  }).filter((d) => d.empleador !== 0 || d.trabajador !== 0)

  // Torta: sueldo neto + porción empleador por organismo con monto > 0.
  const torta = [{ label: 'Sueldo Neto', valor: sueldoNeto }]
  for (const d of detalle) {
    if (d.empleador > 0) torta.push({ label: d.etiqueta, valor: d.empleador })
  }

  return {
    contribuciones, cct, remunerativos, noRemunerativos, descuentos,
    subtotalContribuciones, totalRemunerativo, totalNoRemunerativo,
    sueldoBruto, totalDescuentos, sueldoNeto, costoTotalEmpleador,
    detalle, torta,
  }
}
```

- [ ] **Step 4: Correr → pasa**

Run: `npx vitest run src/utils/__tests__/reciboLayout.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/reciboLayout.js src/utils/__tests__/reciboLayout.test.js
git commit -m "feat(recibo): reciboLayout arma secciones, detalle y torta desde items"
```

---

## Task 6: `reciboPie.js` — dibujar la torta en jsPDF

**Files:**
- Create: `src/utils/reciboPie.js`
- Test: `src/utils/__tests__/reciboPie.test.js`

jsPDF no tiene primitiva de sector; se aproxima cada porción con un abanico de triángulos (`doc.triangle`) para un relleno sólido. El helper además devuelve la geometría de leyenda para que el PDF liste "label — valor".

- [ ] **Step 1: Escribir el test que falla**

```js
// src/utils/__tests__/reciboPie.test.js
import { describe, it, expect, vi } from 'vitest'
import { dibujarTorta } from '../reciboPie'

function docFake() {
  return {
    triangle: vi.fn(),
    setFillColor: vi.fn(),
    setDrawColor: vi.fn(),
    circle: vi.fn(),
    rect: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
  }
}

describe('dibujarTorta', () => {
  it('no dibuja nada si el total es 0', () => {
    const doc = docFake()
    dibujarTorta(doc, { cx: 100, cy: 100, radio: 20, porciones: [{ label: 'X', valor: 0 }] })
    expect(doc.triangle).not.toHaveBeenCalled()
  })

  it('dibuja triángulos para porciones con valor > 0', () => {
    const doc = docFake()
    dibujarTorta(doc, {
      cx: 100, cy: 100, radio: 20,
      porciones: [{ label: 'A', valor: 60 }, { label: 'B', valor: 40 }],
    })
    expect(doc.triangle).toHaveBeenCalled()
    // leyenda: un rectángulo de color + un text por porción
    expect(doc.text).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr → falla**

Run: `npx vitest run src/utils/__tests__/reciboPie.test.js`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar `src/utils/reciboPie.js`**

```js
// src/utils/reciboPie.js
// Torta de "Costo Total Empleador" para el recibo. jsPDF no tiene sectores:
// cada porción se rellena con un abanico de triángulos desde el centro.

// Paleta fija (mismo orden que reciboLayout arma las porciones):
// Sueldo Neto (azul), luego organismos.
const COLORES = [
  [31, 78, 121],   // Sueldo Neto - azul
  [192, 0, 0],     // Sindical - rojo
  [237, 125, 49],  // Seguridad Social - naranja
  [112, 173, 71],  // Obra Social - verde
  [255, 192, 0],   // INSSJP - amarillo
  [68, 114, 196],  // ART - azul claro
  [165, 165, 165], // SCVO - gris
]

const fmt = (n) => `$${(Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function dibujarTorta(doc, { cx, cy, radio, porciones, legendX, legendY }) {
  const total = (porciones || []).reduce((s, p) => s + (Number(p.valor) || 0), 0)
  if (total <= 0) return

  const pasos = 60 // triángulos por vuelta completa: suave sin ser pesado
  let anguloInicio = -Math.PI / 2 // arranca arriba (12 en punto)

  porciones.forEach((p, idx) => {
    const valor = Number(p.valor) || 0
    if (valor <= 0) return
    const barrido = (valor / total) * Math.PI * 2
    const nTri = Math.max(1, Math.round((barrido / (Math.PI * 2)) * pasos))
    const paso = barrido / nTri
    const [rr, gg, bb] = COLORES[idx % COLORES.length]
    doc.setFillColor(rr, gg, bb)
    for (let k = 0; k < nTri; k++) {
      const a0 = anguloInicio + paso * k
      const a1 = anguloInicio + paso * (k + 1)
      doc.triangle(
        cx, cy,
        cx + radio * Math.cos(a0), cy + radio * Math.sin(a0),
        cx + radio * Math.cos(a1), cy + radio * Math.sin(a1),
        'F'
      )
    }
    anguloInicio += barrido
  })

  // Leyenda (a la derecha de la torta por defecto).
  const lx = legendX ?? cx + radio + 6
  let ly = legendY ?? cy - radio
  doc.setFontSize(6.5)
  porciones.forEach((p, idx) => {
    if ((Number(p.valor) || 0) <= 0) return
    const [rr, gg, bb] = COLORES[idx % COLORES.length]
    doc.setFillColor(rr, gg, bb)
    doc.rect(lx, ly - 2.2, 3, 3, 'F')
    doc.setTextColor(0, 0, 0)
    const pct = ((Number(p.valor) || 0) / total) * 100
    doc.text(`${p.label}: ${fmt(p.valor)} (${pct.toFixed(1)}%)`, lx + 4.5, ly)
    ly += 4.5
  })
}
```

- [ ] **Step 4: Correr → pasa**

Run: `npx vitest run src/utils/__tests__/reciboPie.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/reciboPie.js src/utils/__tests__/reciboPie.test.js
git commit -m "feat(recibo): torta costo total empleador en jsPDF"
```

---

## Task 7: `reciboPdf.js` — reescritura al layout vertical del modelo

**Files:**
- Rewrite: `src/utils/reciboPdf.js`
- Rewrite: `src/utils/__tests__/reciboPdf.test.js`

El PDF ahora recibe la estructura de `armarRecibo` más los datos de cabecera. Layout **A4 vertical**, una sola hoja, mismas secciones y orden que el modelo. Las bandas de sección van con fondo verde (mismo del modelo). La firma es única ("Firma del Empleado") con la leyenda "Recibí conforme...". El neto va en números y en letras (`numeroALetras`, ya existe).

- [ ] **Step 1: Reescribir el test**

```js
// src/utils/__tests__/reciboPdf.test.js
import { describe, it, expect } from 'vitest'
import { generarReciboPdf } from '../reciboPdf'

const cabecera = {
  empresa: { nombre: 'LA EMPRESA S.A.', cuit: '30-99999999-9', domicilio: 'Aconquija 123456 (1080) – CABA' },
  persona: {
    nombre: 'Perez José', legajo: '99', cuil: '20-99999999-9', categoria: 'Maestranza y Servicios A',
    fechaIngreso: '01/01/2021', antiguedadReconocida: 0, banco: 'Macro',
  },
  periodo: { mes: '06', anio: '2026', descripcion: '04/2026 - 10/05/2026', fechaPago: '10/05/2026' },
  codigoRecibo: 'A-0001',
}

const items = [
  { codigo: 'SIPA', nombre: 'SIPA – Ley 24.241', tipo: 'aporte_patronal', monto: 133545.68, unidadTexto: '10,77 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
  { codigo: 'OSECAC', nombre: 'Contribución Solidaria OSECAC', tipo: 'aporte_patronal', monto: 28000, unidadTexto: '1', baseCalculo: 28000, grupoRecibo: 'cct', detalleRecibo: 'sindical' },
  { codigo: 'BAS', nombre: 'Sueldo Básico', tipo: 'remunerativo', monto: 1096248, unidadTexto: '30', baseCalculo: 36541.60, grupoRecibo: 'remunerativo', detalleRecibo: null },
  { codigo: 'INR', nombre: 'Incremento No Remunerativo', tipo: 'no_remunerativo', monto: 100000, unidadTexto: '30', baseCalculo: 3333.33, grupoRecibo: 'no_remunerativo', detalleRecibo: null },
  { codigo: 'JUB', nombre: 'Jubilación', tipo: 'descuento', monto: 137168.03, unidadTexto: '11,00 %', baseCalculo: 1246982.10, grupoRecibo: 'descuento', detalleRecibo: 'seguridad_social' },
]

// Extrae todo el texto dibujado del stream del PDF. Es el MISMO patrón que
// ya usan los tests previos de este archivo (doc.internal.pages) — probado y
// funcionando en el repo; no inventar otro método.
const textoDe = (doc) => doc.internal.pages.map((p) => (Array.isArray(p) ? p.join(' ') : '')).join(' ')

describe('generarReciboPdf (formato costo laboral vertical)', () => {
  it('devuelve un jsPDF en A4 vertical', () => {
    const doc = generarReciboPdf({ ...cabecera, items })
    expect(doc).toBeTruthy()
    expect(doc.internal.pageSize.getWidth()).toBeLessThan(doc.internal.pageSize.getHeight()) // portrait
  })

  it('no lanza con items vacíos', () => {
    expect(() => generarReciboPdf({ ...cabecera, items: [] })).not.toThrow()
  })

  it('escribe los títulos de sección del modelo', () => {
    const doc = generarReciboPdf({ ...cabecera, items })
    const texto = textoDe(doc)
    // Substrings SOLO ASCII: los acentos se codifican distinto en el stream.
    expect(texto).toContain('COSTO TOTAL EMPLEADOR')
    expect(texto).toContain('DERIVADO DEL CCT')
    expect(texto).toContain('SUELDO BRUTO')
    expect(texto).toContain('SUELDO NETO')
    expect(texto).toContain('Detalle de la')
  })

  it('incluye el nombre de la empresa y del empleado', () => {
    const doc = generarReciboPdf({ ...cabecera, items })
    const texto = textoDe(doc)
    expect(texto).toContain('LA EMPRESA S.A.')
    expect(texto).toContain('Perez')
  })
})
```

- [ ] **Step 2: Correr → falla**

Run: `npx vitest run src/utils/__tests__/reciboPdf.test.js`
Expected: FAIL (firma vieja, sin secciones nuevas).

- [ ] **Step 3: Reescribir `src/utils/reciboPdf.js`**

```js
import { jsPDF } from 'jspdf'
import { numeroALetras } from './numeroALetras'
import { armarRecibo } from './reciboLayout'
import { dibujarTorta } from './reciboPie'

const VERDE = [198, 224, 180]        // banda de sección (mismo verde del modelo)
const GRIS = [230, 230, 230]         // sub-encabezados (REMUNERATIVO, etc.)
const LEYENDA = 'Recibí conforme copia del original del presente recibo, y el importe neto en pago de mi remuneración del período indicado.'

const fmt = (n) => `$${(Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Recibo de costo laboral (modelo AR), A4 vertical, una hoja. Segrega costo
// empleador (contribuciones + derivados CCT) y sueldo del trabajador
// (remunerativo/no remunerativo/descuentos), con columnas Unidad/Base/Monto,
// composición salarial, neto en letras, detalle por organismo y torta.
export function generarReciboPdf({ empresa, persona, periodo, items, codigoRecibo }) {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4' })
  const R = armarRecibo(items)
  const M = 10                         // margen
  const W = doc.internal.pageSize.getWidth()
  const anchoUtil = W - M * 2
  // Columnas de la tabla (x absolutas): Concepto | Unidad | Base | Monto
  const colConcepto = M + 1
  const colUnidad = M + anchoUtil * 0.52
  const colBase = M + anchoUtil * 0.68
  const colMonto = M + anchoUtil * 0.99 // alineado a derecha
  let y = 12

  const banda = (titulo, total) => {
    doc.setFillColor(...VERDE)
    doc.rect(M, y - 4, anchoUtil, 6, 'F')
    doc.setFont(undefined, 'bold'); doc.setFontSize(9)
    doc.text(titulo, colConcepto, y)
    if (total != null) doc.text(fmt(total), colMonto, y, { align: 'right' })
    doc.setFont(undefined, 'normal')
    y += 7
  }

  const subEncabezado = (t) => {
    doc.setFillColor(...GRIS)
    doc.rect(M, y - 3.5, anchoUtil, 5, 'F')
    doc.setFont(undefined, 'bold'); doc.setFontSize(7.5)
    doc.text(t, colConcepto, y)
    doc.setFont(undefined, 'normal')
    y += 5.5
  }

  const encColumnas = () => {
    doc.setFont(undefined, 'bold'); doc.setFontSize(7)
    doc.text('CONCEPTO', colConcepto, y)
    doc.text('UNIDAD', colUnidad, y)
    doc.text('BASE', colBase, y)
    doc.text('MONTO', colMonto, y, { align: 'right' })
    doc.setFont(undefined, 'normal')
    y += 4
  }

  const filaItem = (i) => {
    doc.setFontSize(7.5)
    doc.text(String(i.nombre || ''), colConcepto, y)
    if (i.unidadTexto != null) doc.text(String(i.unidadTexto), colUnidad, y)
    if (i.baseCalculo != null) doc.text(fmt(i.baseCalculo), colBase, y)
    doc.text(fmt(i.monto), colMonto, y, { align: 'right' })
    y += 4.2
  }

  // ── Cabecera: empresa + datos fiscales ──────────────────────────────
  doc.setFont(undefined, 'bold'); doc.setFontSize(12)
  doc.text(String(empresa?.nombre || '—'), colConcepto, y); y += 5
  doc.setFont(undefined, 'normal'); doc.setFontSize(8)
  doc.text(String(empresa?.domicilio || '—'), colConcepto, y); y += 4
  doc.text(`C.U.I.T.: ${empresa?.cuit || '—'}`, colConcepto, y); y += 6

  // Grilla de datos del empleado (dos filas, estilo modelo).
  doc.setFontSize(7.5)
  const g = (label, valor, x) => { doc.setFont(undefined, 'bold'); doc.text(label, x, y); doc.setFont(undefined, 'normal'); doc.text(String(valor ?? '—'), x, y + 3.5) }
  g('Mes/Año', `${periodo?.mes || '—'}/${periodo?.anio || '—'}`, M)
  g('Apellido y Nombre', persona?.nombre || '—', M + 30)
  g('Legajo', persona?.legajo || '—', M + 95)
  g('Categoría', persona?.categoria || '—', M + 120)
  y += 9
  g('Fecha Ingreso', persona?.fechaIngreso || '—', M)
  g('Antig. Reconocida', persona?.antiguedadReconocida ?? 0, M + 30)
  g('C.U.I.L.', persona?.cuil || '—', M + 75)
  g('Banco', persona?.banco || '—', M + 120)
  g('Período / Pago', `${periodo?.descripcion || '—'}`, M + 150)
  y += 11

  // ── COSTO TOTAL EMPLEADOR ───────────────────────────────────────────
  banda('COSTO TOTAL EMPLEADOR', R.costoTotalEmpleador)
  encColumnas()
  R.contribuciones.forEach(filaItem)
  if (R.cct.length > 0) {
    subEncabezado('COSTO DERIVADO DEL CCT')
    R.cct.forEach(filaItem)
  }
  banda('SUBTOTAL CONTRIBUCIONES EMPLEADOR', R.subtotalContribuciones)

  // ── SUELDO BRUTO ────────────────────────────────────────────────────
  banda('SUELDO BRUTO', R.sueldoBruto)
  encColumnas()
  subEncabezado('REMUNERATIVO')
  R.remunerativos.forEach(filaItem)
  if (R.noRemunerativos.length > 0) {
    subEncabezado('NO REMUNERATIVO')
    R.noRemunerativos.forEach(filaItem)
  }
  subEncabezado('DESCUENTOS')
  R.descuentos.forEach(filaItem)

  // ── COMPOSICIÓN SALARIAL ────────────────────────────────────────────
  y += 1
  doc.setFillColor(...GRIS); doc.rect(M, y - 3.5, anchoUtil, 5, 'F')
  doc.setFont(undefined, 'bold'); doc.setFontSize(7.5)
  doc.text('COMPOSICIÓN SALARIAL »', colConcepto, y)
  doc.text(`Rem.: ${fmt(R.totalRemunerativo)}`, M + anchoUtil * 0.40, y)
  doc.text(`No rem.: ${fmt(R.totalNoRemunerativo)}`, M + anchoUtil * 0.62, y)
  doc.text(`Desc.: ${fmt(R.totalDescuentos)}`, M + anchoUtil * 0.83, y)
  doc.setFont(undefined, 'normal')
  y += 6

  // ── SUELDO NETO ─────────────────────────────────────────────────────
  banda('SUELDO NETO', R.sueldoNeto)
  doc.setFontSize(7.5)
  const letras = doc.splitTextToSize(`Son pesos: ${numeroALetras(R.sueldoNeto)}`, anchoUtil)
  letras.forEach((l) => { doc.text(l, colConcepto, y); y += 3.5 })
  y += 3

  // ── Detalle de la composición salarial (por organismo) ──────────────
  doc.setFont(undefined, 'bold'); doc.setFontSize(8)
  doc.text('Detalle de la composición salarial', colConcepto, y)
  doc.setFont(undefined, 'normal'); y += 4
  doc.setFontSize(7)
  doc.setFont(undefined, 'bold')
  doc.text('Organismo', colConcepto, y)
  doc.text('Empleador', M + anchoUtil * 0.22, y)
  doc.text('Trabajador', M + anchoUtil * 0.35, y)
  doc.setFont(undefined, 'normal'); y += 4
  const yDetalleInicio = y
  R.detalle.forEach((d) => {
    doc.text(d.etiqueta, colConcepto, y)
    doc.text(fmt(d.empleador), M + anchoUtil * 0.22, y)
    doc.text(fmt(d.trabajador), M + anchoUtil * 0.35, y)
    y += 4
  })

  // ── Torta (a la derecha del detalle) ────────────────────────────────
  dibujarTorta(doc, {
    cx: M + anchoUtil * 0.72, cy: yDetalleInicio + 14, radio: 15,
    porciones: R.torta, legendX: M + anchoUtil * 0.82, legendY: yDetalleInicio,
  })

  // ── Firma ───────────────────────────────────────────────────────────
  const altoPagina = doc.internal.pageSize.getHeight()
  let yFirma = Math.max(y + 8, altoPagina - 24)
  doc.setFontSize(7)
  const leyenda = doc.splitTextToSize(LEYENDA, anchoUtil)
  leyenda.forEach((l) => { doc.text(l, colConcepto, yFirma); yFirma += 3.2 })
  yFirma += 8
  doc.line(M + anchoUtil * 0.55, yFirma, M + anchoUtil, yFirma)
  doc.text('Firma del Empleado', M + anchoUtil * 0.7, yFirma + 4)
  if (codigoRecibo) doc.text(`Recibo N°: ${codigoRecibo}`, colConcepto, yFirma + 4)

  return doc
}
```

- [ ] **Step 4: Correr → pasa**

Run: `npx vitest run src/utils/__tests__/reciboPdf.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/reciboPdf.js src/utils/__tests__/reciboPdf.test.js
git commit -m "feat(recibo): reescritura al formato vertical de costo laboral (modelo AR)"
```

---

## Task 8: LiquidacionPage — alimentar el recibo con la estructura nueva

**Files:**
- Modify: `src/pages/LiquidacionPage.jsx` (`handleEmitirRecibo`)

**Contexto real (ya verificado):** en `handleEmitirRecibo` existe `const periodoActivo = periodos.find((p) => p.id === periodoSeleccionado)` definido arriba en el componente (línea ~45), y todas las liquidaciones mostradas pertenecen a `periodoSeleccionado` — así que **`periodoActivo` es el período de `l`**; no busques otro. La tabla `nom_periodos` tiene columnas `tipo, fecha_desde, fecha_hasta` (NO existe `descripcion` ni `nombre`) más la nueva `fecha_pago` (Tarea 1). El objeto liquidación `l` tiene `l.numeroRecibo` (null en la primera emisión). Estos tres bloques son el código ACTUAL a reemplazar.

- [ ] **Step 1: Ampliar la query de legajo**

Reemplazar esta línea actual dentro del `Promise.all`:

```js
        supabase.from('nom_legajo').select('cuil, categoria_id, fecha_ingreso').eq('personal_id', l.personalId).eq('empresa_id', empresaId).single(),
```

por:

```js
        supabase.from('nom_legajo').select('cuil, categoria_id, fecha_ingreso, banco, antiguedad_reconocida').eq('personal_id', l.personalId).eq('empresa_id', empresaId).single(),
```

- [ ] **Step 2: Mapear los items con los campos nuevos**

Reemplazar esta línea actual:

```js
      const items = (itemsPorLiq[l.id] || []).map((i) => ({ nombre: i.concepto_nombre, tipo: i.tipo, monto: Number(i.monto), codigo: i.concepto_codigo }))
```

por:

```js
      const items = (itemsPorLiq[l.id] || []).map((i) => ({
        codigo: i.concepto_codigo, nombre: i.concepto_nombre, tipo: i.tipo, monto: Number(i.monto),
        unidadTexto: i.unidad_texto ?? null,
        baseCalculo: i.base_calculo != null ? Number(i.base_calculo) : null,
        grupoRecibo: i.grupo_recibo ?? null,
        detalleRecibo: i.detalle_recibo ?? null,
      }))
```

- [ ] **Step 3: Reemplazar la llamada a `generarReciboPdf`**

Reemplazar el bloque actual completo (desde `const doc = generarReciboPdf({` hasta su `})` de cierre, el que hoy pasa `empresa/persona/periodo/items/neto` con `logoBase64` y `periodo: { descripcion: ... }`) por:

```js
      const doc = generarReciboPdf({
        empresa: {
          nombre: empresaRow?.nombre || empresaActiva?.nombre || '—',
          cuit: configRow?.cuit || '—',
          domicilio: configRow?.domicilio || '—',
        },
        persona: {
          nombre: personalPorId.get(l.personalId) || l.personalId,
          cuil: legajoRow?.cuil || '—',
          legajo: l.personalId.slice(0, 8),
          categoria: categoriaNombre,
          fechaIngreso: legajoRow?.fecha_ingreso || '—',
          antiguedadReconocida: legajoRow?.antiguedad_reconocida ?? 0,
          banco: legajoRow?.banco || '—',
        },
        periodo: {
          mes: periodoActivo ? String(periodoActivo.fecha_desde).slice(5, 7) : '—',
          anio: periodoActivo ? String(periodoActivo.fecha_desde).slice(0, 4) : '—',
          descripcion: periodoActivo ? `${periodoActivo.tipo} — ${periodoActivo.fecha_desde} a ${periodoActivo.fecha_hasta}` : '—',
          fechaPago: periodoActivo?.fecha_pago || '—',
        },
        items,
        codigoRecibo: l.numeroRecibo || null,
      })
```

Notas: (a) el nuevo `generarReciboPdf` **ya no usa** `logoBase64` ni `neto` (el neto se recomputa dentro desde `items`); el bloque de descarga de logo (`let logoBase64 = ...`) puede quedar sin uso — **dejalo como está**, no lo borres, para no tocar el flujo; solo dejás de pasar `logoBase64`. (b) **No cambies** el orden hash→`emitirRecibo`→`doc.save` que viene después: `const hash = await calcularHashPdf(doc)` etc. siguen igual. En la primera emisión `codigoRecibo` va `null` (el número se estampa recién en la re-emisión); es aceptable y no altera el hash.

- [ ] **Step 4: Verificar build y test de la página (si existe)**

Run: `npx vite build`
Expected: sin errores. Si `src/pages/__tests__/` tuviera un test de LiquidacionPage que rompa por el cambio de forma de datos, correr `npx vitest run src/pages/__tests__/` y ajustarlo a la firma nueva (mismos objetivos).

- [ ] **Step 5: Commit**

```bash
git add src/pages/LiquidacionPage.jsx
git commit -m "feat(liquidacion): emitir recibo con estructura de costo laboral"
```

---

## Task 9: Seed de agrupación de recibo y conceptos patronales del modelo

**Files:**
- Create: `supabase/migrations/0029_seed_recibo_grupos.sql`

Carga la agrupación de recibo (grupo + detalle) y el `config` sobre los conceptos **ya existentes** (por sus códigos reales del repo: `basico`, `presentismo`, `jubilacion`, `ley_19032`, `obra_social`, `retencion_sindical`) y da de alta las **contribuciones patronales** del modelo. En vez de adivinar el UUID del convenio, lo **ancla** al convenio/empresa del concepto `basico` existente (así funciona con cualquier seed). Es idempotente (INSERT con `WHERE NOT EXISTS`, tolerante a `empresa_id` NULL). Los `UPDATE` también fijan la `formula` para que la BASE mostrada coincida con el monto calculado.

**Códigos reales verificados** (de `supabase/migrations/0020_codigos_recibo_seed.sql`): `basico`, `presentismo`, `jubilacion`, `ley_19032`, `obra_social`, `retencion_sindical`. Si tu instancia tuviera otros, ajustá los `codigo = '...'` — pero estos son los del seed del repo.

- [ ] **Step 1: Escribir la migración**

```sql
-- 0029_seed_recibo_grupos.sql
-- Agrupación de recibo (grupo/detalle) + config sobre conceptos existentes, y
-- alta de las contribuciones patronales del modelo AR. Idempotente. Anclado al
-- convenio/empresa del concepto 'basico' (no hardcodea UUIDs). Valores del
-- modelo: SIPA 10,77 %, INSSJP 1,59 %, Asig. Fam. 4,70 %, FNE 0,94 %, Obra
-- social 6 %, ART variable 3 %, OSECAC/INACAP/SCVO nominales.

DO $$
DECLARE
  v_convenio UUID;
  v_empresa  UUID;
BEGIN
  SELECT convenio_id, empresa_id INTO v_convenio, v_empresa
    FROM nom_conceptos WHERE codigo = 'basico' ORDER BY created_at LIMIT 1;
  IF v_convenio IS NULL THEN
    RAISE NOTICE 'no se encontró el concepto "basico"; revisar seed de conceptos'; RETURN;
  END IF;

  -- 1) Descuentos del trabajador: fijar config (para que el motor calcule
  --    unidad/base) + formula consistente + agrupación de recibo.
  UPDATE nom_conceptos SET
      formula = 'min(remunerativo_acumulado, tope_sipa) * 0.11',
      config = '{"modo":"porcentaje","porcentaje":11,"base":"remunerativo","tope":"tope_sipa","recibo":{"grupo":"descuento","detalle":"seguridad_social"}}'::jsonb
    WHERE codigo = 'jubilacion' AND convenio_id = v_convenio AND empresa_id IS NOT DISTINCT FROM v_empresa;

  UPDATE nom_conceptos SET
      formula = 'min(remunerativo_acumulado, tope_sipa) * 0.03',
      config = '{"modo":"porcentaje","porcentaje":3,"base":"remunerativo","tope":"tope_sipa","recibo":{"grupo":"descuento","detalle":"inssjp"}}'::jsonb
    WHERE codigo = 'ley_19032' AND convenio_id = v_convenio AND empresa_id IS NOT DISTINCT FROM v_empresa;

  UPDATE nom_conceptos SET
      formula = '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03',
      config = '{"modo":"porcentaje","porcentaje":3,"base":"ambos","tope":null,"recibo":{"grupo":"descuento","detalle":"obra_social"}}'::jsonb
    WHERE codigo = 'obra_social' AND convenio_id = v_convenio AND empresa_id IS NOT DISTINCT FROM v_empresa;

  UPDATE nom_conceptos SET
      formula = '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.02',
      config = '{"modo":"porcentaje","porcentaje":2,"base":"ambos","tope":null,"recibo":{"grupo":"descuento","detalle":"sindical"}}'::jsonb
    WHERE codigo = 'retencion_sindical' AND convenio_id = v_convenio AND empresa_id IS NOT DISTINCT FROM v_empresa;

  -- 2) Remunerativos: solo agregar la agrupación de recibo, preservando el
  --    resto del config con jsonb_set (merge de la clave 'recibo').
  UPDATE nom_conceptos SET config = jsonb_set(coalesce(config,'{}'::jsonb),'{recibo}',
      '{"grupo":"remunerativo","detalle":null}'::jsonb, true)
    WHERE codigo IN ('basico','presentismo') AND convenio_id = v_convenio AND empresa_id IS NOT DISTINCT FROM v_empresa;

  -- 3) Alta de contribuciones patronales del modelo. WHERE NOT EXISTS para ser
  --    idempotente y tolerar empresa_id NULL (ON CONFLICT no dispara con NULL).
  INSERT INTO nom_conceptos (convenio_id, empresa_id, codigo, nombre, tipo, formula, orden, imprimible, config)
  SELECT v_convenio, v_empresa, x.codigo, x.nombre, 'aporte_patronal', x.formula, x.orden, true, x.config::jsonb
  FROM (VALUES
    ('c_sipa',   'SIPA – Ley 24.241',             'remunerativo_acumulado * 0.1077', 200, '{"modo":"porcentaje","porcentaje":10.77,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'),
    ('c_inssjp_pat','Ley 19.032 – INSSJP (contrib.)','remunerativo_acumulado * 0.0159', 201, '{"modo":"porcentaje","porcentaje":1.59,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"inssjp"}}'),
    ('c_asig',   'Asignaciones Familiares',       'remunerativo_acumulado * 0.047',  202, '{"modo":"porcentaje","porcentaje":4.70,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'),
    ('c_fne',    'Fondo Nacional de Empleo',      'remunerativo_acumulado * 0.0094', 203, '{"modo":"porcentaje","porcentaje":0.94,"base":"remunerativo","recibo":{"grupo":"contribucion","detalle":"seguridad_social"}}'),
    ('c_os_pat', 'Obra social (contribución)',    '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.06', 204, '{"modo":"porcentaje","porcentaje":6.00,"base":"ambos","recibo":{"grupo":"contribucion","detalle":"obra_social"}}'),
    ('c_art',    'Riesgos de Trabajo – Variable', '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03', 205, '{"modo":"porcentaje","porcentaje":3.00,"base":"ambos","recibo":{"grupo":"contribucion","detalle":"art"}}'),
    ('c_osecac', 'Contribución Solidaria OSECAC', '28000',   210, '{"modo":"nominal","monto":28000,"recibo":{"grupo":"cct","detalle":"sindical"}}'),
    ('c_inacap', 'INACAP',                        '5481.25', 211, '{"modo":"nominal","monto":5481.25,"recibo":{"grupo":"cct","detalle":"sindical"}}'),
    ('c_scvo',   'Seguro Colectivo de Vida Obligatorio', '424.62', 212, '{"modo":"nominal","monto":424.62,"recibo":{"grupo":"cct","detalle":"scvo"}}')
  ) AS x(codigo, nombre, formula, orden, config)
  WHERE NOT EXISTS (
    SELECT 1 FROM nom_conceptos c
    WHERE c.codigo = x.codigo AND c.convenio_id = v_convenio AND c.empresa_id IS NOT DISTINCT FROM v_empresa
  );
END $$;
```

- [ ] **Step 2:** Avisar al usuario que aplique la migración en Supabase (SQL Editor). Nota: los `UPDATE` de la sección 1 **cambian la fórmula** de jubilación/INSSJP/obra social/sindicato del template global para que la BASE mostrada coincida con el monto — si el usuario ya tenía alícuotas propias, revisarlas después.
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0029_seed_recibo_grupos.sql
git commit -m "feat(db): seed 0029 agrupacion de recibo y contribuciones patronales del modelo"
```

---

## Task 10: Verificación final — PDF de muestra + suite completa

**Files:**
- Create: `scripts/generar-recibo-muestra.mjs`

- [ ] **Step 1: Script de muestra**

```js
// scripts/generar-recibo-muestra.mjs
// Genera un PDF de muestra desde datos fixture idénticos al modelo, para
// comparar visualmente el layout. Uso: node scripts/generar-recibo-muestra.mjs
import { generarReciboPdf } from '../src/utils/reciboPdf.js'
import { writeFileSync } from 'node:fs'

const items = [
  { codigo: 'C_SIPA', nombre: 'SIPA – Ley 24.241', tipo: 'aporte_patronal', monto: 133545.68, unidadTexto: '10,77 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
  { codigo: 'C_INSSJP', nombre: 'Ley 19.032 – INSSJP', tipo: 'aporte_patronal', monto: 19715.66, unidadTexto: '1,59 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'inssjp' },
  { codigo: 'C_ASIG', nombre: 'Asignaciones Familiares', tipo: 'aporte_patronal', monto: 58278.99, unidadTexto: '4,70 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
  { codigo: 'C_FNE', nombre: 'Fondo Nacional de Empleo', tipo: 'aporte_patronal', monto: 11655.80, unidadTexto: '0,94 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
  { codigo: 'C_OS', nombre: 'Obra social', tipo: 'aporte_patronal', monto: 83008.93, unidadTexto: '6,00 %', baseCalculo: 1383482.10, grupoRecibo: 'contribucion', detalleRecibo: 'obra_social' },
  { codigo: 'C_ART', nombre: 'Riesgos de Trabajo – Variable', tipo: 'aporte_patronal', monto: 41504.46, unidadTexto: '3,00 %', baseCalculo: 1383482.10, grupoRecibo: 'contribucion', detalleRecibo: 'art' },
  { codigo: 'C_OSECAC', nombre: 'Contribución Solidaria OSECAC', tipo: 'aporte_patronal', monto: 28000, unidadTexto: '1', baseCalculo: 28000, grupoRecibo: 'cct', detalleRecibo: 'sindical' },
  { codigo: 'C_INACAP', nombre: 'INACAP', tipo: 'aporte_patronal', monto: 5481.25, unidadTexto: '1', baseCalculo: 5481.25, grupoRecibo: 'cct', detalleRecibo: 'sindical' },
  { codigo: 'C_SCVO', nombre: 'Seguro Colectivo de Vida Obligatorio', tipo: 'aporte_patronal', monto: 424.62, unidadTexto: '1', baseCalculo: 424.62, grupoRecibo: 'cct', detalleRecibo: 'scvo' },
  { codigo: 'BAS', nombre: 'Sueldo Básico', tipo: 'remunerativo', monto: 1096248, unidadTexto: '30', baseCalculo: 36541.60, grupoRecibo: 'remunerativo', detalleRecibo: null },
  { codigo: 'ANT', nombre: 'Adicional por antigüedad', tipo: 'remunerativo', monto: 54812.40, unidadTexto: '5,00 %', baseCalculo: 1096248, grupoRecibo: 'remunerativo', detalleRecibo: null },
  { codigo: 'INR', nombre: 'Incremento No Remunerativo', tipo: 'no_remunerativo', monto: 100000, unidadTexto: '30', baseCalculo: 3333.33, grupoRecibo: 'no_remunerativo', detalleRecibo: null },
  { codigo: 'JUB', nombre: 'Jubilación – Ley 24.241', tipo: 'descuento', monto: 137168.03, unidadTexto: '11,00 %', baseCalculo: 1246982.10, grupoRecibo: 'descuento', detalleRecibo: 'seguridad_social' },
  { codigo: 'INSSJP', nombre: 'Ley 19.032 - INSSJP', tipo: 'descuento', monto: 37409.46, unidadTexto: '3,00 %', baseCalculo: 1246982.10, grupoRecibo: 'descuento', detalleRecibo: 'inssjp' },
  { codigo: 'OS', nombre: 'Obra social', tipo: 'descuento', monto: 41504.46, unidadTexto: '3,00 %', baseCalculo: 1383482.10, grupoRecibo: 'descuento', detalleRecibo: 'obra_social' },
  { codigo: 'FAECYS', nombre: 'FAECyS - Art. 100 CCT 130/75', tipo: 'descuento', monto: 6917.41, unidadTexto: '0,50 %', baseCalculo: 1383482.10, grupoRecibo: 'descuento', detalleRecibo: 'sindical' },
  { codigo: 'SINDICATO', nombre: 'Sindicato - Art. 100 CCT 130/75', tipo: 'descuento', monto: 27669.64, unidadTexto: '2,00 %', baseCalculo: 1383482.10, grupoRecibo: 'descuento', detalleRecibo: 'sindical' },
]

const doc = generarReciboPdf({
  empresa: { nombre: 'LA EMPRESA S.A.', cuit: '30-99999999-9', domicilio: 'Aconquija 123456 (1080) – CABA' },
  persona: { nombre: 'Perez José', legajo: '99', cuil: '20-99999999-9', categoria: 'Maestranza y Servicios A', fechaIngreso: '01/01/2021', antiguedadReconocida: 0, banco: 'Macro' },
  periodo: { mes: '06', anio: '2026', descripcion: '04/2026 - 10/05/2026', fechaPago: '10/05/2026' },
  items,
  codigoRecibo: 'A-0001',
})
writeFileSync('recibo-muestra.pdf', Buffer.from(doc.output('arraybuffer')))
console.log('OK: recibo-muestra.pdf')
```

- [ ] **Step 2: Generar y abrir el PDF**

Run: `node scripts/generar-recibo-muestra.mjs`
Expected: crea `recibo-muestra.pdf`. Abrirlo y comparar contra el modelo: verificar orden de secciones, columnas Unidad/Base/Monto alineadas, subtotales (Subtotal contribuciones ≈ 403.332, Sueldo Bruto ≈ 1.383.483, Neto ≈ 1.132.814 con el juego completo), detalle por organismo y torta presente. Ajustar coordenadas de `reciboPdf.js` si algo se solapa; re-generar.

- [ ] **Step 3: Suite completa + lint**

Run: `npx vitest run` y `npx oxlint` (o `npm run lint`)
Expected: todo verde, sin regresiones.

- [ ] **Step 4: (Opcional) revisión de código con subagente**

Usar `superpowers:requesting-code-review` sobre el diff completo de la rama antes de mergear a `dev`.

- [ ] **Step 5: Commit**

```bash
git add scripts/generar-recibo-muestra.mjs
git commit -m "test(recibo): script de PDF de muestra para comparar con el modelo"
```

---

## Notas de diseño y riesgos

- **Cambio respecto del diseño maestro:** `docs/Recursio_Diseno.md` (paso 118) decía que las contribuciones patronales *no* van en el recibo sino en el reporte fiscal. Este plan las lleva al recibo a pedido explícito del usuario: el documento resultante es una **planilla de costo laboral**, no el recibo legal art. 140 LCT de doble ejemplar (que ya no se emite tras esta fase). Si más adelante se necesita el recibo legal estricto, será un tipo de documento aparte.
- **Fidelidad de "BASE" del Sueldo Básico:** en el modelo, el básico muestra `30 × 36.541,60`. Eso requiere `config.recibo.unidadFormula` (`"30"` o los días liquidados) y `baseFormula` (`"basico_convenio"` o el jornal). El motor ya soporta los overrides (Task 2); cargarlos en el seed/convenio para el concepto básico si se quiere ese desglose exacto — de lo contrario el básico sale con unidad "1" y base = monto.
- **Torta en jsPDF:** la aproximación por triángulos es sólida para relleno; si se quiere un borde perfecto se puede sumar `doc.circle(cx, cy, radio, 'S')` por encima. No usar imágenes externas (el recibo se genera offline en el cliente).
- **Filas viejas:** las liquidaciones ya emitidas antes de la migración 0028 no tienen `unidad_texto`/`base_calculo`/grupos; se re-liquidan (período abierto) o se muestran con esas celdas vacías. No hay backfill automático.
- **Overflow de una hoja:** con muchos conceptos el contenido podría pasar de A4. `reciboPdf.js` no pagina hoy; si un convenio real supera ~35 líneas, agregar `doc.addPage()` cuando `y > altoPagina - 40` dentro de `filaItem` (mejora futura, fuera de alcance salvo que la muestra lo exija).

---

## Resumen de cobertura del modelo (checklist de verificación)

| Elemento del modelo | Tarea |
|---|---|
| Cabecera empresa (nombre, domicilio, CUIT) | 7, 8 |
| Grilla empleado (Mes/Año, Legajo, Categoría, Fecha Ingreso, Antig. Reconocida, CUIL, Banco, Período/Pago) | 1, 7, 8 |
| COSTO TOTAL EMPLEADOR + total | 5, 7 |
| Contribuciones con Unidad/Base/Monto | 1, 2, 5, 7 |
| COSTO DERIVADO DEL CCT | 5, 7, 9 |
| SUBTOTAL CONTRIBUCIONES EMPLEADOR | 5, 7 |
| SUELDO BRUTO + Remunerativo/No remunerativo/Descuentos | 5, 7 |
| COMPOSICIÓN SALARIAL (Rem/No rem/Desc) | 5, 7 |
| SUELDO NETO + Son pesos (letras) | 7 |
| Detalle de la composición salarial (Empleador/Trabajador por organismo) | 5, 7 |
| Gráfico de torta Costo Total Empleador | 5, 6, 7 |
| Firma del Empleado + leyenda de recepción | 7 |
| Conceptos/alícuotas configurables + seed | 4, 9 |
