# Menú de configuración: escalas, no remunerativo, aportes/contribuciones y conceptos adicionales

Fecha: 2026-07-21
Repo: `recursio`, rama `dev`
Sigue a: `docs/2026-07-21-handoff-liquidacion-escalas-configurables.md`

## Objetivo

Hoy `nom_categorias` (básicos por puesto), `nom_parametros` (valores versionados) y
`nom_conceptos` (aportes, contribuciones, adicionales) solo se pueden cargar a mano por
SQL Editor. Este spec agrega pantallas dentro de la app para que el usuario cargue:

1. Básicos por puesto (categorías de convenio), versionados en el tiempo.
2. El valor "no remunerativo" del período (se carga a mano cada vez que cambia).
3. Aportes del trabajador, contribuciones patronales y conceptos adicionales
   (nominales o % de remunerativo/no remunerativo), sin escribir fórmulas a mano.

**No** se expone un editor de fórmula libre para conceptos nuevos (ya existe
`EditorReglas` para reglas condicionales sobre conceptos existentes — eso no cambia).

## Alcance de este spec

Incluye: 1 migración SQL, 3 stores nuevos/editados, 1 componente nuevo, edición de
`ConfiguracionPage.jsx` con tabs, y cambios puntuales en la Edge Function
`liquidar-periodo`. No incluye cambios en `packages/motor` (el intérprete ya soporta
todo lo necesario).

---

## 1. Migración SQL: `supabase/migrations/0012_concepto_categorias.sql`

Nueva tabla para que un concepto (`nom_conceptos`) se limite a ciertos puestos
(`nom_categorias`). **Si un concepto no tiene ninguna fila acá, aplica a todos los
puestos del convenio** (comportamiento actual, sin romper nada existente).

```sql
-- 0012_concepto_categorias.sql
CREATE TABLE IF NOT EXISTS nom_concepto_categorias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto_id  UUID NOT NULL REFERENCES nom_conceptos(id) ON DELETE CASCADE,
  categoria_id UUID NOT NULL REFERENCES nom_categorias(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (concepto_id, categoria_id)
);
ALTER TABLE nom_concepto_categorias ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que nom_concepto_reglas (0005): el aislamiento por empresa
-- se hereda del concepto vía EXISTS, no hay empresa_id propio en esta tabla.
DROP POLICY IF EXISTS nom_concepto_categorias_all ON nom_concepto_categorias;
CREATE POLICY nom_concepto_categorias_all ON nom_concepto_categorias FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_categorias.concepto_id
            AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_categorias.concepto_id
            AND c.empresa_id = auth_empresa_id())
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_concepto_categorias TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_concepto_categorias TO service_role;
CREATE INDEX IF NOT EXISTS nom_concepto_categorias_concepto_idx ON nom_concepto_categorias(concepto_id);
CREATE INDEX IF NOT EXISTS nom_concepto_categorias_categoria_idx ON nom_concepto_categorias(categoria_id);
```

Esta migración la aplica el usuario a mano en el SQL Editor de Supabase (mismo flujo
que las anteriores, ej. `0011_total_contribuciones.sql`). No hace falta que la
implementación la corra — solo dejarla creada en el repo.

---

## 2. Convención: cómo se genera la `formula` de un concepto sin que el usuario la escriba

Variables disponibles hoy en `variablesBase` dentro de la Edge Function (ver
`supabase/functions/liquidar-periodo/index.ts`): `basico_convenio`,
`horas_trabajadas`, `tardanzas`, `faltas_injustificadas`, `faltas_justificadas`,
`horas_extra_50`, `horas_extra_100`, `adelanto_monto`, `tope_sipa`. Además, dentro de
`packages/motor/src/motor.ts`, cada concepto tiene disponible `remunerativo_acumulado`
(suma de los conceptos `tipo: 'remunerativo'` ya procesados, en orden).

Este spec agrega una variable nueva: **`no_remunerativo`** (el valor cargado a mano en
`nom_parametros`, código `no_remunerativo`, vigente para el período — ver sección 5).

El formulario de conceptos (sección 6) no deja escribir fórmulas: el usuario elige un
**"tipo de concepto"** y una **"base de cálculo"**, y el código arma la fórmula. Función
pura nueva en `src/store/conceptosStore.js`:

```js
// baseCalculo: 'monto_fijo' | 'basico_convenio' | 'no_remunerativo_parametro'
//              | 'pct_remunerativo' | 'pct_no_remunerativo'
// valor: number (solo aplica a 'monto_fijo', 'pct_remunerativo', 'pct_no_remunerativo';
//         para 'basico_convenio' y 'no_remunerativo_parametro' se ignora, puede venir undefined)
export function generarFormula(baseCalculo, valor) {
  switch (baseCalculo) {
    case 'monto_fijo':
      return String(Number(valor) || 0)
    case 'basico_convenio':
      return 'basico_convenio'
    case 'no_remunerativo_parametro':
      return 'no_remunerativo'
    case 'pct_remunerativo':
      return `remunerativo_acumulado * ${(Number(valor) || 0) / 100}`
    case 'pct_no_remunerativo':
      return `no_remunerativo * ${(Number(valor) || 0) / 100}`
    default:
      throw new Error(`baseCalculo desconocida: ${baseCalculo}`)
  }
}
```

Esta función es pura (sin red) — debe tener tests unitarios (ver sección 8) igual que
`legajoFromDB`/`legajoToDB` en `src/store/__tests__/`.

**Por qué existen las opciones `basico_convenio` y `no_remunerativo_parametro`:** hoy no
hay ningún concepto seed cargado (`nom_conceptos` está vacía en instalaciones nuevas).
Para que el básico y el no remunerativo entren realmente en el bruto de la liquidación,
el usuario tiene que crear DOS conceptos "ancla" con este formulario:

- Un concepto tipo "adicional remunerativo", base "básico de convenio" → formula
  `basico_convenio`, `orden` bajo (ej. 1), para que sea el primero y
  `remunerativo_acumulado` lo incluya para los conceptos que calculan % sobre él.
- Un concepto tipo "adicional no remunerativo", base "valor no remunerativo del
  período" → formula `no_remunerativo`, `orden` bajo también.

Esto hay que explicarlo en la UI con un texto de ayuda (ver sección 6, "ayuda
contextual").

---

## 3. `src/store/categoriasStore.js` (nuevo)

Sigue el mismo patrón que `src/store/legajoStore.js` (mappers puros + store zustand +
contador de secuencia para descartar respuestas viejas).

```js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const categoriaFromDB = (r) => ({
  id: r.id, convenioId: r.convenio_id, nombre: r.nombre,
  basico: Number(r.basico), vigenciaDesde: r.vigencia_desde,
})

export const categoriaToDB = (c) => ({
  convenio_id: c.convenioId, nombre: c.nombre, basico: c.basico, vigencia_desde: c.vigenciaDesde,
})

let seqCategorias = 0

export const useCategoriasStore = create((set) => ({
  categorias: [], convenios: [], cargando: false, error: null,

  cargarConvenios: async (empresaId) => {
    const { data, error } = await supabase.from('nom_convenios').select('id, nombre')
      .or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order('nombre')
    if (error) { set({ error: error.message }); return }
    set({ convenios: data || [] })
  },

  cargarCategorias: async (convenioId) => {
    const miSeq = ++seqCategorias
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_categorias').select('*')
      .eq('convenio_id', convenioId).order('nombre').order('vigencia_desde', { ascending: false })
    if (miSeq !== seqCategorias) return
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ categorias: (data || []).map(categoriaFromDB), cargando: false })
  },

  // Insert-only: nunca UPDATE (histórico versionado). Un valor nuevo para el
  // mismo nombre+convenio con vigencia_desde distinta es una fila nueva.
  crearCategoria: async (categoria) => {
    const { data, error } = await supabase.from('nom_categorias').insert(categoriaToDB(categoria)).select().single()
    if (error) return { ok: false, error: error.message }
    return { ok: true, categoria: categoriaFromDB(data) }
  },
}))
```

Nota: `nom_categorias` no tiene `empresa_id` propio (se hereda de `convenio_id` →
`nom_convenios.empresa_id`, ver política RLS en `0002_nomina_core.sql`). Por eso
`crearCategoria` no recibe `empresaId`: alcanza con que `convenioId` sea de la empresa
activa, cosa que ya garantiza el `select` de `cargarConvenios`.

Test nuevo: `src/store/__tests__/categoriasStore.test.js`, cubriendo `categoriaFromDB`
y `categoriaToDB` (mappers puros, sin red — mismo estilo que
`src/store/__tests__/legajoStore.test.js` si existe, o si no existe, calcar el estilo
de test de `conceptosStore`).

---

## 4. `src/store/parametrosStore.js` (nuevo)

Para `nom_parametros` (código + valor + vigencia). Sirve tanto para `no_remunerativo`
como para `tope_sipa` u otros códigos futuros — el formulario de UI (sección 6) lo usa
con un `<select>` de códigos conocidos más opción "otro" (input libre).

```js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const parametroFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, codigo: r.codigo, valor: Number(r.valor),
  vigenciaDesde: r.vigencia_desde, vigenciaHasta: r.vigencia_hasta,
})

export const parametroToDB = (p, empresaId) => ({
  empresa_id: empresaId, codigo: p.codigo, valor: p.valor,
  vigencia_desde: p.vigenciaDesde, vigencia_hasta: p.vigenciaHasta || null,
})

let seqParametros = 0

export const useParametrosStore = create((set) => ({
  parametros: [], cargando: false, error: null,

  cargarParametros: async (empresaId) => {
    const miSeq = ++seqParametros
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_parametros').select('*')
      .eq('empresa_id', empresaId).order('codigo').order('vigencia_desde', { ascending: false })
    if (miSeq !== seqParametros) return
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ parametros: (data || []).map(parametroFromDB), cargando: false })
  },

  crearParametro: async (parametro, empresaId) => {
    const { data, error } = await supabase.from('nom_parametros').insert(parametroToDB(parametro, empresaId)).select().single()
    if (error) return { ok: false, error: error.message }
    return { ok: true, parametro: parametroFromDB(data) }
  },
}))
```

Test nuevo: `src/store/__tests__/parametrosStore.test.js` cubriendo los mappers.

---

## 5. Cambios en `supabase/functions/liquidar-periodo/index.ts`

### 5.a Nueva variable `no_remunerativo`

Agregar, junto a la lectura de `tope_sipa` (busca el bloque `topeRows` en el archivo
actual, alrededor de la línea 68), una lectura análoga:

```ts
const { data: noRemRows, error: errNoRem } = await supabase.from('nom_parametros').select('valor')
  .eq('empresa_id', periodo.empresa_id).eq('codigo', 'no_remunerativo')
  .lte('vigencia_desde', periodo.fecha_hasta)
  .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${periodo.fecha_desde}`)
  .order('vigencia_desde', { ascending: false }).limit(1)
```

Sumar `errNoRem` al chequeo combinado que ya existe para `errTope || errAdel` (renombrar
esa constante a algo tipo `errParams` o simplemente agregar `|| errNoRem` a la
condición existente). Luego:

```ts
const noRemunerativo = Number(noRemRows?.[0]?.valor ?? 0) // sin parámetro cargado: 0
```

Y agregarla a `variablesBase` (bloque que ya arma `basico_convenio`, `horas_trabajadas`,
etc.):

```ts
const variablesBase = {
  basico_convenio: basicoPorCategoria.get(legajo.categoria_id) ?? 0,
  no_remunerativo: noRemunerativo,
  horas_trabajadas: asistencia.horasTrabajadas,
  // ...resto sin cambios
}
```

### 5.b Filtrar conceptos por categoría (puesto)

Hoy `conceptosMotor` se arma una sola vez fuera del loop de personas. Hay que:

1. Traer también `nom_concepto_categorias` junto con los conceptos:

```ts
const { data: conceptos, error: errConceptos } = await supabase
  .from('nom_conceptos')
  .select('*, nom_concepto_reglas(*), nom_concepto_categorias(categoria_id)')
  .or(`empresa_id.is.null,empresa_id.eq.${periodo.empresa_id}`)
```

2. En el `.map` que arma `conceptosMotor`, guardar también las categorías permitidas
   (no pasarlas al motor, son solo para filtrar antes):

```ts
const conceptosConAlcance = (conceptos || []).map((c: any) => ({
  concepto: {
    codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, orden: c.orden, formula: c.formula, imprimible: c.imprimible,
    reglas: (c.nom_concepto_reglas || []).map((r: any) => ({ orden: r.orden, condicion: r.condicion, formula: r.formula })),
  },
  categoriasPermitidas: (c.nom_concepto_categorias || []).map((x: any) => x.categoria_id),
}))
```

3. Reemplazar la variable `conceptosMotor` (que antes se pasaba fija a
   `liquidarConceptos`) por un cálculo **dentro del loop `for (const persona of personal || [])`**,
   justo antes de llamar a `liquidarConceptos`:

```ts
const conceptosMotor: Concepto[] = conceptosConAlcance
  .filter((c) => c.categoriasPermitidas.length === 0 || c.categoriasPermitidas.includes(legajo.categoria_id))
  .map((c) => c.concepto)

const resultado = liquidarConceptos(conceptosMotor, variablesBase)
```

(Antes esa línea usaba la variable `conceptosMotor` de afuera del loop — ahora se
calcula por persona porque el alcance depende de `legajo.categoria_id`.)

No hace falta tocar `packages/motor/src/motor.ts` ni `interprete.ts`: el filtro pasa
ANTES de llamar al motor, el motor sigue recibiendo una lista plana de conceptos como
siempre.

---

## 6. UI: `ConfiguracionPage.jsx` con tabs

Reescribir `src/pages/ConfiguracionPage.jsx` para tener 3 pestañas simples (estado
local `useState('conceptos' | 'escalas' | 'parametros')`, sin librería de routing
nueva — son botones que cambian qué bloque se renderiza, mismo patrón que cualquier
tab casera en el resto del código). Mantener el bloque de conceptos existente (con
`EditorReglas`) dentro de la pestaña "Conceptos", agregándole el formulario de alta
nuevo arriba de la lista.

### 6.a Pestaña "Escalas" (básicos por puesto)

Usa `useCategoriasStore`. Necesita elegir convenio primero (select), después lista las
categorías de ese convenio agrupadas por nombre mostrando su historial de vigencias
(orden descendente por `vigenciaDesde`, la primera de cada grupo es la vigente), y un
formulario para agregar una fila nueva: nombre (input libre — o select con los nombres
ya usados en ese convenio + opción "nuevo"), básico (input number), vigencia desde
(input date). Botón "Guardar" llama `crearCategoria`. Sin edición ni borrado (histórico
insert-only, como ya se documentó en la sección 3).

### 6.b Pestaña "Parámetros" (no remunerativo, tope SIPA, etc.)

Usa `useParametrosStore`. Formulario: código (`<select>` con opciones fijas
`no_remunerativo` y `tope_sipa`, más un radio/checkbox "otro código" que habilita un
input libre), valor (number), vigencia desde (date), vigencia hasta (date, opcional).
Botón "Guardar" llama `crearParametro`. Debajo, tabla de parámetros ya cargados
agrupados por código, ordenados por vigencia descendente.

### 6.c Pestaña "Conceptos" (aportes, contribuciones, adicionales)

Arriba de la lista existente de conceptos (que no cambia), agregar un formulario de
alta nuevo, componente `src/components/config/FormularioConcepto.jsx`:

Campos:
- **Nombre** (input texto) → `nombre`
- **Código** (input texto, ej. `presentismo`) → `codigo`. Ayuda: "identificador único,
  sin espacios ni tildes".
- **Tipo de concepto** (`<select>`), 4 opciones que mapean a `tipo` de `nom_conceptos`:
  - "Adicional remunerativo" → `remunerativo`
  - "Adicional no remunerativo" → `no_remunerativo`
  - "Aporte del trabajador (descuento)" → `descuento`
  - "Contribución patronal" → `aporte_patronal`
- **Base de cálculo** (`<select>`), 5 opciones que mapean a `baseCalculo` (sección 2):
  - "Monto fijo en pesos" → `monto_fijo`
  - "Básico de convenio (ancla)" → `basico_convenio`
  - "Valor no remunerativo del período (ancla)" → `no_remunerativo_parametro`
  - "% del total remunerativo" → `pct_remunerativo`
  - "% del valor no remunerativo del período" → `pct_no_remunerativo`
- **Valor** (input number): visible y requerido solo si `baseCalculo` es
  `monto_fijo`, `pct_remunerativo` o `pct_no_remunerativo`; oculto para las opciones
  "ancla".
- **Orden** (input number): posición en la liquidación. Ayuda: "los conceptos con
  orden más bajo se calculan primero; si otro concepto usa '% del total
  remunerativo', este debe tener un orden más bajo que ese para contarlo".
- **Alcance** (checkboxes de las categorías del convenio activo, cargadas con
  `useCategoriasStore`): "Aplica a todos los puestos" (checkbox maestro, marcado por
  default) que, al destildarse, muestra la lista de categorías con checkboxes
  individuales.

Texto de ayuda fijo arriba del formulario (ver nota "conceptos ancla" de la
sección 2): explicar en 2-3 líneas que para que el básico y el no remunerativo
entren en el bruto, tiene que existir un concepto con base "Básico de convenio" y
otro con base "Valor no remunerativo del período".

Al guardar (botón "Crear concepto"):

1. Llamar `generarFormula(baseCalculo, valor)` para obtener la fórmula.
2. Insertar en `nom_conceptos` vía `conceptosStore` (agregar método `crearConcepto`
   análogo a `guardarConcepto` pero sin `id`, incluyendo `formula` generada).
3. Si el alcance no es "todos los puestos", insertar una fila en
   `nom_concepto_categorias` por cada categoría tildada (`concepto_id` +
   `categoria_id`), usando `supabase.from('nom_concepto_categorias').insert([...])`
   directo desde el componente o un método nuevo `guardarAlcanceConcepto` en
   `conceptosStore`.
4. Recargar conceptos (`cargarConceptos`).

`conceptosStore.js`: agregar

```js
crearConcepto: async (concepto, empresaId) => {
  const row = conceptoToDB(concepto, empresaId) // ya existe, reusar tal cual
  const { data, error } = await supabase.from('nom_conceptos').insert(row).select().single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, concepto: conceptoFromDB(data) }
},

guardarAlcanceConcepto: async (conceptoId, categoriaIds) => {
  if (!categoriaIds.length) return { ok: true }
  const rows = categoriaIds.map((categoria_id) => ({ concepto_id: conceptoId, categoria_id }))
  const { error } = await supabase.from('nom_concepto_categorias').insert(rows)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
},
```

`conceptoFromDB` también debería exponer el alcance para mostrarlo en la lista
existente (badge "todos los puestos" o "N puestos"): agregar
`nom_concepto_categorias(categoria_id)` al `select` de `cargarConceptos` (igual que ya
hace con `nom_concepto_reglas`) y mapear:

```js
categoriaIds: (r.nom_concepto_categorias || []).map((x) => x.categoria_id),
```

---

## 7. Ruteo

No hace falta ninguna ruta nueva: `ConfiguracionPage` ya está montada en
`/configuracion` (`src/App.jsx` línea 44). Las 3 pestañas viven dentro de esa misma
página.

---

## 8. Verificación / tests

- `src/store/__tests__/categoriasStore.test.js`: `categoriaFromDB`/`categoriaToDB`
  (mappers puros).
- `src/store/__tests__/parametrosStore.test.js`: `parametroFromDB`/`parametroToDB`.
- `src/store/__tests__/conceptosStore.test.js` (extender el existente si ya hay uno,
  o crearlo): `generarFormula` con los 5 casos de `baseCalculo` — este es el más
  importante porque de acá depende que la liquidación calcule bien.
- Correr `npx vitest run` desde la raíz del repo: debe seguir en verde (82 tests hoy
  + los nuevos).
- Manual, después de aplicar la migración 0012 en Supabase: crear un concepto
  "Básico" (tipo adicional remunerativo, base "Básico de convenio", orden 1), cargar
  un básico real en la pestaña Escalas, recalcular un período desde
  `LiquidacionPage`, y confirmar que el bruto deja de ser $0 (el problema pendiente
  descripto en el handoff del 2026-07-21).

---

## 9. Fuera de alcance (explícitamente, para no scope-creep)

- Edición o borrado de filas de `nom_categorias`/`nom_parametros` ya cargadas (son
  históricos insert-only; si se cargó mal, se carga una fila nueva corrigiendo).
- Edición de conceptos existentes desde este formulario nuevo (el botón "Crear
  concepto" solo inserta; para tocar reglas condicionales de un concepto ya creado se
  sigue usando `EditorReglas`, sin cambios).
- Reglas condicionales para el alcance por puesto (se resolvió con
  todos/selección de categorías, ver decisión del brainstorming).
- Formula libre para conceptos nuevos.
