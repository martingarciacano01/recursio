# Handoff — Períodos por convenio (modalidad mensual/quincenal)

## Qué cambió

- Cada **convenio** ahora tiene una **modalidad** (mensual o quincenal) y sus propias **fechas de corte** (día del mes de inicio/fin de cada quincena y del mensual). Nueva pestaña **"Convenios"** en Configuración para dar de alta convenios propios y editar su modalidad/fechas.
- **"Nuevo período"** en Liquidación ya no pide fechas libres: ahora elegís **Año, Mes, Tipo** y, si corresponde, el **Convenio** (si hay más de uno con esa modalidad). Las fechas se calculan solas (con manejo automático de fin de mes, incluido febrero bisiesto/no bisiesto). Los SAC siguen con fecha manual, sin cambios.
- El personal a liquidar en un período mensual/quincenal ahora se filtra por el `convenio_id` de ESE período, no solo por el flag "fuera de convenio" como antes — así dos convenios con modalidad quincenal pero fechas de corte distintas no se pisan entre sí.
- **Reportes** reutiliza el mismo selector de período (agrupado por año) que ya usaba Liquidación, en vez de su `<select>` con formato crudo.

## Migración pendiente de aplicar

Además de las migraciones 0031-0034 (si todavía no las aplicaste), falta:

- `supabase/migrations/0035_periodos_por_convenio.sql` — agrega `modalidad` y fechas de corte a `nom_convenios`, y `convenio_id` a `nom_periodos`.

## Verificación

- Suite completa: 57 archivos, 325 tests, 0 fallos (2 archivos RLS se skipean, esperado sin DB en vivo).
- `npm run lint`: sin errores nuevos atribuibles a este trabajo — los ~21 errores que aparecen hoy son de una regla de eslint más estricta (`react-hooks/set-state-in-effect`) que se activó en TODO el repo tras la última instalación de dependencias (afecta código preexistente en `ConfiguracionPage.jsx`, `SuperAdminPage.jsx`, `ReportesPage.jsx`, etc., ninguno en los archivos nuevos de esta tarea). Ninguno de los 6 archivos que creé/edité en este plan (`calcularFechasPeriodo.js`, `conveniosStore.js`, `TabConvenios.jsx`) aparece en esa lista.
- `npm run build`: build limpio.
- Cada una de las 7 tareas del plan pasó por implementación + revisión de cumplimiento de spec + revisión de calidad de código (subagentes independientes), con 3 rondas de correcciones reales aplicadas: manejo de tipo/convenio inválido en `calcularFechasPeriodo`, sincronización del estado local en `actualizarConvenio`, limpieza de mensajes de error al cambiar de contexto en `TabConvenios`, remoción de un helper de defaults innecesario en `LiquidacionPage`, y `try/catch` + tests de error en el formulario de nuevo período.

## Comandos de git (correr vos, desde tu máquina)

```bash
cd /ruta/a/recursio
git add supabase/migrations/0035_periodos_por_convenio.sql \
        src/utils/calcularFechasPeriodo.js src/utils/__tests__/calcularFechasPeriodo.test.js \
        src/store/conveniosStore.js src/store/__tests__/conveniosStore.test.js \
        src/components/config/TabConvenios.jsx src/components/config/__tests__/TabConvenios.test.jsx \
        src/pages/ConfiguracionPage.jsx \
        supabase/functions/liquidar-periodo/index.ts \
        src/pages/LiquidacionPage.jsx src/pages/__tests__/LiquidacionPage.test.jsx \
        src/pages/ReportesPage.jsx \
        docs/superpowers/specs/2026-07-28-periodos-por-convenio-design.md \
        docs/superpowers/plans/2026-07-28-periodos-por-convenio.md \
        docs/2026-07-28-handoff-periodos-por-convenio.md

git commit -m "feat: periodos por convenio (modalidad mensual/quincenal + fechas auto-calculadas)

- Convenios ganan modalidad (mensual/quincenal) y fechas de corte configurables
- Nueva pestana Convenios en Configuracion (alta y edicion)
- Nuevo periodo se arma por Anio/Mes/Tipo/Convenio, fechas auto-calculadas
- liquidar-periodo filtra personal por convenio_id del periodo
- ReportesPage reutiliza el SelectorPeriodo agrupado por anio
- Migracion 0035 pendiente de aplicar"

git push origin dev
```
