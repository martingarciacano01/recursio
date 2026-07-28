# Handoff — Liquidaciones individuales + Vacaciones (Fase 6b)

## Qué cambió

- Nueva pestaña **"Liquidaciones individuales"** en `LiquidacionPage` (junto a "Períodos generales"). Ahí se generan vacaciones y liquidación final por persona, no de forma masiva.
- **Vacaciones gozadas**: ahora se calculan como días de la ausencia aprobada en Presencio × valor día (sueldo/25 o valor hora × 8), no con la fórmula por antigüedad. La fórmula por antigüedad se mantiene sin cambios para "vacaciones no gozadas" dentro de la liquidación final.
- Las fechas de vacaciones se toman de una ausencia de Presencio (`tipo='vacaciones'`, `estado='aprobada'`) elegible (no liquidada antes), o se pueden cargar manualmente si no está registrada en Presencio.
- Nuevo selector de período: `<select>` nativo agrupado por año, reemplaza las cajas anidadas.
- El formulario "Nuevo período" (masivo) ya no ofrece "vacaciones" ni "liquidación final" como opciones — solo períodos que tiene sentido liquidar para toda la nómina (quincenas, mensual, SAC).

## Migración pendiente de aplicar

Falta aplicar en Supabase SQL Editor (en orden, si no se aplicaron ya las anteriores 0031-0033):

- `supabase/migrations/0034_vacaciones_liquidadas.sql` — crea la tabla `nom_vacaciones_liquidadas` (trazabilidad de qué ausencia de Presencio ya fue pagada).

## Verificación

- Test suite completa: 54 archivos, 302 tests, todo verde (2 archivos RLS se skipean, esperado).
- `npm run lint`: sin errores nuevos — los 10 errores/24 warnings que aparecen son preexistentes, ninguno en los archivos tocados en esta tarea.
- `npm run build`: build limpio.

## Comandos de git (correr vos, desde tu máquina)

```bash
cd /ruta/a/recursio
git add supabase/migrations/0034_vacaciones_liquidadas.sql \
        packages/motor/src/especiales.ts packages/motor/src/especiales.test.ts \
        supabase/functions/liquidar-periodo/index.ts \
        src/utils/agruparAusencias.js src/utils/vacacionesElegibles.js \
        src/utils/__tests__/vacacionesElegibles.test.js \
        src/store/liquidacionStore.js src/store/__tests__/liquidacionStore.test.js \
        src/components/SelectorPeriodo.jsx src/components/__tests__/SelectorPeriodo.test.jsx \
        src/components/LiquidacionesIndividuales.jsx src/components/__tests__/LiquidacionesIndividuales.test.jsx \
        src/pages/LiquidacionPage.jsx \
        docs/2026-07-28-handoff-liquidacion-individuales.md

git commit -m "feat: liquidaciones individuales (vacaciones y final por persona)

- Vacaciones gozadas se calculan por días de ausencia aprobada en Presencio x valor dia
- Nueva pestana Liquidaciones individuales en LiquidacionPage
- Selector de periodo rediseñado (select agrupado por anio)
- Formulario masivo ya no ofrece vacaciones/final como opciones
- Nueva tabla nom_vacaciones_liquidadas (migracion 0034, pendiente de aplicar)"

git push origin dev
```
