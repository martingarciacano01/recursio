# Plan — F.931 (SICOSS), SiRADIG/F.572, retención de Ganancias y fecha de ingreso

Fecha: 2026-07-29
Alcance: cumplimiento fiscal y previsional. Es el bloque más grande encarado
hasta ahora: toca el motor, el esquema y el contrato con Presencio.

---

## 0. Tres correcciones de premisa (importantes antes de diseñar)

**a) El F.931 no es por empleado.** Es una DDJJ **mensual por empresa** ante
ARCA, que adentro lleva el detalle nominativo de todos los trabajadores. No
existe "el F.931 de Juan Pérez": existe el F.931 de Asset Construcciones con un
registro por CUIL. Lo que Recursio tiene que generar es el **archivo de
importación** que alimenta esa DDJJ (SICOSS).

**b) El F.572 no se carga: se descarga.** Desde la RG 4003/2017 el empleado
completa el **SiRADIG – Trabajador (F.572 Web)** en el portal de ARCA, y el
empleador —como agente de retención— **baja** esa información. El plazo de
transferencia es hasta el 31 de marzo del año siguiente al declarado. Cargar el
572 a mano en Recursio sería re-tipear un dato que ARCA ya tiene, con riesgo de
divergencia. Por eso el camino es **importar**, no capturar.

**c) Cambió el marco en junio de 2026.** El **Decreto 407/2026** (reglamentario
de la Ley 27.802 de Modernización Laboral, vigente desde el 1/6/2026) eliminó la
obligación autónoma de llevar libros laborales, incluido el **Libro de Sueldos
Digital**: la registración pasa a respaldarse en los sistemas de ARCA (altas y
bajas). Los libros preexistentes se conservan 10 años.

> **Consecuencia práctica**: no invertir en generar el archivo del LSD. El
> **F.931 sigue plenamente vigente** (mensual, por mes vencido, vencimiento
> según terminación de CUIT), porque es la DDJJ con la que se pagan aportes y
> contribuciones — cosa distinta del libro. El camino elegido, **TXT para
> Declaración en Línea / SICOSS**, es además el que sobrevive al cambio.

⚠️ Antes de escribir una línea de código, confirmar los dos puntos anteriores
con el estudio contable. La normativa es de hace ocho semanas y los criterios
de aplicación todavía se están asentando.

---

## 1. Fecha de ingreso real (empezar por acá — es barato y desbloquea todo)

**Estado actual — el dato ya existe, nadie lo usa.**

- `personal.fecha_ingreso` **ya está en la base de Presencio**. Está
  documentado en la cabecera de `supabase/migrations/0001_vistas_contrato.sql`
  y `nom_v_personal` **ya la expone**, junto con `created_at AS fecha_alta_sistema`.
- Pero `fichaobra/src/store/appStore.js:69` mapea `fechaAlta: r.created_at` y
  **nunca lee `fecha_ingreso`**.
- Peor: el cálculo de vacaciones (`appStore.js:1672-1681`) usa esa `fechaAlta`
  para la antigüedad → **a todo el mundo le da la antigüedad desde que se cargó
  en el sistema**, no desde que entró a trabajar. Ese es el bug que detectaste.
- Recursio mantiene además su **propia copia** en `nom_legajo.fecha_ingreso`
  (más `antiguedad_reconocida`), que es la que sale impresa en el recibo.

Hoy hay tres valores conviviendo para el mismo concepto.

**Decisión tomada.** Presencio es el dueño; Recursio puede **pisar** el valor
para casos raros (reingresos, antigüedad reconocida de otra empresa).

**Cambios**

| Archivo | Cambio |
|---|---|
| `fichaobra/src/store/appStore.js` | `personalFromDB`: agregar `fechaIngreso: r.fecha_ingreso \|\| null` y **mantener** `fechaAlta: r.created_at` con ese nombre (es la fecha de carga en el sistema, sirve para auditoría). `personalToDB`: escribir `fecha_ingreso`. |
| `fichaobra/src/store/appStore.js:1672` | el cálculo de vacaciones pasa a usar `persona.fechaIngreso \|\| persona.fechaAlta` (fallback mientras se completan los datos viejos). **Esto cambia días de vacaciones ya mostrados**: avisar antes de desplegar. |
| `fichaobra/src/pages/PersonalPage.jsx` | campo "Fecha de ingreso" editable en el alta y la edición de personal, separado y rotulado distinto de la fecha de carga. |
| `fichaobra/src/pages/ReportesPage.jsx` | mostrar ambas columnas donde hoy muestra solo `fechaAlta`. |
| `recursio/supabase/migrations/0042_fecha_ingreso_origen.sql` *(nuevo)* | renombrar `nom_legajo.fecha_ingreso` → `fecha_ingreso_override` (con `COMMENT` explicando la precedencia) y agregar `fecha_ingreso_motivo TEXT`. |
| `recursio/src/utils/fechaIngreso.js` *(nuevo)* | función pura `resolverFechaIngreso({ legajo, personal })` con la precedencia **override → `personal.fecha_ingreso` → `fecha_alta_sistema`**, devolviendo `{ fecha, origen }` para poder mostrar de dónde salió. |
| `recursio/src/utils/emitirReciboLegajo.js` | usarla en vez de leer `legajo.fecha_ingreso` directo. |
| `recursio/src/components/legajo/EditorDatosLegajo.jsx` | mostrar la fecha heredada de Presencio en gris + checkbox "corregir para nómina" que habilita el override y exige un motivo. |
| `recursio/src/utils/legajoCompletitud.js` | marcar en rojo a quien no tenga fecha de ingreso real por ninguna de las tres vías. |

**Backfill.** Script que, para cada persona sin `personal.fecha_ingreso`, tome
`nom_legajo.fecha_ingreso` si existe y la escriba en Presencio. Es la **única
excepción** al principio "Recursio nunca escribe en tablas de Presencio", así
que va como script one-shot ejecutado desde el lado de Presencio, no como
código de Recursio. Requiere tu OK.

**Tests**: `fechaIngreso.test.js` (las tres ramas de precedencia + sin dato);
test del cálculo de vacaciones de Presencio con fecha de ingreso anterior al
alta en sistema.

---

## 2. F.931 — archivo de importación SICOSS

**Decisión tomada.** Generar el **TXT de Declaración en Línea (SICOSS)**.

**Qué es.** Un archivo de texto de **ancho fijo**, un registro por CUIL por
período, con remuneraciones 1 a 9, códigos de situación/condición/actividad/
modalidad, obra social, cantidad de adherentes y bases imponibles. Se importa en
el servicio de ARCA y arma el F.931.

**El problema real no es el formato: son los datos que faltan.** `nom_legajo`
hoy tiene `cuil`, `fecha_nacimiento`, `domicilio`, `convenio_id`,
`categoria_id`, `cbu`, `banco`, `obra_social` (texto libre), `jornada`,
`fecha_baja`, `fuera_convenio`, `localidad`, `provincia`, `codigo_postal`,
`antiguedad_reconocida`. **SICOSS necesita además**, con códigos oficiales:

- Código de **situación de revista** (activo, licencia, maternidad, baja…) —
  varía **mes a mes** según lo que pasó en el período.
- Código de **condición** (jubilado, activo…), **actividad**, **modalidad de
  contratación**, **siniestrado**.
- **Zona geográfica** (afecta reducciones de contribuciones).
- Código **RNOS** de la obra social (número, no el texto libre actual).
- **Cantidad de adherentes** a obra social (derivable de `nom_familiares`).
- Marca de **corresponde reducción** y régimen previsional (SIPA/reparto).

**Cambios**

| Archivo | Cambio |
|---|---|
| `supabase/migrations/0043_datos_sicoss.sql` *(nuevo)* | agregar a `nom_legajo`: `cod_situacion`, `cod_condicion`, `cod_actividad`, `cod_modalidad`, `cod_siniestrado`, `cod_zona`, `obra_social_rnos`, `regimen_previsional`, `corresponde_reduccion`. Todos con default sensato para no romper legajos existentes. |
| `supabase/migrations/0044_tablas_codigos_arca.sql` *(nuevo)* | tabla `nom_codigos_arca (tipo, codigo, descripcion, vigencia_desde, vigencia_hasta)` con las tablas oficiales precargadas. Se actualizan cuando ARCA las cambia, sin tocar código. |
| `packages/motor/src/sicoss.ts` *(nuevo)* | **función pura**: `armarRegistroSicoss(legajo, liquidacionMensual, familiares, params) → string` de ancho fijo, y `armarArchivoSicoss(registros) → string`. Sin dependencias de Supabase, 100% testeable. Es el corazón del entregable. |
| `packages/motor/src/sicoss.test.ts` *(nuevo)* | tests de ancho de cada campo, padding, formato de importes (sin separadores, dos decimales implícitos), y **casos límite**: alta a mitad de mes, baja, licencia sin goce, pluriempleo. |
| `packages/motor/golden/sicoss-*.txt` *(nuevo)* | archivos golden verificados **contra la importación real en el servicio de ARCA**. Sin esto no hay garantía de nada. |
| `src/pages/ReportesPage.jsx` | sección "F.931 / SICOSS": elegir mes → validación previa → botón de descarga del TXT. |
| `src/components/reportes/ValidacionSicoss.jsx` *(nuevo)* | pantalla de errores **bloqueantes** (CUIL inválido, sin código de situación, sin RNOS) antes de dejar exportar. Un TXT que ARCA rechaza a las 23:50 del vencimiento es peor que no tener el botón. |

**Consolidación quincenal.** Cuidado: SICOSS es **mensual** y UOCRA liquida por
quincena. Hay que sumar Q1 + Q2 del mismo mes por persona antes de armar el
registro, respetando la lógica de `grupo_mensual_id` que ya existe en
`nom_periodos`. Reutilizar el criterio de consolidación de
`liquidar-periodo/index.ts`, no reinventarlo.

**Cómo validar el layout.** No inventar el ancho de campos desde un blog:
descargar el diseño de registro oficial vigente del sitio de ARCA y versionar
ese PDF en `docs/arca/`. El layout cambia con las RG.

---

## 3. SiRADIG / F.572 — importación

**Decisión tomada.** Importar el archivo que el empleador baja de ARCA.

**Flujo real.** El empleado carga sus deducciones en SiRADIG → el empleador
entra al servicio de ARCA y descarga las novedades del período → sube el archivo
a Recursio → Recursio lo parsea y lo asocia por CUIL.

**Cambios**

| Archivo | Cambio |
|---|---|
| `supabase/migrations/0045_siradig.sql` *(nuevo)* | `nom_siradig_presentaciones` (`empresa_id`, `personal_id`, `periodo_fiscal`, `numero_presentacion`, `fecha_presentacion`, `archivo_path`, `importado_en`, `importado_por`) y `nom_siradig_items` (`presentacion_id`, `tipo_deduccion`, `subtipo`, `cuit_receptor`, `monto`, `mes`, `datos JSONB`). El JSONB absorbe los campos que varían entre versiones del formato sin migrar tablas. |
| `src/utils/parsearSiradig.js` *(nuevo)* | parser **puro** del export de ARCA. Devuelve `{ presentaciones, items, errores[] }`. Que no toque red ni Supabase. |
| `src/components/config/ImportarSiradig.jsx` *(nuevo)* | drag & drop del archivo → vista previa de qué se va a importar, **por persona**, marcando altas / cambios / CUILs que no matchean ningún legajo → confirmar. Nunca importar a ciegas. |
| `src/components/legajo/TabGanancias.jsx` *(nuevo)* | en la ficha del legajo: última presentación SiRADIG, deducciones vigentes, otros empleadores declarados, y carga manual de respaldo. |
| `src/store/siradigStore.js` *(nuevo)* | acciones de import, listado e historial. |

**Historial, no reemplazo.** Un empleado puede presentar varias veces en el año
(cada una con número de presentación correlativo). Guardar **todas** y usar la
última vigente al mes que se liquida; si se recalcula un mes viejo, tiene que
usar la que estaba vigente **entonces**. Esto es lo que hace auditable la
retención.

**Nota sobre datos personales.** El SiRADIG trae información sensible (obra
social, hijos, alquileres, donaciones, cónyuge). RLS estricta por `empresa_id`
y permiso propio: no todo el que ve una liquidación debería ver esto. Sumar
`ver_ganancias` a `src/utils/permisos.js`.

---

## 4. Retención de Ganancias (RG 4003) — motor acumulado

**Decisión tomada.** Motor completo.

**Por qué es el trabajo más grande.** El motor actual
(`liquidarConceptos` en `packages/motor/src/motor.ts`) es **sin estado**: recibe
las variables de un período y devuelve items. Ganancias **no se puede calcular
así**. El mecanismo de la RG 4003 es **acumulativo anual**:

1. Se acumulan ganancias brutas del **1/1 al mes que se liquida**.
2. Se restan deducciones (jubilación, obra social, sindical) y las del SiRADIG,
   también acumuladas.
3. Se aplican deducciones personales (mínimo no imponible, especial, cargas de
   familia) **proporcionales a los meses transcurridos**.
4. Se aplica la escala del **art. 94** de la ley, acumulada.
5. Al impuesto determinado se le restan **las retenciones ya practicadas** en el
   año → la diferencia es la retención del mes (puede dar **negativa**:
   devolución).

Es decir: el resultado de un mes depende de los once anteriores. Y hay que
sumar la liquidación **anual** (o **final**, si la persona se va).

**Complicación extra en esta empresa**: los montos de escala y deducciones
**se actualizan durante el año** (por ejemplo, el ajuste que rige para el
semestre julio–diciembre 2026), y el ajuste tiene que entrar dentro del
mecanismo acumulativo, sin recalcular hacia atrás lo ya retenido.

**Arquitectura propuesta**

| Archivo | Cambio |
|---|---|
| `supabase/migrations/0046_ganancias.sql` *(nuevo)* | `nom_ganancias_acumulado` (`empresa_id`, `personal_id`, `periodo_fiscal`, `mes`, `ganancia_bruta_mes`, `deducciones_mes`, `ganancia_neta_acumulada`, `impuesto_determinado`, `retenciones_anteriores`, `retencion_mes`, `calculado_en`) — una fila por persona/mes, **inmutable**, que es el rastro de auditoría. Y `nom_ganancias_parametros` (escala art. 94 por tramo + deducciones personales, con `vigencia_desde`/`vigencia_hasta`). |
| `packages/motor/src/ganancias.ts` *(nuevo)* | **función pura** `calcularRetencionMes({ acumuladoPrevio, brutoMes, deduccionesMes, siradig, parametros, mes, cargasFamilia }) → { impuestoDeterminado, retencionMes, detalle }`. Toda la complejidad concentrada acá, sin I/O. |
| `packages/motor/src/ganancias.test.ts` *(nuevo)* | La batería de tests más importante del proyecto: mes 1, mes 7 con cambio de parámetros a mitad de año, retención negativa (devolución), pluriempleo, SAC (que tiene tratamiento propio), alta y baja a mitad de año, liquidación final. |
| `supabase/functions/liquidar-periodo/index.ts` | leer el acumulado de meses previos, llamar a `calcularRetencionMes`, insertar el item `retencion_ganancias` (tipo `descuento`) y persistir la fila del acumulado. **Solo en períodos mensuales o en la Q2** — no tiene sentido retener dos veces en el mes. |
| `src/components/config/TabGananciasParametros.jsx` *(nuevo)* | ABM de escala y deducciones con vigencias, reutilizando el patrón de `TablaVigencias.jsx` que ya existe para escalas salariales. |
| `src/pages/ReportesPage.jsx` | liquidación anual/final por empleado y reporte de retenciones del período. |

**Riesgo de idempotencia.** Hoy `calcularPeriodo` se puede correr N veces y el
`upsert` deja todo consistente. Con un acumulado eso deja de ser cierto: si se
recalcula marzo, hay que **invalidar y recalcular abril en adelante**. Definir
esto explícitamente antes de codear — es la principal fuente de bugs de este
módulo. Propuesta: el acumulado se recalcula en cascada y los meses **cerrados**
quedan congelados (la diferencia se corrige en el mes abierto, que es además lo
que hace el mecanismo de la RG).

**Antes de codear**: pedirle al estudio contable **tres liquidaciones reales**
de un empleado con ganancias (un mes cualquiera, el mes del SAC y la anual) para
usarlas como golden. Sin un caso real contra el cual contrastar, este módulo no
se puede dar por terminado.

---

## 5. Fases sugeridas

| Fase | Contenido | Esfuerzo |
|---|---|---|
| **A** | Fecha de ingreso (§1) | días |
| **B** | Datos SICOSS en el legajo + validación (§2, primera mitad) | 1–2 semanas |
| **C** | Generador SICOSS + golden contra ARCA (§2, segunda mitad) | 2 semanas |
| **D** | Import SiRADIG (§3) | 1–2 semanas |
| **E** | Motor Ganancias (§4) | 3–4 semanas |

A y B se pueden hacer en paralelo con las 5 mejoras del plan anterior.
D es **prerequisito** de E: sin las deducciones del SiRADIG, la retención sale
mal en cualquier caso que no sea el más simple.

## Dependencias fuera del código

1. Confirmación del estudio contable sobre el alcance del Decreto 407/2026.
2. Diseño de registro SICOSS oficial vigente (PDF de ARCA, versionado en `docs/arca/`).
3. Formato exacto del export de SiRADIG del lado empleador (bajar uno real).
4. Tres liquidaciones de Ganancias reales como golden.
5. Un CUIT de prueba para validar la importación del TXT sin presentar nada.

---

Sources:
- [Libro de sueldos digital — ARCA](https://afip.gob.ar/LibrodeSueldosDigital/novedades-beneficios/definicion.asp)
- [Decreto 407/2026 — texto oficial, Argentina.gob.ar](https://www.argentina.gob.ar/normativa/nacional/decreto-407-2026-426270/texto)
- [Reforma laboral 2026: ¿eliminación del libro de sueldos digital? — Estudio Piccinini](https://www.estudiopiccinini.com.ar/laboral-y-previsional/reforma-laboral-2026-se-elimina-la-obligacion-de-llevar-libro-de-sueldos-digital/)
- [Claves del Decreto 407/2026 — CPCE Formosa](https://cpcef.org.ar/modernizacion-laboral-claves-del-decreto-407-2026/)
- [Manual SiRADIG – Trabajador, versión 1.20 (jun. 2026) — AFIP/ARCA](https://www.afip.gob.ar/572web/documentos/ManualSiRADIG.pdf)
- [SIRADIG - Formulario F.572 Web — ARCA](https://servicioscf.afip.gob.ar/publico/abc/ABCpaso2.aspx?id_nivel1=563&id_nivel2=567&id_nivel3=659&id_nivel4=2571&id_nivel5=2575&p=SIRADIG+-+Formulario+F.572+Web)
- [Impuesto a las Ganancias 4ta categoría, manual año 2026 — AFIP/ARCA](https://ftp.afip.gov.ar/572web/documentos/F1359-Version-00200-Manual-001-a%C3%B1o2026.pdf)
- [Vencimientos F.931 2026 — Calendario Fiscal](https://calendariofiscal.com.ar/impuestos/f931)
- [Retención de Ganancias 4ta categoría, RG 4003 — Contaduría General de San Juan](https://web.sanjuan.gob.ar/cgp/retencion-de-impuesto-a-las-ganancias-sobre-sueldos/)
