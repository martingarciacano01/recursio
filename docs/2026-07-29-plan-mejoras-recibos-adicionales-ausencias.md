# Plan de mejoras — recibos, adicionales, ausencias y CSV

Fecha: 2026-07-29
Alcance: 6 pedidos sobre Liquidaciones / Recibos / Legajo / Configuración.

Orden de ejecución sugerido: **4 → 5 → 2 → 3 → 1**, con **6 en paralelo**
(primero los bugs que ensucian los números, después las features; el ZIP se hace
último porque conviene que el recibo ya salga bien antes de generarlos en lote.
El rediseño del legajo no toca cálculo, así que puede ir en cualquier momento).

---

## 1. Selección múltiple de recibos + descarga en ZIP

**Estado actual.** `LiquidacionPage.jsx` emite de a uno: `handleEmitirRecibo(l)`
→ `generarYDescargarRecibo()` → RPC `emitir_recibo` → `doc.save()`. No hay
selección ni descarga masiva. `jszip` no está en `package.json`.

**Decisión tomada.** El ZIP **emite y numera**: cada PDF pasa por
`emitir_recibo` (queda con número y hash, auditable).

**Cambios**

| Archivo | Cambio |
|---|---|
| `package.json` | agregar `jszip` (~100 kB) |
| `src/utils/reciboZip.js` *(nuevo)* | `generarZipRecibos({ liquidaciones, ...deps, onProgreso })`: itera secuencial, reutiliza `generarYDescargarRecibo` sin `doc.save()`, llama `emitirRecibo`, mete `doc.output('arraybuffer')` en el zip. Devuelve `{ blob, emitidos, fallidos[] }`. Import dinámico de jszip (mismo patrón que `cargarJsPDF.js`). |
| `src/utils/emitirReciboLegajo.js` | cachear `datosReciboDesdeSupabase` por `empresaId` (hoy hace 3 queries + logo **por persona**; con 30 recibos son 90 queries y 30 descargas del mismo logo). Extraer `cargarDatosEmpresa(empresaId)` una sola vez y pasarla como parámetro. |
| `src/pages/LiquidacionPage.jsx` | estado `seleccionadas: Set<liquidacionId>`; checkbox por fila + checkbox "todos" en el `<th>` (indeterminate cuando es parcial); botón "Descargar recibos (N)" junto a *Descargar CSV*; barra de progreso "12 de 27"; panel de errores por persona al terminar. Deshabilitar checkbox en liquidaciones anuladas o sin items. |

**Detalles**
- Nombre dentro del zip: `recibo-<numero>-<nombre>.pdf`; nombre del zip:
  `recibos-<tipo>-<fecha_desde>.zip`.
- Secuencial, no `Promise.all`: `emitir_recibo` asigna números correlativos y en
  paralelo se pisan / se saltean números.
- Si una persona falla, se sigue con el resto y se reporta al final (no abortar
  el lote entero).
- Al terminar: `cargarLiquidaciones()` para refrescar los números de recibo.

**Tests**: `src/utils/__tests__/reciboZip.test.js` — todos ok; una falla en el
medio no corta el lote; nombres de archivo; no se emite dos veces la misma
liquidación.

---

## 2. Básico por hora en el recibo (BASE = valor hora, UNIDAD = horas)

**Estado actual.** El concepto `basico` (migración 0031) tiene fórmula
`basico_periodo` y config `{"recibo":{"grupo":"remunerativo"}}` — sin `modo`,
sin `unidadFormula`, sin `baseFormula`. En `motor.ts` eso deja
`unidadTexto = null` y `baseCalculo = null`, así que en el PDF las columnas
UNIDAD y BASE del básico salen vacías.

`calcularBasicoPeriodo` (modalidad `hora`) hace `basico * horasTrabajadas` con
horas fraccionarias (71,26).

**Decisión tomada.** El redondeo **también afecta el cálculo**:
`basico_periodo = valor_hora × ceil(horas_trabajadas)`. Así BASE × UNIDAD =
MONTO y el recibo es aritméticamente verificable.

**Cambios**

| Archivo | Cambio |
|---|---|
| `packages/motor/src/interprete.ts` | agregar función `ceil(x)` (hoy solo hay `min`, `max`, `round`). |
| `packages/motor/src/basico.ts` | en modalidad `hora`: `p.basico * Math.ceil(p.horasTrabajadas)`. Devolver también `horasLiquidadas` y `valorHora` → cambiar la firma a `{ monto, horasLiquidadas, valorHora }` (romper el retorno escalar a propósito, para que el compilador marque todos los call sites). |
| `supabase/functions/liquidar-periodo/index.ts` | exponer en `variablesBase`: `valor_hora` (el `basico` de la escala cuando la modalidad es `hora`, si no `0`) y `horas_liquidadas` (`ceil(horas_trabajadas)`). Guardar `horas_liquidadas` dentro de `detalle_horas` para que el CSV y la grilla puedan mostrarlo. |
| `supabase/migrations/0039_basico_unidad_base.sql` *(nuevo)* | `UPDATE nom_conceptos SET config = ...` para el concepto `basico`, agregando `recibo.unidadFormula = 'horas_liquidadas'` y `recibo.baseFormula = 'valor_hora'`. Idempotente (`WHERE codigo = 'basico'`, merge con `jsonb_set`). |
| `scripts/reseed-completo.sql` | mismo config en el seed, para que una base nueva nazca correcta. |

**Ojo — modalidades mensual/quincenal.** Para esas escalas `valor_hora` es 0 y
la unidad no son horas. Definir en la misma migración:
`unidadFormula = 'dias_liquidados'` / `baseFormula = 'basico_convenio'`, o dejar
el config del básico distinto según modalidad. **Pendiente de decidir**: hoy hay
un único concepto `basico` compartido por las tres modalidades, así que la
fórmula de unidad tiene que ser condicional. Opción más simple: que el motor
resuelva `unidad_basico` y `base_basico` como dos variables más, calculadas en la
Edge Function según modalidad, y que el config apunte a esas dos variables
genéricas.

**Tests**
- `basico.test.ts`: 71,26 h → 72 h; 78,00 h → 78 (no sube a 79); 0 h → 0.
- `interprete.test.ts`: `ceil`.
- `reciboPdf.test.js` / `reciboLayout.test.js`: la fila del básico trae
  UNIDAD y BASE no nulas.

**Riesgo.** Cambia montos de períodos ya calculados. Recalcular solo períodos
**abiertos**; los cerrados quedan con el criterio viejo (no reliquidar hacia
atrás sin aviso).

---

## 3. Adicionales por empleado (ej. trabajo en altura)

**Estado actual.** Los adicionales viven en `nom_conceptos` a nivel **convenio**
(`TabAdicionales.jsx` + `FormularioConcepto.jsx`), con modo `porcentaje` o
`nominal`, y se filtran por **categoría** (`filtrarPorCategoria` en `motor.ts`).
No hay forma de decir "esta persona cobra altura y esta otra no" sin inventar
una categoría por combinación.

**Decisión tomada.** Asignación **en la ficha del legajo**, con override
opcional de valor (% del básico o monto fijo).

**Cambios**

| Archivo | Cambio |
|---|---|
| `supabase/migrations/0040_adicionales_por_legajo.sql` *(nuevo)* | tabla `nom_legajo_adicionales` (`id`, `empresa_id`, `legajo_id` FK→`nom_legajo`, `concepto_id` FK→`nom_conceptos`, `modo` `'porcentaje'\|'nominal'\|'heredado'`, `porcentaje` NUMERIC, `monto` NUMERIC, `vigencia_desde` DATE, `vigencia_hasta` DATE NULL, `created_at`). UNIQUE `(legajo_id, concepto_id, vigencia_desde)`. RLS por `empresa_id` igual que `nom_legajo`. GRANT SELECT a `service_role` (lo lee la Edge Function). |
| `nom_conceptos` | agregar `asignacion TEXT DEFAULT 'categoria' CHECK (asignacion IN ('categoria','legajo'))`. Un adicional marcado `legajo` **no** se aplica por categoría: solo a quien lo tenga asignado. |
| `packages/motor/src/motor.ts` | nueva `filtrarAsignados(conceptos, categoriaNombre, asignadosPorLegajo)`: los `asignacion='categoria'` siguen la lógica actual; los `asignacion='legajo'` entran solo si están en el set, y con la fórmula pisada por el override. |
| `supabase/functions/liquidar-periodo/index.ts` | cargar `nom_legajo_adicionales` en lote (`partirEnLotes`, igual que fichajes/ausencias), agrupar por legajo, y aplicar el override generando la fórmula con `generarFormula(config)` antes de llamar a `liquidarConceptos`. Filtrar por vigencia contra `periodo.fecha_hasta`. |
| `src/components/config/FormularioConcepto.jsx` | selector "Aplica a: todas las categorías / categorías elegidas / **empleados asignados**" → escribe `asignacion`. |
| `src/components/legajo/TabAdicionalesLegajo.jsx` *(nuevo)* | lista de adicionales del convenio con `asignacion='legajo'`; checkbox de asignación + campos de override (% o monto) + vigencia. |
| `src/pages/FichaLegajoPage.jsx` | nueva pestaña "Adicionales". |
| `src/store/legajoStore.js` | acciones `cargarAdicionalesLegajo` / `guardarAdicionalLegajo` / `quitarAdicionalLegajo`. |

**Base del porcentaje.** Para "% del básico" hace falta que la variable
`basico_periodo` esté disponible como base en `formulas.ts` (hoy las bases son
`remunerativo` / `no_remunerativo` / `ambos` / `acumulado_mensual`). Agregar
`basico` → `basico_periodo` a `BASES` y a `BASES_EXPR` en `motor.ts`.

**Tests**: `motor.test.ts` (asignados vs no asignados, override de %,
override nominal), test del componente de la pestaña, y un caso end-to-end en
`packages/motor/golden`.

---

## 4. BUG — las ausencias de Presencio no se están tomando

**Diagnóstico (hipótesis principal, muy probable).**

`liquidar-periodo/index.ts:358`:

```ts
supabase.from('nom_v_ausencias').select('*').in('personal_id', lote).eq('estado', 'aprobada')
```

Del lado de Presencio (`fichaobra/src/store/appStore.js`):

- `ausenciaToDB()` incluye `estado` **solo si `a.estado` es truthy**
  (`...(a.estado ? { estado: a.estado } : {})`), así que el alta normal de una
  ausencia inserta la fila **sin** `estado`.
- `ausenciaFromDB()` compensa en el cliente con `estado: r.estado || 'aprobada'`
  — por eso en Presencio *se ven* aprobadas, pero en la base el valor es NULL
  (o el default de la columna, que hay que verificar).
- `aprobarAusencia()` sí escribe `'aprobada'`, pero solo se usa en el flujo de
  aprobación de **vacaciones**.

Resultado: `.eq('estado','aprobada')` descarta las ausencias con `estado` NULL →
`construirDiasPeriodo` marca `ausenciaAprobada: false` → todo cae en
`faltasInjustificadas`. Coincide con lo que se ve en pantalla: Juan Martín y
Arévalo con **11 faltas injustificadas** y bruto $0.

**Hipótesis secundarias a descartar en el mismo paso**
1. `nom_v_ausencias` es `security_invoker = true` y la Edge Function usa
   `service_role`: verificar que el GRANT de la migración 0010 sobre la tabla
   base `ausencias` esté efectivamente aplicado en prod (si no, la query
   devuelve 0 filas o error).
2. Filtro de fechas: la query trae **todas** las ausencias históricas de la
   persona, sin acotar al período — funciona, pero conviene acotar
   (`.lte('fecha_desde', periodo.fecha_hasta).gte('fecha_hasta', periodo.fecha_desde)`).
3. `empresa_id`: la query no filtra por empresa. Con `personal_id` alcanza, pero
   conviene agregarlo por consistencia con el resto.

**Paso 0 — verificación antes de tocar código**

```sql
SELECT estado, count(*) FROM ausencias GROUP BY estado;
SELECT id, personal_id, desde, hasta, tipo, estado
FROM ausencias
WHERE personal_id IN ('<juan>','<arevalo>') AND hasta >= '2026-07-01';
```

**Cambios (una vez confirmado)**

| Archivo | Cambio |
|---|---|
| `supabase/functions/liquidar-periodo/index.ts` | cambiar el filtro a `.or('estado.is.null,estado.eq.aprobada')` y **excluir explícitamente** `rechazada` / `pendiente`. Agregar el filtro de rango de fechas y `empresa_id`. |
| `supabase/migrations/0041_backfill_estado_ausencias.sql` *(nuevo)* | `UPDATE ausencias SET estado='aprobada' WHERE estado IS NULL;` + `ALTER COLUMN estado SET DEFAULT 'aprobada'` + `SET NOT NULL`. **Requiere tu OK explícito**: escribe sobre una tabla de Presencio. |
| `fichaobra/src/store/appStore.js` | `ausenciaToDB`: escribir siempre `estado: a.estado \|\| 'aprobada'`, para que no se sigan creando filas sin estado. |
| `src/pages/LiquidacionPage.jsx` | en el panel de avisos, mostrar cuántas ausencias se computaron por persona — hoy no hay forma de ver desde Recursio si el dato llegó o no. |

**Tests**: `asistencia.test.ts` — una ausencia que cubre el día lo cuenta como
falta **justificada**; ausencia parcial (solo algunos días del rango); ausencia
que empieza antes del período y termina adentro.

**Nota aparte.** Aun con las ausencias arregladas, `calcularBasicoPeriodo` en
modalidad `mensual` descuenta solo `faltasInjustificadas` — las justificadas se
pagan enteras. Confirmar que ese es el criterio deseado (para enfermedad con
certificado sí; para licencia sin goce de sueldo, no).

---

## 5. BUG — valores del CSV mal formateados

**Diagnóstico.** `src/utils/exportCsv.js` usa `;` como separador (correcto para
Excel es-AR) pero escribe los números con `String(v)`, o sea **punto decimal**:
`352594.48`. Excel en configuración regional es-AR interpreta el punto como
separador de **miles**, no de decimales → `352594.48` deja de ser un número
válido y termina en el disparate que se ve en pantalla
(`35.259.448.000.000.000`).

Se suma el aviso de Excel *"Posible pérdida de datos… guárdelo como archivo de
Excel"*, que aparece por abrir el `.csv` directamente.

**Cambios**

| Archivo | Cambio |
|---|---|
| `src/utils/exportCsv.js` | soportar columnas tipadas: `{ titulo, valor, tipo: 'numero' \| 'texto' }`. Para `numero`, formatear con `toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })` → `352594,48`. Sin separador de miles (rompería el parseo). Mantener el BOM. |
| `src/pages/LiquidacionPage.jsx` | marcar `tipo: 'numero'` en Horas, HE 50%, HE 100%, Bruto, Aportes, Contribuciones, Neto. Agregar columnas Tardanzas / Faltas inj. / Faltas just. / Horas liquidadas, que hoy se ven en la grilla pero no en el CSV. |
| `src/pages/ReportesPage.jsx` y demás llamadores de `exportarCsv` | revisar y tipar sus columnas numéricas (el bug es transversal, no solo de Liquidaciones). |

**Opción B a evaluar** (mejor experiencia, más trabajo): exportar `.xlsx` real
en vez de CSV. Elimina de raíz el problema de locale y el cartel de Excel.
Costo: una dependencia tipo `xlsx` (~400 kB). Recomendación: arreglar el CSV
ahora y dejar el xlsx para después.

**Tests**: `exportCsv.test.js` — `1234.5` → `1234,50`; `0` → `0,00`;
negativos → `-17976,34`; un texto con `;` se sigue escapando bien.

---

## 6. Rediseño del PDF de Legajo (logo + estética del recibo)

**Estado actual.** `src/utils/legajoPdf.js` son 62 líneas que escriben texto
plano: `titulo()` en 14 pt, `linea()` en 10 pt, todo alineado a `x = 14`, sin
logo, sin color, sin tablas, sin encabezado ni pie. Es una lista corrida. El
recibo (`reciboPdf.js`), en cambio, ya tiene todo lo que le falta: caja de logo
con relación de aspecto respetada, bandas verdes de sección (`VERDE`),
sub-encabezados grises (`GRIS`), grilla de datos en dos filas (`g(label, valor, x)`),
columnas alineadas y pie con firma.

**El problema de fondo es que ese estilo está encerrado dentro de `reciboPdf.js`**
como funciones locales. No se puede reutilizar sin copiarlo, y copiarlo garantiza
que en seis meses los dos documentos se vean distintos.

**Bug encontrado de paso.** `FichaLegajoPage.jsx:107` llama a `generarLegajoPdf`
**sin pasar `documentos`** (hay un comentario en la línea 103 admitiéndolo), así
que la sección "2. Documentación" dice siempre *"Sin documentos cargados"*,
aunque la persona tenga todos los papeles subidos. Se arregla en el mismo paso.

**Cambios**

| Archivo | Cambio |
|---|---|
| `src/utils/pdfEstilo.js` *(nuevo)* | extraer de `reciboPdf.js` el kit compartido: constantes `VERDE`/`GRIS`, `crearLienzo(doc)` que devuelve `{ banda, subEncabezado, grilla, fila, tabla, asegurarEspacio, pie }` manejando la `y` internamente, y `cabeceraEmpresa(doc, empresa, y)` con la caja de logo y los datos fiscales. Módulo puro sobre un `doc` de jsPDF. |
| `src/utils/reciboPdf.js` | **refactor sin cambio visual**: pasa a consumir `pdfEstilo.js`. Los tests existentes (`reciboPdf.test.js`, `reciboLayout.test.js`) son la red de seguridad — tienen que seguir en verde sin tocarlos. |
| `src/utils/legajoPdf.js` | reescritura sobre el mismo kit (ver estructura abajo). |
| `src/pages/FichaLegajoPage.jsx` | pasar `empresa` (reutilizar `datosReciboDesdeSupabase` de `emitirReciboLegajo.js`, que ya resuelve nombre, CUIT, domicilio y logo) **y** `documentos` — levantar la lista de `DocumentosLegajo.jsx` al padre, o exponerla por callback. |
| `src/utils/__tests__/legajoPdf.test.js` | ampliar: legajo sin logo (no debe romper), sin documentos, con 40 ausencias (salto de página correcto), y que el pie numere las páginas. |

**Estructura propuesta del documento**

1. **Cabecera** — logo arriba a la derecha, nombre / domicilio / CUIT de la
   empresa a la izquierda, título `LEGAJO DEL PERSONAL` en banda verde.
2. **Grilla de identificación** — dos filas al estilo del recibo: Apellido y
   Nombre · Legajo · DNI · CUIL / Puesto · Categoría · Fecha de ingreso ·
   Antigüedad · Jornada. Reemplaza las líneas sueltas de hoy.
3. **Secciones en banda verde**, cada una con su tabla de columnas alineadas y
   encabezado gris: Datos bancarios y obra social · Documentación (con
   vencimientos, y los vencidos **en rojo**) · Licencias y vacaciones ·
   Sanciones · Familiares.
4. **Pie en todas las páginas** — "Página N de M", fecha de emisión y nombre de
   la persona. Hoy no hay nada: si se imprime y se caen las hojas, no hay forma
   de reordenarlas.
5. **Sin torta**: en el recibo tiene sentido (composición del costo), acá no hay
   nada que graficar. No copiar el gráfico solo por simetría.

**Detalles**
- Mantener `asegurarEspacio()`, que hoy ya funciona bien, pero moverlo al kit
  para que el recibo también lo tenga (el recibo asume una hoja; con muchos
  conceptos se puede desbordar — vale revisarlo en el mismo pase).
- El logo puede fallar: el recibo ya lo envuelve en `try/catch` y sigue sin él.
  Mantener ese criterio, no hacer el PDF dependiente de que el logo exista.
- Cuidado con el número de páginas: jsPDF necesita una segunda pasada para
  escribir "de M". Usar `doc.getNumberOfPages()` al final e iterar con
  `doc.setPage(i)`.

**Esfuerzo**: 2–3 días, la mitad en el refactor de `pdfEstilo.js`. No toca
cálculo ni esquema, así que se puede hacer en paralelo con cualquier otro punto.

---

## Riesgos y orden de despliegue

1. **4 y 5 primero**: son bugs, no cambian contratos, y sin el 4 los montos de
   los recibos siguen mal (no tiene sentido generar 27 PDFs con faltas mal
   contadas).
2. **2 cambia montos**: recalcular únicamente períodos abiertos. Antes de
   aplicar, correr los golden de `packages/motor/golden` y comparar.
3. **3 toca el esquema**: dos migraciones (`nom_legajo_adicionales` +
   `asignacion` en `nom_conceptos`) y la Edge Function. Probar en staging con
   `scripts/anonimizar-staging.sql`.
4. **1 es aditivo**: no toca cálculo, solo UI + una dependencia nueva.
5. La migración 0041 escribe sobre `ausencias`, tabla **de Presencio**. No se
   ejecuta sin tu confirmación explícita.

## Puntos pendientes de definición

- Unidad/base del básico para escalas **mensual** y **quincenal** (ver §2).
- ¿Las faltas justificadas se pagan siempre, o hay tipos de ausencia sin goce
  de sueldo que deberían descontar? (ver §4).
- ¿El adicional por empleado tiene que aparecer en el recibo como línea propia
  o consolidado dentro del básico? (asumo línea propia).
