# Menú de Configuración (escalas, no remunerativos, aportes, adicionales, parámetros) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UI de configuración para que el usuario cargue básicos por categoría, sumas no remunerativas mensuales, porcentajes de aportes/contribuciones, conceptos adicionales por puesto y parámetros versionados, sin tocar SQL.

**Architecture:** Se extiende el esquema existente (spec: `docs/superpowers/specs/2026-07-21-menu-configuracion-escalas-design.md`): tabla nueva `nom_no_remunerativos`, columnas `categorias`/`config` en `nom_conceptos`, función `clonar_convenio` SECURITY DEFINER. El motor gana la variable `no_remunerativo_acumulado`, un filtro por categoría y un generador de fórmulas puro. La página Configuración se reorganiza en 5 pestañas con stores zustand por dominio.

**Tech Stack:** React + zustand + Supabase (Postgres/RLS/Edge Functions Deno) + vitest. Motor puro en `packages/motor` (TS, sin eval).

**Nota de entorno:** las migraciones se aplican a mano en el SQL Editor de Supabase (patrón del repo — avisar al usuario y esperar confirmación). Si un commit falla con `.git/HEAD.lock` u `objects/*/tmp_obj_*`, pedirle al usuario que borre esos archivos desde su Mac (limitación conocida del sandbox).

---

## Estructura de archivos

- Create: `supabase/migrations/0012_config_escalas.sql`
- Modify: `packages/motor/src/motor.ts` (+ test) — `no_remunerativo_acumulado`, `filtrarPorCategoria`
- Create: `packages/motor/src/formulas.ts` (+ test) — `generarFormula(config)`
- Modify: `supabase/functions/liquidar-periodo/index.ts` — `no_rem_convenio`, filtrado por convenio/categoría
- Create: `src/store/conveniosStore.js`, `src/store/escalasStore.js`, `src/store/noRemunerativosStore.js`, `src/store/parametrosStore.js` (+ tests de mappers)
- Modify: `src/store/conceptosStore.js` (+ test) — `categorias`, `config`
- Create: `src/components/config/TablaVigencias.jsx` (compartido por Escalas y No remunerativos)
- Create: `src/components/config/TabEscalas.jsx`, `TabNoRemunerativos.jsx`, `TabAportes.jsx`, `TabAdicionales.jsx`, `TabParametros.jsx`
- Modify: `src/pages/ConfiguracionPage.jsx` — pestañas + selector de convenio + banner "Personalizar convenio"

---

### Task 1: Migración 0012 — esquema

**Files:**
- Create: `supabase/migrations/0012_config_escalas.sql`

- [ ] **Step 1: Escribir la migración completa**

```sql
-- 0012_config_escalas.sql — menú de configuración (spec 2026-07-21)

-- ─── nom_no_remunerativos ───────────────────────────────────────
-- Suma no remunerativa por categoría, versionada por vigencia_desde
-- (mismo patrón que nom_categorias: nunca se pisa, se agrega vigencia).
CREATE TABLE IF NOT EXISTS nom_no_remunerativos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convenio_id      UUID NOT NULL REFERENCES nom_convenios(id) ON DELETE CASCADE,
  categoria_nombre TEXT NOT NULL,
  monto            NUMERIC NOT NULL,
  vigencia_desde   DATE NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (convenio_id, categoria_nombre, vigencia_desde)
);
ALTER TABLE nom_no_remunerativos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_no_remunerativos_all ON nom_no_remunerativos;
CREATE POLICY nom_no_remunerativos_all ON nom_no_remunerativos FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_no_remunerativos.convenio_id
            AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_convenios c WHERE c.id = nom_no_remunerativos.convenio_id
            AND c.empresa_id = auth_empresa_id())
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_no_remunerativos TO authenticated;
GRANT SELECT ON nom_no_remunerativos TO service_role;
CREATE INDEX IF NOT EXISTS nom_no_remunerativos_convenio_idx ON nom_no_remunerativos(convenio_id);

-- ─── nom_conceptos: categorias + config ─────────────────────────
-- categorias: NULL = aplica a todas las categorías; con valores, solo a esas.
-- config: metadata del formulario estructurado; la fórmula se genera de acá.
ALTER TABLE nom_conceptos ADD COLUMN IF NOT EXISTS categorias TEXT[];
ALTER TABLE nom_conceptos ADD COLUMN IF NOT EXISTS config JSONB;

-- ─── concepto plantilla: suma no remunerativa ───────────────────
-- La UNIQUE (convenio_id, empresa_id, codigo) no matchea filas con
-- empresa_id NULL (NULLs distintos), por eso NOT EXISTS y no ON CONFLICT.
INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible)
SELECT NULL, c.id, 'suma_no_rem', 'Suma no remunerativa', 'no_remunerativo', 'no_rem_convenio', 50, true
FROM nom_convenios c
WHERE c.empresa_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM nom_conceptos x
    WHERE x.convenio_id = c.id AND x.codigo = 'suma_no_rem' AND x.empresa_id IS NULL
  );

-- ─── clonar_convenio ────────────────────────────────────────────
-- Copia un convenio global (empresa_id NULL) a la empresa del usuario,
-- con categorías (todas las vigencias), no remunerativos, conceptos
-- plantilla y reglas; re-apunta los legajos de la empresa. Idempotente:
-- si ya existe un convenio de la empresa con el mismo nombre, lo devuelve.
CREATE OR REPLACE FUNCTION clonar_convenio(convenio_global_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID := auth_empresa_id();
  v_origen  nom_convenios%ROWTYPE;
  v_nuevo   UUID;
BEGIN
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'usuario sin empresa asignada';
  END IF;
  SELECT * INTO v_origen FROM nom_convenios WHERE id = convenio_global_id AND empresa_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'convenio global no encontrado';
  END IF;

  SELECT id INTO v_nuevo FROM nom_convenios WHERE empresa_id = v_empresa AND nombre = v_origen.nombre;
  IF FOUND THEN
    RETURN v_nuevo;
  END IF;

  INSERT INTO nom_convenios (empresa_id, nombre, regimen, descripcion)
  VALUES (v_empresa, v_origen.nombre, v_origen.regimen, v_origen.descripcion)
  RETURNING id INTO v_nuevo;

  INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde)
  SELECT v_nuevo, nombre, basico, vigencia_desde
  FROM nom_categorias WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_no_remunerativos (convenio_id, categoria_nombre, monto, vigencia_desde)
  SELECT v_nuevo, categoria_nombre, monto, vigencia_desde
  FROM nom_no_remunerativos WHERE convenio_id = convenio_global_id;

  INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config)
  SELECT v_empresa, v_nuevo, codigo, nombre, tipo, formula, orden, imprimible, categorias, config
  FROM nom_conceptos WHERE convenio_id = convenio_global_id AND empresa_id IS NULL;

  INSERT INTO nom_concepto_reglas (concepto_id, orden, condicion, formula)
  SELECT nc.id, r.orden, r.condicion, r.formula
  FROM nom_conceptos viejo
  JOIN nom_concepto_reglas r ON r.concepto_id = viejo.id
  JOIN nom_conceptos nc ON nc.convenio_id = v_nuevo AND nc.empresa_id = v_empresa AND nc.codigo = viejo.codigo
  WHERE viejo.convenio_id = convenio_global_id AND viejo.empresa_id IS NULL;

  UPDATE nom_legajo l SET
    convenio_id = v_nuevo,
    categoria_id = (
      SELECT nueva.id FROM nom_categorias vieja
      JOIN nom_categorias nueva
        ON nueva.convenio_id = v_nuevo
       AND nueva.nombre = vieja.nombre
       AND nueva.vigencia_desde = vieja.vigencia_desde
      WHERE vieja.id = l.categoria_id
    )
  WHERE l.empresa_id = v_empresa AND l.convenio_id = convenio_global_id;

  RETURN v_nuevo;
END $$;
REVOKE ALL ON FUNCTION clonar_convenio(UUID) FROM public;
GRANT EXECUTE ON FUNCTION clonar_convenio(UUID) TO authenticated;
```

- [ ] **Step 2: Pedir al usuario que la aplique en Supabase (SQL Editor) y espere confirmación**

No hay entorno local de Postgres. Mensaje al usuario: "Aplicá `0012_config_escalas.sql` en el SQL Editor de Supabase y confirmame". No avanzar a Task 4 (Edge Function) sin esta confirmación; Tasks 2-3 (motor puro) no dependen.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0012_config_escalas.sql
git commit -m "feat(db): nom_no_remunerativos, categorias/config en conceptos y clonar_convenio"
```

---

### Task 2: Motor — `no_remunerativo_acumulado` y `filtrarPorCategoria`

**Files:**
- Modify: `packages/motor/src/motor.ts`
- Test: `packages/motor/src/motor.test.ts`

- [ ] **Step 1: Escribir los tests que fallan** (agregar al final de `motor.test.ts`)

```ts
describe('no_remunerativo_acumulado', () => {
  it('acumula los no remunerativos ya liquidados y los expone como variable', () => {
    const conceptos: Concepto[] = [
      { codigo: 'nr1', nombre: 'Suma no rem', tipo: 'no_remunerativo', orden: 1, formula: '10000', imprimible: true },
      { codigo: 'os_nr', nombre: 'OS sobre no rem', tipo: 'descuento', orden: 2, formula: 'no_remunerativo_acumulado * 0.03', imprimible: true },
    ]
    const r = liquidarConceptos(conceptos, {})
    expect(r.items[1].monto).toBe(300)
  })

  it('arranca en 0 si no hubo no remunerativos previos', () => {
    const conceptos: Concepto[] = [
      { codigo: 'x', nombre: 'X', tipo: 'informativo', orden: 1, formula: 'no_remunerativo_acumulado', imprimible: true },
    ]
    expect(liquidarConceptos(conceptos, {}).items[0].monto).toBe(0)
  })
})

describe('filtrarPorCategoria', () => {
  const conceptos = [
    { codigo: 'a', categorias: null },
    { codigo: 'b', categorias: ['Oficial', 'Medio Oficial'] },
    { codigo: 'c', categorias: ['Ayudante'] },
    { codigo: 'd' },
  ]
  it('deja pasar los que no tienen categorias (null/undefined) y los que incluyen la categoría', () => {
    expect(filtrarPorCategoria(conceptos, 'Oficial').map((c) => c.codigo)).toEqual(['a', 'b', 'd'])
  })
  it('array vacío equivale a todas las categorías', () => {
    expect(filtrarPorCategoria([{ codigo: 'e', categorias: [] }], 'Oficial').map((c) => c.codigo)).toEqual(['e'])
  })
})
```

Importar `filtrarPorCategoria` en el import existente del test: `import { liquidarConceptos, filtrarPorCategoria, type Concepto } from './motor.ts'`.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run packages/motor/src/motor.test.ts`
Expected: FAIL — `filtrarPorCategoria` no exportada; monto 0 en vez de 300.

- [ ] **Step 3: Implementar en `motor.ts`**

En `Concepto`, agregar campo opcional:

```ts
  categorias?: string[] | null
```

En `liquidarConceptos`, junto a `remunerativoAcumulado`:

```ts
  let noRemunerativoAcumulado = 0
```

En `vars`:

```ts
    const vars: Record<string, number> = {
      ...variablesBase,
      remunerativo_acumulado: remunerativoAcumulado,
      no_remunerativo_acumulado: noRemunerativoAcumulado,
    }
```

En el `switch`, caso `no_remunerativo`:

```ts
      case 'no_remunerativo':
        noRemunerativoAcumulado += monto
        bruto += monto
        break
```

Al final del archivo:

```ts
// Conceptos aplicables a una categoría: sin `categorias` (null/undefined/[])
// el concepto aplica a todas; con valores, solo si incluye la categoría.
export function filtrarPorCategoria<T extends { categorias?: string[] | null }>(
  conceptos: T[],
  categoriaNombre: string
): T[] {
  return conceptos.filter(
    (c) => !c.categorias || c.categorias.length === 0 || c.categorias.includes(categoriaNombre)
  )
}
```

- [ ] **Step 4: Correr todos los tests del motor**

Run: `npx vitest run packages/motor`
Expected: PASS (todos, incluidos los previos).

- [ ] **Step 5: Commit**

```bash
git add packages/motor/src/motor.ts packages/motor/src/motor.test.ts
git commit -m "feat(motor): no_remunerativo_acumulado y filtrarPorCategoria"
```

---

### Task 3: Motor — `generarFormula(config)`

**Files:**
- Create: `packages/motor/src/formulas.ts`
- Test: `packages/motor/src/formulas.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
import { describe, it, expect } from 'vitest'
import { generarFormula, type ConfigConcepto } from './formulas.ts'
import { evaluar } from './interprete.ts'

describe('generarFormula', () => {
  it('nominal devuelve el monto como literal', () => {
    expect(generarFormula({ modo: 'nominal', monto: 15000 })).toBe('15000')
  })

  it('porcentaje sobre remunerativo', () => {
    expect(generarFormula({ modo: 'porcentaje', porcentaje: 11, base: 'remunerativo' }))
      .toBe('remunerativo_acumulado * 0.11')
  })

  it('porcentaje sobre no remunerativo', () => {
    expect(generarFormula({ modo: 'porcentaje', porcentaje: 3, base: 'no_remunerativo' }))
      .toBe('no_remunerativo_acumulado * 0.03')
  })

  it('porcentaje sobre ambos', () => {
    expect(generarFormula({ modo: 'porcentaje', porcentaje: 9, base: 'ambos' }))
      .toBe('(remunerativo_acumulado + no_remunerativo_acumulado) * 0.09')
  })

  it('porcentaje con tope aplica min(base, tope)', () => {
    expect(generarFormula({ modo: 'porcentaje', porcentaje: 11, base: 'remunerativo', tope: 'tope_sipa' }))
      .toBe('min(remunerativo_acumulado, tope_sipa) * 0.11')
  })

  it('las fórmulas generadas son evaluables por el intérprete', () => {
    const configs: ConfigConcepto[] = [
      { modo: 'nominal', monto: 500.5 },
      { modo: 'porcentaje', porcentaje: 11, base: 'remunerativo', tope: 'tope_sipa' },
      { modo: 'porcentaje', porcentaje: 9, base: 'ambos' },
    ]
    const vars = { remunerativo_acumulado: 1000000, no_remunerativo_acumulado: 100000, tope_sipa: 800000 }
    for (const c of configs) {
      expect(typeof evaluar(generarFormula(c), vars)).toBe('number')
    }
  })

  it('rechaza configs incompletas', () => {
    expect(() => generarFormula({ modo: 'nominal' } as ConfigConcepto)).toThrow()
    expect(() => generarFormula({ modo: 'porcentaje', base: 'remunerativo' } as ConfigConcepto)).toThrow()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run packages/motor/src/formulas.test.ts`
Expected: FAIL — módulo `formulas.ts` inexistente.

- [ ] **Step 3: Implementar `packages/motor/src/formulas.ts`**

```ts
// Generador de fórmulas para el formulario estructurado de conceptos.
// Es la ÚNICA vía por la que la UI produce fórmulas: el usuario nunca
// tipea una fórmula libre (spec 2026-07-21, sección 5). Módulo puro y
// autocontenido para que el bundle del cliente no arrastre el motor.

export interface ConfigConcepto {
  modo: 'porcentaje' | 'nominal'
  porcentaje?: number
  base?: 'remunerativo' | 'no_remunerativo' | 'ambos'
  tope?: string | null
  monto?: number
}

const BASES: Record<string, string> = {
  remunerativo: 'remunerativo_acumulado',
  no_remunerativo: 'no_remunerativo_acumulado',
  ambos: '(remunerativo_acumulado + no_remunerativo_acumulado)',
}

export function generarFormula(config: ConfigConcepto): string {
  if (config.modo === 'nominal') {
    if (typeof config.monto !== 'number' || !Number.isFinite(config.monto)) {
      throw new Error('config nominal requiere monto numérico')
    }
    return String(config.monto)
  }
  if (typeof config.porcentaje !== 'number' || !Number.isFinite(config.porcentaje)) {
    throw new Error('config porcentual requiere porcentaje numérico')
  }
  const base = BASES[config.base ?? 'remunerativo']
  if (!base) throw new Error(`base desconocida: ${config.base}`)
  const baseConTope = config.tope ? `min(${base}, ${config.tope})` : base
  return `${baseConTope} * ${config.porcentaje / 100}`
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run packages/motor/src/formulas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/motor/src/formulas.ts packages/motor/src/formulas.test.ts
git commit -m "feat(motor): generarFormula para conceptos estructurados"
```

---

### Task 4: Edge Function — `no_rem_convenio` y filtrado por convenio/categoría

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts`

Requiere la migración 0012 aplicada (Task 1 Step 2). Sin tests automáticos (no hay harness de Edge Functions en el repo); la verificación es el recálculo end-to-end de Task 10.

- [ ] **Step 1: Importar `filtrarPorCategoria`** (línea 3)

```ts
import { liquidarConceptos, filtrarPorCategoria, type Concepto } from '../../../packages/motor/src/motor.ts'
```

- [ ] **Step 2: Mapear `convenio_id` y `categorias` en los conceptos** (reemplaza el mapeo de `conceptosMotor`, líneas 50-53)

```ts
  type ConceptoConConvenio = Concepto & { convenioId: string | null }
  const conceptosMotor: ConceptoConConvenio[] = (conceptos || []).map((c: any) => ({
    codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, orden: c.orden, formula: c.formula, imprimible: c.imprimible,
    categorias: c.categorias ?? null, convenioId: c.convenio_id ?? null,
    reglas: (c.nom_concepto_reglas || []).map((r: any) => ({ orden: r.orden, condicion: r.condicion, formula: r.formula })),
  }))
```

- [ ] **Step 3: Resolver nombre de categoría y `no_rem_convenio` vigente** (dentro del bloque `if (categoriaIds.length > 0)`, después del loop de básicos, y declarando los mapas junto a `basicoPorCategoria`)

```ts
  const nombrePorCategoria = new Map<string, string>()
  const noRemPorCategoria = new Map<string, number>()
```

Dentro del `for (const cat of cats || [])`, después de setear `basicoPorCategoria`:

```ts
      nombrePorCategoria.set(cat.id, cat.nombre)
      const { data: nr } = await supabase.from('nom_no_remunerativos').select('monto')
        .eq('convenio_id', cat.convenio_id).eq('categoria_nombre', cat.nombre)
        .lte('vigencia_desde', periodo.fecha_hasta)
        .order('vigencia_desde', { ascending: false }).limit(1)
      noRemPorCategoria.set(cat.id, Number(nr?.[0]?.monto ?? 0))
```

- [ ] **Step 4: Filtrar conceptos por convenio y categoría del legajo, y pasar `no_rem_convenio`** (en el loop de personas, reemplaza `const resultado = liquidarConceptos(conceptosMotor, variablesBase)`)

En `variablesBase`, agregar:

```ts
      no_rem_convenio: noRemPorCategoria.get(legajo.categoria_id) ?? 0,
```

Y el llamado:

```ts
    // Solo conceptos del convenio del legajo (evita duplicar plantilla
    // global + copia de empresa tras clonar_convenio) y de su categoría.
    const conceptosLegajo = filtrarPorCategoria(
      conceptosMotor.filter((c) => c.convenioId === legajo.convenio_id),
      nombrePorCategoria.get(legajo.categoria_id) ?? ''
    )
    const resultado = liquidarConceptos(conceptosLegajo, variablesBase)
```

- [ ] **Step 5: Deploy y commit**

```bash
npx supabase functions deploy liquidar-periodo
git add supabase/functions/liquidar-periodo/index.ts
git commit -m "feat(liquidacion): no_rem_convenio por categoria y filtrado de conceptos por convenio/categoria"
```

Si el deploy falla por credenciales, pedirle al usuario que lo corra él (mismo flujo que el deploy anterior).

---

### Task 5: `conveniosStore`

**Files:**
- Create: `src/store/conveniosStore.js`
- Test: `src/store/__tests__/conveniosStore.test.js`

- [ ] **Step 1: Test de mappers que falla**

```js
import { describe, it, expect } from 'vitest'
import { convenioFromDB } from '../conveniosStore'

describe('mappers de convenios', () => {
  it('convenioFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'cv1', empresa_id: null, nombre: 'UOCRA', regimen: 'ley_22250', descripcion: 'Construcción' }
    expect(convenioFromDB(row)).toEqual({ id: 'cv1', empresaId: null, nombre: 'UOCRA', regimen: 'ley_22250', descripcion: 'Construcción' })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/store/__tests__/conveniosStore.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/store/conveniosStore.js`**

```js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const convenioFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, nombre: r.nombre, regimen: r.regimen, descripcion: r.descripcion,
})

export const useConveniosStore = create((set) => ({
  convenios: [], cargando: false, error: null,

  cargarConvenios: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_convenios').select('*')
      .or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order('nombre')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ convenios: (data || []).map(convenioFromDB), cargando: false })
  },

  // Clona un convenio global a la empresa (función SQL SECURITY DEFINER,
  // migración 0012). Devuelve el id del convenio propio.
  clonarConvenio: async (convenioGlobalId) => {
    const { data, error } = await supabase.rpc('clonar_convenio', { convenio_global_id: convenioGlobalId })
    if (error) return { ok: false, error: error.message }
    return { ok: true, convenioId: data }
  },
}))
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/store/__tests__/conveniosStore.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/conveniosStore.js src/store/__tests__/conveniosStore.test.js
git commit -m "feat(config): conveniosStore con clonado de convenio global"
```

---

### Task 6: `escalasStore` y `noRemunerativosStore` (+ agrupador de vigencias)

**Files:**
- Create: `src/store/escalasStore.js`
- Create: `src/store/noRemunerativosStore.js`
- Test: `src/store/__tests__/escalasStore.test.js`

Ambos stores comparten la lógica "filas versionadas por (nombre, vigencia_desde)". El agrupador `agruparVigencias` es una función pura exportada desde `escalasStore.js` y reutilizada por el otro store y por `TablaVigencias`.

- [ ] **Step 1: Tests que fallan**

```js
import { describe, it, expect } from 'vitest'
import { agruparVigencias, categoriaFromDB } from '../escalasStore'

describe('agruparVigencias', () => {
  it('agrupa por nombre con el valor vigente (mayor vigencia <= hoy) y el historial ordenado', () => {
    const filas = [
      { nombre: 'Oficial', valor: 100, vigenciaDesde: '2026-01-01' },
      { nombre: 'Oficial', valor: 120, vigenciaDesde: '2026-06-01' },
      { nombre: 'Oficial', valor: 990, vigenciaDesde: '2099-01-01' }, // futura: no es la vigente
      { nombre: 'Ayudante', valor: 80, vigenciaDesde: '2026-01-01' },
    ]
    const g = agruparVigencias(filas, '2026-07-21')
    expect(g).toEqual([
      {
        nombre: 'Ayudante', vigente: { valor: 80, vigenciaDesde: '2026-01-01' },
        historial: [{ valor: 80, vigenciaDesde: '2026-01-01' }],
      },
      {
        nombre: 'Oficial', vigente: { valor: 120, vigenciaDesde: '2026-06-01' },
        historial: [
          { valor: 990, vigenciaDesde: '2099-01-01' },
          { valor: 120, vigenciaDesde: '2026-06-01' },
          { valor: 100, vigenciaDesde: '2026-01-01' },
        ],
      },
    ])
  })

  it('sin vigencia aplicable, vigente es null', () => {
    const g = agruparVigencias([{ nombre: 'X', valor: 1, vigenciaDesde: '2099-01-01' }], '2026-07-21')
    expect(g[0].vigente).toBeNull()
  })
})

describe('categoriaFromDB', () => {
  it('mapea basico numérico', () => {
    expect(categoriaFromDB({ id: 'k1', convenio_id: 'cv1', nombre: 'Oficial', basico: '123.45', vigencia_desde: '2026-06-01' }))
      .toEqual({ id: 'k1', convenioId: 'cv1', nombre: 'Oficial', valor: 123.45, vigenciaDesde: '2026-06-01' })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/store/__tests__/escalasStore.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/store/escalasStore.js`**

```js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Fila genérica versionada: { nombre, valor, vigenciaDesde }
export const categoriaFromDB = (r) => ({
  id: r.id, convenioId: r.convenio_id, nombre: r.nombre, valor: Number(r.basico), vigenciaDesde: r.vigencia_desde,
})

// Agrupa filas versionadas por nombre: vigente = mayor vigenciaDesde <= hoy;
// historial completo ordenado descendente. Orden alfabético por nombre.
export function agruparVigencias(filas, hoy) {
  const porNombre = new Map()
  for (const f of filas) {
    if (!porNombre.has(f.nombre)) porNombre.set(f.nombre, [])
    porNombre.get(f.nombre).push({ valor: f.valor, vigenciaDesde: f.vigenciaDesde })
  }
  return [...porNombre.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([nombre, versiones]) => {
      const historial = [...versiones].sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde))
      const vigente = historial.find((v) => v.vigenciaDesde <= hoy) ?? null
      return { nombre, vigente, historial }
    })
}

export const useEscalasStore = create((set) => ({
  categorias: [], cargando: false, error: null,

  cargarEscala: async (convenioId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_categorias').select('*')
      .eq('convenio_id', convenioId).order('nombre').order('vigencia_desde', { ascending: false })
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ categorias: (data || []).map(categoriaFromDB), cargando: false })
  },

  // Alta de una vigencia nueva para varias categorías a la vez (paritaria).
  // filas: [{ nombre, valor }]. Nunca se actualiza una fila existente.
  guardarVigencias: async (convenioId, filas, vigenciaDesde) => {
    const rows = filas.map((f) => ({
      convenio_id: convenioId, nombre: f.nombre, basico: f.valor, vigencia_desde: vigenciaDesde,
    }))
    const { error } = await supabase.from('nom_categorias').insert(rows)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}))
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/store/__tests__/escalasStore.test.js`
Expected: PASS.

- [ ] **Step 5: Implementar `src/store/noRemunerativosStore.js`** (mismo patrón sobre `nom_no_remunerativos`)

```js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const noRemFromDB = (r) => ({
  id: r.id, convenioId: r.convenio_id, nombre: r.categoria_nombre, valor: Number(r.monto), vigenciaDesde: r.vigencia_desde,
})

export const useNoRemunerativosStore = create((set) => ({
  noRemunerativos: [], cargando: false, error: null,

  cargarNoRemunerativos: async (convenioId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_no_remunerativos').select('*')
      .eq('convenio_id', convenioId).order('categoria_nombre').order('vigencia_desde', { ascending: false })
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ noRemunerativos: (data || []).map(noRemFromDB), cargando: false })
  },

  guardarVigencias: async (convenioId, filas, vigenciaDesde) => {
    const rows = filas.map((f) => ({
      convenio_id: convenioId, categoria_nombre: f.nombre, monto: f.valor, vigencia_desde: vigenciaDesde,
    }))
    const { error } = await supabase.from('nom_no_remunerativos').insert(rows)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}))
```

- [ ] **Step 6: Correr toda la suite y commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add src/store/escalasStore.js src/store/noRemunerativosStore.js src/store/__tests__/escalasStore.test.js
git commit -m "feat(config): stores de escalas y no remunerativos con vigencias versionadas"
```

---

### Task 7: `parametrosStore`

**Files:**
- Create: `src/store/parametrosStore.js`
- Test: `src/store/__tests__/parametrosStore.test.js`

- [ ] **Step 1: Test de mappers que falla**

```js
import { describe, it, expect } from 'vitest'
import { parametroFromDB, parametroToDB } from '../parametrosStore'

describe('mappers de parametros', () => {
  it('parametroFromDB mapea snake_case y castea valor', () => {
    expect(parametroFromDB({ id: 'p1', empresa_id: 'e1', codigo: 'tope_sipa', valor: '123.4', vigencia_desde: '2026-01-01', vigencia_hasta: null }))
      .toEqual({ id: 'p1', empresaId: 'e1', codigo: 'tope_sipa', valor: 123.4, vigenciaDesde: '2026-01-01', vigenciaHasta: null })
  })
  it('parametroToDB arma la fila con empresa_id explícito', () => {
    expect(parametroToDB({ codigo: 'tope_sipa', valor: 100, vigenciaDesde: '2026-01-01', vigenciaHasta: null }, 'e1'))
      .toEqual({ empresa_id: 'e1', codigo: 'tope_sipa', valor: 100, vigencia_desde: '2026-01-01', vigencia_hasta: null })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/store/__tests__/parametrosStore.test.js`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/store/parametrosStore.js`**

```js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const parametroFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, codigo: r.codigo, valor: Number(r.valor),
  vigenciaDesde: r.vigencia_desde, vigenciaHasta: r.vigencia_hasta,
})

export const parametroToDB = (p, empresaId) => ({
  empresa_id: empresaId, codigo: p.codigo, valor: p.valor,
  vigencia_desde: p.vigenciaDesde, vigencia_hasta: p.vigenciaHasta ?? null,
})

export const useParametrosStore = create((set, get) => ({
  parametros: [], cargando: false, error: null,

  cargarParametros: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_parametros').select('*')
      .eq('empresa_id', empresaId).order('codigo').order('vigencia_desde', { ascending: false })
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ parametros: (data || []).map(parametroFromDB), cargando: false })
  },

  // Versionado: siempre INSERT de una vigencia nueva, nunca UPDATE.
  guardarParametro: async (parametro, empresaId) => {
    const { error } = await supabase.from('nom_parametros').insert(parametroToDB(parametro, empresaId))
    if (error) return { ok: false, error: error.message }
    await get().cargarParametros(empresaId)
    return { ok: true }
  },
}))
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/store/__tests__/parametrosStore.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/parametrosStore.js src/store/__tests__/parametrosStore.test.js
git commit -m "feat(config): parametrosStore versionado (tope_sipa y otros)"
```

---

### Task 8: `conceptosStore` — `categorias`, `config` y recarga tras guardar

**Files:**
- Modify: `src/store/conceptosStore.js`
- Test: `src/store/__tests__/conceptosStore.test.js`

- [ ] **Step 1: Extender los tests existentes** (agregar al describe existente)

```js
  it('conceptoFromDB incluye categorias y config', () => {
    const row = {
      id: 'c9', empresa_id: 'e1', convenio_id: 'cv1', codigo: 'adic_titulo', nombre: 'Adicional título',
      tipo: 'remunerativo', formula: 'remunerativo_acumulado * 0.05', orden: 10, imprimible: true,
      categorias: ['Oficial'], config: { modo: 'porcentaje', porcentaje: 5, base: 'remunerativo' },
      nom_concepto_reglas: [],
    }
    const r = conceptoFromDB(row)
    expect(r.categorias).toEqual(['Oficial'])
    expect(r.config).toEqual({ modo: 'porcentaje', porcentaje: 5, base: 'remunerativo' })
  })

  it('conceptoToDB serializa categorias y config (null si faltan)', () => {
    const c = { codigo: 'x', nombre: 'X', tipo: 'remunerativo', formula: '1', orden: 1, convenioId: 'cv1' }
    const row = conceptoToDB(c, 'e1')
    expect(row.categorias).toBeNull()
    expect(row.config).toBeNull()
  })
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/store/__tests__/conceptosStore.test.js`
Expected: FAIL — `categorias`/`config` undefined.

- [ ] **Step 3: Implementar** (en `conceptosStore.js`)

En `conceptoFromDB`, agregar al objeto devuelto:

```js
  categorias: r.categorias ?? null, config: r.config ?? null,
```

En `conceptoToDB`, agregar:

```js
  categorias: c.categorias ?? null, config: c.config ?? null,
```

Y en `guardarConcepto`, tras el guardado exitoso, refrescar la lista para que la UI quede consistente (reemplazar el `return { ok: true, ... }`):

```js
    const { data, error } = await query
    if (error) return { ok: false, error: error.message }
    await useConceptosStore.getState().cargarConceptos(empresaId)
    return { ok: true, concepto: conceptoFromDB(data) }
```

**Ojo:** los tests existentes de `conceptoFromDB`/`conceptoToDB` usan `toEqual` con el objeto completo — hay que actualizar esos dos tests agregando `categorias: null, config: null` a los objetos esperados.

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/store/__tests__/conceptosStore.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/conceptosStore.js src/store/__tests__/conceptosStore.test.js
git commit -m "feat(config): categorias y config en conceptosStore"
```

---

### Task 9: `TablaVigencias` (componente compartido)

**Files:**
- Create: `src/components/config/TablaVigencias.jsx`
- Test: `src/components/config/__tests__/TablaVigencias.test.jsx`

Componente genérico para Escalas y No remunerativos: muestra filas agrupadas (`agruparVigencias`), historial expandible, y un formulario "Nueva vigencia" que precarga los nombres actuales (carga de paritaria completa) y permite agregar una categoría nueva.

- [ ] **Step 1: Test que falla** (mismo estilo que `EditorReglas.test.jsx`, con testing-library)

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TablaVigencias from '../TablaVigencias'

const items = [
  { nombre: 'Ayudante', vigente: { valor: 80, vigenciaDesde: '2026-01-01' }, historial: [{ valor: 80, vigenciaDesde: '2026-01-01' }] },
  { nombre: 'Oficial', vigente: null, historial: [] },
]

describe('TablaVigencias', () => {
  it('muestra el valor vigente y "sin valor" cuando no hay vigencia', () => {
    render(<TablaVigencias items={items} etiquetaValor="Básico" soloLectura onGuardar={() => {}} />)
    expect(screen.getByText('Ayudante')).toBeInTheDocument()
    expect(screen.getByText('$ 80')).toBeInTheDocument()
    expect(screen.getByText('sin valor')).toBeInTheDocument()
  })

  it('en solo lectura no ofrece "Nueva vigencia"', () => {
    render(<TablaVigencias items={items} etiquetaValor="Básico" soloLectura onGuardar={() => {}} />)
    expect(screen.queryByText('Nueva vigencia')).toBeNull()
  })

  it('el formulario precarga los nombres y llama onGuardar con filas y fecha', () => {
    const onGuardar = vi.fn().mockResolvedValue({ ok: true })
    render(<TablaVigencias items={items} etiquetaValor="Básico" soloLectura={false} onGuardar={onGuardar} />)
    fireEvent.click(screen.getByText('Nueva vigencia'))
    const inputs = screen.getAllByPlaceholderText('monto')
    fireEvent.change(inputs[0], { target: { value: '100' } })
    fireEvent.change(inputs[1], { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText('vigencia desde'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByText('Guardar vigencia'))
    expect(onGuardar).toHaveBeenCalledWith(
      [{ nombre: 'Ayudante', valor: 100 }, { nombre: 'Oficial', valor: 150 }],
      '2026-08-01'
    )
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/config/__tests__/TablaVigencias.test.jsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/components/config/TablaVigencias.jsx`**

```jsx
import { useState } from 'react'

const fmt = (n) => `$ ${Number(n).toLocaleString('es-AR')}`

// items: salida de agruparVigencias → [{ nombre, vigente, historial }]
// onGuardar(filas, vigenciaDesde) → { ok, error? }
export default function TablaVigencias({ items, etiquetaValor, soloLectura, onGuardar }) {
  const [abierto, setAbierto] = useState(false)
  const [valores, setValores] = useState({})       // nombre -> monto tipeado
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [vigenciaDesde, setVigenciaDesde] = useState('')
  const [expandido, setExpandido] = useState(null) // nombre con historial visible
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(false)

  const nombres = [...items.map((i) => i.nombre), ...(nuevoNombre.trim() ? [nuevoNombre.trim()] : [])]

  const guardar = async () => {
    const filas = nombres
      .filter((n) => valores[n] !== undefined && valores[n] !== '')
      .map((n) => ({ nombre: n, valor: Number(valores[n]) }))
    if (filas.length === 0 || !vigenciaDesde) { setError('Cargá al menos un monto y la fecha de vigencia'); return }
    if (filas.some((f) => !Number.isFinite(f.valor))) { setError('Hay montos inválidos'); return }
    setGuardando(true); setError(null)
    const r = await onGuardar(filas, vigenciaDesde)
    setGuardando(false)
    if (!r?.ok) { setError(r?.error || 'No se pudo guardar'); return }
    setAbierto(false); setValores({}); setNuevoNombre('')
  }

  return (
    <div>
      <table className="table" style={{ width: '100%' }}>
        <thead>
          <tr><th style={{ textAlign: 'left' }}>Categoría</th><th style={{ textAlign: 'right' }}>{etiquetaValor} vigente</th><th /></tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <FilaCategoria key={i.nombre} item={i} expandido={expandido === i.nombre}
              onToggle={() => setExpandido(expandido === i.nombre ? null : i.nombre)} />
          ))}
        </tbody>
      </table>

      {!soloLectura && !abierto && (
        <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => setAbierto(true)}>Nueva vigencia</button>
      )}
      {!soloLectura && abierto && (
        <div className="card" style={{ marginTop: 10 }}>
          {nombres.map((n) => (
            <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{n}</span>
              <input className="input" type="number" placeholder="monto" style={{ width: 140 }}
                value={valores[n] ?? ''} onChange={(e) => setValores((v) => ({ ...v, [n]: e.target.value }))} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <input className="input" placeholder="agregar categoría nueva…" value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)} />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              vigencia desde
              <input className="input" type="date" aria-label="vigencia desde" value={vigenciaDesde}
                onChange={(e) => setVigenciaDesde(e.target.value)} />
            </label>
          </div>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando}>Guardar vigencia</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function FilaCategoria({ item, expandido, onToggle }) {
  return (
    <>
      <tr>
        <td>{item.nombre}</td>
        <td style={{ textAlign: 'right' }}>
          {item.vigente ? fmt(item.vigente.valor) : <span className="badge badge-warning">sin valor</span>}
        </td>
        <td style={{ textAlign: 'right' }}>
          {item.historial.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={onToggle}>{expandido ? 'ocultar' : 'historial'}</button>
          )}
        </td>
      </tr>
      {expandido && item.historial.map((h) => (
        <tr key={h.vigenciaDesde} style={{ color: 'var(--text-secondary)' }}>
          <td style={{ paddingLeft: 24 }}>desde {h.vigenciaDesde}</td>
          <td style={{ textAlign: 'right' }}>{fmt(h.valor)}</td>
          <td />
        </tr>
      ))}
    </>
  )
}
```

Nota: el test espera `$ 80` — `toLocaleString('es-AR')` de 80 es "80", así que el texto es "$ 80". Si la clase `table` no existe en el CSS del proyecto, usar la que usen las tablas de `LiquidacionPage.jsx` (verificar al implementar).

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/components/config/__tests__/TablaVigencias.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/config/TablaVigencias.jsx src/components/config/__tests__/TablaVigencias.test.jsx
git commit -m "feat(config): TablaVigencias compartida para escalas y no remunerativos"
```

---

### Task 10: `ConfiguracionPage` con pestañas + Escalas + No remunerativos + clonado

**Files:**
- Modify: `src/pages/ConfiguracionPage.jsx` (reescritura)
- Create: `src/components/config/TabEscalas.jsx`
- Create: `src/components/config/TabNoRemunerativos.jsx`

Sin tests de componente nuevos (la lógica pura ya está testeada en stores y TablaVigencias); verificación visual en Step 4.

- [ ] **Step 1: `TabEscalas.jsx`**

```jsx
import { useEffect } from 'react'
import { useEscalasStore, agruparVigencias } from '../../store/escalasStore'
import TablaVigencias from './TablaVigencias'

export default function TabEscalas({ convenio, soloLectura }) {
  const { categorias, cargando, error, cargarEscala, guardarVigencias } = useEscalasStore()

  useEffect(() => { if (convenio?.id) cargarEscala(convenio.id) }, [convenio?.id])

  if (!convenio) return null
  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const hoy = new Date().toISOString().slice(0, 10)
  return (
    <div className="card">
      <TablaVigencias
        items={agruparVigencias(categorias, hoy)}
        etiquetaValor="Básico"
        soloLectura={soloLectura}
        onGuardar={async (filas, fecha) => {
          const r = await guardarVigencias(convenio.id, filas, fecha)
          if (r.ok) await cargarEscala(convenio.id)
          return r
        }}
      />
    </div>
  )
}
```

- [ ] **Step 2: `TabNoRemunerativos.jsx`** (idéntico patrón, otro store)

```jsx
import { useEffect } from 'react'
import { useNoRemunerativosStore } from '../../store/noRemunerativosStore'
import { agruparVigencias } from '../../store/escalasStore'
import TablaVigencias from './TablaVigencias'

export default function TabNoRemunerativos({ convenio, soloLectura }) {
  const { noRemunerativos, cargando, error, cargarNoRemunerativos, guardarVigencias } = useNoRemunerativosStore()

  useEffect(() => { if (convenio?.id) cargarNoRemunerativos(convenio.id) }, [convenio?.id])

  if (!convenio) return null
  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const hoy = new Date().toISOString().slice(0, 10)
  return (
    <div className="card">
      <p style={{ color: 'var(--text-secondary)' }}>
        Sumas no remunerativas por categoría (acuerdos/paritarias). El valor del período es el vigente a su fecha de cierre.
      </p>
      <TablaVigencias
        items={agruparVigencias(noRemunerativos, hoy)}
        etiquetaValor="Monto no rem."
        soloLectura={soloLectura}
        onGuardar={async (filas, fecha) => {
          const r = await guardarVigencias(convenio.id, filas, fecha)
          if (r.ok) await cargarNoRemunerativos(convenio.id)
          return r
        }}
      />
    </div>
  )
}
```

- [ ] **Step 3: Reescribir `ConfiguracionPage.jsx`** (pestañas, selector de convenio, banner de clonado; las pestañas Aportes/Adicionales/Parámetros se agregan en Tasks 11-12 — por ahora renderizan `null`)

```jsx
import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useConveniosStore } from '../store/conveniosStore'
import TabEscalas from '../components/config/TabEscalas'
import TabNoRemunerativos from '../components/config/TabNoRemunerativos'

const PESTANAS = ['Escalas salariales', 'No remunerativos', 'Aportes y contribuciones', 'Adicionales', 'Parámetros']

export default function ConfiguracionPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const empresaActiva = empresa || empresaVista
  const { convenios, cargarConvenios, clonarConvenio } = useConveniosStore()
  const [convenioId, setConvenioId] = useState(null)
  const [pestana, setPestana] = useState(PESTANAS[0])
  const [clonando, setClonando] = useState(false)
  const [errorClonado, setErrorClonado] = useState(null)

  useEffect(() => { if (empresaActiva?.id) cargarConvenios(empresaActiva.id) }, [empresaActiva?.id])
  // Selección por defecto: el primer convenio propio; si no hay, el primero global.
  useEffect(() => {
    if (!convenioId && convenios.length > 0) {
      const propio = convenios.find((c) => c.empresaId === empresaActiva?.id)
      setConvenioId((propio || convenios[0]).id)
    }
  }, [convenios, convenioId, empresaActiva?.id])

  const convenio = convenios.find((c) => c.id === convenioId) || null
  const esGlobal = convenio?.empresaId === null

  const personalizar = async () => {
    setClonando(true); setErrorClonado(null)
    const r = await clonarConvenio(convenio.id)
    setClonando(false)
    if (!r.ok) { setErrorClonado(r.error); return }
    await cargarConvenios(empresaActiva.id)
    setConvenioId(r.convenioId)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Configuración</h1>
        <p className="page-subtitle">Escalas, no remunerativos, aportes, adicionales y parámetros</p>
      </div>

      {!empresaActiva && (
        <div className="card">Elegí una empresa en Superadmin → "Entrar" para ver su configuración.</div>
      )}

      {empresaActiva && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <select className="input" style={{ maxWidth: 320 }} value={convenioId ?? ''} onChange={(e) => setConvenioId(e.target.value)}>
              {convenios.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}{c.empresaId === null ? ' (plantilla)' : ''}</option>
              ))}
            </select>
            {esGlobal && (
              <button className="btn btn-primary btn-sm" onClick={personalizar} disabled={clonando}>
                {clonando ? 'Clonando…' : 'Personalizar convenio'}
              </button>
            )}
          </div>
          {esGlobal && (
            <div className="card" style={{ marginBottom: 12 }}>
              Este convenio es una plantilla de solo lectura. "Personalizar convenio" crea una copia propia de tu empresa
              (categorías, conceptos y reglas incluidos) y re-apunta tus legajos para poder editarla.
            </div>
          )}
          {errorClonado && <div className="card" style={{ color: 'var(--danger)' }}>Error al clonar: {errorClonado}</div>}

          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {PESTANAS.map((p) => (
              <button key={p} className={`btn btn-sm ${pestana === p ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPestana(p)}>{p}</button>
            ))}
          </div>

          {pestana === 'Escalas salariales' && <TabEscalas convenio={convenio} soloLectura={esGlobal} />}
          {pestana === 'No remunerativos' && <TabNoRemunerativos convenio={convenio} soloLectura={esGlobal} />}
          {pestana === 'Aportes y contribuciones' && null}
          {pestana === 'Adicionales' && null}
          {pestana === 'Parámetros' && null}
        </>
      )}
    </div>
  )
}
```

**Nota:** la página anterior mostraba los conceptos con `EditorReglas` — ese contenido pasa a la pestaña "Aportes y contribuciones" (Task 11), donde `EditorReglas` se conserva dentro de la card de cada concepto.

- [ ] **Step 4: Verificación visual + suite**

Run: `npx vitest run` → PASS. `npm run build` → sin errores.
Pedir al usuario que verifique en la app: pestañas visibles, selector de convenio, banner de plantilla, carga de escala (solo lectura) y clonado (requiere migración 0012 aplicada).

- [ ] **Step 5: Commit**

```bash
git add src/pages/ConfiguracionPage.jsx src/components/config/TabEscalas.jsx src/components/config/TabNoRemunerativos.jsx
git commit -m "feat(config): pestañas de configuracion con escalas, no remunerativos y clonado de convenio"
```

---

### Task 11: Pestañas "Aportes y contribuciones" y "Adicionales"

**Files:**
- Create: `src/components/config/FormularioConcepto.jsx` (formulario estructurado compartido)
- Create: `src/components/config/TabAportes.jsx`
- Create: `src/components/config/TabAdicionales.jsx`
- Modify: `src/pages/ConfiguracionPage.jsx` (conectar pestañas)
- Test: `src/components/config/__tests__/FormularioConcepto.test.jsx`

- [ ] **Step 1: Test del validador que falla**

`FormularioConcepto` exporta `validarYGenerarFormula(config)`: genera la fórmula con `generarFormula` y la evalúa con el intérprete real sobre valores de ejemplo (incluyendo el tope si lo hay). Si algo falla, devuelve el error.

```jsx
import { describe, it, expect } from 'vitest'
import { validarYGenerarFormula } from '../FormularioConcepto'

describe('validarYGenerarFormula', () => {
  it('devuelve la fórmula para un config válido', () => {
    const r = validarYGenerarFormula({ modo: 'porcentaje', porcentaje: 11, base: 'remunerativo', tope: 'tope_sipa' })
    expect(r).toEqual({ ok: true, formula: 'min(remunerativo_acumulado, tope_sipa) * 0.11' })
  })
  it('devuelve error para un config inválido', () => {
    const r = validarYGenerarFormula({ modo: 'porcentaje', base: 'remunerativo' })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run src/components/config/__tests__/FormularioConcepto.test.jsx`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `FormularioConcepto.jsx`**

```jsx
import { useState } from 'react'
import { generarFormula } from '../../../packages/motor/src/formulas.ts'
import { evaluar } from '../../../packages/motor/src/interprete.ts'

// Valida generando la fórmula y evaluándola con el intérprete REAL del
// motor sobre valores de ejemplo. Si el intérprete no la acepta, no se
// guarda (spec sección 5). Los valores de ejemplo incluyen el tope que
// referencie el config para que la variable exista al evaluar.
export function validarYGenerarFormula(config) {
  try {
    const formula = generarFormula(config)
    const vars = { remunerativo_acumulado: 1000000, no_remunerativo_acumulado: 100000 }
    if (config.tope) vars[config.tope] = 800000
    evaluar(formula, vars)
    return { ok: true, formula }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Formulario estructurado de un concepto. Props:
//  concepto: existente (con config) o null para alta
//  categorias: nombres disponibles del convenio (para el multiselect; null = ocultar)
//  conMonto: permitir modo nominal (Adicionales sí, Aportes no)
//  onGuardar({ config, formula, categorias }) → { ok, error? }
export default function FormularioConcepto({ concepto, categorias, conMonto, onGuardar }) {
  const cfg = concepto?.config || {}
  const [modo, setModo] = useState(cfg.modo || 'porcentaje')
  const [porcentaje, setPorcentaje] = useState(cfg.porcentaje ?? '')
  const [base, setBase] = useState(cfg.base || 'remunerativo')
  const [conTope, setConTope] = useState(Boolean(cfg.tope))
  const [monto, setMonto] = useState(cfg.monto ?? '')
  const [seleccion, setSeleccion] = useState(concepto?.categorias || [])
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    const config = modo === 'nominal'
      ? { modo, monto: Number(monto) }
      : { modo, porcentaje: Number(porcentaje), base, tope: conTope ? 'tope_sipa' : null }
    const v = validarYGenerarFormula(config)
    if (!v.ok) { setError(v.error); return }
    setGuardando(true); setError(null)
    const r = await onGuardar({ config, formula: v.formula, categorias: seleccion.length > 0 ? seleccion : null })
    setGuardando(false)
    if (!r?.ok) setError(r?.error || 'No se pudo guardar')
  }

  return (
    <div style={{ marginTop: 8 }}>
      {conMonto && (
        <select className="input" style={{ marginBottom: 6 }} value={modo} onChange={(e) => setModo(e.target.value)}>
          <option value="porcentaje">Porcentual</option>
          <option value="nominal">Monto fijo</option>
        </select>
      )}
      {modo === 'nominal' ? (
        <input className="input" type="number" placeholder="monto" value={monto} onChange={(e) => setMonto(e.target.value)} />
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" type="number" step="0.01" placeholder="%" style={{ width: 90 }}
            value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} />
          <span>sobre</span>
          <select className="input" style={{ width: 200 }} value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="remunerativo">lo remunerativo</option>
            <option value="no_remunerativo">lo no remunerativo</option>
            <option value="ambos">remunerativo + no remunerativo</option>
          </select>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={conTope} onChange={(e) => setConTope(e.target.checked)} />
            con tope SIPA
          </label>
        </div>
      )}
      {categorias && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Aplica a:</span>
          {categorias.map((n) => (
            <label key={n} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={seleccion.includes(n)}
                onChange={(e) => setSeleccion((s) => e.target.checked ? [...s, n] : s.filter((x) => x !== n))} />
              {n}
            </label>
          ))}
          <span style={{ color: 'var(--text-secondary)' }}>(ninguna marcada = todas)</span>
        </div>
      )}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={guardar} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run src/components/config/__tests__/FormularioConcepto.test.jsx`
Expected: PASS. (Si Vite/vitest no resuelve el import `.ts` desde `src`, quitar la extensión en los imports: `'../../../packages/motor/src/formulas'`.)

- [ ] **Step 5: Implementar `TabAportes.jsx`** (conceptos `descuento` y `aporte_patronal` del convenio; conserva `EditorReglas`; muestra errores de guardado)

```jsx
import { useEffect, useState } from 'react'
import { useConceptosStore } from '../../store/conceptosStore'
import EditorReglas from './EditorReglas'
import FormularioConcepto from './FormularioConcepto'

export default function TabAportes({ convenio, empresaId, soloLectura }) {
  const { conceptos, cargando, error, cargarConceptos, guardarConcepto } = useConceptosStore()
  const [errorGuardado, setErrorGuardado] = useState(null)

  useEffect(() => { if (empresaId) cargarConceptos(empresaId) }, [empresaId])

  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const lista = conceptos.filter((c) => c.convenioId === convenio?.id && (c.tipo === 'descuento' || c.tipo === 'aporte_patronal'))

  return (
    <div>
      {errorGuardado && <div className="card" style={{ color: 'var(--danger)' }}>Error al guardar: {errorGuardado}</div>}
      {lista.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: '1rem' }}>
          <h3>{c.orden}. {c.nombre} <span className="badge badge-neutral">{c.tipo === 'descuento' ? 'aporte del trabajador' : 'contribución patronal'}</span></h3>
          <p style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.formula}</p>
          {!soloLectura && (
            <FormularioConcepto concepto={c} categorias={null} conMonto={false}
              onGuardar={async ({ config, formula }) => {
                const r = await guardarConcepto({ ...c, config, formula }, empresaId)
                setErrorGuardado(r.ok ? null : r.error)
                return r
              }} />
          )}
          {!soloLectura && (
            <EditorReglas reglas={c.reglas} onChange={async (reglas) => {
              const r = await guardarConcepto({ ...c, reglas }, empresaId)
              setErrorGuardado(r?.ok === false ? r.error : null)
            }} />
          )}
        </div>
      ))}
      {lista.length === 0 && <div className="card">No hay aportes ni contribuciones para este convenio.</div>}
    </div>
  )
}
```

Conceptos sin `config` (fórmula legada no estructurada): el formulario arranca vacío y al guardar pisa la fórmula con una generada — comportamiento deseado (así se migran a estructurado); la fórmula vieja queda visible arriba hasta entonces.

- [ ] **Step 6: Implementar `TabAdicionales.jsx`** (alta y edición de conceptos `remunerativo`/`no_remunerativo` con `config`)

```jsx
import { useEffect, useState } from 'react'
import { useConceptosStore } from '../../store/conceptosStore'
import { useEscalasStore, agruparVigencias } from '../../store/escalasStore'
import FormularioConcepto from './FormularioConcepto'

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

export default function TabAdicionales({ convenio, empresaId, soloLectura }) {
  const { conceptos, cargarConceptos, guardarConcepto } = useConceptosStore()
  const { categorias, cargarEscala } = useEscalasStore()
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoTipo, setNuevoTipo] = useState('remunerativo')
  const [creando, setCreando] = useState(false)

  useEffect(() => { if (empresaId) cargarConceptos(empresaId) }, [empresaId])
  useEffect(() => { if (convenio?.id) cargarEscala(convenio.id) }, [convenio?.id])

  const hoy = new Date().toISOString().slice(0, 10)
  const nombresCategorias = agruparVigencias(categorias, hoy).map((g) => g.nombre)
  const delConvenio = conceptos.filter((c) => c.convenioId === convenio?.id)
  const adicionales = delConvenio.filter((c) => (c.tipo === 'remunerativo' || c.tipo === 'no_remunerativo') && c.config)

  const crear = async ({ config, formula, categorias: cats }) => {
    const orden = Math.max(0, ...delConvenio.map((c) => c.orden)) + 1
    const r = await guardarConcepto({
      convenioId: convenio.id, codigo: slug(nuevoNombre), nombre: nuevoNombre.trim(),
      tipo: nuevoTipo, formula, orden, imprimible: true, config, categorias: cats,
    }, empresaId)
    if (r.ok) { setNuevoNombre(''); setCreando(false) }
    return r
  }

  return (
    <div>
      {adicionales.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: '1rem' }}>
          <h3>{c.nombre} <span className="badge badge-neutral">{c.tipo}</span>
            {c.categorias?.length > 0 && <span className="badge badge-neutral">{c.categorias.join(', ')}</span>}</h3>
          <p style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.formula}</p>
          {!soloLectura && (
            <FormularioConcepto concepto={c} categorias={nombresCategorias} conMonto
              onGuardar={({ config, formula, categorias: cats }) =>
                guardarConcepto({ ...c, config, formula, categorias: cats }, empresaId)} />
          )}
        </div>
      ))}
      {adicionales.length === 0 && <div className="card" style={{ marginBottom: '1rem' }}>Todavía no hay adicionales para este convenio.</div>}

      {!soloLectura && !creando && (
        <button className="btn btn-primary btn-sm" onClick={() => setCreando(true)}>Nuevo adicional</button>
      )}
      {!soloLectura && creando && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input className="input" placeholder="nombre (ej: Adicional por título)" value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)} />
            <select className="input" style={{ width: 200 }} value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value)}>
              <option value="remunerativo">Remunerativo</option>
              <option value="no_remunerativo">No remunerativo</option>
            </select>
          </div>
          {nuevoNombre.trim()
            ? <FormularioConcepto concepto={null} categorias={nombresCategorias} conMonto onGuardar={crear} />
            : <p style={{ color: 'var(--text-secondary)' }}>Poné un nombre para continuar.</p>}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setCreando(false)}>Cancelar</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Conectar en `ConfiguracionPage.jsx`**

Imports:

```jsx
import TabAportes from '../components/config/TabAportes'
import TabAdicionales from '../components/config/TabAdicionales'
```

Reemplazar los `null`:

```jsx
          {pestana === 'Aportes y contribuciones' && <TabAportes convenio={convenio} empresaId={empresaActiva.id} soloLectura={esGlobal} />}
          {pestana === 'Adicionales' && <TabAdicionales convenio={convenio} empresaId={empresaActiva.id} soloLectura={esGlobal} />}
```

- [ ] **Step 8: Suite + build + commit**

Run: `npx vitest run` → PASS. `npm run build` → sin errores.

```bash
git add src/components/config/FormularioConcepto.jsx src/components/config/TabAportes.jsx src/components/config/TabAdicionales.jsx src/components/config/__tests__/FormularioConcepto.test.jsx src/pages/ConfiguracionPage.jsx
git commit -m "feat(config): formularios estructurados de aportes/contribuciones y adicionales por categoria"
```

---

### Task 12: Pestaña "Parámetros"

**Files:**
- Create: `src/components/config/TabParametros.jsx`
- Modify: `src/pages/ConfiguracionPage.jsx`

- [ ] **Step 1: Implementar `TabParametros.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { useParametrosStore } from '../../store/parametrosStore'

export default function TabParametros({ empresaId }) {
  const { parametros, cargando, error, cargarParametros, guardarParametro } = useParametrosStore()
  const [form, setForm] = useState({ codigo: 'tope_sipa', valor: '', vigenciaDesde: '', vigenciaHasta: '' })
  const [errorGuardado, setErrorGuardado] = useState(null)

  useEffect(() => { if (empresaId) cargarParametros(empresaId) }, [empresaId])

  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const guardar = async () => {
    if (!form.codigo.trim() || form.valor === '' || !form.vigenciaDesde) {
      setErrorGuardado('Completá código, valor y vigencia desde'); return
    }
    const r = await guardarParametro({
      codigo: form.codigo.trim(), valor: Number(form.valor),
      vigenciaDesde: form.vigenciaDesde, vigenciaHasta: form.vigenciaHasta || null,
    }, empresaId)
    setErrorGuardado(r.ok ? null : r.error)
    if (r.ok) setForm({ codigo: 'tope_sipa', valor: '', vigenciaDesde: '', vigenciaHasta: '' })
  }

  return (
    <div className="card">
      <p style={{ color: 'var(--text-secondary)' }}>
        Valores versionados por vigencia (ej. <code>tope_sipa</code>). Nunca se pisan: se agrega una vigencia nueva.
      </p>
      <table style={{ width: '100%' }}>
        <thead><tr><th style={{ textAlign: 'left' }}>Código</th><th style={{ textAlign: 'right' }}>Valor</th><th>Desde</th><th>Hasta</th></tr></thead>
        <tbody>
          {parametros.map((p) => (
            <tr key={p.id}>
              <td><code>{p.codigo}</code></td>
              <td style={{ textAlign: 'right' }}>$ {p.valor.toLocaleString('es-AR')}</td>
              <td style={{ textAlign: 'center' }}>{p.vigenciaDesde}</td>
              <td style={{ textAlign: 'center' }}>{p.vigenciaHasta ?? '—'}</td>
            </tr>
          ))}
          {parametros.length === 0 && <tr><td colSpan={4}>Sin parámetros cargados.</td></tr>}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input className="input" placeholder="código" style={{ width: 160 }} value={form.codigo}
          onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))} />
        <input className="input" type="number" placeholder="valor" style={{ width: 140 }} value={form.valor}
          onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} />
        <input className="input" type="date" title="vigencia desde" value={form.vigenciaDesde}
          onChange={(e) => setForm((f) => ({ ...f, vigenciaDesde: e.target.value }))} />
        <input className="input" type="date" title="vigencia hasta (opcional)" value={form.vigenciaHasta}
          onChange={(e) => setForm((f) => ({ ...f, vigenciaHasta: e.target.value }))} />
        <button className="btn btn-primary btn-sm" onClick={guardar}>Agregar vigencia</button>
      </div>
      {errorGuardado && <p style={{ color: 'var(--danger)' }}>{errorGuardado}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Conectar en `ConfiguracionPage.jsx`**

```jsx
import TabParametros from '../components/config/TabParametros'
```

```jsx
          {pestana === 'Parámetros' && <TabParametros empresaId={empresaActiva.id} />}
```

(Parámetros son por empresa, no por convenio — no llevan `soloLectura`.)

- [ ] **Step 3: Suite + build + commit**

Run: `npx vitest run` → PASS. `npm run build` → sin errores.

```bash
git add src/components/config/TabParametros.jsx src/pages/ConfiguracionPage.jsx
git commit -m "feat(config): pestaña de parametros versionados"
```

---

### Task 13: Verificación final de punta a punta

- [ ] **Step 1: Suite completa y build**

Run: `npx vitest run` → PASS (82 previos + nuevos). `npm run build` → sin errores.

- [ ] **Step 2: Checklist manual con el usuario (en la app)**

1. Configuración → seleccionar convenio plantilla → "Personalizar convenio" → aparece el convenio propio y los legajos siguen mostrando su categoría (verificar en Legajos).
2. Escalas: cargar la escala real con "Nueva vigencia" (montos + fecha).
3. No remunerativos: cargar la suma no remunerativa vigente.
4. Aportes: verificar/ajustar porcentajes (ej. jubilación 11% con tope SIPA).
5. Parámetros: cargar `tope_sipa` real.
6. Adicionales: crear uno de prueba limitado a una categoría y verificar que solo aparece en las liquidaciones de esa categoría.
7. Liquidación → recalcular el período → bruto/aportes/contribuciones/neto ya no dan $0.

- [ ] **Step 3: Contraste contra Presencio**

Comparar la liquidación calculada contra el reporte de Presencio de la misma quincena. Anotar discrepancias; NO ajustar el motor para forzar coincidencia sin entender la causa (pendiente heredado del plan anterior, Task 7 punto 3).

- [ ] **Step 4: Commit final de docs (si hubo ajustes) y cierre**

```bash
git add -A docs/
git commit -m "docs: cierre plan menu de configuracion"
```
