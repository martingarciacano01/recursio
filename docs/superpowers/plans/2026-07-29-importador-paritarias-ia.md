# Importador de paritarias con IA (Fase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir un acta paritaria en PDF o Word, que un modelo Haiku extraiga básicos y sumas no remunerativas, y que el usuario revise un diff antes de que se escriba una sola fila.

**Architecture:** Tres piezas con frontera dura. Una Edge Function Deno habla con la API de Anthropic y **no escribe en la base**; un módulo de funciones puras hace emparejamiento, diff y validación **sin red**; una RPC transaccional escribe. El PDF viaja crudo como bloque `document` porque las tablas de las actas reales son imágenes sin capa de texto.

**Tech Stack:** React 19, Zustand, Supabase (Postgres + RLS + Storage + Edge Functions Deno), API de Anthropic (`claude-haiku-4-5-20251001`) con `tool_choice` forzado, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-29-importador-paritarias-ia-design.md`

---

## Convenciones de este repo (leer antes de la Tarea 1)

Del plan maestro `docs/Recursio_Plan_Ejecucion_Sonnet5.md`:

1. **TDD siempre**: test que falla → verificar que falla → implementación mínima → test pasa → commit.
2. **Migraciones** solo en `supabase/migrations/NNNN_nombre.sql`, numeradas e idempotentes. Nunca SQL suelto en la raíz.
3. **RLS** habilitada en el mismo archivo que crea la tabla, con política por `empresa_id = auth_empresa_id()` **más** bypass `is_superadmin()` (ver `0008_superadmin_bypass.sql`).
4. **Zustand sin `persist`** para datos salariales.
5. **Español (Argentina)** en UI, tablas y comentarios.
6. **Commits frecuentes**, mensajes `feat:`/`fix:`/`test:`/`chore:`.

Correr los tests: `npm test`. Un archivo puntual: `npx vitest run <ruta>`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/utils/importarParitaria.js` | **Crear.** Lógica pura: normalización de nombres, alias, emparejamiento, filtro por zona, diff, validación. Sin Supabase ni `fetch`. Es donde vive todo lo que puede pagar mal, y por eso es lo más testeado. |
| `src/utils/__tests__/importarParitaria.test.js` | **Crear.** Tests unitarios de lo anterior. |
| `supabase/migrations/0039_importaciones_paritarias.sql` | **Crear.** Tabla `nom_importaciones` + RLS + bucket privado + RPC `aplicar_paritaria`. |
| `supabase/functions/importar-paritaria/index.ts` | **Crear.** Recibe archivo, llama a Haiku, devuelve propuesta. No escribe en la base. |
| `src/store/importacionesStore.js` | **Crear.** Zustand: invocar la función, listar historial, aplicar. |
| `src/components/config/TabImportarParitaria.jsx` | **Crear.** Los cuatro estados de la UI. |
| `src/components/config/__tests__/TabImportarParitaria.test.jsx` | **Crear.** Tests de componente. |
| `src/pages/ConfiguracionPage.jsx` | **Modificar** (línea 31, array `tabs`). Agregar la pestaña. |

---

### Task 1: Normalización y emparejamiento de categorías

El corazón del asunto. Las actas escriben "½ Oficial" donde la base dice "Medio oficial", y — ojo — una normalización ingenua convierte "½ Oficial" en "oficial", que **matchea la categoría equivocada y paga de menos sin avisar**. El pre-paso de `½ → medio` existe para eso.

**Files:**
- Create: `src/utils/importarParitaria.js`
- Test: `src/utils/__tests__/importarParitaria.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
import { describe, it, expect } from 'vitest'
import { normalizarNombre, emparejarCategorias } from '../importarParitaria'

describe('normalizarNombre', () => {
  it('baja a minúsculas, saca tildes y colapsa espacios', () => {
    expect(normalizarNombre('  Oficial   Especializado ')).toBe('oficial especializado')
    expect(normalizarNombre('Técnico')).toBe('tecnico')
  })

  // Regresión: sin el pre-paso, '½ Oficial' se normaliza a 'oficial' y
  // matchea la categoría Oficial — pagando Medio oficial como Oficial.
  it('convierte ½ y 1/2 en "medio" ANTES de descartar símbolos', () => {
    expect(normalizarNombre('½ Oficial')).toBe('medio oficial')
    expect(normalizarNombre('1/2 Oficial')).toBe('medio oficial')
    expect(normalizarNombre('½ Oficial')).not.toBe('oficial')
  })
})

describe('emparejarCategorias', () => {
  const existentes = ['Oficial especializado', 'Oficial', 'Medio oficial', 'Ayudante', 'Sereno']

  it('empareja ignorando mayúsculas y tildes', () => {
    const r = emparejarCategorias([{ nombre_acta: 'OFICIAL ESPECIALIZADO', basico: 6800 }], existentes)
    expect(r.emparejadas).toHaveLength(1)
    expect(r.emparejadas[0].nombre).toBe('Oficial especializado')
    expect(r.huerfanas).toHaveLength(0)
  })

  it('empareja "½ Oficial" con "Medio oficial", no con "Oficial"', () => {
    const r = emparejarCategorias([{ nombre_acta: '½ Oficial', basico: 5375 }], existentes)
    expect(r.emparejadas[0].nombre).toBe('Medio oficial')
  })

  it('manda a huérfanas lo que no reconoce, sin adivinar', () => {
    const r = emparejarCategorias([{ nombre_acta: 'NIVEL A', basico: 940335.99 }], existentes)
    expect(r.emparejadas).toHaveLength(0)
    expect(r.huerfanas).toHaveLength(1)
    expect(r.huerfanas[0].nombre_acta).toBe('NIVEL A')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/utils/__tests__/importarParitaria.test.js`
Expected: FAIL — `Failed to resolve import "../importarParitaria"`

- [ ] **Step 3: Implementación mínima**

```js
// src/utils/importarParitaria.js

// Reemplazos que DEBEN correr antes de descartar símbolos: '½' no es
// [a-z0-9], así que un strip directo lo borra y '½ Oficial' termina en
// 'oficial' — emparejando con la categoría equivocada y pagando de menos.
const PREVIOS = [
  [/½/g, ' medio '],
  [/\b1\s*\/\s*2\b/g, ' medio '],
]

export function normalizarNombre(s) {
  let t = String(s ?? '')
  for (const [re, rep] of PREVIOS) t = t.replace(re, rep)
  return t
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Divergencias reales entre cómo escribe el acta y cómo está en la base.
// Curado a mano: NO se infiere ni se usa distancia de edición. Un match
// aproximado errado paga mal y nadie lo nota. Clave y valor normalizados.
export const ALIAS_CATEGORIAS = {
  'medio oficial albanil': 'medio oficial',
  'ayudante especializado': 'ayudante',
}

export function emparejarCategorias(propuestas, existentes) {
  const indice = new Map(existentes.map((n) => [normalizarNombre(n), n]))
  const emparejadas = []
  const huerfanas = []
  for (const p of propuestas) {
    const norm = normalizarNombre(p.nombre_acta)
    const destino = ALIAS_CATEGORIAS[norm] ?? norm
    const match = indice.get(destino)
    if (match) emparejadas.push({ ...p, nombre: match })
    else huerfanas.push(p)
  }
  return { emparejadas, huerfanas }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/utils/__tests__/importarParitaria.test.js`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/utils/importarParitaria.js src/utils/__tests__/importarParitaria.test.js
git commit -m "feat: normalizacion y emparejamiento de categorias de paritaria"
```

---

### Task 2: Filtro por zona, diff y validación

**Files:**
- Modify: `src/utils/importarParitaria.js`
- Test: `src/utils/__tests__/importarParitaria.test.js`

- [ ] **Step 1: Escribir el test que falla**

Agregar al final del archivo de tests:

```js
import { filtrarPorZona, construirDiff, validarPropuesta } from '../importarParitaria'

describe('filtrarPorZona', () => {
  const tramo = {
    vigencia_desde: '2026-06-01',
    categorias: [
      { nombre_acta: 'NIVEL A', zona: 'A', basico: 940335.99 },
      { nombre_acta: 'NIVEL A', zona: 'B', basico: 1073495.22 },
    ],
    no_remunerativos: [{ concepto_acta: 'VIANDA', zona: 'A', monto: 7469.57 }],
  }

  it('deja solo las filas de la zona elegida', () => {
    const r = filtrarPorZona(tramo, 'A')
    expect(r.categorias).toHaveLength(1)
    expect(r.categorias[0].basico).toBe(940335.99)
    expect(r.no_remunerativos).toHaveLength(1)
  })

  it('conserva las filas sin zona declarada', () => {
    const r = filtrarPorZona({ ...tramo, categorias: [{ nombre_acta: 'Oficial', zona: null, basico: 5817 }] }, 'A')
    expect(r.categorias).toHaveLength(1)
  })
})

describe('construirDiff', () => {
  const vigentes = [{ nombre: 'Oficial', basico: 5700 }, { nombre: 'Sereno', basico: 0 }]

  it('calcula la variación porcentual contra el básico vigente', () => {
    const d = construirDiff([{ nombre: 'Oficial', basico: 5817, modalidad: 'hora' }], vigentes)
    expect(d[0].actual).toBe(5700)
    expect(d[0].propuesto).toBe(5817)
    expect(d[0].deltaPct).toBeCloseTo(2.05, 2)
    expect(d[0].sospechoso).toBe(false)
    expect(d[0].seleccionado).toBe(true)
  })

  it('deja deltaPct en null cuando el vigente es 0 y no lo marca sospechoso', () => {
    const d = construirDiff([{ nombre: 'Sereno', basico: 898817, modalidad: 'mensual' }], vigentes)
    expect(d[0].deltaPct).toBeNull()
    expect(d[0].sospechoso).toBe(false)
  })

  it('marca sospechosa una variación mayor al 100%', () => {
    const d = construirDiff([{ nombre: 'Oficial', basico: 99999, modalidad: 'hora' }], vigentes)
    expect(d[0].sospechoso).toBe(true)
    expect(d[0].seleccionado).toBe(true)
  })

  it('marca sospechoso y destilda un básico <= 0', () => {
    const d = construirDiff([{ nombre: 'Oficial', basico: 0, modalidad: 'hora' }], vigentes)
    expect(d[0].sospechoso).toBe(true)
    expect(d[0].seleccionado).toBe(false)
  })
})

describe('validarPropuesta', () => {
  it('avisa cuando no hay tramos', () => {
    expect(validarPropuesta({ tramos: [] })[0]).toMatch(/ningún tramo/i)
  })

  it('avisa cuando la vigencia no es una fecha ISO', () => {
    const a = validarPropuesta({ tramos: [{ vigencia_desde: 'junio 2026', categorias: [{ nombre_acta: 'X', basico: 1 }] }] })
    expect(a.some((x) => /vigencia/i.test(x))).toBe(true)
  })

  it('no devuelve avisos con una propuesta sana', () => {
    const a = validarPropuesta({
      tramos: [{ vigencia_desde: '2026-06-01', categorias: [{ nombre_acta: 'Oficial', basico: 5817 }] }],
    })
    expect(a).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/utils/__tests__/importarParitaria.test.js`
Expected: FAIL — `filtrarPorZona is not a function`

- [ ] **Step 3: Implementación mínima**

Agregar a `src/utils/importarParitaria.js`:

```js
// Un anexo trae las cuatro zonas juntas y nom_categorias no tiene columna
// de zona: el usuario elige una y el resto se descarta. Las filas sin zona
// declarada se conservan (el acta puede no discriminar).
export function filtrarPorZona(tramo, zona) {
  if (!zona) return tramo
  const z = normalizarNombre(zona)
  const f = (arr) => (arr ?? []).filter((r) => !r.zona || normalizarNombre(r.zona) === z)
  return { ...tramo, categorias: f(tramo.categorias), no_remunerativos: f(tramo.no_remunerativos) }
}

// deltaPct es null cuando no hay vigente contra qué comparar (básico 0 tras
// un reseed): mostrar "+∞ %" no ayuda y marcarlo sospechoso obligaría a
// destildar las 5 filas en la primera importación.
export function construirDiff(emparejadas, vigentes) {
  const actualPorNombre = new Map(vigentes.map((v) => [v.nombre, Number(v.basico)]))
  return emparejadas.map((e) => {
    const actual = actualPorNombre.get(e.nombre) ?? 0
    const propuesto = Number(e.basico)
    const deltaPct = actual > 0 ? ((propuesto - actual) / actual) * 100 : null
    const invalido = !(propuesto > 0)
    return {
      nombre: e.nombre,
      actual,
      propuesto,
      modalidad: e.modalidad ?? 'hora',
      deltaPct,
      sospechoso: invalido || (deltaPct !== null && Math.abs(deltaPct) > 100),
      seleccionado: !invalido,
    }
  })
}

export function validarPropuesta(p) {
  const avisos = []
  const tramos = p?.tramos
  if (!Array.isArray(tramos) || tramos.length === 0) {
    avisos.push('El acta no devolvió ningún tramo con valores.')
    return avisos
  }
  for (const t of tramos) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.vigencia_desde ?? '')) {
      avisos.push(`Tramo sin fecha de vigencia válida: "${t.vigencia_desde ?? ''}".`)
    }
    if ((t.categorias ?? []).length === 0) {
      avisos.push(`El tramo ${t.vigencia_desde} no trae básicos.`)
    }
    for (const c of t.categorias ?? []) {
      if (!(Number(c.basico) > 0)) {
        avisos.push(`${c.nombre_acta}: básico inválido (${c.basico}).`)
      }
    }
  }
  return avisos
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/utils/__tests__/importarParitaria.test.js`
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**

```bash
git add src/utils/importarParitaria.js src/utils/__tests__/importarParitaria.test.js
git commit -m "feat: filtro por zona, diff y validacion de propuesta de paritaria"
```

---

### Task 3: Migración — tabla de importaciones, bucket y RPC transaccional

**Files:**
- Create: `supabase/migrations/0039_importaciones_paritarias.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0039_importaciones_paritarias.sql
-- Historial de importaciones de actas paritarias + RPC transaccional.
--
-- `propuesta` guarda lo que devolvió el modelo; `aplicado` lo que el
-- usuario confirmó. La diferencia entre ambas es la evidencia de que hubo
-- revisión humana, y sirve para medir qué tan bien extrae el modelo.

CREATE TABLE IF NOT EXISTS nom_importaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  convenio_id    UUID NOT NULL REFERENCES nom_convenios(id) ON DELETE CASCADE,
  archivo_path   TEXT NOT NULL,
  archivo_nombre TEXT NOT NULL,
  zona           TEXT,
  propuesta      JSONB NOT NULL,
  aplicado       JSONB,
  usuario_id     UUID,
  created_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_importaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_importaciones_all ON nom_importaciones;
CREATE POLICY nom_importaciones_all ON nom_importaciones FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_importaciones TO authenticated;
GRANT SELECT, INSERT, UPDATE ON nom_importaciones TO service_role;
CREATE INDEX IF NOT EXISTS nom_importaciones_convenio_idx
  ON nom_importaciones(convenio_id, created_at DESC);

-- Bucket privado para las actas originales.
INSERT INTO storage.buckets (id, name, public)
SELECT 'paritarias', 'paritarias', false
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'paritarias');

DROP POLICY IF EXISTS paritarias_rw ON storage.objects;
CREATE POLICY paritarias_rw ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'paritarias')
  WITH CHECK (bucket_id = 'paritarias');

-- aplicar_paritaria: escribe categorías y no remunerativos de UNA vez.
-- Una importación a medias es peor que ninguna, de ahí la transacción.
--
-- p_categorias: [{"nombre":"Oficial","basico":5817,"modalidad":"hora"}]
-- p_no_rem:     [{"categoria":"Oficial","monto":58300}]
--
-- ON CONFLICT DO NOTHING: si esa vigencia ya existe no se pisa (la tabla
-- es un histórico y nunca se actualiza, ver 0002).
CREATE OR REPLACE FUNCTION aplicar_paritaria(
  p_importacion_id UUID,
  p_convenio_id    UUID,
  p_vigencia       DATE,
  p_categorias     JSONB,
  p_no_rem         JSONB
) RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa   UUID := auth_empresa_id();
  v_filas     INT  := 0;
  v_convenio  nom_convenios%ROWTYPE;
BEGIN
  SELECT * INTO v_convenio FROM nom_convenios WHERE id = p_convenio_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'convenio inexistente';
  END IF;

  IF NOT is_superadmin() AND v_convenio.empresa_id IS DISTINCT FROM v_empresa THEN
    RAISE EXCEPTION 'el convenio no pertenece a la empresa del usuario';
  END IF;

  INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde, modalidad)
  SELECT p_convenio_id,
         x->>'nombre',
         (x->>'basico')::numeric,
         p_vigencia,
         COALESCE(x->>'modalidad', 'hora')
  FROM jsonb_array_elements(COALESCE(p_categorias, '[]'::jsonb)) AS x
  ON CONFLICT (convenio_id, nombre, vigencia_desde) DO NOTHING;
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  INSERT INTO nom_no_remunerativos (convenio_id, categoria_nombre, monto, vigencia_desde)
  SELECT p_convenio_id,
         x->>'categoria',
         (x->>'monto')::numeric,
         p_vigencia
  FROM jsonb_array_elements(COALESCE(p_no_rem, '[]'::jsonb)) AS x
  ON CONFLICT (convenio_id, categoria_nombre, vigencia_desde) DO NOTHING;

  UPDATE nom_importaciones
  SET aplicado = COALESCE(aplicado, '[]'::jsonb) || jsonb_build_object(
        'vigencia', p_vigencia, 'categorias', p_categorias, 'no_rem', p_no_rem)
  WHERE id = p_importacion_id;

  RETURN v_filas;
END $$;
REVOKE ALL ON FUNCTION aplicar_paritaria(UUID, UUID, DATE, JSONB, JSONB) FROM public;
GRANT EXECUTE ON FUNCTION aplicar_paritaria(UUID, UUID, DATE, JSONB, JSONB) TO authenticated;
```

- [ ] **Step 2: Verificar que parsea antes de aplicarla**

Run: `python3 -c "import sqlglot; print(len([x for x in sqlglot.parse(open('supabase/migrations/0039_importaciones_paritarias.sql').read(), read='postgres') if x]))"`
Expected: imprime un número ≥ 8 sin lanzar excepción. Los avisos `unsupported syntax` sobre `CREATE POLICY` son normales.

- [ ] **Step 3: Aplicar la migración**

Pegar el archivo en el SQL editor del proyecto y correrlo.
Expected: `Success. No rows returned`

- [ ] **Step 4: Verificar la RPC contra un convenio real**

```sql
SELECT aplicar_paritaria(
  gen_random_uuid(), (SELECT id FROM nom_convenios WHERE nombre = 'UOCRA (Ley 22.250)' LIMIT 1),
  DATE '2099-01-01',
  '[{"nombre":"Oficial","basico":1,"modalidad":"hora"}]'::jsonb, '[]'::jsonb);

SELECT basico FROM nom_categorias
WHERE nombre = 'Oficial' AND vigencia_desde = DATE '2099-01-01';
-- Esperado: 1

DELETE FROM nom_categorias WHERE vigencia_desde = DATE '2099-01-01';
```

Expected: la primera devuelve `1`, la segunda muestra `1`, la tercera limpia la prueba.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0039_importaciones_paritarias.sql
git commit -m "feat: tabla de importaciones de paritarias y RPC aplicar_paritaria"
```

---

### Task 4: Edge Function `importar-paritaria`

Manda el PDF **crudo** como bloque `document`. Las páginas 3 a 6 del acta de calibración son PNG con cero caracteres extraíbles: cualquier pipeline de texto devuelve el acuerdo sin ninguna escala salarial.

**Files:**
- Create: `supabase/functions/importar-paritaria/index.ts`

- [ ] **Step 1: Escribir la función**

```ts
// supabase/functions/importar-paritaria/index.ts
//
// Recibe un acta, la manda a Haiku y devuelve la propuesta estructurada.
// NO escribe en nom_categorias ni en nom_no_remunerativos: eso lo hace
// aplicar_paritaria() después de que el usuario revise el diff.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_BYTES = 10 * 1024 * 1024
const MIME_OK = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

// tool_choice forzado: sin esto el modelo devuelve prosa y hay que parsearla.
const HERRAMIENTA = {
  name: 'cargar_paritaria',
  description: 'Carga los valores salariales de un acta paritaria argentina.',
  input_schema: {
    type: 'object',
    properties: {
      convenio_detectado: { type: ['string', 'null'] },
      zonas_presentes: { type: 'array', items: { type: 'string' } },
      tramos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            vigencia_desde: { type: 'string', description: 'YYYY-MM-DD' },
            porcentaje_declarado: { type: ['number', 'null'] },
            categorias: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  nombre_acta: { type: 'string' },
                  zona: { type: ['string', 'null'] },
                  basico: { type: 'number' },
                  modalidad: { type: 'string', enum: ['hora', 'mensual', 'quincenal'] },
                  confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
                },
                required: ['nombre_acta', 'basico', 'modalidad', 'confianza'],
              },
            },
            no_remunerativos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  concepto_acta: { type: 'string' },
                  categoria_acta: { type: ['string', 'null'] },
                  zona: { type: ['string', 'null'] },
                  monto: { type: 'number' },
                  confianza: { type: 'string', enum: ['alta', 'media', 'baja'] },
                },
                required: ['concepto_acta', 'monto', 'confianza'],
              },
            },
          },
          required: ['vigencia_desde', 'categorias', 'no_remunerativos'],
        },
      },
      notas: { type: 'string' },
    },
    required: ['tramos', 'notas'],
  },
}

const PROMPT = `Sos un asistente de liquidación de sueldos en Argentina. Te paso un acta paritaria.

Extraé los salarios básicos por categoría y las sumas no remunerativas, y cargalos con la herramienta.

Reglas:
- Las tablas suelen estar en anexos ESCANEADOS. Leé los números de la imagen, no del texto.
- Formato argentino: el punto separa miles y la coma decimales. "940.335,99" son novecientos cuarenta mil trescientos treinta y cinco con 99. Devolvé números JSON: 940335.99.
- Un acta puede otorgar aumentos escalonados por mes (junio, julio, agosto). Cada uno es un tramo con su propia vigencia_desde, el día 1 del mes que corresponda.
- Si el acta muestra varias zonas (A, B, C, D), cargá TODAS las filas con su zona. No elijas por tu cuenta.
- Copiá el nombre de la categoría tal cual figura en el acta, sin traducirlo ni normalizarlo.
- modalidad: 'hora' si es jornal por hora, 'mensual' si es un monto mensual fijo.
- confianza 'baja' si el número está borroso, cortado o dudoso. Es preferible marcarlo que adivinar.
- Si un dato no está, omitilo. No inventes valores.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const { archivo, mime, nombre, convenio_id, empresa_id, zona } = await req.json()

    if (!MIME_OK.includes(mime)) {
      return json({ error: `Tipo de archivo no soportado: ${mime}` }, 400)
    }
    const bytes = Uint8Array.from(atob(archivo), (c) => c.charCodeAt(0))
    if (bytes.length > MAX_BYTES) {
      return json({ error: `El archivo pesa ${(bytes.length / 1048576).toFixed(1)} MB; el máximo es 10 MB.` }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const path = `${empresa_id}/${crypto.randomUUID()}-${nombre}`
    const { error: errUp } = await supabase.storage.from('paritarias').upload(path, bytes, { contentType: mime })
    if (errUp) return json({ error: `No se pudo guardar el archivo: ${errUp.message}` }, 500)

    // PDF: bloque document nativo (el modelo ve la imagen de la tabla).
    // DOCX: no hay soporte nativo, se manda el texto del document.xml.
    let contenido: unknown[]
    if (mime === 'application/pdf') {
      contenido = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: archivo } }]
    } else {
      const texto = await textoDeDocx(bytes)
      contenido = [{ type: 'text', text: texto }]
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        tools: [HERRAMIENTA],
        tool_choice: { type: 'tool', name: 'cargar_paritaria' },
        messages: [{ role: 'user', content: [...contenido, { type: 'text', text: PROMPT }] }],
      }),
    })

    if (!r.ok) {
      return json({ error: `La API respondió ${r.status}: ${await r.text()}` }, 502)
    }

    const data = await r.json()
    const uso = data.content?.find((c: { type: string }) => c.type === 'tool_use')
    if (!uso) return json({ error: 'No se pudo leer el acta: el modelo no devolvió valores.' }, 422)

    const { data: fila, error: errIns } = await supabase.from('nom_importaciones').insert({
      empresa_id, convenio_id, archivo_path: path, archivo_nombre: nombre,
      zona: zona ?? null, propuesta: uso.input,
    }).select('id').single()
    if (errIns) return json({ error: `No se pudo registrar la importación: ${errIns.message}` }, 500)

    return json({ importacion_id: fila.id, propuesta: uso.input })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

// Un .docx es un zip; el texto vive en word/document.xml. Se sacan los
// tags y queda el contenido plano — suficiente para un acta de texto.
async function textoDeDocx(bytes: Uint8Array): Promise<string> {
  const { unzip } = await import('https://deno.land/x/zipjs@v2.7.29/index.js')
  const entries = await unzip(bytes)
  const xml = new TextDecoder().decode(entries['word/document.xml'])
  return xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').trim()
}
```

- [ ] **Step 2: Cargar la API key como secret**

Run: `npx supabase secrets set ANTHROPIC_API_KEY=<tu-key>`
Expected: `Finished supabase secrets set.`

La key vive **solo** del lado del servidor. Nunca en `.env.local`, que Vite empaqueta en el bundle del navegador.

- [ ] **Step 3: Desplegar**

Run: `npx supabase functions deploy importar-paritaria`
Expected: `Deployed Function importar-paritaria`

- [ ] **Step 4: Probar con el acta real**

```bash
ACTA=$(base64 -i "docs/fixtures/acta-76-75-junio-2026.pdf")
curl -s -X POST "https://hlipootstxojwdxwkrwl.supabase.co/functions/v1/importar-paritaria" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"archivo\":\"$ACTA\",\"mime\":\"application/pdf\",\"nombre\":\"acta.pdf\",\"convenio_id\":\"<uuid>\",\"empresa_id\":\"<uuid>\"}" \
  | python3 -m json.tool
```

Expected: `tramos` con tres entradas (`2026-06-01`, `2026-07-01`, `2026-08-01`) y las categorías Sereno / Ayudante / ½ Oficial / Oficial / Oficial Especializado con básicos > 0.

Copiar el acta a `docs/fixtures/acta-76-75-junio-2026.pdf` antes de correr esto.

- [ ] **Step 5: Commit**

```bash
mkdir -p docs/fixtures
git add supabase/functions/importar-paritaria/index.ts docs/fixtures/
git commit -m "feat: edge function importar-paritaria con extraccion via Haiku"
```

---

### Task 5: Store de importaciones

**Files:**
- Create: `src/store/importacionesStore.js`

- [ ] **Step 1: Escribir el store**

```js
// src/store/importacionesStore.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Sin `persist`: la propuesta trae remuneraciones (plan maestro, punto 6).
export const useImportacionesStore = create((set) => ({
  propuesta: null, importacionId: null, cargando: false, error: null, aplicando: false,

  limpiar: () => set({ propuesta: null, importacionId: null, error: null }),

  analizar: async ({ archivo, convenioId, empresaId, zona }) => {
    set({ cargando: true, error: null, propuesta: null })
    const base64 = await new Promise((res, rej) => {
      const fr = new FileReader()
      fr.onload = () => res(String(fr.result).split(',')[1])
      fr.onerror = rej
      fr.readAsDataURL(archivo)
    })
    const { data, error } = await supabase.functions.invoke('importar-paritaria', {
      body: {
        archivo: base64, mime: archivo.type, nombre: archivo.name,
        convenio_id: convenioId, empresa_id: empresaId, zona: zona ?? null,
      },
    })
    if (error || data?.error) {
      set({ error: data?.error || error.message, cargando: false })
      return { ok: false, error: data?.error || error.message }
    }
    set({ propuesta: data.propuesta, importacionId: data.importacion_id, cargando: false })
    return { ok: true }
  },

  aplicar: async ({ importacionId, convenioId, vigencia, categorias, noRem }) => {
    set({ aplicando: true, error: null })
    const { data, error } = await supabase.rpc('aplicar_paritaria', {
      p_importacion_id: importacionId, p_convenio_id: convenioId,
      p_vigencia: vigencia, p_categorias: categorias, p_no_rem: noRem,
    })
    set({ aplicando: false })
    if (error) { set({ error: error.message }); return { ok: false, error: error.message } }
    return { ok: true, filas: data }
  },
}))
```

- [ ] **Step 2: Verificar que compila**

Run: `npx eslint src/store/importacionesStore.js`
Expected: sin errores

- [ ] **Step 3: Commit**

```bash
git add src/store/importacionesStore.js
git commit -m "feat: store de importaciones de paritarias"
```

---

### Task 5b: Permiso `importar_paritaria`

⚠ **Decisión pendiente de confirmar con el usuario.** El spec dice "admin de empresa y RRHH", pero la matriz actual reserva `editar_configuracion` a `admin` solo. Importar una paritaria **escribe escalas salariales**, así que es edición de configuración. Este plan sigue lo que eligió el usuario (admin + rrhh) creando una acción propia; si prefiere alinearlo con `editar_configuracion`, cambiar el array a `['admin']` y ajustar el test.

Esto es gating de UI. El control real es la RLS de `nom_categorias` y la validación de empresa dentro de `aplicar_paritaria` (Task 3).

**Files:**
- Modify: `src/utils/permisos.js:19` (agregar entrada a `MATRIZ`)
- Test: `src/utils/__tests__/permisos.test.js`

- [ ] **Step 1: Escribir el test que falla**

Agregar al archivo de tests existente:

```js
describe('importar_paritaria', () => {
  it('lo permite a admin y a rrhh', () => {
    expect(puede([{ rol: 'admin' }], 'importar_paritaria')).toBe(true)
    expect(puede([{ rol: 'rrhh' }], 'importar_paritaria')).toBe(true)
  })

  it('lo niega a consulta, supervisor y revisores', () => {
    expect(puede([{ rol: 'consulta' }], 'importar_paritaria')).toBe(false)
    expect(puede([{ rol: 'supervisor' }], 'importar_paritaria')).toBe(false)
    expect(puede([{ rol: 'revisor_interno' }], 'importar_paritaria')).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/utils/__tests__/permisos.test.js`
Expected: FAIL — `expected false to be true` (la acción no existe en la matriz y `puede` devuelve `false`)

- [ ] **Step 3: Agregar la acción a la matriz**

En `src/utils/permisos.js`, dentro de `MATRIZ`, después de `editar_configuracion`:

```js
  // Importar una paritaria escribe escalas salariales. Se le da a rrhh
  // además de admin por decisión explícita del usuario, aunque
  // editar_configuracion sea solo de admin. El gating real es la RLS.
  importar_paritaria: ['admin', 'rrhh'],
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/utils/__tests__/permisos.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/permisos.js src/utils/__tests__/permisos.test.js
git commit -m "feat: permiso importar_paritaria para admin y rrhh"
```

---

### Task 6: Pestaña "Importar paritaria"

**Files:**
- Create: `src/components/config/TabImportarParitaria.jsx`
- Create: `src/components/config/__tests__/TabImportarParitaria.test.jsx`
- Modify: `src/pages/ConfiguracionPage.jsx:31` (array `tabs` de la sección `convenios`)

- [ ] **Step 1: Escribir el test que falla**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TabImportarParitaria from '../TabImportarParitaria'

let estado
vi.mock('../../../store/importacionesStore', () => ({
  useImportacionesStore: () => estado,
}))
vi.mock('../../../store/escalasStore', () => ({
  useEscalasStore: () => ({ categorias: [{ nombre: 'Oficial', valor: 5700, vigenciaDesde: '2026-05-01' }], cargarEscala: vi.fn() }),
  agruparVigencias: () => [{ nombre: 'Oficial', vigente: { valor: 5700 }, historial: [] }],
}))

const convenio = { id: 'c1', nombre: 'UOCRA (Ley 22.250)', empresaId: 'e1' }
const base = { propuesta: null, importacionId: null, cargando: false, error: null, aplicando: false,
  analizar: vi.fn(), aplicar: vi.fn(), limpiar: vi.fn() }

beforeEach(() => { estado = { ...base } })

describe('TabImportarParitaria', () => {
  it('en un convenio plantilla no deja importar', () => {
    render(<TabImportarParitaria convenio={convenio} empresaId="e1" soloLectura />)
    expect(screen.getByText(/personalizá el convenio/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/acta/i)).not.toBeInTheDocument()
  })

  it('muestra el error cuando la extracción falla', () => {
    estado = { ...base, error: 'No se pudo leer el acta' }
    render(<TabImportarParitaria convenio={convenio} empresaId="e1" soloLectura={false} />)
    expect(screen.getByText(/no se pudo leer el acta/i)).toBeInTheDocument()
  })

  it('lista un tramo por vigencia con su diff', () => {
    estado = { ...base, importacionId: 'i1', propuesta: { tramos: [
      { vigencia_desde: '2026-06-01', categorias: [{ nombre_acta: 'Oficial', basico: 5817, modalidad: 'hora' }], no_remunerativos: [] },
      { vigencia_desde: '2026-07-01', categorias: [{ nombre_acta: 'Oficial', basico: 5933, modalidad: 'hora' }], no_remunerativos: [] },
    ] } }
    render(<TabImportarParitaria convenio={convenio} empresaId="e1" soloLectura={false} />)
    expect(screen.getByText('2026-06-01')).toBeInTheDocument()
    expect(screen.getByText('2026-07-01')).toBeInTheDocument()
    expect(screen.getAllByText(/5\.?817/).length).toBeGreaterThan(0)
  })

  it('separa las categorías que no reconoce en vez de descartarlas', () => {
    estado = { ...base, importacionId: 'i1', propuesta: { tramos: [
      { vigencia_desde: '2026-06-01', categorias: [{ nombre_acta: 'NIVEL A', basico: 940335.99, modalidad: 'mensual' }], no_remunerativos: [] },
    ] } }
    render(<TabImportarParitaria convenio={convenio} empresaId="e1" soloLectura={false} />)
    expect(screen.getByText(/no reconocidas/i)).toBeInTheDocument()
    expect(screen.getByText('NIVEL A')).toBeInTheDocument()
  })

  it('destildar una fila la excluye al confirmar', () => {
    const aplicar = vi.fn().mockResolvedValue({ ok: true, filas: 0 })
    estado = { ...base, aplicar, importacionId: 'i1', propuesta: { tramos: [
      { vigencia_desde: '2026-06-01', categorias: [{ nombre_acta: 'Oficial', basico: 5817, modalidad: 'hora' }], no_remunerativos: [] },
    ] } }
    render(<TabImportarParitaria convenio={convenio} empresaId="e1" soloLectura={false} />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Oficial/i }))
    fireEvent.click(screen.getByRole('button', { name: /aplicar/i }))
    expect(aplicar).toHaveBeenCalledWith(expect.objectContaining({ categorias: [] }))
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run src/components/config/__tests__/TabImportarParitaria.test.jsx`
Expected: FAIL — `Failed to resolve import "../TabImportarParitaria"`

- [ ] **Step 3: Implementar el componente**

```jsx
import { useEffect, useMemo, useState } from 'react'
import { useImportacionesStore } from '../../store/importacionesStore'
import { useEscalasStore, agruparVigencias } from '../../store/escalasStore'
import { emparejarCategorias, construirDiff, filtrarPorZona, validarPropuesta } from '../../utils/importarParitaria'

const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2 })

export default function TabImportarParitaria({ convenio, empresaId, soloLectura }) {
  const { propuesta, importacionId, cargando, error, aplicando, analizar, aplicar, limpiar } = useImportacionesStore()
  const { categorias, cargarEscala } = useEscalasStore()
  const [zona, setZona] = useState('')
  const [seleccion, setSeleccion] = useState({})
  const [resultado, setResultado] = useState(null)

  useEffect(() => { if (convenio?.id) cargarEscala(convenio.id) }, [convenio?.id])

  const hoy = new Date().toISOString().slice(0, 10)
  const vigentes = useMemo(
    () => agruparVigencias(categorias, hoy).map((g) => ({ nombre: g.nombre, basico: g.vigente?.valor ?? 0 })),
    [categorias]
  )
  const nombresBase = vigentes.map((v) => v.nombre)

  const tramos = useMemo(() => {
    if (!propuesta?.tramos) return []
    return propuesta.tramos.map((t) => {
      const f = filtrarPorZona(t, zona)
      const { emparejadas, huerfanas } = emparejarCategorias(f.categorias ?? [], nombresBase)
      return {
        vigencia: t.vigencia_desde,
        filas: construirDiff(emparejadas, vigentes),
        huerfanas,
        noRem: f.no_remunerativos ?? [],
      }
    })
  }, [propuesta, zona, categorias])

  const avisos = propuesta ? validarPropuesta(propuesta) : []

  if (!convenio) return null
  if (soloLectura) {
    return (
      <div className="card">
        Este convenio es una plantilla de solo lectura. Para importar una paritaria,
        primero <strong>personalizá el convenio</strong>.
      </div>
    )
  }

  const marcado = (v, nombre) => seleccion[`${v}|${nombre}`] !== false

  const confirmar = async (t) => {
    const categoriasAEnviar = t.filas
      .filter((f) => marcado(t.vigencia, f.nombre) && !(f.propuesto <= 0))
      .map((f) => ({ nombre: f.nombre, basico: f.propuesto, modalidad: f.modalidad }))
    const r = await aplicar({
      importacionId, convenioId: convenio.id, vigencia: t.vigencia,
      categorias: categoriasAEnviar,
      noRem: t.noRem.filter((n) => n.categoria_acta).map((n) => ({ categoria: n.categoria_acta, monto: n.monto })),
    })
    if (r.ok) { setResultado(`Se aplicaron ${categoriasAEnviar.length} categorías con vigencia ${t.vigencia}.`); await cargarEscala(convenio.id) }
  }

  return (
    <div>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}
      {resultado && <div className="card">{resultado}</div>}

      {!propuesta && (
        <div className="card">
          <div className="input-group input-medio" style={{ marginBottom: 12 }}>
            <label className="input-label" htmlFor="zona-acta">Zona (opcional)</label>
            <input id="zona-acta" className="input" placeholder="ej: A" value={zona}
              onChange={(e) => setZona(e.target.value)} />
          </div>
          <label className="input-label" htmlFor="acta">Acta paritaria (PDF o Word, hasta 10 MB)</label>
          <input id="acta" type="file" accept=".pdf,.docx" disabled={cargando}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) analizar({ archivo: f, convenioId: convenio.id, empresaId, zona })
            }} />
          {cargando && <p className="texto-secundario">Leyendo el acta… puede tardar 15 segundos.</p>}
        </div>
      )}

      {avisos.length > 0 && (
        <div className="card" style={{ color: 'var(--warning)' }}>
          <strong>Revisá antes de aplicar:</strong>
          <ul>{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}

      {tramos.map((t) => (
        <div className="card" key={t.vigencia}>
          <h3 style={{ fontSize: '1rem' }}>Vigencia desde {t.vigencia}</h3>
          <table className="tabla">
            <thead>
              <tr><th></th><th>Categoría</th><th>Actual</th><th>Propuesto</th><th>Δ</th></tr>
            </thead>
            <tbody>
              {t.filas.map((f) => (
                <tr key={f.nombre}>
                  <td>
                    <input type="checkbox" aria-label={f.nombre} checked={marcado(t.vigencia, f.nombre)}
                      onChange={(e) => setSeleccion((s) => ({ ...s, [`${t.vigencia}|${f.nombre}`]: e.target.checked }))} />
                  </td>
                  <td>{f.nombre}{f.sospechoso && <span className="badge badge-neutral">revisar</span>}</td>
                  <td>${fmt(f.actual)}</td>
                  <td>${fmt(f.propuesto)}</td>
                  <td>{f.deltaPct === null ? '—' : `${f.deltaPct.toFixed(1)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {t.huerfanas.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong>Categorías no reconocidas</strong>
              <p className="texto-secundario" style={{ fontSize: '0.85rem' }}>
                No coinciden con ninguna categoría de este convenio y no se van a cargar.
              </p>
              <ul>{t.huerfanas.map((h) => <li key={h.nombre_acta}>{h.nombre_acta} — ${fmt(h.basico)}</li>)}</ul>
            </div>
          )}

          <div className="acciones" style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" disabled={aplicando} onClick={() => confirmar(t)}>
              {aplicando ? 'Aplicando…' : `Aplicar vigencia ${t.vigencia}`}
            </button>
          </div>
        </div>
      ))}

      {propuesta && (
        <button className="btn btn-ghost btn-sm" onClick={() => { limpiar(); setResultado(null) }}>
          Importar otra acta
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run src/components/config/__tests__/TabImportarParitaria.test.jsx`
Expected: PASS — 5 tests

- [ ] **Step 5: Enganchar la pestaña en ConfiguracionPage**

En `src/pages/ConfiguracionPage.jsx`, agregar los imports:

```jsx
import TabImportarParitaria from '../components/config/TabImportarParitaria'
import { puede } from '../utils/permisos'
```

Y leer los roles del store de auth, junto a las lecturas de `empresa` que ya existen (líneas 43-44). Mismo patrón que `Sidebar.jsx:55`:

```jsx
  const rol = useAuthStore((s) => s.rol)
  const rolesNomina = useAuthStore((s) => s.rolesNomina)
```

Cambiar el array `tabs` de la sección `convenios` (línea 31):

```jsx
    tabs: ['Escalas salariales', 'No remunerativos', 'Aportes y contribuciones', 'Adicionales', 'Importar paritaria', 'Mis convenios'],
```

Y agregar el render junto a los demás (después de la línea de `TabAdicionales`):

```jsx
          {pestana === 'Importar paritaria' && (
            rol === 'superadmin' || puede(rolesNomina, 'importar_paritaria')
              ? <TabImportarParitaria convenio={convenio} empresaId={empresaActiva.id} soloLectura={esGlobal} />
              : <div className="card">No tenés permiso para importar paritarias.</div>
          )}
```

- [ ] **Step 6: Correr toda la suite**

Run: `npm test`
Expected: PASS, incluidos los 4 tests de `ConfiguracionPage.test.jsx` que ya existían

- [ ] **Step 7: Commit**

```bash
git add src/components/config/TabImportarParitaria.jsx src/components/config/__tests__/TabImportarParitaria.test.jsx src/pages/ConfiguracionPage.jsx
git commit -m "feat: pestana de importacion de paritarias con revision de diff"
```

---

### Task 7: Verificación end-to-end con el acta real

- [ ] **Step 1: Importar el acta de calibración**

Con la app corriendo (`npm run dev`), ir a Configuración → Convenios, elegir el convenio **propio** (personalizarlo si hace falta) → Importar paritaria → zona `A` → subir `docs/fixtures/acta-76-75-junio-2026.pdf`.

Expected: aparecen **tres tramos** (2026-06-01, 2026-07-01, 2026-08-01), cada uno con las cinco categorías emparejadas y ninguna huérfana. "½ Oficial" tiene que caer en **Medio oficial**, no en Oficial.

- [ ] **Step 2: Confirmar el primer tramo y verificar en la base**

Aplicar solo la vigencia 2026-06-01 y correr:

```sql
SELECT nombre, basico, modalidad, vigencia_desde
FROM nom_categorias k
JOIN nom_convenios cv ON cv.id = k.convenio_id
WHERE cv.empresa_id IS NOT NULL AND k.vigencia_desde = DATE '2026-06-01'
ORDER BY nombre;
```

Expected: cinco filas con los básicos del acta. Las vigencias anteriores siguen intactas.

- [ ] **Step 3: Verificar que la revisión quedó registrada**

```sql
SELECT archivo_nombre, zona,
       jsonb_array_length(propuesta->'tramos') AS tramos_propuestos,
       jsonb_array_length(COALESCE(aplicado, '[]'::jsonb)) AS tramos_aplicados
FROM nom_importaciones ORDER BY created_at DESC LIMIT 1;
```

Expected: `tramos_propuestos = 3`, `tramos_aplicados = 1`. Esa diferencia es la evidencia de que hubo revisión humana.

- [ ] **Step 4: Probar el rechazo de archivos inválidos**

Subir un `.txt` renombrado a `.pdf`.
Expected: mensaje de error legible, sin filas nuevas en `nom_categorias`.

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "test: verificacion end-to-end del importador con acta 76/75"
```

---

## Fuera de alcance (Fase 2)

Documentado para que nadie lo implemente por las suyas:

- **Aportes, contribuciones y adicionales.** Viven en `nom_conceptos`, que tiene `UNIQUE (convenio_id, empresa_id, codigo)` y **ninguna columna de vigencia**. Importarlos hoy pisaría el valor y se perdería con qué porcentaje se liquidó cada período anterior. Fase 2 = versionar `nom_conceptos` + adaptar `liquidar-periodo`.
- **Pago de la SNR por mitades** (50 % con cada quincena) y **aporte solidario del 2 %** absorbido por la cuota sindical en afiliados: son reglas del motor, no del importador. El segundo además necesita un campo `afiliado_sindicato` en `nom_legajo`, que no existe.
- **Columna de zona en `nom_categorias`.** Hoy el usuario elige una zona al importar. Si alguna empresa llegara a operar en varias, eso cambia el esquema y arrastra al motor.
