# Fase 5C — Recibo de sueldo modelo AR + datos de empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recibo de sueldo con el layout real de un modelo AR (A4 apaisado, doble copia empleador/empleado, tabla de conceptos con código, monto en letras) y los datos fiscales de la empresa (CUIT, domicilio) resueltos correctamente — hoy esa query falla en silencio porque busca columnas que no existen.

**Architecture:** La tabla `empresas` es **compartida con Presencio** (definida en `fichaobra/supabase/migrations/000_01_schema.sql`, columnas `id, nombre, color_primario, color_secundario, logo_url, created_at`) — ya tiene `logo_url`, pero NO tiene `cuit` ni `domicilio`. `src/pages/LiquidacionPage.jsx` (`handleEmitirRecibo`, línea 97) ya intenta `supabase.from('empresas').select('nombre, cuit, domicilio')...` — esa query **falla hoy** (columnas inexistentes) y el catch silencioso deja `cuit`/`domicilio` en `'—'` siempre. En vez de alterar el esquema compartido con Presencio (Regla del plan maestro: "No tocar Presencio"), se crea una tabla satélite `nom_empresa_config (empresa_id PK, cuit, domicilio)` — mismo patrón `nom_*` que el resto del dominio de Nómina. El logo se **reutiliza** desde `empresas.logo_url` (ya existe, ya lo administra Presencio/Superadmin) — no se crea ningún bucket nuevo ni UI de upload en Recursio. `src/utils/reciboPdf.js` (ya existe, 45 líneas, formato simple de una columna) se **rediseña** — no se crea desde cero — a A4 apaisado con dos mitades (empleador/empleado), logo, tabla de conceptos y monto en letras.

**Tech Stack:** React 19, Vite, jsPDF (ya en el repo), Supabase, Vitest.

---

## Task 40: Migración 0021 — `nom_empresa_config` (CUIT y domicilio)

**Files:**
- Create: `supabase/migrations/0021_empresa_config.sql`

- [ ] **Step 1:** Crear la migración:

```sql
-- 0021_empresa_config.sql
-- Datos fiscales de la empresa para el recibo (CUIT, domicilio) — en una
-- tabla satélite propia de Nómina, NO en `empresas` (esa tabla es
-- compartida con Presencio; el plan maestro prohíbe tocar su esquema). El
-- logo se reutiliza de `empresas.logo_url`, que ya existe y ya administra
-- Presencio/Superadmin — no se duplica acá.
CREATE TABLE IF NOT EXISTS nom_empresa_config (
  empresa_id  UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  cuit        TEXT,
  domicilio   TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_empresa_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nom_empresa_config_rw ON nom_empresa_config;
CREATE POLICY nom_empresa_config_rw ON nom_empresa_config FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_empresa_config TO authenticated;
```

- [ ] **Step 2:** Avisar al usuario que la aplique en Supabase (SQL Editor).
- [ ] **Step 3:** Commit: `git add supabase/migrations/0021_empresa_config.sql && git commit -m "feat(db): migracion 0021 nom_empresa_config (cuit y domicilio)"`

## Task 41: `numeroALetras.js` — monto en letras (es-AR)

**Files:**
- Create: `src/utils/numeroALetras.js`
- Create: `src/utils/__tests__/numeroALetras.test.js`

- [ ] **Step 1: Test que falla**

```js
// src/utils/__tests__/numeroALetras.test.js
import { describe, it, expect } from 'vitest'
import { numeroALetras } from '../numeroALetras'

describe('numeroALetras', () => {
  it('cero', () => expect(numeroALetras(0)).toBe('Cero Pesos con 00/100'))
  it('solo centavos', () => expect(numeroALetras(0.95)).toBe('Cero Pesos con 95/100'))
  it('miles con decimales', () => expect(numeroALetras(2393.95)).toBe('Dos mil trescientos noventa y tres Pesos con 95/100'))
  it('un millon exacto', () => expect(numeroALetras(1000000)).toBe('Un millón Pesos con 00/100'))
  it('mil uno (sin "un" antes de mil)', () => expect(numeroALetras(1001)).toBe('Mil uno Pesos con 00/100'))
  it('veintiuno', () => expect(numeroALetras(21)).toBe('Veintiuno Pesos con 00/100'))
  it('dieciseis', () => expect(numeroALetras(16)).toBe('Dieciséis Pesos con 00/100'))
  it('cien exacto (no "ciento")', () => expect(numeroALetras(100)).toBe('Cien Pesos con 00/100'))
  it('ciento uno', () => expect(numeroALetras(101)).toBe('Ciento uno Pesos con 00/100'))
})
```

- [ ] **Step 2:** Run `npx vitest run src/utils/__tests__/numeroALetras.test.js` → Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementación.** Escribir `src/utils/numeroALetras.js` con una función pura `numeroALetras(monto)` que satisfaga los 9 casos de arriba. Reglas es-AR a implementar (contrato, no pseudocódigo — la unidad de estas reglas SON los tests, iterar sobre la implementación hasta que los 9 pasen):
  - Unidades 0-29 con las formas irregulares del español (`dieciséis`, no "diez y seis"; `veintiuno`, no "veinte y uno").
  - Decenas 30-90 se unen a unidades con `" y "` (ej. "noventa y tres"), salvo exactamente 30/40/.../90.
  - Centenas: `cien` para exactamente 100; `ciento` + resto para 101-199; formas irregulares `quinientos`, `setecientos`, `novecientos` (no "cincocientos"/"sietecientos"/"nuevecientos").
  - Miles: `mil` sin "un" adelante para 1000-1999 (`"mil uno"`, no `"un mil uno"`); `<N> mil` para 2000+.
  - Millones: `"un millón"` para exactamente 1, `"<N> millones"` para 2+.
  - Formato final: `"<Entero en letras, con mayúscula inicial> Pesos con <centavos de 2 dígitos>/100"`. `Math.round` para los centavos (evitar errores de punto flotante: `Math.round((monto - Math.floor(monto)) * 100)`).

- [ ] **Step 4:** Run → PASS (9 tests). `npx vitest run` completo → PASS, sin regresiones. Commit: `git add src/utils/numeroALetras.js src/utils/__tests__/numeroALetras.test.js && git commit -m "feat(recibo): numeroALetras para el monto en letras del recibo"`

## Task 42: Sección "Empresa" en Configuración (CUIT, domicilio, logo de solo lectura)

**Files:**
- Create: `src/store/empresaConfigStore.js`
- Create: `src/store/__tests__/empresaConfigStore.test.js`
- Create: `src/components/config/TabEmpresa.jsx`
- Modify: `src/pages/ConfiguracionPage.jsx` (agregar pestaña "Empresa")

- [ ] **Step 1: Test que falla**

```js
// src/store/__tests__/empresaConfigStore.test.js
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabla) => {
      if (tabla === 'nom_empresa_config') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { empresa_id: 'e1', cuit: '30-12345678-9', domicilio: 'Av. Siempre Viva 123' }, error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      if (tabla === 'empresas') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { nombre: 'Asset', logo_url: 'https://x/logo.png' }, error: null }),
        }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    }),
  },
}))

import { useEmpresaConfigStore } from '../empresaConfigStore'

describe('useEmpresaConfigStore', () => {
  it('cargar trae cuit/domicilio de nom_empresa_config y nombre/logo de empresas', async () => {
    await useEmpresaConfigStore.getState().cargar('e1')
    const s = useEmpresaConfigStore.getState()
    expect(s.cuit).toBe('30-12345678-9')
    expect(s.domicilio).toBe('Av. Siempre Viva 123')
    expect(s.nombre).toBe('Asset')
    expect(s.logoUrl).toBe('https://x/logo.png')
  })

  it('guardar hace upsert en nom_empresa_config', async () => {
    const r = await useEmpresaConfigStore.getState().guardar('e1', { cuit: '30-1-9', domicilio: 'X 1' })
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 2:** Run `npx vitest run src/store/__tests__/empresaConfigStore.test.js` → FAIL (módulo no existe).

- [ ] **Step 3: Implementación**

```js
// src/store/empresaConfigStore.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// CUIT/domicilio viven en nom_empresa_config (tabla satélite, ver migración
// 0021); nombre y logo se leen de `empresas` (compartida con Presencio,
// nunca se escribe acá — el logo lo administra Presencio/Superadmin).
export const useEmpresaConfigStore = create((set) => ({
  cuit: '', domicilio: '', nombre: '', logoUrl: null, cargando: false, error: null,

  cargar: async (empresaId) => {
    set({ cargando: true, error: null })
    const [{ data: config, error: e1 }, { data: empresa, error: e2 }] = await Promise.all([
      supabase.from('nom_empresa_config').select('*').eq('empresa_id', empresaId).maybeSingle(),
      supabase.from('empresas').select('nombre, logo_url').eq('id', empresaId).single(),
    ])
    if (e1 || e2) { set({ error: (e1 || e2).message, cargando: false }); return }
    set({
      cuit: config?.cuit || '', domicilio: config?.domicilio || '',
      nombre: empresa?.nombre || '', logoUrl: empresa?.logo_url || null,
      cargando: false,
    })
  },

  guardar: async (empresaId, { cuit, domicilio }) => {
    const { error } = await supabase.from('nom_empresa_config')
      .upsert({ empresa_id: empresaId, cuit, domicilio }, { onConflict: 'empresa_id' })
    if (error) return { ok: false, error: error.message }
    set({ cuit, domicilio })
    return { ok: true }
  },
}))
```

- [ ] **Step 4:** Run → PASS (2 tests). Commit: `git add src/store/empresaConfigStore.js src/store/__tests__/empresaConfigStore.test.js && git commit -m "feat(recibo): store de datos fiscales de empresa (cuit, domicilio)"`

- [ ] **Step 5: `TabEmpresa.jsx`** — formulario simple: inputs "CUIT" y "Domicilio" con botón "Guardar"; muestra el logo (`<img src={logoUrl} />`, con placeholder si es `null`) y un texto fijo "El logo se administra desde Superadmin/Presencio." (sin botón de upload — no se construye esa UI en esta tarea). Sin test de componente (mismo criterio que otros Tabs simples del repo, ej. `TabParametros.jsx` — verificar si ese ya tiene test antes de decidir; si SÍ lo tiene, seguir el mismo patrón acá).

- [ ] **Step 6: Enganchar en `ConfiguracionPage.jsx`.** Agregar `'Empresa'` a `PESTANAS` y renderizar `<TabEmpresa empresaId={empresaActiva?.id} />` cuando esa pestaña esté activa (seguir el patrón exacto de cómo se renderizan las otras pestañas condicionalmente en el archivo — leerlo completo antes de editar).

- [ ] **Step 7:** `npx vitest run` completo → PASS, sin regresiones. Commit: `git add src/components/config/TabEmpresa.jsx src/pages/ConfiguracionPage.jsx && git commit -m "feat(recibo): pestana Empresa en Configuracion (cuit, domicilio, logo de solo lectura)"`

## Task 43: Recibo doble copia (A4 apaisado, logo, tabla de conceptos, monto en letras) [⚙️ esfuerzo medio]

**Contexto exacto:** `src/utils/reciboPdf.js` (45 líneas, ya leído completo) exporta `generarReciboPdf({ empresa, persona, periodo, items, neto })` con jsPDF vertical, una sola columna, sin logo, sin tabla. Se **reemplaza el contenido de la función**, no se crea un archivo nuevo — la firma se extiende (agrega `codigoRecibo`, `logoBase64` opcional, y separa `remunerativo`/`no_remunerativo`/`descuento`/`aporte_patronal` que ya vienen tipados en `items`).

**Referencia visual:** recibo UOCRA modelo AR provisto por el usuario en la conversación original (dos copias idénticas lado a lado, izquierda "Firma Empleador" / derecha "Firma Empleado" con la leyenda de recepción agregada solo del lado derecho).

**Files:**
- Modify: `src/utils/reciboPdf.js`
- Create: `src/utils/__tests__/reciboPdf.test.js` (si no existe ya — VERIFICAR primero con `find src/utils -iname "*reciboPdf*test*"`; si ya existe, leerlo completo y extender sus casos en vez de reescribirlo)
- Modify: `src/pages/LiquidacionPage.jsx` (`handleEmitirRecibo`: traer `cuit`/`domicilio` de `nom_empresa_config` y `logo_url` de `empresas`, y el `codigo_recibo` de cada item si `nom_liquidacion_items` lo tiene — verificar con `grep -n "codigo_recibo" supabase/migrations/*.sql src/pages/LiquidacionPage.jsx` si ya está disponible ahí o si el "Known limitation" de la Fase 5B (Task 9: `nom_liquidacion_items` no persiste `codigo_recibo`) sigue vigente; si sigue faltando, usar `concepto_codigo` tal cual está hoy y anotarlo, NO bloquear esta tarea por eso)

- [ ] **Step 1: Leer** `src/utils/reciboPdf.js` completo (ya transcripto arriba en el contexto de esta sesión) y, si existe, su test actual.

- [ ] **Step 2: Reescribir `generarReciboPdf`.** Layout:
  - `new jsPDF({ orientation: 'landscape', format: 'a4' })` — ancho útil total dividido en dos mitades iguales con un margen central; una función interna `dibujarCopia(offsetX, anchoMitad, esCopiaEmpleado)` que dibuja todo el contenido dentro de esa mitad, invocada dos veces (`dibujarCopia(0, ...)` y `dibujarCopia(anchoMitad, ...)`).
  - Encabezado de cada mitad: si `empresa.logoBase64` está presente, `doc.addImage(empresa.logoBase64, 'PNG', x, y, 20, 20)` (formato a confirmar con el dato real; si `logoBase64` es `null`, saltear sin romper el layout) + `empresa.nombre` + `CUIT: ${empresa.cuit}` + `empresa.domicilio` + título "RECIBO DE REMUNERACIONES" + `Período: ${periodo.descripcion}`.
  - Bloque empleado: Legajo, Apellido y Nombres, CUIL, Fecha Ing., Categoría.
  - Tabla de conceptos con columnas `Cod | Concepto | Hab. C/Desc. | Hab. S/Desc. | Deducciones` — remunerativo → "Hab. C/Desc.", no_remunerativo → "Hab. S/Desc.", descuento/aporte_patronal → "Deducciones" (usar `doc.text` con columnas de `x` fijas dentro de la mitad, sin librería de tablas adicional — mismo estilo manual que ya usa el archivo).
  - Pie: TOTALES por columna, NETO, `"Son Pesos: " + numeroALetras(neto)` (importar de `../utils/numeroALetras`, Task 41), línea de firma ("Firma Empleador" a la izquierda, "Firma Empleado" a la derecha).
  - Leyenda extra SOLO en la copia derecha (empleado): *"Recibí el importe neto y duplicado de la presente liquidación en pago de mi remuneración correspondiente al período indicado."*

- [ ] **Step 3:** Test — si no existía `reciboPdf.test.js`, crear uno mínimo que solo verifique que `generarReciboPdf({...datos mínimos...})` no tira excepción y devuelve una instancia con `.internal.pageSize.getWidth() > .getHeight()` (confirma orientación apaisada). Un test de contenido visual exacto de PDF no es práctico con jsPDF — el criterio real de aceptación es la revisión visual del usuario (ver Step 5).

- [ ] **Step 4: `LiquidacionPage.jsx`.** En `handleEmitirRecibo`, agregar la lectura de `nom_empresa_config` (además de la ya existente a `empresas`) y pasar `cuit`/`domicilio` de ahí en vez de (o combinados con) la query vieja a `empresas` que hoy pide columnas inexistentes — **corregir ese bug real** cambiando la query de `empresas` a `select('nombre, logo_url')` únicamente (sin `cuit, domicilio`, que ya no existen ahí) y agregando la query a `nom_empresa_config` para esos dos campos. Si `logo_url` existe, convertirlo a base64 antes de pasarlo a `generarReciboPdf` (usar `fetch(logoUrl).then(r => r.blob())` + `FileReader` para base64 — envuelto en `try/catch`: si falla la descarga del logo, el recibo se genera igual sin logo, nunca bloquea la emisión).

- [ ] **Step 5:** `npx vitest run` completo → PASS, sin regresiones. Commit: `git add src/utils/reciboPdf.js src/utils/__tests__/reciboPdf.test.js src/pages/LiquidacionPage.jsx && git commit -m "feat(recibo): layout doble copia A4 apaisado con logo, tabla de conceptos y monto en letras"`
- [ ] **Step 6:** Prueba manual guiada del usuario: emitir un recibo real de un legajo con datos completos y confirmar visualmente que el layout reproduce el modelo AR provisto (dos copias, logo, tabla, monto en letras coincide con el neto). Este es el criterio de aceptación final de la Fase 5C — anotar el resultado en el commit o en un comentario de seguimiento.

---

## Verificación final de la sub-fase (Tasks 40-43)

- [ ] `npx vitest run` completo en verde, sin regresiones vs. la base previa (172 tests al cierre de la Fase 5I).
- [ ] Confirmar con el usuario que aplicó la migración `0021_empresa_config.sql`.
- [ ] Confirmar que cargó CUIT/domicilio de al menos una empresa de prueba desde la pestaña "Empresa" nueva, para poder probar el recibo con datos reales (sin esto, el recibo emite con `cuit`/`domicilio` vacíos, no rotos, pero incompletos).
- [ ] Nota para el usuario: si más adelante se quiere permitir subir un logo distinto por empresa DESDE Recursio (no reusar el de Presencio), eso es trabajo nuevo no cubierto acá — hoy el logo del recibo es el mismo que usa Presencio para esa empresa.
