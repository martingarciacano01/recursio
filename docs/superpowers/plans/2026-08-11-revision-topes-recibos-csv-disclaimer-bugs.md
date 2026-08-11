# Plan de ejecución — Tope de horas por obra (fix), recibo de sueldo ($0 y superposición), disclaimer contador, importador CSV de convenios y bugs de interfaz

> **Documento de ejecución** para los 6 pedidos del cliente. El plan corrige, en orden:
> 1. **Tope de horas por obra que no se aplica** — explicar cómo funciona y por qué falla, commitear el fix del motor que quedó sin commitear y cerrar el resto de la cadena.
> 2. **Valores en $0 que aparecen en el recibo de sueldo** — ítems con monto $0 (resta de quincena 1 en quincena 2, escalas faltantes, %, etc.) que se imprimen y ensucian el recibo.
> 3. **Textos superpuestos en el PDF del recibo** (ej. nombre del banco) — recibo como modelo AR con coordenadas fijas que no truncan.
> 4. **Disclaimer legal de contador matriculado** — nota legal en login, configuración y pie de cada recibo emitido.
> 5. **Carga CSV de convenios con vigencia y plantilla** — importar básicos/no remunerativos versionados por `vigencia_desde` (mismo patrón que el importador de paritarias IA ya diseñado, pero por CSV con plantilla descargable).
> 6. **Corrección de bugs de interfaz** — 10 bugs verificados (paginación, confirmaciones, filtros, toasts, estados vacíos, scroll).
> 7. **Recibo "para el Empleado" (con firma del aprobador de pago) vs recibo "para el Empleador" (con espacio para firmar del empleado)** — dos variantes del mismo recibo; la que lleva la firma solo se habilita cuando el flujo del período quedó aprobado.

> **Reglas de este documento (heredadas del repo):**
> 1. TDD siempre: test que falla → verificación → implementación mínima → pasa → commit.
> 2. Migraciones en `supabase/migrations/NNNN_nombre.sql`, numeradas e idempotentes. La última existente es `0068`; **la nueva migración de este plan es `0069`** (firma de recibo, Fase 7).
> 3. RLS en el mismo archivo que crea la tabla, con `empresa_id = auth_empresa_id()` **más** `is_superadmin()`.
> 4. Zustand sin `persist` para datos salariales.
> 5. Español (Argentina) en UI, tablas y comentarios.
> 6. Commits frecuentes: `feat:`/`fix:`/`test:`/`chore:`.
>
> **Comandos de referencia:** tests `npm test` (= `npx vitest run`) · un archivo `npx vitest run <ruta>` · lint `npm run lint` · build `npm run build` · Node 22 antes de todo: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use`.

> **Decisiones ya tomadas con el usuario (NO re-abrir):**
> - El recibo es un modelo de costo laboral (AR) de UNA hoja: columnas Concepto/Unidad/Base/Monto, composición salarial, neto en letras, detalle por organismo, torta.
> - El tope diario se resuelve **obra → empresa → default 8h/4h parcial**, y se fuerza SIEMPRE (sin depender de feature toggle) porque lo configura la propia empresa.
> - Los topes semanal/quincena/mes existen en la tabla `nom_config_obras` (0060) pero hoy NO se aplican; este plan **no los implementa** (solo el diario, que es lo que el cliente usa).
> - El clave **no se commitearon** los cambios del plan 2026-08-07 (working tree sucio): el fix del tope en `asistencia.ts` está en el working tree pero NO en `HEAD`. Por eso "cada vez que lo aplicamos no funciona": el código deployado es el que suma las horas sin topar.
> - No se toca Presencio. Recursio lee vía vistas contrato (`nom_v_*`).
> - **Recibo de dos variantes (decisiones confirmadas con el cliente, feedback 2026-08-11):** (a) la firma es **una por empresa** — el aprobador de pago sube UNA imagen de firma + nombre/apellido + puesto, y se estampa en todos los recibos "para Empleado" de esa empresa; (b) el gate que habilita el recibo "para Empleado" es el **flujo del período aprobado** (instancia de `nom_flujo_instancias` en `'aprobado'`); (c) las dos variantes comparten el **mismo `numero_recibo`** (son original + copia del mismo recibo), con hash por variante; (d) al aprobar solo se **habilita la descarga** (no se genera automáticamente).

---

## Fase 0 — Estado actual y diagnóstico (baseline) [⚙️ bajo]

### Task 0.1: Commitear el working tree en orden lógico

**Por qué:** hay 38 archivos modificados y migraciones `0063`–`0068` sin commitear. El fix del tope de horas (`packages/motor/src/asistencia.ts`) está en el working tree pero nunca se commiteó: es la causa raíz del punto 1. El repo tiene que arrancar limpio para que cada task de este plan sea un diff pequeño.

- [ ] **Step 1:** `git status --short`. Revisar que no haya `dist/`, `.env*`, `scripts/.dumps/` colados (agregarlos a `.gitignore` si aparecen).
- [ ] **Step 2:** Commitear en bloques lógicos, **no** un solo commit gigante:
  - `fix(motor): tope de horas diarias no solo recorta la extra sino las horas trabajadas` → `packages/motor/src/asistencia.ts` + su test.
  - `feat(db): topes de horas por obra, periodo por obra y features por empresa (0060-0068)` → migraciones `0060`–`0068`.
  - `feat(ui): liquidaciones por período/obra, features por empresa, topes por obra (TabEmpresa)` → `src/**`, `supabase/functions/**`.
  - `chore: docs de plan y estado` → `docs/` (incluido este archivo).
- [ ] **Step 3:** `git push` a `origin/main` **solo si el usuario lo autoriza**.

**Criterio de aceptación:** `git status` limpio salvo `docs/superpowers/plans/2026-08-11-…`.

### Task 0.2: Baseline de lint y tests [⚙️ bajo]

- [ ] **Step 1:** `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use && node -v` → 22.x.
- [ ] **Step 2:** `npm run lint && npm test` y guardar la salida.
- [ ] **Step 3:** Corregir errores o justificarlos. Commit `chore(ci): baseline de lint y tests en verde`.

**Criterio de aceptación:** lint y tests verdes antes de tocar nada.

---

## Fase 1 — Tope de horas por obra: cómo funciona y por qué "no funciona" [⚙️ medio]

### Task 1.1: Documentar cómo funciona hoy el tope (ENTREGABLE para el cliente)

**Por qué:** el cliente pidió "quiero saber cómo funciona y cómo se aplica". Hoy no hay doc de esto.

- [ ] **Step 1:** Crear `docs/TOPE-HORAS-POR-OBRA.md` explicando:
  - **Cadena de aplicación:** `LiquidacionPage → Postal` → edge function `liquidar-periodo` → resuelve tope `obra → empresa → default` (`index.ts:699-764`) → `calcularAsistencia` topea por día (`asistencia.ts:70-96`) → `horasTrabajadas` topada alimenta el básico por hora, la extra y las columnas Unidad/Horas.
  - **Config:** Empresa → Empresa → "Horas por obra" (tabla por obra, `nom_config_obras`). Obra tomada de Presencio (`persona.obra_id`). Persona sin obra → cae a config de empresa → default 8h/4h.
  - **Qué topa:** horas normales Y extra. Excedente sobre el tope queda fuera (ni normal ni extra) — es para que un fichaje desmedido no dispare extras gigantes.
  - **Qué NO topa:** topes semanal/quincena/mes (existen en la tabla, no implementados), y el básico de modalidad mensual/quincenal (no depende de horas).
  - **Cómo se ve:** panel expandido de la fila en Liquidaciones muestra "Tope horas/día: X h" (`LiquidacionPage.jsx:1020-1022`).

**Criterio de aceptación:** doc en español que el cliente pueda leer.

### Task 1.2: Verificar el fix del tope (TDD) [⚙️ medio]

**Files:** `packages/motor/src/asistencia.ts`, `packages/motor/src/asistencia.test.ts`.

**Por qué:** en `HEAD`, `calcularAsistencia` hace `resultado.horasTrabajadas += horas` SIN topar; el tope solo recortaba la hora extra. Un día de 14 h con tope 12 seguía contando 14 h para el básico. El fix ya está en el working tree (`horasTopadas`) pero sin commitear ni cubierto por test que lo restrinja.

- [ ] **Step 1:** Commit del fix según Task 0.1 (ya está escrito en el working tree).
- [ ] **Step 2:** Agregar tests que restrinjan el contrato (TDD inverso — el fix ya existe, ahora se blinde):
  - `test("topeHorasDiarias recorta las horas trabajadas normales y no solo la extra")`
  - `test("el excedente sobre el tope no suma ni como normal ni como extra")`
  - `test("feriado/domingo trabajados se topan igual que las horas normales")` (verifica `horasFeriado`/`horasExtra100` con `horasTopadas`, líneas 88-92).
  - caso límite: `topeHorasDiarias: null` → sin tope (comportamiento de siempre).

**Criterio de aceptación:** tests verdes con el fix; si se quita el fix, al menos un test falla.

### Task 1.3: End-to-end de la resolución obra→empresa→default [⚙️ medio]

**Files:** `supabase/functions/liquidar-periodo/__tests__/extras.test.ts` (o `final.test.ts`).

**Por qué:** la cadena de resolución del tope (`configObraPorObraId`, `index.ts:704-757`) no está testeada de punta a punta. Un fallo ahí explica "configuro el tope pero sigue pasando".

- [ ] **Step 1:** Agregar test e2e que, con mocks de Supabase, verifique:
  - persona con obra con `nom_config_obras.tope_horas_diarias=6` → días de 8 h liquidan 6 h.
  - persona sin obra + config de empresa con tope → aplica el de empresa.
  - persona sin obra y sin config de empresa → sin tope (no se aplica `Math.min`).
- [ ] **Step 2:** Verificar que `horasLiquidadas` (CSV/grilla) refleje el tope: `Math.ceil(horasTrabajadas)` en `index.ts:523` ya opera sobre el valor topado.

**Criterio de aceptación:** verde; confirma que el tope llega al resultado.

### Task 1.4: Verificación en producción (diagnóstico al cliente) [⚙️ bajo]

**Por qué:** el cliente reporta que "cada vez que lo aplicamos no funciona". La causa más probable es que el fix esté en el working tree pero el deploy usó `HEAD` (sin el fix).

- [ ] **Step 1:** Verificar qué commit está deployado en la edge function `liquidar-periodo` (Supabase → Edge Functions → deploy history) y confirmar si incluye el fix del tope.
- [ ] **Step 2:** Verificar en la base de Presencio que las personas tienen `obra_id` (mismatch de obra → cae a config empresa o default).
- [ ] **Step 3:** Tras deployar el fix, reproducir: liquidar el período de la obra con tope 6 h y confirmar 6 h en la grilla.

**Criterio de aceptación:** diagnóstico cerrado con el cliente: o era el deploy, o era obra sin asignar.

---

## Fase 2 — Recibo de sueldo: ocultar ítems en $0 [⚙️ bajo]

**Files:** `packages/motor/src/motor.ts`, `supabase/functions/liquidar-periodo/index.ts`, `src/utils/reciboLayout.js`.

### Task 2.1: No persistir ni imprimir ítems con monto $0 (con excepción)

**Por qué:** el motor push a `items` todos los conceptos incluidos, también los que evalúan en `$0` (escala faltante, `%` con base $0, resta de quincena 1 en quincena 2 que deja el ítem en $0 dentro de la lista — `index.ts:838-850`). Un ítem remunerativo/descuento en `$0` no aporta nada al total y ensucia el recibo. **Excepción:** los ítems **informativos** (`tipo === 'informativo'`, ej. cantidad de horas sin monto) se conservan.

- [x] **Step 3 (fallback en persistencia):** en `index.ts:896-910`, al mapear `itemsLote` filtrar también `i.monto === 0` para que la fila de la base nunca guarde ítems $0 (protege emisiones viejas o por fuera del motor). Aplicado también al mapeo de items del branch `final` (`index.ts:1444`).
- [x] **Step 4 (fallback en render):** en `reciboLayout.js`, `armarRecibo` descarta ítems `$0` de `remunerativos/noRemunerativos/descuentos/contribuciones/cct` antes de armar secciones. Así recibe por las 3 vías (motor, base, layout) nunca imprime $0. Conserva los `informativo` (monto 0 no altera; grupoRecibo null los excluye de todas las secciones igual).
- [ ] **Steps 1-2 (filtro en el motor) — NO implementados (desvío documentado):** filtrar en el motor rompe `motor.test.ts:42-57` y los golden `06/07` (verifican que el ítem en $0 exista con su `reglaAplicada`), y además **no arregla el caso Q2 del cliente** (la resta de Q1 ocurre en `index.ts:838-850`, *después* de `liquidarConceptos`, así que el filtro del motor no lo alcanzaría). Los pasos 3+4 cubren las 3 vías y cumplen el criterio de aceptación con `npm test` verde sin tocar fixtures. El motor conserva la semántica completa (ítem + reglaAplicada en $0), que es la única forma de auditar qué regla del presentismo aplicó.

**Criterio de aceptación:**
- Recibo de un caso Q2 (resta de Q1 deja el ítem en $0) no muestra el ítem en $0.
- Totales idénticos antes/después en la misma liquidación.
- `npm test` verde.

### Task 2.2: No renderizar encabezados vacíos [⚙️ bajo]

**Files:** `src/utils/reciboPdf.js`, `src/utils/reciboLayout.js`.

**Por qué:** si queda una sección entera sin ítems (ej. `DESCUENTOS` vacío), se imprime el sub-encabezado gris sin contenido (reciboPdf.js:120-127).

- [ ] **Step 1:** En `reciboPdf.js`, antes de cada `subEncabezado('REMUNERATIVO'|'NO REMUNERATIVO'|'DESCUENTOS')` verificar que el array correspondiente de `R` tiene ítems; si está vacío, no dibujar el sub-encabezado.
- [ ] **Step 2:** `COSTO DERIVADO DEL CCT` ya está condicionado (`cct.length > 0`, línea 111) — mantener. Verificar `contribuciones` de `R` nunca vacío (si fuese vacío, no imprimir `SUBTOTAL CONTRIBUCIONES EMPLEADOR` de $0).
- [ ] **Step 3:** test de `reciboLayout` para `armarRecibo` con arrays vacíos.

**Criterio de aceptación:** un recibo con bruto solo de básico y sin descuentos no imprime el sub-encabezado DESCUENTOS.

---

## Fase 3 — Recibo PDF: corregir textos superpuestos [⚙️ medio]

**Files:** `src/utils/reciboPdf.js`, nuevo `src/utils/textoPdf.js`.

**Causa raíz (verificada):** coordenadas x fijas (`colConcepto`, `colUnidad`, `colBase`, `colMonto` = M + anchoUtil × 0.52/0.68/0.99; y la grilla `g(...)` con x fijas M+30/M+95/M+120/M+150). Un nombre de concepto largo pisa Unidad/Base/Monto; en la grilla del empleado, "Banco" largo (x M+120) pisa "Período / Pago" (x M+150), y "Apellido y Nombre" largo pisa "Legajo"/"Categoría". `splitTextToSize` solo se usa para "Son pesos" y la leyenda.

### Task 3.1: Utilidad de texto ajustado y truncado (TDD) [⚙️ bajo]

- [ ] **Step 1:** Crear `src/utils/textoPdf.js` con:
  - `ajustarTexto(doc, texto, anchoMax)` → si `doc.getTextWidth(texto) > anchoMax`, trunca con `…` hasta que entre (busqueda binaria o reducción progresiva).
  - `textoEnPunto(doc, texto, x, y, anchoMax, opts)` → aplica `ajustarTexto` + `doc.text`.
- [ ] **Step 2 (TDD):** test con un `doc` stub que exponga `getTextWidth` y `text` (no hace falta jsPDF real): `ajustarTexto` trunca y marca con `…`; texto corto no se toca; `anchoMax` pequeño devuelve `…`.

**Criterio de aceptación:** la utilidad es pura y testeada sin instanciar jsPDF.

### Task 3.2: Grilla del empleado con columnas que no pisan [⚙️ medio]

- [ ] **Step 1:** Redefinir la grilla `g(...)` (reciboPdf.js:94-104) sobre 2 filas con 4 columnas decimales calculadas del ancho útil (ej. M, M+30, M+95, M+120 en la fila 1 y análoga en la fila 2 — pero cada cell usa `ajustarTexto` con `anchoMax` = distancia a la siguiente columna − 2).
- [ ] **Step 2:** Valores con `anchoMax` correcto: `Apellido y Nombre` (col 2) no puede pisar `Legajo`; `Banco` no puede pisar `Período / Pago` (caso del cliente). Labels (bold) también truncados.
- [ ] **Step 3:** `Antig. Reconocida` muestra `'—'` si `0` (mismo criterio que `?? '—'` de los demás).

**Criterio de aceptación:** con un banco largo (ej. "Banco de la Provincia de Buenos Aires") y apellido largo, no hay superposición visual en el PDF.

### Task 3.3: Filas de concepto con nombre largo [⚙️ medio]

- [ ] **Step 1:** `filaItem` usa `ajustarTexto(doc, nombre, colUnidad - colConcepto - 3)`. Unidad/Base con formato corto ya caben; Monto alineado a derecha.
- [ ] **Step 2:** El formulador "COMPOSICIÓN SALARIAL »" (línea 134-136) desplaza a la izquierda con ancho ajustado si la columna lo necesita; verificar las x fijas M+0.40/0.62/0.83 con textos largos (`Rem.`, `No rem.`, `Desc.` son cortos — solo revisar).

**Criterio de aceptación:** concepto largo (ej. "Adicional por zona desfavorable transferencia") no pisa Unidad/Base.

### Task 3.4: Logo y cabecera de empresa [⚙️ bajo]

- [ ] **Step 1:** `empresa.nombre` en negrita tamaño 12 (línea 87) puede pisar la caja del logo (que va a la derecha). Truncar el nombre con `anchoMax = anchoUtil - CAJA_ANCHO - 4` cuando hay logo.

**Criterio de aceptación:** nombre de empresa largo no se superpone al logo.

### Task 3.5: Verificación visual [⚙️ bajo]

- [ ] **Step 1:** Emitir recibos de prueba (1) normal, (2) nombre de concepto largo, (3) banco largo + apellido largo. Adjuntar capturas en el PR o mostrarlas al usuario.
- [ ] **Step 2:** `npm run lint` y `npm test`.

**Criterio de aceptación:** el usuario confirma visualmente que ya no se pisan textos.

---

## Fase 4 — Disclaimer legal de contador matriculado [⚙️ bajo]

**Files:** `src/utils/reciboPdf.js`, `src/utils/reciboLayout.js` (o nuevo `src/utils/disclaimerRecursio.js`), `src/components/Layout.jsx`, `src/pages/LoginPage.jsx`, `src/pages/ConfiguracionPage.jsx`.

### Task 4.1: Constante del disclaimer (single source) [⚙️ bajo]

- [ ] **Step 1:** Crear `src/utils/disclaimerRecursio.js` con `const DISCLAIMER_CONTADOR = '…'` y exportarla. Texto sugerido (revisar redacción con el cliente/contador):
  > "Documento generado por Recursio. Los valores aquí consignados deben ser validados por un contador público matriculado antes de su uso oficial."
- [ ] **Step 2:** Reutilizarla en los 3 puntos (recibo, login, configuración).

**Criterio de aceptación:** un único export; la UI y el recibo muestran el mismo texto.

### Task 4.2: Disclaimer en el pie del recibo PDF [⚙️ bajo]

- [ ] **Step 1:** En `reciboPdf.js`, tras la línea de firma (o debajo del "Recibo N°"), imprimir el disclaimer en tamaño 6.5, gris, con `splitTextToSize` (ya hay patrón para la leyenda).
- [ ] **Step 2:** Verificar que no desplaza el contenido si la página llega al límite (son 1-2 líneas; usar `yFinal` y, si se pasa del alto de página, mover a una altura fija al pie — el recibo ya reserva pie con `yFirma = Math.max(y + 8, altoPagina - 24)`).

**Criterio de aceptación:** todo recibo emitido lleva la nota al pie.

### Task 4.3: Disclaimer en la app (login y configuración) [⚙️ bajo]

- [ ] **Step 1:** Login: nota pequeña debajo del formulario en `LoginPage.jsx`.
- [ ] **Step 2:** Configuración: caja informativa destacada en `ConfiguracionPage.jsx` (ej. encima del selector de convenio o en la sección Empresa), con `DISCLAIMER_CONTADOR`.

**Criterio de aceptación:** visible en ambas pantallas.

---

## Fase 5 — Importador CSV de convenios con vigencia y plantilla [⚙️ medio-alto]

**Files:** nuevo `src/utils/csvConvenios.js`, `src/components/config/TabImportarCsv.jsx` (nueva), `src/pages/ConfiguracionPage.jsx`, `src/store/conveniosStore.js` (o `escalasStore.js`), tests.

**Contexto:** existe el spec aprobado `docs/superpowers/specs/2026-07-29-importador-paritarias-ia-design.md` (importación de actas PDF con IA, Fase 1: básicos + no remunerativos, Fase 2: aportes que requiere versionar `nom_conceptos`). Este plan NO reemplaza ese spec: agrega el camino **CSV manual con plantilla** que pide el cliente, reutilizando el mismo esquema de vigencia. No hace falta migración nueva para cargar datos: `nom_categorias` (0002/0018) y `nom_no_remunerativos` (0012) ya son versionados por `vigencia_desde` y el `UNIQUE` las protege de duplicados.

### Task 5.1: Parser CSV es-AR (TDD) [⚙️ medio]

- [ ] **Step 1 (TDD):** crear `src/utils/csvConvenios.js` con `parseCsvConvenios(texto)`:
  - Separador `;` (estándar es-AR, consistente con `exportCsv.js`). Comillas simples `"..."` para escapar `;`/saltos.
  - **Columnas del template:** `concepto` (`basico`|`no_remunerativo`), `nombre` (categoría), `valor`, `modalidad` (solo básico: `hora`|`mensual`|`quincenal`), `vigencia_desde` (YYYY-MM-DD o DD/MM/YYYY).
  - Normaliza `valor` con coma decimal (`1234,56` → `1234.56`).
  - Validaciones con errores por fila (número de fila, no vacío, formato fecha, modalidad válida, `valor` numérico).
- [ ] **Step 2:** test con casos: fixture válido, separador `;`, decimal coma, fila con error → devuelve `{ ok, errores, filas }`.

**Criterio de aceptación:** parser puro testeado sin UI.

### Task 5.2: Plantilla descargable [⚙️ bajo]

- [ ] **Step 1:** `generarPlantillaCsv(convenioIdExistentes)` devuelve un string CSV con una fila de ejemplo por tipo, listando los nombres de categorías ya cargadas (para que el usuario las complete en vez de tipearlas).
- [ ] **Step 2:** Descarga con `<a download>` generando Blob type `text/csv;charset=utf-8` + BOM para Excel.

**Criterio de aceptación:** la plantilla abre en Excel con `;` y decimales correctos.

### Task 5.3: Persistencia versionada [⚙️ medio]

**Por qué:** nunca sobrescribir una vigencia esistente — el patrón del repo es **insertar una nueva fila con `vigencia_desde` nueva** (igual que `TablaVigencias`/`escalasStore.guardarVigencias`).

- [ ] **Step 1:** En `conveniosStore.js` agregar `importarVigencias(convenioId, filas)` que:
  - Separa `basico` (→ `nom_categorias`) y `no_remunerativo` (→ `nom_no_remunerativos`).
  - Convierte modalidad: `hora`→'h'? — VERIFICAR valores actuales de `nom_categorias.modalidad` antes (grep en migraciones `0002`/`0018`). Usar el mismo enum.
  - Inserta solo filas cuya `(convenio_id, nombre, vigencia_desde)` no exista ya (pre-consulta a la tabla; el `UNIQUE` hace de red de seguridad contra la carrera).
  - Devuelve `{ insertados, omitidos }` (omitidos = duplicados).
- [ ] **Step 2 (TDD):** test del store con mock de `supabase` verificando insert contra `nom_categorias` y `nom_no_remunerativos`, y la deduplicación.

**Criterio de aceptación:** importar el mismo CSV dos veces inserta una sola vez (los segundos van a `omitidos`).

### Task 5.4: UI de importación con diff previo [⚙️ medio]

- [ ] **Step 1:** Nueva pestaña "Importar CSV" en `ConfiguracionPage.jsx` bajo el selector de convenio (o botón dentro de `TabConvenios`). Flujo en pasos:
  1. Elegir convenio + subir/tirar el `.csv` (o pegar texto).
  2. **Revisión**: tabla de filas parseadas con validez por fila y aviso de duplicados contra la base (categorías nuevas vs existentes por `nombre`+`vigencia_desde`).
  3. Confirmar → `importarVigencias` → resumen `{ insertados, omitidos }` + toast y recarga de la pestaña.
- [ ] **Step 2:** Botón "Descargar plantilla".
- [ ] **Step 3:** Estados vacíos/errores (archivo sin filas válidas, convenio sin seleccionar).
- [ ] **Step 4:** Test de componente con `test-utils` (mock de `crypto.subtle`/file reader o pasar el texto parseado directo).

**Criterio de aceptación:** el flujo completo funciona en la UI; el usuario ve qué se va a insertar antes de confirmar.

### Task 5.5: Verificación final [⚙️ bajo]

- [ ] **Step 1:** `npm test && npm run lint && npm run build`.
- [ ] **Step 2:** Importar un CSV real de prueba en la empresa demo; confirmar que la pestaña Escalas/No remunerativos muestra las vigencias nuevas.

**Criterio de aceptación:** datos visibles en escalas con su vigencia.

---

## Fase 6 — Bugs de interfaz (10 verificados) [⚙️ medio]

Cada bug es una task con su propio commit. Todos verificados leyendo código (ini.

### Task 6.1: (ALTA) Eliminar documento de legajo sin confirmación

**File:** `src/components/legajo/DocumentosLegajo.jsx:55-59,90`.
**Bug:** un click borra el registro y el archivo del bucket, irreversible, sin `confirm` ni toast de éxito.
- [ ] **Step 1:** Agregar `window.confirm` (o modal pequeña usando el patrón del repo) y toast de éxito al eliminar.
- [ ] **Step 2:** Test del handler.

### Task 6.2: (MEDIA) "Quitar" bono sin confirmación y con fallo silencioso

**File:** `src/components/config/TabBonos.jsx:171,245`; `src/store/bonosStore.js:79-84`.
**Bug:** borrado de aplicación/excepción de un click, sin confirmación; el onClick ignora `{ ok:false }`.
- [ ] **Step 1:** Confirmación + toast (éxito y error). Manejar el `{ ok:false }` del store.
- [ ] **Step 2:** Tests de los handlers.

### Task 6.3: (MEDIA) Pestañas de configuración en blanco al cambiar empresa (Superadmin)

**File:** `src/pages/ConfiguracionPage.jsx:54,101-107,114`.
**Bug:** `convenioId` no se resetea al cambiar `empresaVista`; `convenios.find(...)` da null y el efecto de preselección no vuelve a correr. `TabEscalas`/`TabNoRemunerativos` quedan en blanco.
- [ ] **Step 1:** Resetear `convenioId` al cambiar de empresa (o que el efecto corra también cuando `find` da null).
- [ ] **Step 2:** Test del store/componente con cambio de empresa.

### Task 6.4: (MEDIA) Paginación de Aprobaciones sin volver atrás

**File:** `src/hooks/usePaginado.js:13`; `src/pages/AprobacionesPage.jsx:92,217-221`.
**Bug:** solo `siguientePagina` — sin página anterior, y deja un `<div>` vacío cuando `pagina>0` sin más páginas.
- [ ] **Step 1:** Agregar `paginaAnterior()`/`irAPagina(n)` a `usePaginado`. Botón "Ver anteriores"/paginador en Aprobaciones.
- [ ] **Step 2:** No renderizar el `<div>` vacío. Test del hook.

### Task 6.5: (MEDIA) LegajosPage: "Cargar más" pagina sobre el total sin respetar filtro de estado

**File:** `src/pages/LegajosPage.jsx:43-47,81,117-121,143-145`.
**Bug:** el filtro activo/inactivo se aplica a lo cargado, pero `hayMasPaginas` usa el count de todos los estados: con mayoría inactivos y filtro "Activo", "Cargar más" no cambia la tabla.
- [ ] **Step 1:** En la query, traer también el count por estado filtrado para el paginado (o cargar más y filtrar y cortar cuando no quedan del estado actual). Ajustar `hayMasPaginas` al count del estado elegido.
- [ ] **Step 2:** Test del componente con datos mixtos.

### Task 6.6: (MEDIA) Dos sistemas de toast superpuestos

**File:** `src/components/Toast.jsx:24-28`; `src/components/ToastContainer.jsx:22-27`; `src/pages/LiquidacionPage.jsx:335,853`.
**Bug:** ambos comparten posición `bottom:20 right:20`. LiquidacionPage usa el `Toast` legacy puntual para algunas acciones y el global para el store.
- [ ] **Step 1:** Unificar: eliminar el `Toast` legacy de LiquidacionPage y pasar esas acciones por el `toastStore`/`ToastContainer` global (que ya vive en `Layout.jsx:79`).
- [ ] **Step 2:** Verificar posición única y tests de regresión de LiquidacionPage.

### Task 6.7: (MEDIA) "Crear período" no navega ni da feedback

**File:** `src/pages/LiquidacionPage.jsx:529-571`.
**Bug:** tras insertar, solo resetea el form sin toast ni navegación; el usuario no sabe si se creó.
- [ ] **Step 1:** Después de insertar: toast de éxito ("Período creado") y navegación a la pestaña "Períodos" (o seleccionar el período nuevo).
- [ ] **Step 2:** Test del flujo.

### Task 6.8: (MEDIA) Eliminar tipo de documento obligatorio sin confirmación

**File:** `src/components/config/TabDocumentacion.jsx:54`.
- [ ] **Step 1:** Confirmación (avisa que afecta a los legajos que usan ese tipo) + toast.
- [ ] **Step 2:** Test.

### Task 6.9: (BAJA) Tabla de vigencias sin estado vacío

**File:** `src/components/config/TablaVigencias.jsx:37-47`.
**Bug:** convenio sin categorías/no-remunerativos → solo encabezado sin mensaje.
- [ ] **Step 1:** Mensaje de vacío ("Sin categorías para este convenio" / "Sin no remunerativos") + CTA descargar plantilla CSV (ver Task 5.2). Afecta `TabEscalas`/`TabNoRemunerativos`.

### Task 6.10: (BAJA) Historial de LiquidacionesIndividuales sin scroll horizontal

**File:** `src/components/LiquidacionesIndividuales.jsx:413-435`.
**Bug:** la tabla de historial no está envuelta en `.table-scroll`; en mobile se aplasta.
- [ ] **Step 1:** Envolver en `.table-scroll` igual que la grilla principal.
- [ ] **Step 2:** Verificar responsiva.

---

## Fase 7 — Recibo "para el Empleado" (firma del aprobador) y recibo "para el Empleador" (espacio de firma del empleado) [⚙️ medio-alto]

> **Contexto (verificado en el relevamiento):** hoy no existe ninguna entidad de firma en el sistema (solo el logo de empresa, vía `nom_empresas.logo_url` + storage + `cargarLogoRecibo.js`). El recibo actual tiene única línea de firma "Firma del Empleado" (`reciboPdf.js:178-179`). El RPC `emitir_recibo` asigna `numero_recibo` por liquidación y guarda `hash_pdf` (`nom_liquidaciones.hash_pdf`), y **no chequea ningún estado de aprobación**: un recibo preliminar o rechazado se puede emitir igual (`LiquidacionPage.jsx:1057-1061` es el único gate visible). El `aprobador_pagos`/`admin` aprueba el pago vía el flujo del período (`avanzar_flujo`, pasos con `rol_requerido` de `0014`/`0025`); la instancia queda en `'aprobado'` en `nom_flujo_instancias` al pasar el último paso.

**Objetivo:** dos variantes del mismo recibo, ambas con el mismo `numero_recibo`:
- **para el Empleado** (lo recibe el trabajador): lleva la **firma del aprobador de pago** (imagen) y como aclaración el Nombre y Apellido + puesto de la compañía. Solo descargable cuando el **flujo del período está aprobado**.
- **para el Empleador** (lo conserva la empresa): deja el **espacio en blanco para firmar del empleado** (comportamiento actual del recibo). Descargable siempre (también antes de la aprobación).

### Task 7.1: Migración `0069` — firma por empresa y hashes por variante [⚙️ medio]

**Por qué:** no existe ninguna tabla de firma; el `hash_pdf` único no alcanza para dos variantes; y `nom_liquidaciones` debe registrar qué variante se emitió. Además, `numero_recibo` debe seguir siendo único por empresa (mismo número, dos variantes) — no hay que tocar la secuencia.

- [ ] **Step 1:** Crear `supabase/migrations/0069_firma_recibos.sql`:
  - **Tabla `nom_firma_empresa`** (una fila por empresa): `empresa_id UUID PRIMARY KEY REFERENCES nom_empresas(id)`, `firma_url TEXT` (storage público, patrón logo de `0036`), `nombre_completo TEXT NOT NULL`, `puesto TEXT NOT NULL`, `configurado_por UUID`, `actualizado_en TIMESTAMPTZ DEFAULT now()`. RLS: `empresa_id = auth_empresa_id()` OR `is_superadmin()` (igual que `nom_config_obras`, 0060). Grants a `authenticated`.
  - **Bucket de storage** `nom-firmas` público (mismo patrón que el bucket `nom-logos`, 0036).
  - **Columnas nuevas en `nom_liquidaciones`:** `hash_pdf_empleado TEXT`, `hash_pdf_empleador TEXT`, `emitido_empleado BOOLEAN NOT NULL DEFAULT false`, `emitido_empleador BOOLEAN NOT NULL DEFAULT false`. Conservar `hash_pdf`/`numero_recibo` como están (compatibilidad con lo ya emitido).
  - **Nueva función RPC `emitir_recibo_variante(p_liquidacion_id UUID, p_variante TEXT, p_hash TEXT)`** (variante en `'empleado'|'empleador'`):
    - Idempotente con `emitir_recibo` (0016): si `numero_recibo` es NULL, asigna `siguiente_numero_recibo`; si ya tiene, reutiliza.
    - Guarda `hash_pdf_empleado`/`hash_pdf_empleador` + flag según variante.
    - **Rechaza `estado_revision = 'rechazado'`** (mismo espíritu que el rechazo de anuladas en 0016:79-81).
    - Para `p_variante = 'empleado'`: **requiere firma configurada** (`EXISTS nom_firma_empresa` para la empresa) y **requiere el flujo aprobado**: `EXISTS (SELECT 1 FROM nom_flujo_instancias i WHERE i.periodo_id = v_liq.periodo_id AND i.estado = 'aprobado')`. De lo contrario `RAISE EXCEPTION` con mensaje claro.
    - Autorización: solo superadmin o empresa propia (patrón de 0016:76-78).

**Criterio de aceptación:** la migración aplica idempotente; el RPC asigna un solo número a ambas variantes y deja el hash del empleado en NULL hasta que haya flujo aprobado + firma.

### Task 7.2: UI para cargar la firma del aprobador [⚙️ medio]

**Files:** `src/store/firmaStore.js` (nuevo), `src/components/config/TabEmpresa.jsx`, `src/utils/cargarFirmaRecibo.js` (nuevo, patrón `cargarLogoRecibo.js`).

- [ ] **Step 1 (TDD):** store `firmaStore` con `cargarFirma(empresaId)`, `subirFirma({ empresaId, file, nombreCompleto, puesto })` que: valida PNG/JPG ≤ 2 MB, sube a `nom-firmas/<empresa_id>/firma-<ts>.<ext>`, `getPublicUrl`, guarda en `supabase.from('nom_firma_empresa').upsert(...)` con `onConflict: 'empresa_id'`. Tests con mock de supabase (`src/store/__tests__/firmaStore.test.js`).
- [ ] **Step 2:** En `TabEmpresa.jsx`, nueva sección "Firma del aprobador de pago (recibos para empleado)" — solo visible para roles `admin`/`aprobador_pagos`/superadmin (`permisos.js:12` `aprobar_pago`). Input file + vista previa de la imagen (patrón logo, TabEmpresa.jsx:149-208) + inputs **Nombre y Apellido** y **Puesto de la compañía** + botón Guardar.
- [ ] **Step 3:** `cargarFirmaRecibo.js`: `fetch(url) → readAsDataURL` devolviendo `{ dataUrl, ancho, alto, formato }` (clon de `cargarLogoRecibo.js`); tolerante: nunca rompe la emisión si la firma falla (el recibo para empleado sale con aclaración textual pero sin la imagen, o se muestra un error previo en el botón).

**Criterio de aceptación:** la empresa carga una firma única visible en la UI; la firma queda en storage y en `nom_firma_empresa`.

### Task 7.3: Recibo PDF con variante y firma del aprobador [⚙️ medio]

**Files:** `src/utils/reciboPdf.js`, `src/utils/emitirReciboLegajo.js`, `src/utils/reciboLayout.js`.

- [ ] **Step 1:** `generarReciboPdf({ empresa, persona, periodo, items, codigoRecibo, variante = 'empleador', firma = null })`:
  - `variante === 'empleador'` → comportamiento actual (línea "Firma del Empleado" en blanco, reciboPdf.js:178-179).
  - `variante === 'empleado'` → en vez de la línea de firma del empleado, dibuja la **imagen de la firma del aprobador** (`doc.addImage` con la `dataUrl`, patrón del logo reciboPdf.js:74-84) + aclaración debajo: `Nombre y Apellido` en negrita y `Puesto` en la línea siguiente. Si no llega `firma`, imprime solo la aclaración textual (nombre/puesto).
  - Mantener numeroALetras/recibo N°/hashes por variante.
- [ ] **Step 2:** `emitirReciboLegajo.js` — `generarYDescargarRecibo({ ..., variante, firma })` lo propaga a `generarReciboPdf`. `reciboLayout.js` no cambia (los ítems son los mismos para ambas variantes).

**Criterio de aceptación:** con la firma cargada, la variante empleado muestra imagen + aclaración; la empleador conserva el espacio en blanco.

### Task 7.4: Emitir por separado y gate de flujo aprobado [⚙️ medio]

**Files:** `src/pages/LiquidacionPage.jsx`, `src/components/LiquidacionesIndividuales.jsx`, `src/pages/FichaLegajoPage.jsx`, `src/store/liquidacionStore.js`, `src/store/aprobacionesStore.js`.

**Por qué:** hoy `cargarLiquidaciones` trae `nom_liquidaciones` sin saber si su período quedó aprobado. El gate (flujo aprobado) hay que exponerlo al front.

- [ ] **Step 1 (TDD):** en `liquidacionStore.cargarLiquidaciones`, además traer para el período: `supabase.from('nom_flujo_instancias').select('estado').eq('periodo_id', periodoId)` y exponer `flujoAprobado: existe instancia con estado 'aprobado'`. Mapear en `liquidacionFromDB` como `periodoFlujoAprobado`. Test del mapper.
- [ ] **Step 2:** En `LiquidacionPage.jsx` (fila expandida ~l.1057), si `periodoFlujoAprobado` y hay firma configurada y `!l.anulado`: botón **"Emitir recibo para Empleado"**. Botón **"Emitir recibo para Empleador"** disponible siempre (siempre que el recibo sea emitible). Ambos llaman al flujo de 3 pasos (reservar número → `generarYDescargarRecibo` con variante → `emitirReciboVariante` con hash) usando la variante correcta.
- [ ] **Step 3:** Si falta la firma o el flujo de aprobado, tooltip explicativo en el botón (ej. "Se habilita cuando el período esté aprobado y esté cargada la firma").
- [ ] **Step 4:** Replicar los dos botones en `LiquidacionesIndividuales.jsx` y `FichaLegajoPage.jsx` (patrón del handler `handleDescargarRecibo` existente).
- [ ] **Step 5:** En `AprobacionesPage.jsx`, al quedar el período aprobado (tras `actuar` con aprobado en el último paso), mostrar toast "Período aprobado: ya se pueden emitir los recibos para el empleado a los legajos".

**Criterio de aceptación:** antes de la aprobación solo existe el botón "para Empleador"; después existe el "para Empleado" (si hay firma cargada).

### Task 7.5: Descarga por lote con variantes [⚙️ medio]

**Files:** `src/utils/reciboZip.js`, `src/pages/LiquidacionPage.jsx`.

- [ ] **Step 1:** `generarZipRecibos({ ..., variante, firma })` propaga la variante a cada `generarYDescargarRecibo` del lote. Los nombres de archivo dentro del ZIP llevan sufijo `-empleado`/`-empleador` (respeta la numeración correlativa secuencial ya comentada en reciboZip.js:11-13).
- [ ] **Step 2:** En `LiquidacionPage.jsx`, dos botones de lote junto a "Descargar recibos (N)" (l.606-609):
  - "Descargar recibos para Empleador (N)" — siempre que haya selección y permisos.
  - "Descargar recibos para Empleado (N)" — solo si el período está `flujoAprobado` (todos los seleccionados pertenecen al período aprobado) y hay firma cargada; si no, `disabled` + tooltip.
- [ ] **Step 3:** Ambos respetan el progreso/fallidos del ZIP actual y el panel de errores (LiquidacionPage.jsx:856-868).

**Criterio de aceptación:** se descargan las dos variantes por separado y con el mismo número de recibo por legajo.

### Task 7.6: Verificación y cierre [⚙️ bajo]

- [ ] **Step 1:** `npm test && npm run lint && npm run build` verdes.
- [ ] **Step 2:** Flujo manual de verificación: configurar firma (Superadmin o admin) → período enviado a aprobación → aprobar en `AprobacionesPage` → verificar que aparezca el botón "para Empleado" y que el PDF muestre la firma + nombre y puesto.
- [ ] **Step 3:** Actualizar `docs/RUNBOOK-DE-MIGRACIONES.md` y archivar las decisiones en `docs/VALIDACION-CONTADOR.md` si corresponde.

**Criterio de aceptación:** el cliente confirma que el recibo para empleado lleva la firma del aprobador y que sin aprobación solo se puede imprimir el de empleador.

---

## Fase 8 — Verificación final y cierre [⚙️ bajo]

- [ ] **Step 1:** `npm test && npm run lint && npm run build` completo en verde.
- [ ] **Step 2:** Repasar `git log` de este rango: cada cambio con su commit y su texto.
- [ ] **Step 3:** Notificar al usuario/deploy autorizado: (a) deployar la edge function `liquidar-periodo` (debe incluir el fix del tope), (b) aplicar migraciones `0060-0068` si no estaban aplicadas aún Y la `0069` (firma/recibos), (c) actualizar `docs/RUNBOOK-DE-MIGRACIONES.md` con el estado real.
- [ ] **Step 4:** Cerrar con el cliente el diagnóstico del tope (Task 1.4), validar los recibos visualmente (Task 3.5) y validar la nueva firma (Task 7.6).

**Criterio de aceptación:** todo verde; el cliente confirma tope, recibo sin $0/sin pisar, disclaimer, importador CSV y recibos con firma.