# Liquidación: pestañas (general/individual) + vacaciones basadas en ausencias reales

**Fecha:** 2026-07-28
**Estado:** aprobado por el usuario (brainstorming conversacional, mockups revisados)

## Contexto

Dos problemas reportados sobre `LiquidacionPage`:

1. El selector de período (recuadros anidados por año → mes → botones de tipo) se ve mal y va a acumular información sin límite con el tiempo.
2. "Vacaciones" y "Liquidación final" son conceptualmente **individuales** (una persona a la vez) pero hoy se crean con el mismo formulario "Nuevo período" que crea períodos **masivos** (quincenas, mensual). Para "vacaciones" esto es un bug real: el período se crea sin `personalIds`, así que `liquidar-periodo` intenta liquidar vacaciones a **toda la nómina activa**.

Además, surgió un tercer problema al diseñar la solución: la fórmula actual de "vacaciones" (`calcularVacacionesNoGozadas`, por antigüedad) no tiene relación con los días de vacaciones realmente otorgados y registrados en Presencio como ausencia justificada. Hay que separar "vacaciones gozadas" (pagadas cuando la persona efectivamente se toma los días — este spec) de "vacaciones no gozadas" (indemnización por antigüedad al momento de la baja — liquidación final, **sin cambios**).

## Alcance

**Sí incluye:**
- Rediseño de `LiquidacionPage` en dos pestañas: "Períodos generales" y "Liquidaciones individuales".
- Selector de período compacto (`<select>` nativo agrupado por año → mes) reemplazando los recuadros anidados.
- El formulario "Nuevo período" pierde las opciones `vacaciones` y `final` de su `<select>` de tipo.
- Pestaña "Liquidaciones individuales": buscador de persona, generación de vacaciones (basada en ausencias reales) y de liquidación final (sin cambios de fórmula, solo reubicado), historial de liquidaciones individuales de todas las personas.
- Nueva tabla `nom_vacaciones_liquidadas` para trazabilidad sin escribir en tablas de Presencio.
- Nueva fórmula de "vacaciones" (período tipo `vacaciones`): días de la ausencia (o carga manual) × valor día, en vez de antigüedad.
- Acción de store `crearPeriodoVacaciones`, simétrica a `crearPeriodoFinal` (ya existente).

**No incluye (fuera de alcance, sin cambios):**
- La fórmula de "vacaciones no gozadas" dentro de la liquidación final (`calcularVacacionesNoGozadasUocra` / rama LCT de `calcularLiquidacionFinal`) — sigue por antigüedad, tal cual hoy.
- Escritura en tablas de Presencio (`ausencias`, `personal`, etc.) — se sigue respetando la regla de oro del repo (`0001_vistas_contrato.sql`).
- SAC (sigue siendo período masivo, sin cambios).

## Diseño

### 1. Estructura de la página (`LiquidacionPage.jsx`)

Dos pestañas con el mismo patrón que `ConfiguracionPage` (`PESTANAS` + `pestana === 'X' && <Componente/>`):

- **"Períodos generales"** — el contenido actual de `LiquidacionPage` (selector, calcular, tabla de resultados, flujo de aprobación, CSV), con dos cambios:
  - El componente `SelectorPeriodo` se reemplaza por un `<select>` nativo con `<optgroup label="{año}">` por año y, dentro, una opción por período usando `etiquetaPeriodo`/`etiquetaTipoPeriodo` (ya existen de la Fase 6). Se ordena descendente por fecha.
  - El `<select>` de "Nuevo período" pierde las opciones `vacaciones` y `final`.
- **"Liquidaciones individuales"** — pestaña nueva, componente `LiquidacionesIndividuales.jsx`:
  - Buscador de persona (`<input>` con filtro sobre `nom_v_personal`, mismo patrón que ya usa la búsqueda de la tabla de resultados).
  - Al elegir una persona, dos acciones (visibles según elegibilidad):
    - **"Generar vacaciones"** → abre el panel de vacaciones (ver sección 3).
    - **"Generar liquidación final"** → visible solo si `legajo.fechaBaja` existe y `legajo.liquidacionFinalId` es null (mismo criterio y misma acción `crearPeriodoFinal` que ya usa `FichaLegajoPage` — no se duplica lógica, se importa/reutiliza).
  - Debajo: tabla de historial — liquidaciones de tipo `vacaciones` o `final` de **todas** las personas de la empresa activa, con período (etiqueta), persona, neto, y botón de recibo (reutiliza `generarYDescargarRecibo`, ya extraído en la Fase 6).

### 2. Vacaciones — origen de datos y trazabilidad

**Tabla nueva** `nom_vacaciones_liquidadas` (migración `0034`):

```sql
CREATE TABLE nom_vacaciones_liquidadas (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id    UUID NOT NULL,
  ausencia_id    UUID,              -- id de nom_v_ausencias (Presencio); NULL si origen='manual'
  liquidacion_id UUID NOT NULL REFERENCES nom_liquidaciones(id) ON DELETE CASCADE,
  fecha_desde    DATE NOT NULL,
  fecha_hasta    DATE NOT NULL,
  dias           INT NOT NULL,
  origen         TEXT NOT NULL CHECK (origen IN ('presencio','manual')),
  created_at     TIMESTAMPTZ DEFAULT now()
);
```

Sin FK a `ausencias` (tabla de Presencio, fuera del esquema de Recursio) — se guarda el UUID suelto, consistente con cómo `nom_documentos_legajo.requerido_id` referencia solo tablas propias y las de Presencio se enlazan por id crudo.

**Flujo "Generar vacaciones":**
1. Se consulta `nom_v_ausencias` filtrando `personal_id`, `tipo = 'vacaciones'`, `estado = 'aprobada'`, excluyendo las que ya tengan una fila en `nom_vacaciones_liquidadas.ausencia_id`.
2. Si hay resultados, se listan para elegir (fecha_desde – fecha_hasta, días). Si el usuario no ve la que busca, o no hay ninguna, un toggle "Cargar manualmente" habilita inputs de fecha libres.
3. Al confirmar: `crearPeriodoVacaciones(personalId, fechaDesde, fechaHasta, empresaId, ausenciaId)` en `liquidacionStore.js` (simétrica a `crearPeriodoFinal`):
   - Crea `nom_periodos` con `tipo: 'vacaciones'`, esas fechas, `estado: 'abierto'`.
   - Invoca `liquidar-periodo` con `personalIds: [personalId]` (igual que `crearPeriodoFinal`).
   - Si sale bien, inserta la fila en `nom_vacaciones_liquidadas` (con `ausencia_id` o `null` + `origen` correspondiente).
   - Si la Edge Function falla, borra el período huérfano (mismo patrón ya existente en `crearPeriodoFinal`).

### 3. Fórmula de vacaciones (Edge Function)

En `liquidar-periodo/index.ts`, rama `periodo.tipo === 'vacaciones'` (línea ~828): se reemplaza el cálculo por antigüedad por:

```ts
const dias = diasEnRango(periodo.fecha_desde, periodo.fecha_hasta) // (hasta - desde) + 1
const montoDia = valorDiaVacaciones({ modalidad: legajo.jornada, sueldoMensual: insumos.sueldoMensual, valorHora: insumos.valorHora })
const monto = dias * montoDia
```

`valorDiaVacaciones` es una función pura nueva en `packages/motor/src/especiales.ts`, extraída de la lógica de `montoDia` que ya existe dentro de `calcularVacaciones` (mensual: `sueldoMensual / 25`; jornalizado: `valorHora * 8`) — se factoriza para reutilizarla sin arrastrar el cálculo de días por antigüedad. `calcularVacaciones` (la función completa, con antigüedad) queda intacta y se sigue usando tal cual en la liquidación final.

### 4. Testing

- `packages/motor/src/especiales.test.ts`: casos nuevos para `valorDiaVacaciones` (modalidad mensual y jornalizada) y para el monto resultante de días × valorDía.
- `src/store/__tests__/liquidacionStore.test.js`: `crearPeriodoVacaciones` — crea período con `personalIds`, inserta en `nom_vacaciones_liquidadas` al éxito, borra el período huérfano al fallar la Edge Function (mismo patrón que los tests existentes de `crearPeriodoFinal`).
- `src/pages/__tests__/LiquidacionesIndividuales.test.jsx` (nuevo componente): lista ausencias elegibles, excluye las ya liquidadas, toggle manual, llama a `crearPeriodoVacaciones` con los datos correctos, muestra/oculta "Generar liquidación final" según elegibilidad.
- Ajustar tests existentes de `LiquidacionPage` / `SelectorPeriodo` si alguno asume el layout viejo.

## Migraciones a aplicar (usuario, en Supabase SQL Editor)

- `0034_vacaciones_liquidadas.sql` (tabla + RLS, mismo patrón que `0032`).

## Preguntas ya resueltas en la conversación

- Layout: pestañas (opción A del mockup), no acordeón apilado.
- Selector de período: `<select>` nativo agrupado, no combobox con búsqueda.
- Contenido de la pestaña individual: buscador + generar primero, historial abajo (no lista de pendientes arriba).
- Origen de fechas de vacaciones: ausencia de Presencio si existe, override manual si no.
- Fórmula: días de la ausencia × valor día — solo para el período suelto "vacaciones"; la liquidación final no se toca.
