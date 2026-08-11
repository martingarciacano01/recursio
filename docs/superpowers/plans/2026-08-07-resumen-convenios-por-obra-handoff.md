# Resumen — Convenios por obra, ajustes de horas, bonos no remunerativos, features por empresa

> Handoff breve para continuar en otra conversación. Plan original: `docs/superpowers/plans/2026-08-07-convenios-por-obra-ajustes-bonos-ejecucion-sonnet5.md`.

## Estado: implementado y commiteado en `main`. 549 tests en verde.

## Qué se hizo

**DB (migraciones `supabase/migrations/`):**
- `0058` `nom_v_obras` — vista de solo lectura hacia `obras` de Presencio.
- `0059` `nom_convenios.obra_id` + `clonar_convenio(convenio_global_id, p_empresa_id, p_obra_id)` — clona plantilla hacia una obra puntual (o toda la empresa si `p_obra_id` es null).
- `0060` `nom_config_obras` — tope de horas diarias y jornada por obra.
- `0061` `nom_ajustes_horas` — delta global de horas por persona y período (no día a día).
- `0062` `nom_bonos` + `nom_bono_aplicaciones` + `nom_bono_excepciones` — bono no remunerativo: catálogo global (superadmin) + aplicación por empresa/obra + excepción por persona.
- `0063` `nom_empresa_features` — toggle por empresa de las 4 features de arriba (`convenios_por_obra`, `topes_horas_por_obra`, `ajuste_horas_periodo`, `bonos_no_remunerativos`). Sin fila = apagada (fail-closed).

**Todas las 6 migraciones ya están aplicadas en Presencio-dev** (confirmado por el usuario).

**Motor (`packages/motor/src/motor.ts`):** tipo de concepto `'bono'` — suma a bruto/neto, NO alimenta `remunerativo_acumulado`/`no_remunerativo_acumulado` (no integra base de aportes), `grupoRecibo` forzado a `null` (nunca se imprime en el recibo).

**Edge function (`supabase/functions/liquidar-periodo/index.ts`):**
- Lee `obra_id` del personal (vía `nom_v_personal`).
- Resuelve tope de horas/jornada: obra → empresa → default 8h.
- Aplica el ajuste global de horas del período antes de calcular el básico.
- Agrega bonos aplicables (obra + excepción) como conceptos sintéticos tipo `bono`.
- **Respeta `nom_empresa_features`**: si una feature está apagada para la empresa, ignora los datos aunque existan (ajustes, config de obra, bonos cargados de una prueba previa no se aplican si el flag está off).

**Frontend:**
- `conveniosStore.clonarConvenio(id, empresaId, obraId)` — obraId opcional.
- `ConfiguracionPage.jsx` — selector de obra al "Personalizar convenio" (gateado por `convenios_por_obra`).
- `TabEmpresa.jsx` — sección "Horas por obra" (gateada por `topes_horas_por_obra`).
- `LiquidacionPage.jsx` — panel de ajuste global de horas por persona en la fila expandida (gateado por `ajuste_horas_periodo`).
- `TabBonos.jsx` + `bonosStore.js` — alta de catálogo (superadmin), aplicación por obra/empresa, excepción por persona (gateado por `bonos_no_remunerativos`; tab solo visible si está prendida).
- `empresaFeaturesStore.js` — `cargarFeatures(empresaId)`, `tieneFeature(empresaId, feature)`, `setFeature(...)` (solo superadmin puede escribir, RLS lo exige).
- `SuperAdminPage.jsx` — botón "Features" por empresa, expande checkboxes para las 4 features.
- `reciboLayout.js` — sin cambios de código, solo test agregado: confirma que un ítem con `grupoRecibo: null` (bono) no aparece en ninguna sección del recibo.

**Auth (`src/store/authStore.js`, `src/pages/LoginPage.jsx`):** se agregó el flujo de MFA/TOTP (segundo factor) al login de Recursio — necesario porque `is_superadmin()` (compartido con Presencio, migración `037_mfa_guard_superadmin.sql` de fichaobra) exige sesión `aal2` si la cuenta tiene un factor TOTP verificado. Mismo patrón que `fichaobra/src/store/appStore.js` / `LoginPage.jsx`.

## Pendiente / próximos pasos

1. **Habilitar features por empresa**: recién aplicada la migración `0063`, todas las empresas arrancan con las 4 features apagadas. Ir a Superadmin → botón "Features" en cada empresa que las necesite y tildar las que correspondan.
2. **Probar de punta a punta** con features habilitadas: clonar convenio a una obra, cargar tope de horas por obra, cargar ajuste de horas, aplicar un bono con excepción, liquidar el período y verificar que el bono suma a bruto/neto pero no aparece en el PDF del recibo ni en la base de aportes.
3. **`clonar_convenio` por obra no está gateado a nivel RPC** (solo a nivel UI vía el flag `convenios_por_obra`) — si hace falta bloquearlo también server-side, agregar el chequeo dentro de la función SQL.
4. Build local (`npm run build`) requiere Node 22 (`nvm use 22`) — el repo no corre con Node 18.

## Nota sobre el entorno de esta sesión

Durante la implementación, el mount de la carpeta del proyecto tuvo un bug de I/O (`Resource deadlock avoided`) que impidió commitear/buildear desde el agente en un momento dado; se resolvió pidiéndole al usuario que corriera los comandos desde su propia terminal. Si vuelve a pasar, mismo approach: dar los comandos exactos para que el usuario los corra localmente.
