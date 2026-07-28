# Handoff — Fase 6: legajo editable, períodos legibles, Dashboard (28/07/2026)

Estado: **código de las 9 tasks implementado y testeado. Migraciones SQL escritas
pero SIN aplicar todavía — hay que correrlas a mano en Supabase antes de usar
las funciones nuevas.** Los `git commit` no pudieron correrse desde este entorno
(ver sección 4); los cambios están en el working tree, sin commitear.

---

## 1. Migraciones pendientes de aplicar (en este orden)

Ejecutar en Supabase → SQL Editor, una por una:

1. **`0031_seed_conceptos_base.sql`** — de la sesión anterior (handoff
   `2026-07-28-handoff-liquidacion-cero.md`). **Sin ella la liquidación sigue
   dando $0** (no existe el concepto `basico`). Aplicar ANTES de verificar
   cualquier monto de esta fase.
2. **`0032_documentos_legajo.sql`** — crea `nom_documentos_requeridos`,
   `nom_documentos_legajo`, RLS y el bucket de Storage `nom-documentos`.
   Sin esto, la pestaña Documentación del legajo y Configuración →
   Documentación tiran error de tabla inexistente.
3. **`0033_periodo_mensual_fuera_convenio.sql`** — agrega el tipo de período
   `mensual_fc` al CHECK de `nom_periodos.tipo`. Sin esto, crear un período
   "Fuera de convenio (mensual)" falla por violar el constraint.

Verificación rápida después de aplicar las tres:
```sql
select count(*) from nom_documentos_requeridos; -- 0, sin error
select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'nom_periodos_tipo_check';
-- debe incluir 'mensual_fc'
```

## 2. Qué se implementó (las 9 revisiones del 28/07/2026)

| # | Revisión | Cambio | Verificar en |
|---|---|---|---|
| 1 | Liquidación lenta (20 invocaciones) | Se cuentan los omitidos como procesados (Edge Function) + corte por falta de progreso en el cliente | Liquidación → Calcular → 1 sola invocación en Network |
| 2 | Categoría con UUID crudo | `form` se resincroniza cuando llega `legajo`; categorías cuelgan también de `legajo.convenioId` | Legajos → persona → Datos → "Categoría: Ayudante" |
| 3 | Sueldo individual fuera de convenio | Vista de solo lectura muestra sueldo convenido; `legajoIncompleto` no exige convenio/categoría si `fueraConvenio` | Datos → tildar "Fuera de convenio" → cargar sueldo → guardar |
| 4 | Editar familiares | Modo edición en `TabFamiliares` (el store ya soportaba UPDATE) | Familiares → Editar → Guardar cambios |
| 5 | Cargar documentación + tipos configurables | Tablas nuevas `nom_documentos_requeridos`/`nom_documentos_legajo`, store, pestaña en el legajo y en Configuración | Configuración → Documentación; Legajo → Documentación |
| 6 | Editar sanciones | Modo edición en `TabSanciones` (el store ya soportaba UPDATE) | Sanciones → Editar → Guardar cambios |
| 7 | Liquidaciones y recibos en el legajo | `emitirReciboLegajo.js` extrae la lógica de `LiquidacionPage`; la ficha del legajo emite/descarga el mismo recibo | Legajo → Liquidaciones → Emitir recibo |
| 8 | Etiquetas de período | `etiquetaPeriodo.js` único, usado por selector, tabla de liquidaciones y recibo; nuevo tipo `mensual_fc` | Selector y encabezados: "Junio 2026 · 1ra quincena" |
| 9 | Dashboard por tareas pendientes | 5 tarjetas clickeables: aprobaciones, liquidaciones a realizar, legajos a revisar, bajas sin final, personal activo. Umbrales en Configuración → Alertas | Dashboard |

## 3. Verificación de tests corrida en este entorno

- `npx vitest run`: **52 archivos, 284 tests, 0 fallas** (más 2 archivos de
  RLS que se skipean sin credenciales reales de Supabase).
- `npm run lint`: sin errores nuevos. Los 10 errores y ~24 warnings que
  aparecen son preexistentes (no en archivos tocados por esta fase) salvo los
  nuevos warnings `react-hooks/exhaustive-deps` en `TabAlertas`,
  `TabDocumentacion`, `DocumentosLegajo` y `EditorDatosLegajo` — mismo patrón
  que ya tiene el resto del código base (no incluir las acciones del store en
  las dependencias).
- `npm run build`: build de producción OK.
- Motor puro (`packages/motor`, ejecutado desde esa carpeta): 9 archivos, 105
  tests, 0 fallas — nadie tocó el motor en esta fase, así que no hay
  regresión.
- La verificación manual en la app (`npm run dev`, clicks reales) **no se
  hizo** — este entorno no tiene navegador ni Supabase real conectado.
  Recomendado antes de dar por cerrada la fase.

## 4. Nota operativa: no se pudo commitear

Los `git commit` en el working tree conectado fallan con `Resource deadlock
avoided` / `Operation not permitted` al escribir `.git/COMMIT_EDITMSG` e
`.git/index.lock` — parece un conflicto con el proceso de sincronización local
de la carpeta. Los archivos modificados/creados quedaron en el disco, listos
para revisar y commitear manualmente. Sugerencia de commits (uno por task,
como pedía el plan):

```bash
git add supabase/functions/liquidar-periodo/index.ts src/store/liquidacionStore.js src/store/__tests__/liquidacionStore.test.js
git commit -m "perf(liquidar): contar omitidos como procesados y cortar reintentos sin progreso"

git add src/components/legajo/EditorDatosLegajo.jsx src/components/legajo/__tests__/EditorDatosLegajo.test.jsx
git commit -m "fix(legajo): resolver el nombre de la categoria en la vista de solo lectura"

git add src/utils/legajoCompletitud.js src/utils/__tests__/legajoCompletitud.test.js src/components/legajo/EditorDatosLegajo.jsx src/components/legajo/__tests__/EditorDatosLegajo.test.jsx src/pages/DashboardPage.jsx
git commit -m "feat(legajo): sueldo convenido visible y completitud correcta para fuera de convenio"

git add src/components/legajo/TabFamiliares.jsx src/components/legajo/__tests__/TabFamiliares.test.jsx
git commit -m "feat(legajo): editar familiares desde la ficha"

git add src/components/legajo/TabSanciones.jsx src/components/legajo/__tests__/TabSanciones.test.jsx
git commit -m "feat(legajo): editar sanciones desde la ficha"

git add supabase/migrations/0032_documentos_legajo.sql src/store/documentosStore.js src/store/__tests__/documentosStore.test.js src/components/legajo/DocumentosLegajo.jsx src/components/legajo/__tests__/DocumentosLegajo.test.jsx src/components/config/TabDocumentacion.jsx src/pages/ConfiguracionPage.jsx src/pages/FichaLegajoPage.jsx
git commit -m "feat(legajo): carga de documentacion con tipos requeridos configurables"

git add src/utils/etiquetaPeriodo.js src/utils/__tests__/etiquetaPeriodo.test.js supabase/migrations/0033_periodo_mensual_fuera_convenio.sql src/components/SelectorPeriodo.jsx src/components/__tests__/SelectorPeriodo.test.jsx src/pages/LiquidacionPage.jsx supabase/functions/liquidar-periodo/index.ts
git commit -m "feat(periodos): etiquetas legibles y periodo mensual solo para fuera de convenio"

git add src/utils/emitirReciboLegajo.js src/utils/__tests__/emitirReciboLegajo.test.js src/pages/FichaLegajoPage.jsx src/pages/LiquidacionPage.jsx
git commit -m "feat(legajo): liquidaciones legibles y emision de recibo desde la ficha"

git add src/utils/alertasDashboard.js src/utils/__tests__/alertasDashboard.test.js src/components/config/TabAlertas.jsx src/pages/DashboardPage.jsx src/pages/ConfiguracionPage.jsx
git commit -m "feat(dashboard): tarjetas de pendientes con umbrales de alerta configurables"

git add docs/2026-07-28-handoff-fase6.md
git commit -m "docs: handoff de la fase 6"
```

## 5. Pendientes explícitos (fuera del alcance de este plan)

1. **Documentos bidireccionales con Presencio** — que lo cargado en Recursio
   se vea dentro de Presencio requiere tocar la otra app. Decisión postergada
   por el usuario ("revisémoslo después").
2. **Migración `0031_seed_conceptos_base.sql`** — sin aplicar (ver sección 1).
3. **`tope_sipa` sin cargar** en Configuración → Parámetros: los aportes con
   tope se calculan sobre el bruto completo.
4. **Fórmulas de horas extra y presentismo para UOCRA** — las columnas HE 50 %
   / HE 100 % se calculan pero no se pagan, porque ningún concepto las
   consume.
