# Plan Maestro v3 — Detalle de ejecución para Sonnet 5 (esfuerzo bajo)

> **Documento compañero de** `2026-07-31-produccion-pyme-plan-maestro.md` (el índice). Amplía task por task con **código concreto, SQL, tests red/green y comandos**, para que un agente los ejecute sin tener que diseñar nada.
>
> **Reglas de este documento:**
> 1. TDD siempre: escribir el test que falla → verificar que falla → implementación mínima → verificar que pasa → commit.
> 2. Migraciones en `supabase/migrations/NNNN_nombre.sql`, numeradas e idempotentes. Nunca SQL suelto en la raíz.
> 3. RLS habilitada en el mismo archivo que crea la tabla, con `empresa_id = auth_empresa_id()` **más** `is_superadmin()`.
> 4. Zustand sin `persist` para datos salariales.
> 5. Español (Argentina) en UI, tablas y comentarios.
> 6. Commits frecuentes: `feat:`/`fix:`/`test:`/`chore:`.
>
> **Comandos de referencia (package.json):** tests `npm test` (= `npx vitest run`) · un archivo `npx vitest run <ruta>` · lint `npm run lint` · build `npm run build` · Node 22 antes de todo: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use`.
>
> **Numeración de migraciones libres:** `0043` (storage F1), `0044` (accesos_log F1), `0045` (importador F5), `0046` (feriados F2), `0047` (config horas F2), `0048` (tope SIPA mensual F2), `0049` (conceptos UOCRA F2).

---

## Fase 0 — Preparación y baseline [⚙️ bajo]

### Task 0.1: Commitear el working tree en orden lógico

**Por qué:** 95 cambios sin commitear, incluidas 7 migraciones (0036–0042), la PWA completa y los scripts. El repo hoy no es reproducible.

- [ ] **Step 1:** `git status --short`. Verificar que `dist/`, `.env*` y `scripts/.dumps/` están en `.gitignore` (agregarlos si no):
  ```bash
  grep -nE "dist|\.env|\.dumps" .gitignore || echo "FALTAN entradas en .gitignore"
  ```
- [ ] **Step 2:** Agrupar por tema y commitear. Orden propuesto (adaptar a lo que aparezca en `git status`):
  ```bash
  git log --oneline -15   # mirar el estilo del historial
  git add supabase/migrations/ && git commit -m "feat(db): migraciones 0036-0042 pendientes (empresa logo, vacaciones liquidas, periodo fuera de convenio, periodos por convenio, correccion aportes, clon cortes, basico unidad base)"
  git add public/ && git commit -m "feat(pwa): service worker y manifest"
  git add scripts/ && git commit -m "chore(scripts): utilidades de sync y dumps"
  git add packages/motor/ && git commit -m "chore(motor): ajustes del paquete motor"
  git add src/ && git commit -m "feat(ui): cambios pendientes de UI y utilidades"
  ```
  Si algo no entra limpio en un tema, `git add -p` y commit separado.
- [ ] **Step 3:** Verificar que no salió nada sensible:
  ```bash
  git status --short && git diff --cached --name-only | grep -iE "\.env|\.dumps" && echo "OJO: secreto commiteado" || echo "OK sin secretos"
  ```
- [ ] **Step 4:** `git push` a `origin/dev` **solo si el usuario lo autoriza**.
- [ ] **Step 5:** Verificación: `git status` limpio.

**Criterio de aceptación:** un checkout fresco reproduce el repo completo (PWA + migraciones 0036–0042).

### Task 0.2: Alinear Node y verificar migraciones aplicadas [⚙️ bajo]

- [ ] **Step 1:** `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm install && nvm use && node -v` → debe dar 22.x (según `.nvmrc`).
- [ ] **Step 2:** Conectar a la base real (dev y prod). Listar aplicadas:
  ```bash
  # en el SQL editor de Supabase:
  select version, name, applied_at from supabase_migrations.schema_migrations order by version;
  # y el máximo del repo:
  ls supabase/migrations | sort | tail -5
  ```
  Anotar el desvío (qué migraciones existen en el repo y faltan en la base).
- [ ] **Step 3:** Aplicar las faltantes **en orden** 0031→0042. En la CLI de Supabase: `supabase db push --db-url "$DATABASE_URL"` (o pegar cada archivo en el SQL editor). **Aplicar de a una** y verificar que `Success. No rows returned`.
- [ ] **Step 4:** Verificar seed con:
  ```sql
  select count(*) from nom_convenios;                       -- > 0
  select count(*) from nom_conceptos where codigo = 'basico'; -- > 0
  select codigo, valor, vigencia_desde from nom_parametros where codigo = 'tope_sipa' order by vigencia_desde desc limit 1;
  ```
- [ ] **Step 5:** Escribir `docs/RUNBOOK-DE-MIGRACIONES.md` (tabla: versión, nombre, fecha aplicada, base) y commitear.

**Criterio de aceptación:** Node 22 activo; migraciones aplicadas = repo; seed completo.

### Task 0.3: Baseline de lint y tests [⚙️ bajo]

- [ ] **Step 1:** `npm run lint && npm test`. Guardar la salida.
- [ ] **Step 2:** Corregir errores (no warnings) o justificarlos. Evaluar `react-hooks/set-state-in-effect` (si es solo warning, dejarlo y anotarlo).
- [ ] **Step 3:** `npm run lint && npm test` verdes → commit `chore(ci): baseline de lint y tests en verde`.

---

## Fase 1 — Seguridad (bloqueante) [⚙️ medio-alto]

> **Fuente completa:** `docs/superpowers/plans/2026-07-28-fase5h-seguridad.md` ya tiene el código (Tasks 1-5 con snippets). Esta fase lo integra y le agrega la auditoría renumerada como `0044`. **Copiar el código de ahí, no reescribirlo.**

### Task 1.1: `liquidar-periodo` valida JWT + empresa + rol [⚙️ medio]

**Files:** Modify `supabase/functions/liquidar-periodo/index.ts` · Reference `supabase/functions/invitar-usuario/index.ts`.

- [ ] **Step 1 (test que falla):** Crear `supabase/functions/liquidar-periodo/__tests__/auth.test.ts` (vitest con mocks de `Deno.serve` y `createClient`). Tres casos:
  1. sin header `Authorization` → 401 con `{error: 'falta header Authorization'}`;
  2. con token válido pero `nom_usuarios_empresas` sin rol `admin`/`rrhh` para ese `empresa_id` → 403;
  3. con rol `rrhh` de la empresa correcta → no corta (llega al resto del handler).
  Verificar que falla (la función hoy no valida nada):
  ```bash
  npx vitest run supabase/functions/liquidar-periodo/__tests__/auth.test.ts
  ```
- [ ] **Step 2 (implementación):** En `Deno.serve`, después del `OPTIONS` (línea 60-62) y **antes** de `const body = await req.json()` (línea 67), insertar el bloque de `fase5h-seguridad.md:59-82` (cliente anon + `auth.getUser()`). Luego, después de cargar `periodo` (línea 73) y antes de la línea 88, insertar el bloque de validación de empresa+rol (`fase5h-seguridad.md:86-104`).
  **Verificar antes:** el nombre real de la columna de usuario (`grep -n "usuario_id\|user_id" supabase/migrations/0014_flujos_aprobacion.sql supabase/migrations/0025_roles_nomina.sql`) y el criterio de superadmin (`sed -n '1,40p' supabase/migrations/0008_superadmin_bypass.sql`) — usar el criterio real, no `app_metadata.rol` si el repo usa otro.
- [ ] **Step 3 (mensajes genéricos):** Reemplazar `errPeriodo.message`/`errPeriodo.code` por mensajes genéricos **+ log server-side** en TODAS las ocurrencias:
  ```bash
  grep -n "errPeriodo.message\|errPeriodo.code" supabase/functions/liquidar-periodo/index.ts
  ```
  Ejemplo del reemplazo (conservando `console.error` para diagnóstico):
  ```ts
  if (errPeriodo) {
    console.error('liquidar-periodo: error al buscar el período', { periodoId, err: errPeriodo })
    return new Response(JSON.stringify({ error: 'no se pudo leer el período solicitado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  ```
- [ ] **Step 4:** `npx vitest run supabase/functions/liquidar-periodo/__tests__/auth.test.ts` verde + `npm test` completo.
- [ ] **Step 5:** Commit `fix(seguridad): liquidar-periodo valida JWT, empresa y rol del llamador`.
- [ ] **Step 6:** `supabase functions deploy liquidar-periodo`. El usuario prueba: período propio OK; `periodoId` de otra empresa → 403.

**Criterio de aceptación:** sin JWT → 401; empresa ajena o rol consulta → 403; admin/rrhh → opera.

### Task 1.2: Migración `0026_rls_roles.sql` — RLS por rol [⚙️ alto]

**Files:** Create `supabase/migrations/0026_rls_roles.sql` · Reference `fase5h-seguridad.md` Task 2 (matriz `:133-162`).

- [ ] **Step 1:** `grep -rn "FOR ALL" supabase/migrations/*.sql` → inventario de policies a dropear por nombre (anotarlo, va al commit message).
- [ ] **Step 2:** Escribir la migración con el patrón por tabla de `fase5h-seguridad.md:142-162` (DROP + SELECT amplio + INSERT/UPDATE/DELETE gated con `has_rol_nomina(...)`). Mapear según la matriz:
  - `nom_legajo`, `nom_familiares`, `nom_sanciones_personal`, `nom_legajo_adicionales` → SELECT `['admin','rrhh','consulta','supervisor']`, escritura `['admin','rrhh']`;
  - `nom_convenios`, `nom_categorias`, `nom_conceptos`, `nom_parametros`, `nom_no_remunerativos` → SELECT todos los roles internos, escritura `['admin','rrhh']`;
  - `nom_periodos`, `nom_liquidaciones`, `nom_liquidacion_items` → SELECT `['admin','rrhh','consulta','supervisor']`, escritura `['admin','rrhh']`;
  - `nom_flujos`, `nom_flujo_pasos` → SELECT `['admin','rrhh']`, escritura `['admin']`;
  - `nom_usuarios_empresas` → SELECT `['admin']`, escritura solo vía RPC/edge (INSERT con `WITH CHECK (is_superadmin() OR ...)` o sin policy de escritura);
  - `nom_aprobaciones` → SELECT participantes del flujo, escritura solo vía RPC `avanzar_flujo`.
  **Convenios globales solo lectura** (los de `empresa_id IS NULL`): SELECT para todos, escritura solo `is_superadmin()`.
- [ ] **Step 3:** NO romper el bypass: verificar que `0008_superadmin_bypass.sql` sigue aplicando (las policies de superadmin son separadas y se combinan con OR). Si alguna tabla nueva no tiene policy de superadmin, agregarla acá.
- [ ] **Step 4 (red de seguridad):** al final, el bloque idempotente de `fase5h-seguridad.md:168-179` (owner → admin si no hay ningún admin). **Verificar antes** que `empresas` tenga `owner_id` (`grep -rn "owner_id\|CREATE TABLE.*empresas" supabase/migrations/*.sql`); si no existe, **preguntar al usuario** a quién darle admin.
- [ ] **Step 5:** Además corregir los dos agujeros menores (master hallazgo 5): a `nom_no_remunerativos` agregarle `is_superadmin()` a su policy (`0012:15-25`); a `quincena_pareja` `REVOKE ALL ON FUNCTION ... FROM public; GRANT EXECUTE ... TO authenticated;` (`0017:28`).
- [ ] **Step 6:** `npm test` + aplicar en dev (el usuario). Commit `feat(db): migracion 0026 RLS por rol — cierra la deuda de la Fase 5G`. Incluir al pie el SQL de rollback en un comentario.

**Criterio de aceptación:** `consulta` lee pero no escribe; `admin` escribe; superadmin bypassa; owner sin vínculos queda `admin`.

### Task 1.3: Storage `nom-documentos` aislado por empresa [⚙️ bajo]

**Files:** Create `supabase/migrations/0043_storage_ruta_empresa.sql`.

- [ ] **Step 1:** Migración:
  ```sql
  -- 0043_storage_ruta_empresa.sql — aisla nom-documentos por carpeta de empresa
  DROP POLICY IF EXISTS nom_documentos_storage_rw ON storage.objects;
  CREATE POLICY nom_documentos_storage_rw ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'nom-documentos'
           AND storage.foldername(name)[1] = (SELECT auth_empresa_id())::text)
    WITH CHECK (bucket_id = 'nom-documentos'
           AND storage.foldername(name)[1] = (SELECT auth_empresa_id())::text);
  ```
  **Nota:** si `auth_empresa_id()` no está en el `search_path` de `storage`, crear helper `SECURITY STABLE`:
  ```sql
  CREATE OR REPLACE FUNCTION public.auth_empresa_id_storage() RETURNS UUID
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  'SELECT public.auth_empresa_id()';
  GRANT EXECUTE ON FUNCTION public.auth_empresa_id_storage() TO authenticated;
  -- y usar (SELECT public.auth_empresa_id_storage())::text en la policy
  ```
- [ ] **Step 2:** Aplicar y probar: usuario de empresa A obtiene `createSignedUrl` de un archivo bajo `B/...` → debe fallar. (`src/store/documentosStore.js:130` ya usa `createSignedUrl`, así que la ruta de prueba real es esa.)
- [ ] **Step 3:** Commit `fix(seguridad): storage nom-documentos aislado por carpeta de empresa`.

**Criterio de aceptación:** upload/get/delete solo sobre la carpeta de la propia empresa.

### Task 1.4: Arreglar `invitar-usuario` [⚙️ medio]

**Files:** Modify `supabase/functions/invitar-usuario/index.ts`.

- [ ] **Step 1:** El bug (403 siempre): la línea 36 llama `supabase.rpc('has_rol_nomina')` con el cliente **service-role** → `auth.uid()` es NULL. Fix: crear cliente **anon** con el `Authorization` del llamante (patrón de `liquidar-periodo`, Task 1.1) y validar con ESE. El cliente service-role queda solo para Auth Admin (`listUsers`/`inviteUserByEmail`) y el upsert final.
- [ ] **Step 2:** Validar `email` con regex simple (`/^[^@\s]+@[^@\s]+\.[^@\s]+$/`) y `rol` contra `['admin','rrhh','consulta','supervisor','revisor_interno','revisor_externo','aprobador_pagos']`. 400 si no.
- [ ] **Step 3:** Test de la función (mock de `createClient`): admin de la empresa E invita → llama `inviteUserByEmail` y hace upsert; usuario sin rol admin → 403. `npx vitest run supabase/functions/invitar-usuario/__tests__/`. Commit `fix(seguridad): invitar-usuario valida con el JWT del llamante y no con service_role`.

**Criterio de aceptación:** el admin invita por email; roles no-admin reciben 403.

### Task 1.5: Suite RLS ejecutable + CI [⚙️ medio]

**Files:** Modify `tests/rls/nomina_core.rls.test.js`, `tests/rls/legajo.rls.test.js` · Create `tests/rls/roles.rls.test.js`, `tests/rls/README.md`, `tests/rls/setup.md`.

- [ ] **Step 1:** Quitar `describe.skipIf`. Usar env vars `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON`, `RLS_TEST_USER_A_EMAIL/PASSWORD`, `RLS_TEST_USER_B_EMAIL/PASSWORD` (van en `.env.local`, nunca commiteadas).
- [ ] **Step 2:** Documentar en `README.md` (advertencia arriba: los tests corren contra la misma base de dev; crear datos con prefijo `ZZ-TEST-*`, limpiar en `afterAll`, nunca borrar lo que no crearon). `setup.md` = pasos SQL para dar de alta los 2 usuarios de prueba en Auth + roles en `nom_usuarios_empresas`.
- [ ] **Step 3:** Casos mínimos (cada uno un `it`): A no lee legajos/liquidaciones/documentos de B; `consulta` no escribe en ninguna tabla; `revisor_externo` solo ve períodos de su paso; `supervisor` de sitio X no ve sitio Y; `anon` no lee `nom_*`. Storage: A no firma URL de B (si el storage está conectado; si no, dejar el caso `skip` con comentario).
- [ ] **Step 4:** `npx vitest run tests/rls` → **se espera que falle** si 0026 no está aplicada. Aplicar 0026 → todos verdes. Commit `test(rls): suite de aislamiento entre empresas y por rol, ejecutable`.
- [ ] **Step 5:** Job `rls` en CI (se hace en Task 7.1).

**Criterio de aceptación:** la suite corre (no skipped) y verifica aislamiento A/B.

### Task 1.6: Endurecimiento [⚙️ bajo]

**Files:** Modify `vercel.json` · Create `supabase/migrations/0044_accesos_log.sql`.

- [ ] **Step 1:** Leer `vercel.json` entero (tiene rewrites de SPA, no sobrescribir). Agregar la clave `headers` de `fase5h-seguridad.md:283-295` (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).
- [ ] **Step 2:** Auditoría como `0044` (la numeración original `0031` ya está ocupada por el seed de conceptos). Copiar el SQL de `fase5h-seguridad.md:230-260` renombrando el archivo a `0044_accesos_log.sql`. Test `src/utils/__tests__/auditoria.test.js` (`fase5h-seguridad.md:262`): `registrarAcceso` llama a `supabase.rpc('registrar_acceso', {...})` con parámetros correctos y el `detalle` **nunca incluye montos ni CUIL**.
- [ ] **Step 3:** Conectar fire-and-forget (`.catch(() => {})`) en: emisión/descarga de recibo PDF (`LiquidacionPage.jsx`), exports CSV (`LiquidacionPage.jsx`, `ReportesPage.jsx`), apertura de detalle de liquidación. Restringir exports con `puede(rolesNomina, 'exportar')`.
- [ ] **Step 4:** Commit `feat(seguridad): log de accesos a recibos y exports + gating por rol`.

**Criterio de aceptación:** headers presentes; cada acceso a recibo/legajo logueado.

---

## Fase 2 — Correctitud del motor (bloqueante de negocio) [⚙️ alto]

> **Orden:** Task 2.11 (base sobre remunerativo total, bug del usuario) primero, después 2.1 y 2.2 (SAC/vacaciones), el resto en el orden listado. Cada fix con test primero. **Todos los tests del motor van junto al archivo** (p.ej. `packages/motor/src/motor.test.ts`, `uocra.test.ts`, `especiales.test.ts`, `asistencia.test.ts`) y corren con `npx vitest run packages/motor/src/<archivo>.test.ts`.

### Task 2.11: Descuentos y contribuciones sobre el remunerativo TOTAL del período [⚙️ medio-alto]

**Files:** Modify `packages/motor/src/motor.ts` (`liquidarConceptos`).

> **Bug:** un concepto nuevo con `config.base='remunerativo'` insertado con `orden=max+1` (`TabAdicionales.jsx:25`, p.ej. 206, después de descuentos 100-103 y contribuciones 200-205) NO entra en `remunerativo_acumulado` cuando evalúan jubilación/obra social/contribuciones. Es un problema de ORDEN de evaluación.

- [ ] **Step 1 (test que falla):** Agregar a `packages/motor/src/motor.test.ts`:
  ```ts
  describe('base de cálculo sobre el remunerativo TOTAL (Task 2.11)', () => {
    it('un adicional con orden posterior a los descuentos entra igual en la base de jubilación', () => {
      const conceptos: Concepto[] = [
        { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', orden: 10, formula: '1000000', imprimible: true },
        { codigo: 'jubilacion', nombre: 'Jubilación', tipo: 'descuento', orden: 100,
          formula: 'min(remunerativo_acumulado, tope_sipa) * 0.11', imprimible: true },
        { codigo: 'adicional', nombre: 'Adicional nuevo', tipo: 'remunerativo', orden: 206, formula: '50000', imprimible: true },
      ]
      const r = liquidarConceptos(conceptos, { tope_sipa: 999999999 })
      const jub = r.items.find((i) => i.codigo === 'jubilacion')!
      expect(jub.monto).toBeCloseTo(1050000 * 0.11, 2) // hoy: 110000 (solo básico)
    })

    it('la base de las contribuciones patronales también usa el total', () => {
      const conceptos: Concepto[] = [
        { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', orden: 10, formula: '1000000', imprimible: true },
        { codigo: 'adicional', nombre: 'Adicional', tipo: 'remunerativo', orden: 206, formula: '50000', imprimible: true },
        { codigo: 'c_sipa', nombre: 'SIPA', tipo: 'aporte_patronal', orden: 200,
          formula: 'remunerativo_acumulado * 0.1077', imprimible: true },
      ]
      const r = liquidarConceptos(conceptos, {})
      expect(r.items.find((i) => i.codigo === 'c_sipa')!.monto).toBeCloseTo(1050000 * 0.1077, 2)
    })
  })
  ```
  `npx vitest run packages/motor/src/motor.test.ts` → FAIL (da 110000/107700).
- [ ] **Step 2 (implementación):** Reescribir `liquidarConceptos` (`motor.ts:84-199`) en **dos pasadas** conservando la salida en orden de `orden` (el recibo no cambia de layout):

  ```ts
  export function liquidarConceptos(
    conceptos: Concepto[],
    variablesBase: Record<string, number>
  ): ResultadoLiquidacion {
    const ordenados = [...conceptos].sort((a, b) => a.orden - b.orden)

    // ── Pasada 1: totales del período (Task 2.11, bug reportado por el
    // usuario). El motor exponía `remunerativo_acumulado` como el acumulado
    // PARCIAL hasta cada concepto, así que un adicional creado desde la UI
    // con orden max+1 (TabAdicionales.jsx:25) quedaba DESPUÉS de
    // jubilación/OS/contribuciones y no entraba en su base. Acá se evalúan
    // primero TODOS los remunerativos/no remunerativos (en orden, para
    // respetar encadenamientos tipo presentismo % del acumulado) y se deja
    // el total del período listo para la pasada 2.
    let remunerativoTotal = 0
    let noRemunerativoTotal = 0
    for (const c of ordenados) {
      if (c.tipo !== 'remunerativo' && c.tipo !== 'no_remunerativo') continue
      const vars0: Record<string, number> = {
        ...variablesBase,
        remunerativo_acumulado: remunerativoTotal,
        no_remunerativo_acumulado: noRemunerativoTotal,
      }
      let formula = c.formula
      if (c.reglas && c.reglas.length > 0) {
        const reglasOrdenadas = [...c.reglas].sort((a, b) => a.orden - b.orden)
        for (const regla of reglasOrdenadas) {
          if (evaluar(regla.condicion, vars0) === true) { formula = regla.formula; break }
        }
      }
      const monto = redondearCentavos(evaluar(formula, vars0) as number)
      if (c.tipo === 'remunerativo') remunerativoTotal += monto
      else noRemunerativoTotal += monto
    }

    const items: ItemLiquidado[] = []
    let remunerativoAcumulado = 0
    let noRemunerativoAcumulado = 0
    let bruto = 0
    let totalDescuentos = 0

    for (const concepto of ordenados) {
      // Descuentos y aportes patronales calculan sobre el TOTAL del período;
      // el resto ve el acumulado parcial (comportamiento histórico).
      const esDescuentoOAporte = concepto.tipo === 'descuento' || concepto.tipo === 'aporte_patronal'
      const vars: Record<string, number> = {
        ...variablesBase,
        remunerativo_acumulado: esDescuentoOAporte ? remunerativoTotal : remunerativoAcumulado,
        no_remunerativo_acumulado: esDescuentoOAporte ? noRemunerativoTotal : noRemunerativoAcumulado,
        remunerativo_total: remunerativoTotal,
        no_remunerativo_total: noRemunerativoTotal,
      }

      let formula = concepto.formula
      let reglaAplicada: number | 'base' = 'base'

      if (concepto.reglas && concepto.reglas.length > 0) {
        const reglasOrdenadas = [...concepto.reglas].sort((a, b) => a.orden - b.orden)
        for (let i = 0; i < reglasOrdenadas.length; i++) {
          const regla = reglasOrdenadas[i]
          if (evaluar(regla.condicion, vars) === true) {
            formula = regla.formula
            reglaAplicada = i
            break
          }
        }
      }

      const monto = redondearCentavos(evaluar(formula, vars) as number)

      const cfg = concepto.config ?? undefined
      const recibo = cfg?.recibo ?? undefined
      let unidadTexto: string | null = null
      let baseCalculo: number | null = null

      if (recibo?.baseFormula) {
        baseCalculo = evaluar(recibo.baseFormula, vars) as number
      } else if (cfg?.modo === 'porcentaje') {
        const baseExpr = BASES_EXPR[cfg.base ?? 'remunerativo'] ?? 'remunerativo_acumulado'
        const conTope = cfg.tope ? `min(${baseExpr}, ${cfg.tope})` : baseExpr
        baseCalculo = evaluar(conTope, vars) as number
      } else if (cfg?.modo === 'nominal') {
        baseCalculo = typeof cfg.monto === 'number' ? cfg.monto : monto
      }

      if (recibo?.unidadFormula) {
        unidadTexto = formatCantidad(evaluar(recibo.unidadFormula, vars) as number)
      } else if (cfg?.modo === 'porcentaje' && typeof cfg.porcentaje === 'number') {
        unidadTexto = formatPorcentaje(cfg.porcentaje)
      } else if (cfg?.modo === 'nominal') {
        unidadTexto = '1'
      }

      let grupoRecibo = recibo?.grupo ?? null
      if (
        grupoRecibo != null &&
        (concepto.tipo === 'remunerativo' || concepto.tipo === 'no_remunerativo' || concepto.tipo === 'descuento')
      ) {
        grupoRecibo = concepto.tipo
      }

      items.push({
        codigo: concepto.codigo,
        nombre: concepto.nombre,
        tipo: concepto.tipo,
        monto,
        reglaAplicada,
        unidadTexto,
        baseCalculo,
        grupoRecibo,
        detalleRecibo: recibo?.detalle ?? null,
      })

      switch (concepto.tipo) {
        case 'remunerativo':
          remunerativoAcumulado += monto
          bruto += monto
          break
        case 'no_remunerativo':
          noRemunerativoAcumulado += monto
          bruto += monto
          break
        case 'descuento':
          totalDescuentos += monto
          break
        case 'aporte_patronal':
        case 'informativo':
          break
      }
    }

    return {
      items,
      remunerativoAcumulado,
      bruto,
      totalDescuentos,
      neto: bruto - totalDescuentos,
    }
  }
  ```
  Y agregar el helper (además de `formatPorcentaje`/`formatCantidad`):
  ```ts
  // Task 2.4: redondeo a centavos de cada monto de concepto ANTES de
  // acumular. 250519.17329999997 → 250519.17. El EPSILON evita el caso
  // 1.005 → 1.00 (ver interprete.ts, Task 2.10).
  function redondearCentavos(x: number): number {
    return Math.round((x + Number.EPSILON) * 100) / 100
  }
  ```
- [ ] **Step 3:** `npx vitest run packages/motor/src/motor.test.ts` → PASS (incluye los nuevos). **Chequear que no se rompieron** los de `no_remunerativo_acumulado`, `contribucion sobre base ambos` y `unidad y base en ítems`.
- [ ] **Step 4 (regresión):** agregar el test con dos adicionales + HE + presentismo + jubilación/OS (base = suma de todos los remunerativos). El golden UOCRA (Task 2.8) cubre el caso end-to-end.
- [ ] **Step 5:** `npm test` completo → verdes. Commit `fix(motor): descuentos y contribuciones sobre remunerativo total del periodo`.

**Criterio de aceptación:** agregar cualquier adicional remunerativo desde la UI lo suma a la base de jubilación/OS/contribuciones, sin reordenar conceptos.

### Task 2.1: SAC UOCRA = 50% de la mejor remuneración MENSUAL [⚙️ medio]

**Files:** Modify `supabase/functions/liquidar-periodo/index.ts` (función `brutosDelSemestre`, línea 915) · Reference `packages/motor/src/uocra.ts:23-27`.

> **Bug (C1):** `brutosDelSemestre` devuelve **un bruto por liquidación** (cada quincena ≈ M/2). `Math.max(...brutos)` → mejor quincena; `calcularSACProporcionalUocra` divide por 2 → 25% del mes. Fix: consolidar las quincenas **por mes** y pasar el máximo mensual.

- [ ] **Step 1 (test que falla, a nivel motor):** en `packages/motor/src/uocra.test.ts` documentar el contrato nuevo:
  ```ts
  it('calcularSAC recibe bruto MENSUAL: la mejor quincena ya fue consolidada por el llamador', () => {
    // Se pasa el máximo mensual (750000), no cada quincena (375000).
    expect(calcularSACProporcional(750000, 182)).toBeCloseTo(375000, 2)
  })
  ```
  Este test ya pasa: el bug vive en el llamador. El **test que debe fallar** es el de integración → usar el fixture del golden (Task 2.8) con dos quincenas por mes.
- [ ] **Step 2 (implementación):** reemplazar `brutosDelSemestre` por una versión que agrupe por mes. La liquidación trae `periodo_id`; el mes sale del período:
  ```ts
  async function brutosMensualesDelSemestre(personalId: string, idsPeriodos: string[]): Promise<number[]> {
    if (idsPeriodos.length === 0) return []
    const { data: liqs } = await supabase.from('nom_liquidaciones').select('bruto, periodo_id')
      .eq('personal_id', personalId).in('periodo_id', idsPeriodos)
    const idsUnicos = [...new Set((liqs || []).map((l: any) => l.periodo_id))]
    const { data: periodos } = idsUnicos.length
      ? await supabase.from('nom_periodos').select('id, fecha_desde').in('id', idsUnicos)
      : { data: [] }
    const mesDeId = new Map((periodos || []).map((p: any) => [p.id, String(p.fecha_desde).slice(0, 7)]))
    const porMes = new Map<string, number>()
    for (const l of liqs || []) {
      const mes = mesDeId.get(l.periodo_id)
      if (!mes) continue
      porMes.set(mes, (porMes.get(mes) ?? 0) + Number(l.bruto))
    }
    return [...porMes.values()]
  }
  ```
  Reemplazar los dos usos (línea 980-986 SAC y línea 1038-1039 liquidación final) `brutosDelSemestre(...)` → `brutosMensualesDelSemestre(...)`. El resto de la lógica (`Math.max(...brutos)`, `calcularSACProporcionalUocra`) no cambia.
- [ ] **Step 3:** Fixture de integración en `liquidar-periodo` (o en el golden UOCRA de Task 2.8): 6 meses quincenales, mejor mes $1.500.000 → SAC UOCRA = $750.000 (no $375.000). Si el test de integración exige levantar la Edge Function, validar contra el cálculo manual en Task 2.9.
- [ ] **Step 4:** Commit `fix(motor): SAC UOCRA sobre mejor remuneracion mensual`.

**Criterio de aceptación:** SAC de un jornalizado quincenal = 50% de la mejor mes del semestre.

### Task 2.2: Vacaciones no gozadas proporcionales (art. 152 LCT) [⚙️ medio]

**Files:** Modify `packages/motor/src/especiales.ts:59-67` · Modify `supabase/functions/liquidar-periodo/index.ts:1059`.

- [ ] **Step 1 (test que falla):** en `especiales.test.ts`:
  ```ts
  it('no gozadas con 2 años y 74 días trabajados en el año: proporcional 21 × 74/365', () => {
    const r = calcularVacaciones({ antiguedadAnios: 2, diasTrabajadosAnio: 74, modalidad: 'mensual', sueldoMensual: 1500000 })
    expect(r.dias).toBeCloseTo(21 * 74 / 365, 2) // ≈ 4.26
    expect(r.total).toBeCloseTo(r.dias * (1500000 / 25), 2)
  })
  ```
  FAIL hoy (devuelve 21 días completos).
- [ ] **Step 2 (implementación):** en `especiales.ts:62-64`:
  ```ts
  const dias = input.antiguedadAnios < 0.5
    ? Math.floor(input.diasTrabajadosAnio / 20)                       // art. 153 (sin cambio)
    : diasVacacionesPorAntiguedad(input.antiguedadAnios) * (input.diasTrabajadosAnio / 365)
  ```
- [ ] **Step 3 (régimen UOCRA):** `index.ts:1059` llama `diasVacacionesPorAntiguedadUocra(antiguedadAnios)` sin proporcional. Cambiar:
  ```ts
  const diasVacNoGozados = diasVacacionesPorAntiguedadUocra(antiguedadAnios) * (diasTrabajadosAnioFinal / 365)
  ```
- [ ] **Step 4:** `npx vitest run packages/motor/src/especiales.test.ts` → PASS. `npm test` completo. Commit `fix(motor): vacaciones no gozadas proporcionales por dias trabajados del año`.

**Criterio de aceptación:** la liquidación final prorratea vacaciones no gozadas por días trabajados en el año.

### Task 2.3: Tope SIPA mensual en quincenales (activar consolidación) [⚙️ medio-alto]

**Files:** Create `supabase/migrations/0048_tope_sipa_mensual.sql` · Modify `supabase/functions/liquidar-periodo/index.ts` (solo si hace falta) · Tests.

> **Bug (C3):** `min(remunerativo_acumulado, tope_sipa)` por quincena → cada quincena queda bajo el tope y la retención se duplica. El mecanismo `acumulado_mensual` ya existe (`motor.ts:56`, `index.ts:246-248` y ajuste `:591-603`) pero ninguna migración lo activa.

- [ ] **Step 1 (migración):**
  ```sql
  -- 0048_tope_sipa_mensual.sql — activa la consolidación mensual del tope
  -- SIPA en quincenales. Q1 calcula sobre el mes parcial; Q2 calcula sobre
  -- el mes completo (remunerativo_acumulado + remunerativo_quincena1) y el
  -- ajuste de liquidar-periodo (codigosConsolidadosPorAcumuladoMensual)
  -- resta lo ya retenido en Q1 para ese mismo concepto. La clave que
  -- activa el mecanismo es config.base = 'acumulado_mensual'
  -- (index.ts:246-248). Idempotente: UPDATE repetido con el mismo valor.
  UPDATE nom_conceptos SET
    formula = 'min(remunerativo_acumulado + remunerativo_quincena1, tope_sipa) * 0.11',
    config  = '{"modo":"porcentaje","porcentaje":11,"base":"acumulado_mensual","tope":"tope_sipa","recibo":{"grupo":"descuento","detalle":"seguridad_social"}}'::jsonb
  WHERE codigo = 'jubilacion';

  UPDATE nom_conceptos SET
    formula = 'min(remunerativo_acumulado + remunerativo_quincena1, tope_sipa) * 0.03',
    config  = '{"modo":"porcentaje","porcentaje":3,"base":"acumulado_mensual","tope":"tope_sipa","recibo":{"grupo":"descuento","detalle":"inssjp"}}'::jsonb
  WHERE codigo = 'ley_19032';
  ```
  **Nota:** en Q1, `remunerativo_quincena1` = 0 (no hay Q1 previa) → la fórmula queda igual que hoy. En Q2 suma la Q1 y el ajuste `:591-603` resta lo ya retenido.
- [ ] **Step 2 (test motor, regla de ajuste):** en `motor.test.ts` verificar que `BASES_EXPR['acumulado_mensual']` expone la suma:
  ```ts
  it('base acumulado_mensual = remunerativo_acumulado + remunerativo_quincena1', () => {
    const j: Concepto = { codigo: 'jubilacion', nombre: 'J', tipo: 'descuento', orden: 5,
      formula: 'min(remunerativo_acumulado + remunerativo_quincena1, tope_sipa) * 0.11', imprimible: true }
    const b: Concepto = { codigo: 'basico', nombre: 'B', tipo: 'remunerativo', orden: 1, formula: '600000', imprimible: true }
    const r = liquidarConceptos([b, j], { tope_sipa: 800000, remunerativo_quincena1: 600000 })
    expect(r.items.find((i) => i.codigo === 'jubilacion')!.monto).toBeCloseTo(800000 * 0.11, 2)
  })
  ```
- [ ] **Step 3:** Verificación end-to-end (Task 2.9/gate contador): bruto mensual $3.000.000 con tope → retención mensual total = `min(3.000.000; tope) × 11%` repartida Q1+Q2. Commit `feat(db): tope SIPA consolidado por mes en quincenales`.

**Criterio de aceptación:** la suma Q1+Q2 de cada descuento con tope no supera el tope mensual.

### Task 2.4: Redondeo a centavos en producción + golden alineados [⚙️ medio]

**Files:** Modify `packages/motor/src/motor.ts` (ya incluido en Task 2.11) · Modify `packages/motor/golden/conceptos-fuera-convenio.ts` y `packages/motor/golden/golden.test.ts`.

- [ ] **Step 1:** El helper `redondearCentavos` y su uso por monto ya quedaron de Task 2.11. Verificar con el test:
  ```ts
  it('250519.17329999997 se guarda como 250519.17', () => {
    const r = liquidarConceptos([{ codigo: 'x', nombre: 'X', tipo: 'remunerativo', orden: 1,
      formula: '250519.17329999997', imprimible: true }], {})
    expect(r.items[0].monto).toBe(250519.17)
  })
  ```
- [ ] **Step 2 (alinear golden):** `conceptos-fuera-convenio.ts` usa fórmulas con `round(...)` manual (líneas 17-19) que NO son las de las seeds. Reemplazarlas por las **fórmulas seed reales** (`0031_seed_conceptos_base.sql:66-76`) sin `round()`: `min(remunerativo_acumulado, tope_sipa) * 0.11`, `remunerativo_acumulado * 0.03`, `(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03`. El redondeo ya lo hace el motor.
- [ ] **Step 3:** `npx vitest run packages/motor/golden/golden.test.ts` → PASS (los fixtures ya toleran 2 decimales). Si algún fixture real (01-03) se desvía > $1, revisar si era por el `round` manual de prueba.
- [ ] **Step 4:** Commit `fix(motor): redondeo a centavos en produccion y golden con formulas seed reales`.

**Criterio de aceptación:** la base guarda montos idénticos al recibo impreso (a centavos).

### Task 2.5: Feriados desde Presencio (NO tabla propia) [⚙️ medio]

**Files:** Create `supabase/migrations/0046_vista_feriados_presencio.sql` · Modify `packages/motor/src/asistencia.ts` · Modify `supabase/functions/liquidar-periodo/index.ts`.

> **Decisión del usuario:** Presencio ya cuenta los feriados en `empresas.config_json -> 'moduloHorasProyecto' -> 'feriados'` como `[{fecha:'yyyy-MM-dd', nombre}]`. Recursio los lee de ahí; no crea `nom_feriados`.

- [ ] **Step 1 (migración 0046):**
  ```sql
  -- 0046_vista_feriados_presencio.sql — expone los feriados que Presencio ya
  -- cuenta (empresas.config_json->'moduloHorasProyecto'->'feriados') sin
  -- tocar el esquema de `empresas` (contrato 0001_vistas_contrato.sql:
  -- Recursio NO escribe en tablas de Presencio, solo lee vistas).
  CREATE OR REPLACE VIEW nom_v_empresa_feriados
  WITH (security_invoker = true) AS
  SELECT id AS empresa_id,
         config_json -> 'moduloHorasProyecto' -> 'feriados' AS feriados
  FROM empresas;
  GRANT SELECT ON nom_v_empresa_feriados TO authenticated;
  GRANT SELECT ON nom_v_empresa_feriados TO service_role;
  ```
- [ ] **Step 2 (asistencia.ts):** agregar soporte de feriados a `construirDiasPeriodo` y a `calcularAsistencia`.
  1. `DiaAsistencia` gana `esFeriado?: boolean` y `ResultadoAsistencia` gana `horasFeriado: number`.
  2. `construirDiasPeriodo` opciones gana `feriados?: Set<string>`:
  ```ts
  const esFeriado = Boolean(opciones.feriados?.has(fecha))
  const laborable = dentroDeRelacionLaboral && dow >= 1 && dow <= 5 && !esFeriado
  dias.push({ fecha, horaEntradaEsperada: laborable ? '08:00' : null, horaEntradaReal: reg?.entrada ?? null,
    horasTrabajadas: Math.round(horas * 100) / 100, esDomingo: dow === 0, esFeriado,
    ausenciaAprobada: ausencias.some((a) => fecha >= a.fecha_desde && fecha <= a.fecha_hasta) })
  ```
  3. `calcularAsistencia`: si `dia.esFeriado` y hay horas trabajadas, esas horas van a `horasFeriado` (recargo) en vez de `horasExtra50`; y el feriado **no** genera falta injustificada (ya no es laborable). Orden en el loop: la rama de precalculadas primero, después `esFeriado` con horas → `resultado.horasFeriado += horas`, después domingo, después exceso de jornada.
- [ ] **Step 3 (index.ts):** tras cargar el período, leer los feriados (cliente service-role ya bypasea RLS):
  ```ts
  const { data: empFeriados, error: errFeriados } = await supabase.from('nom_v_empresa_feriados')
    .select('feriados').eq('empresa_id', periodo.empresa_id).maybeSingle()
  if (errFeriados) { /* cortar y reportar, patrón errLectura */ }
  const feriadosSet = new Set((empFeriados?.feriados || []).map((f: any) => f.fecha))
  ```
  Y pasar `{ ..., feriados: feriadosSet }` en la llamada a `construirDiasPeriodo` (línea 541-547).
- [ ] **Step 4 (tests, asistencia.test.ts):**
  ```ts
  it('feriado entre semana NO cuenta falta si no se trabajó', () => {
    const dias = construirDiasPeriodo([], [], '2026-05-25', '2026-05-25', { feriados: new Set(['2026-05-25']) })
    expect(dias[0].horaEntradaEsperada).toBeNull()
    const r = calcularAsistencia(dias, 15)
    expect(r.faltasInjustificadas).toBe(0)
  })
  it('feriado trabajado suma horasFeriado (recargo 100%) y no extra 50', () => {
    const dias = construirDiasPeriodo([{ tipo: 'entrada', timestamp: '2026-05-25T08:00:00+00:00' },
      { tipo: 'salida', timestamp: '2026-05-25T17:00:00+00:00' }], [], '2026-05-25', '2026-05-25',
      { feriados: new Set(['2026-05-25']) })
    const r = calcularAsistencia(dias, 15)
    expect(r.horasFeriado).toBe(9)
    expect(r.horasExtra50).toBe(0)
  })
  it('empresa sin feriados configurados: se comporta como hoy', () => {
    const dias = construirDiasPeriodo([], [], '2026-05-25', '2026-05-25')
    expect(dias[0].horaEntradaEsperada).toBe('08:00') // día normal
  })
  ```
- [ ] **Step 5:** Commit `fix(motor): feriados desde Presencio (config_json moduloHorasProyecto)`. El concepto `hs_feriado` (con recargo 100%) se siembra en Task 2.7/2.13.

**Criterio de aceptación:** los feriados vienen de `empresas.config_json` (sin tabla propia); no figuran como faltas y pagan recargo cuando corresponde.

### Task 2.6: Idempotencia de recibos emitidos + hash [⚙️ medio]

**Files:** Modify `supabase/functions/liquidar-periodo/index.ts:617-656` · Modify `src/utils/reciboHash.js`/flujo de emisión.

- [ ] **Step 1 (decisión con el usuario):** bloquear recálculo una vez emitido (recomendado) en vez de anular+v+1. Implementación en `index.ts`, tras cargar `periodo`:
  ```ts
  const { data: emitidos } = await supabase.from('nom_liquidaciones')
    .select('id').eq('periodo_id', periodoId).not('numero_recibo', 'is', null).limit(1)
  if ((emitidos || []).length > 0) {
    return new Response(JSON.stringify({
      error: 'el período ya tiene recibos emitidos: no se puede recalcular. Anulá los recibos o emití una rectificativa.',
    }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
  ```
- [ ] **Step 2 (hash):** el flujo actual calcula `calcularHashPdf(doc)` sobre el PDF **antes** de imprimir el número (`reciboPdf.js:180` dibuja `Recibo N°:` al final). Fix: en `LiquidacionPage.jsx`, pasar el número a `generarReciboPdf({ ..., codigoRecibo: numero })` y **recién después** calcular el hash del `doc` terminado. Cambiar la firma para que `generarReciboPdf` acepte `codigoRecibo` (ya lo acepta) y el hash se calcule post-draw:
  ```js
  const doc = await generarReciboPdf({ empresa, persona, periodo, items, codigoRecibo })
  const hash = await calcularHashPdf(doc)
  const { ok, numeroRecibo } = await emitirRecibo(liquidacionId, hash)
  ```
  (Verificar el orden real en `LiquidacionPage.jsx:244-249`; si el hash ya se calcula sobre el doc final, solo testear.)
- [ ] **Step 3 (tests):** `src/utils/__tests__/reciboHash.test.js`: dos generaciones del mismo recibo (mismo número) → mismo hash; recibo con número distinto → hash distinto. Usar jsPDF real (ya es dependencia) en jsdom. Commit `fix: bloquea recalculo de periodos emitidos y hashea el PDF final con numero`.

**Criterio de aceptación:** no existen dos montos distintos bajo un mismo `numero_recibo`; el hash autentica el recibo final.

### Task 2.7: Horas extra y presentismo UOCRA + hora de la zona horaria [⚙️ medio-alto]

**Files:** Modify `packages/motor/src/asistencia.ts:94-95` · Create `supabase/migrations/0049_conceptos_uocra.sql` · Modify `index.ts` (variables).

- [ ] **Step 1 (zona horaria — test que falla):** `asistencia.ts:94-95` extrae fecha/hora con `slice` del ISO crudo (UTC). Si el fichaje se guarda como `timestamptz` UTC, un fichaje real de 08:30 en Buenos Aires (11:30 UTC) aparece como 11:30 → tardanza espuria. Fix: convertir a `America/Argentina/Buenos_Aires`:
  ```ts
  const FMT_AR = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  function descomponerTimestamp(timestamp: string) {
    const parts = FMT_AR.formatToParts(new Date(timestamp)).reduce<Record<string, string>>(
      (acc, p) => (p.type !== 'literal' ? { ...acc, [p.type]: p.value } : acc), {})
    const hh = parts.hour === '24' ? '00' : parts.hour
    return { fecha: `${parts.year}-${parts.month}-${parts.day}`, hora: `${hh}:${parts.minute}` }
  }
  ```
  Y en `construirDiasPeriodo`: `const { fecha, hora } = descomponerTimestamp(f.timestamp)`.
  Test: fichaje `2026-06-15T11:30:00Z` → fecha `2026-06-15`, hora `08:30`.
- [ ] **Step 2 (seed 0049):**
  ```sql
  -- 0049_conceptos_uocra.sql — HE y presentismo UOCRA + recargo feriado.
  -- La jornada UOCRA es 9 h/día, 44 h/semana (e-sueldos); el divisor de la
  -- hora extra se valida con el contador (Task 2.9) — acá se usa /200 como
  -- el HE existente fuera de convenio. Idempotente (WHERE NOT EXISTS).
  INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, config)
  SELECT cv.empresa_id, cv.id, x.codigo, x.nombre, x.tipo, x.formula, x.orden, true, x.config::jsonb
  FROM nom_convenios cv
  JOIN nom_regiones r ON r.codigo = '76'   -- ⚠ ajustar al código real del convenio UOCRA
  CROSS JOIN (VALUES
    ('hs_feriado', 'Recargo feriado', 'remunerativo',
     '(basico_convenio / 200) * horas_feriado', 15,
     '{"modo":"porcentaje","porcentaje":100,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'),
    ('hora_extra_50', 'Hora extra 50%', 'remunerativo',
     '(basico_convenio / 200) * 1.5 * horas_extra_50', 16,
     '{"modo":"porcentaje","porcentaje":150,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'),
    ('hora_extra_100', 'Hora extra 100%', 'remunerativo',
     '(basico_convenio / 200) * 2 * horas_extra_100', 17,
     '{"modo":"porcentaje","porcentaje":200,"base":"basico","recibo":{"grupo":"remunerativo","detalle":null}}'),
    ('presentismo', 'Presentismo', 'remunerativo',
     'remunerativo_acumulado * 0.20', 18,
     '{"modo":"porcentaje","porcentaje":20,"base":"remunerativo","recibo":{"grupo":"remunerativo","detalle":null}}')
  ) AS x(codigo, nombre, tipo, formula, orden, config)
  WHERE NOT EXISTS (
    SELECT 1 FROM nom_conceptos c WHERE c.codigo = x.codigo AND c.convenio_id = cv.id
  );
  ```
  **Verificar antes:** nombre/estructura real del convenio UOCRA en `nom_convenios` (`select id, nombre, regimen from nom_convenios;`) y del `hs_feriado` seed existente en 0031 (`grep -n hs_feriado supabase/migrations/*.sql`) — el 0031 solo le asigna `codigo_recibo`, no lo crea. Ajustar el `JOIN nom_regiones` al criterio real del convenio (si el convenio UOCRA es global, `empresa_id IS NULL`; si no hay `nom_regiones`, insertar directo en los convenios con `regimen = '22250'`).
- [ ] **Step 3 (variables en index.ts):** `variablesBase` (línea 567-583) ya expone `horas_extra_50/100`; agregar `horas_feriado: asistencia.horasFeriado ?? 0`. **Jornada UOCRA 9 h:** sale de Task 2.12 (`jornada_horas` de la config), no del hardcode `parcial?4:8`.
- [ ] **Step 4 (tests):** 2 HE 50%, 1 HE 100%, presentismo con 1 y 2 tardanzas (patrón de `conceptos-fuera-convenio.ts`). Commit `feat(motor): horas extra, presentismo y recargo feriado UOCRA + zona horaria Argentina`.

**Criterio de aceptación:** el recibo UOCRA incluye HE y presentismo correctos; tardanzas sin desvío de 3h por zona.

### Task 2.8: Golden tests UOCRA + casos reales [⚙️ medio]

**Files:** Create `packages/motor/golden/fixtures/` (UOCRA) · Modify `golden.test.ts`.

- [ ] **Step 1:** Crear fixtures JSON siguiendo el esquema de `10-tope-sipa-sintetico.json` (campos: `descripcion`, `esReal`, `variablesBase`, `resultadoEsperado: { items: [{codigo, montoEsperado}], neto }`). Casos: básico por jornada 9h, HE 50/100, presentismo, SAC mensual, tope SIPA consolidado, liquidación final con vacaciones proporcionales. Los montos salen de **cálculo manual** (hoja de cálculo), no del motor.
- [ ] **Step 2:** Modificar `golden.test.ts` para que los fixtures UOCRA usen conceptos UOCRA (extender `conceptos-fuera-convenio.ts` con el set UOCRA o agregar un set nuevo). Mantener el caso de los 3 reales con `CONCEPTOS_SOLO_BASICO_Y_DEDUCCIONES`.
- [ ] **Step 3:** `npx vitest run packages/motor/golden/golden.test.ts` → PASS con tolerancia ≤ $1. Commit `test(motor): golden UOCRA (jornada, HE, presentismo, SAC, tope, final)`.

**Criterio de aceptación:** los casos UOCRA cierran dentro de $1 contra cálculo manual.

### Task 2.9: Gate externo — validación con contador laboralista [⚙️ medio, no código]

- [ ] **Step 1:** Conseguir 5–10 recibos UOCRA reales (Asset/piloto) → fixtures.
- [ ] **Step 2:** Emitir un recibo con la app; el contador lo valida contra su cálculo manual. Documentar en `docs/VALIDACION-CONTADOR.md`.
- [ ] **Step 3:** Corregir divergencias (volver a tasks 2.1–2.8 si aplica). **Este es el gate real antes de liquidar sueldos de verdad.**

### Task 2.10: Fixes menores del motor [⚙️ bajo]

- [ ] **Step 1:** `interprete.ts:368` `round` → `Math.round((x + Number.EPSILON) * 100) / 100`. Test: `evaluar('round(1.005)') === 1.01` (`interprete.test.ts`).
- [ ] **Step 2:** `tope_sipa` con `valor` vacío → `Number('') === 0` topea todo en $0 (`index.ts:267,807`). Fix:
  ```ts
  const topeSipa = topeRows?.[0]?.valor != null && String(topeRows[0].valor).trim() !== ''
    ? Number(topeRows[0].valor)
    : 999999999
  ```
- [ ] **Step 3:** Vacaciones gozadas de jornalizados con remuneración normal y habitual (`especiales.ts:53-57`): `valorDiaVacaciones` para `hora` usa `valorHora * 8`; para jornal UOCRA (9 h) ajustar el multiplicador según el divisor que decida el contador (Task 2.9). Documentar la decisión en un comentario.
- [ ] **Step 4:** Días trabajados del mes de baja = días calendario − ausencias injustificadas del tramo (`index.ts:1043-1046`): hoy es solo el día de fecha_baja. Reemplazar por la resta (reusar las ausencias ya cargadas del período).
- [ ] **Step 5:** Tests + commit `fix(motor): ajustes menores de redondeo, tope SIPA vacio, vacaciones gozadas y dias de baja`.

### Task 2.12: Config de horas extras y tope por empresa [⚙️ medio]

**Files:** Create `supabase/migrations/0047_config_horas_extras.sql` · Modify `index.ts:548` y `:264-273` · Modify `packages/motor/src/asistencia.ts:26-30` · UI `src/components/config/TabEmpresa.jsx`.

- [ ] **Step 1 (migración 0047):**
  ```sql
  -- 0047_config_horas_extras.sql — configuración de horas extras por empresa
  -- (hallazgo 24): si contabiliza HE o no, topes, y jornada por convenio.
  CREATE TABLE IF NOT EXISTS nom_config_horas (
    empresa_id                  UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
    contabilizar_horas_extras   BOOLEAN NOT NULL DEFAULT true,
    tope_horas_diarias          NUMERIC,
    tope_horas_semanales        NUMERIC,
    tope_horas_quincena         NUMERIC,
    tope_horas_mes              NUMERIC,
    jornada_horas               NUMERIC NOT NULL DEFAULT 8,
    updated_at                  TIMESTAMPTZ DEFAULT now()
  );
  ALTER TABLE nom_config_horas ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS nom_config_horas_rw ON nom_config_horas;
  CREATE POLICY nom_config_horas_rw ON nom_config_horas FOR ALL TO authenticated
    USING (is_superadmin() OR empresa_id = auth_empresa_id())
    WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
  GRANT SELECT, INSERT, UPDATE, DELETE ON nom_config_horas TO authenticated;
  ```
- [ ] **Step 2 (asistencia.ts):** `calcularAsistencia` gana opciones de tope:
  ```ts
  export interface OpcionesAsistencia {
    contabilizarHorasExtras?: boolean
    topeHorasDiarias?: number
    topeHorasQuincena?: number
    topeHorasMes?: number
  }
  ```
  Dentro del loop, si `horas > jornadaHoras`:
  - si `contabilizarHorasExtras === false` → no se paga extra (las horas de exceso quedan como horas normales hasta el tope, sin recargo);
  - si `topeHorasDiarias` y `horas > topeHorasDiarias` → el excedente sobre el tope no se cuenta como extra.
  `jornadaHoras` pasa a salir de la config (UOCRA 9).
- [ ] **Step 3 (index.ts):** cargar la config:
  ```ts
  const { data: cfgHoras } = await supabase.from('nom_config_horas')
    .select('*').eq('empresa_id', periodo.empresa_id).maybeSingle()
  ```
  Usar `cfgHoras?.jornada_horas ?? (legajo.jornada === 'parcial' ? 4 : 8)` en la llamada (línea 548) y pasar `contabilizarHorasExtras`/topes a `calcularAsistencia`. Si `contabilizar_horas_extras = false` y hay exceso → push a `advertencias` con `{ personal_id, mensaje: 'la persona supera las horas topadas: se paga sin recargo' }`.
- [ ] **Step 4 (tests):** en `asistencia.test.ts`: con extras `true` → HE 50/100 se pagan; con `false` y exceso → horas topeadas sin recargo; tope diario 12 h; jornada UOCRA 9 h (9h trabajadas → 0 extra).
- [ ] **Step 5 (UI):** toggle + campos en `TabEmpresa.jsx`. Commit `feat: config de horas extras y topes por empresa`.

**Criterio de aceptación:** la empresa elige si paga horas extra y con qué tope, sin cambiar código; el aviso de exceso aparece antes de liquidar.

### Task 2.13: Adicionales UOCRA del artículo e-sueldos [⚙️ medio]

**Files:** Seed de conceptos/adicionales UOCRA (extender `0049`) · Validar contra `docs/fixtures/` · Tests.

- [ ] **Step 1:** Modelar como conceptos seed en `0049` los fijos: `zona_desfavorable` (% del básico, por escala geográfica), `trabajo_insalubre` (6 h pagadas como 8 h: `(basico_convenio / 200) * 2 * horas_insalubres` con `horas_insalubres` calculada en el motor solo si el legajo lo declara), `tarea_especifica` (10-25% del básico). Los de asignación por persona (asistencia perfecta, título habilitante, traslado, vestimenta) se soportan con `nom_legajo_adicionales` (0040) + `base:'basico'` — **validar con un ejemplo** en el test de `motor.test.ts` (patrón "override de adicional por legajo").
- [ ] **Step 2:** Asistencia perfecta 20%: decidir con el contador (Task 2.9) si entra como regla del concepto `presentismo` (0/50/100, patrón existente) o como adicional por legajo. No inventar: dejarlo documentado en `docs/VALIDACION-CONTADOR.md`.
- [ ] **Step 3:** Tests por concepto (cada uno un caso manual que cierre a centavos). Commit `feat(motor): adicionales UOCRA del articulo e-sueldos`.

**Criterio de aceptación:** los adicionales UOCRA del artículo están modelados y validados; un jornal con zona desfavorable e insalubridad cierra contra cálculo manual.

---

## Fase 3 — Robustez del frontend (bloqueante de integridad) [⚙️ medio-alto]

### Task 3.1: Guardia de secuencia en liquidación (race condition C1) [⚙️ medio]

**Files:** Modify `src/store/liquidacionStore.js:127-138` y `src/pages/LiquidacionPage.jsx`.

- [ ] **Step 1 (test que falla):** `src/store/__tests__/liquidacionStore.test.js` — mockear `supabase.functions.invoke` con dos promesas que resuelven desordenadas; `cargarLiquidaciones(A)` y luego `cargarLiquidaciones(B)`; la respuesta de A llega última → el store debe quedar con los datos de B.
- [ ] **Step 2 (implementación):** replicar el patrón `seq` de `legajoStore.js:89-92`:
  ```js
  cargarLiquidaciones: async (periodoId) => {
    const seq = (set.getState()._seq ?? 0) + 1
    set({ _seq: seq })
    if (!periodoId) { set({ liquidaciones: [] }); return }
    const { data, error } = await supabase.from('nom_liquidaciones').select('*').eq('periodo_id', periodoId)
    if (set.getState()._seq !== seq) return   // respuesta obsoleta: descartar
    if (error) { set({ error: error.message }); return }
    set({ liquidaciones: (data || []).map(liquidacionFromDB), error: null })
  },
  ```
  Aplicar el mismo a `calcularPeriodo`, `cargarItems`, `crearPeriodoFinal`, `crearPeriodoVacaciones`.
- [ ] **Step 3 (LiquidacionPage):** deshabilitar `SelectorPeriodo` mientras `calculando`; en `handleCalcular` (líneas 159-163) verificar que el período sigue siendo el seleccionado antes de aplicar; resetear `seleccionadas` y `busqueda` al cambiar de período (M1).
- [ ] **Step 4:** Test de la página (existe `LiquidacionPage.test.jsx` como patrón) simulando respuestas desordenadas. Commit `fix(ui): guardia de secuencia en carga/calculo de liquidaciones`.

**Criterio de aceptación:** cambiar de período durante el cálculo nunca muestra/exporta/emite datos del período equivocado.

### Task 3.2: ErrorBoundary global + estados de error consistentes [⚙️ medio]

**Files:** Create `src/components/ErrorBoundary.jsx` · Modify `src/main.jsx` · Stores.

- [ ] **Step 1:** ErrorBoundary de clase alrededor de `<App/>` con pantalla de error + botón "Recargar" (`window.location.reload()`), log a consola. Test de render (jsdom) que una child que lanza muestra el fallback.
- [ ] **Step 2:** Mappers defensivos: en `liquidacionStore.js`/`legajoStore.js`/`aprobacionesStore.js` validar la forma de fila antes de mapear (si `r.bruto` es undefined → 0, etc.), evitando throw en render.
- [ ] **Step 3:** Commit `feat(ui): ErrorBoundary global y mappers defensivos`.

### Task 3.3: `try/catch` en acciones que pueden trabarse [⚙️ medio]

**Files:** `src/store/liquidacionStore.js:59-125`, `authStore.js:83-139`, resto de stores.

- [ ] **Step 1:** `calcularPeriodo`/`crearPeriodoFinal`/`crearPeriodoVacaciones`: envolver en `try/catch`; en catch `set({ calculando: false, error: 'no se pudo contactar el servidor' })`, borrar best-effort el período recién insertado si falla, retornar `{ ok: false, error }`.
- [ ] **Step 2:** `login` y `cargarSesion` (`authStore.js`): `try/catch`; en catch `cargando: false` y mensaje; `LoginPage` revierte "Ingresando…".
- [ ] **Step 3:** Repasar `documentosStore`, `empresaConfigStore`, `flujosStore`, `aprobacionesStore`, `conceptosStore`, `escalasStore` con el mismo patrón.
- [ ] **Step 4:** Tests de stores existentes (`liquidacionStore.test.js`, `authStore.test.js`) cubriendo el caso de red caída. Commit `fix(ui): try/catch en acciones de red de todos los stores`.

### Task 3.4: Robustez de datos y navegación [⚙️ bajo]

- [ ] **Step 1:** M2 — `seq` en `LiquidacionPage` (cambio de empresa), `ReportesPage`, `LiquidacionesIndividuales`.
- [ ] **Step 2:** M3 — al fallar la carga, limpiar datos viejos o indicar "datos del período anterior".
- [ ] **Step 3:** M4 — `key` estable por fila en `TabFlujo.jsx:64` y `EditorReglas.jsx:47` (usar `id` de la fila, no `index`).
- [ ] **Step 4:** M5 — `URL.revokeObjectURL` diferido (`setTimeout(() => URL.revokeObjectURL(url), 1000)`) en `LiquidacionPage.jsx:244-249` y `exportCsv.js:38-43`.
- [ ] **Step 5:** M6 — ante fallo de `whoami`, resolver perfil restrictivo (`{ rol: null, roles: [] }`) en vez de `user_metadata` editable (`authStore.js:55-81`).
- [ ] **Step 6:** M7 — reemplazar `new Function` en `EditorReglas.jsx:17-28` por el parser de `packages/motor/src/interprete.ts` (importar `evaluar` — es seguro, sin eval).
- [ ] **Step 7:** M9 — `AprobacionesPage.jsx:11` filtra por `empresaActiva?.id`.
- [ ] **Step 8:** B6 — resetear `documentosStore` al cambiar de legajo. Commit por grupo (2-3 commits temáticos).

**Criterio de aceptación:** sin datos de otra empresa/legajo/período visibles por stale state; sin descargas abortadas.

---

## Fase 4 — UX/UI para PYME

### Task 4.1: Aprobaciones con detalle visible [⚙️ medio]

**Files:** Modify `src/pages/AprobacionesPage.jsx` y `src/store/aprobacionesStore.js`.

- [ ] **Step 1:** En el store, agregar agregados por `periodo_id`: `sum(bruto)`, `sum(total_aportes)`, `count(*)` desde `nom_liquidaciones`.
- [ ] **Step 2:** En la página, mostrar total bruto, descuentos, neto y cantidad; link "Ver detalle" → `/liquidacion?periodo=<id>`.
- [ ] **Step 3:** Rechazo con comentario obligatorio (`textarea` + validación). Paginación (`usePaginado.js`). Recarga al volver al foco (`window.addEventListener('focus', ...)`).
- [ ] **Step 4:** Tests (`AprobacionesPage.test.jsx` si existe, o crear). Commit `feat(ui): aprobaciones con montos visibles y rechazo con motivo`.

### Task 4.2: Usuarios identificables + confirmación de quita [⚙️ bajo]

**Files:** Modify `src/store/usuariosStore.js` y `src/pages/UsuariosPage.jsx`.

- [ ] **Step 1:** RPC `listar_usuarios_empresa(empresa_id)` SECURITY DEFINER cruzando `auth.users.email` (validando `auth_empresa_id()` + `has_rol_nomina(['admin'])`). Como fallback simple: guardar el email en el vínculo al invitar.
- [ ] **Step 2:** Mostrar email en vez de `usuarioId.slice(0,8)` (`UsuariosPage.jsx:62`). Confirmación `window.confirm` antes de "Quitar". Estado vacío.
- [ ] **Step 3:** Commit `feat(ui): usuarios con email y confirmacion de quita`.

### Task 4.3: Toasts globales [⚙️ medio]

**Files:** Create `src/components/Toast.jsx` + `src/store/toastStore.js` · Modify `App.jsx`/`Layout.jsx` y páginas de acción.

- [ ] **Step 1:** `toastStore.js`: `push(msg, tipo)` con `setTimeout` de auto-dismiss 5s; render en `Layout.jsx` con `role="status"` y `aria-live="polite"`.
- [ ] **Step 2:** Conectar en: enviar a aprobación, aprobar/rechazar, guardar escala/empresa, cerrar período, emitir recibos, invitar usuario, clonar convenio. Reemplazar los `alert`/mensajes temporales de `TabEmpresa.jsx:25,109` y `UsuariosPage.jsx:52`.
- [ ] **Step 3:** Tests + commit `feat(ui): toasts globales`.

### Task 4.4: Recuperación de contraseña [⚙️ bajo]

- [ ] **Step 1:** En `LoginPage.jsx`: `supabase.auth.resetPasswordForEmail(email)` con respuesta genérica ("si la cuenta existe, recibirás un email"). Estado de carga en el botón.
- [ ] **Step 2:** Configurar la URL de redirect en el dashboard de Supabase (Auth → URL Configuration). Commit `feat(auth): recuperacion de contrasena`.

### Task 4.5: Onboarding de primeros pasos [⚙️ medio-alto]

**Files:** Create `src/utils/progresoOnboarding.js` + banner en `DashboardPage`/`ConfiguracionPage`.

- [ ] **Step 1:** `progresoOnboarding(empresa, convenios, conceptos, documentos, flujo, legajos, periodos)` → array de hitos con `{ id, label, hecho }` (empresa → clonar convenio → escalas → documentación → flujo de aprobación → primera alta → primer período). Pura y testeada.
- [ ] **Step 2:** Banner con barra de progreso y links a los tabs; desaparece cuando todos `hecho`.
- [ ] **Step 3:** Tests + commit `feat(ui): onboarding de primeros pasos`.

### Task 4.6: Unificar cierre de período [⚙️ bajo]

- [ ] **Step 1:** Extraer `verificarEscalaVigente()` de `ReportesPage.jsx:116-150` a `src/utils/verificarEscala.js` (pura, testeada).
- [ ] **Step 2:** `LiquidacionPage.jsx:143-151` `handleCerrarPeriodo`: validar escala vencida + confirmación. Un solo punto de cierre. Commit `refactor(ui): cierre de periodo unificado con validacion de escala`.

### Task 4.7: Pulidos de accesibilidad y estados vacíos [⚙️ medio]

Aplicar por archivo (detalle en la 1ª pasada): Dashboard (tarjetas semánticas), LiquidacionPage (`aria-expanded`, estado vacío, separar "Borrar período"), modales (`AsistenteAlta`, `BorrarPeriodo` focus trap + Escape), `index.css` (clase `select` inexistente usada en `LegajosPage.jsx:98`), `Layout.jsx` (sidebar `inert` en móvil), formularios con `<form onSubmit>` y labels `htmlFor`. Commit por grupo.

---

## Fase 5 — Importador de paritarias con IA [⚙️ medio-alto]

> **Fuente completa:** `docs/superpowers/plans/2026-07-29-importador-paritarias-ia.md` tiene TODO el código (utils, tests, migración, Edge Function, store, tab, tests de componente). Esta fase lo integra **con 3 correcciones obligatorias**:
> 1. La migración se **renumera** de `0039_importaciones_paritarias.sql` → `0045_importaciones_paritarias.sql` (0039 ya está ocupada por `basico_unidad_base`).
> 2. La Edge Function **valida JWT + empresa + rol** antes de actuar (patrón de Task 1.1); el `empresa_id` del archivo sale del JWT validado, no del body.
> 3. La policy del bucket `paritarias` **aísla por empresa** (como Task 1.3), no solo por `bucket_id`.

### Task 5.1: Utilidades puras [⚙️ medio]

**Files:** Create `src/utils/importarParitaria.js` + `src/utils/__tests__/importarParitaria.test.js`. Copiar **verbatim** del plan fuente (Tasks 1-2, líneas 53-325): `normalizarNombre` (con pre-paso `½ → medio`), `ALIAS_CATEGORIAS`, `emparejarCategorias`, `filtrarPorZona`, `construirDiff`, `validarPropuesta`. TDD: test → FAIL → copiar → PASS (14 tests) → commit `feat: normalizacion, emparejamiento, zona, diff y validacion de paritaria`.

### Task 5.2: Migración `0045` [⚙️ medio]

**Files:** Create `supabase/migrations/0045_importaciones_paritarias.sql`. Copiar del plan fuente Task 3 (líneas 336-432) renombrando a `0045`, con las correcciones:
- **Policy del bucket** (corrección #3):
  ```sql
  DROP POLICY IF EXISTS paritarias_rw ON storage.objects;
  CREATE POLICY paritarias_rw ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'paritarias'
           AND storage.foldername(name)[1] = (SELECT public.auth_empresa_id_storage())::text)
    WITH CHECK (bucket_id = 'paritarias'
           AND storage.foldername(name)[1] = (SELECT public.auth_empresa_id_storage())::text);
  ```
  (crear `auth_empresa_id_storage()` como en Task 1.3 si hace falta).
- **RPC `aplicar_paritaria`** (corrección #1, hallazgo 22c): además de validar el convenio, validar que la importación pertenezca a la empresa:
  ```sql
  PERFORM 1 FROM nom_importaciones
    WHERE id = p_importacion_id AND empresa_id = v_empresa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'importacion inexistente o ajena';
  END IF;
  ```
- Verificar parseo con sqlglot (`python3 -c "import sqlglot; ..."`), aplicar contra dev, probar RPC con vigencia `2099-01-01` y limpiar. Commit `feat(db): importaciones de paritarias y RPC aplicar_paritaria`.

### Task 5.3: Edge Function `importar-paritaria` con auth [⚙️ medio]

**Files:** Create `supabase/functions/importar-paritaria/index.ts`. Copiar del plan fuente Task 4 (líneas 479-648), con dos cambios:
1. **Parametrizar CCT** (hallazgo 26): el PROMPT recibe `convenio` (código, categorías, zonas) en vez de asumir 76/75; el parseo de zonas es por convenio.
2. **Validación de auth** (corrección #2, patrón Task 1.1): cliente anon + `auth.getUser()` → 401 sin token; cargar `empresa_id`/`convenio_id` del body; validar vínculo `nom_usuarios_empresas` (usuario + empresa, rol ∈ `['admin','rrhh']`) o superadmin → 403 si no; el path del archivo usa `empresa_id` del **JWT validado**, no del body.

Comandos: `npx supabase secrets set ANTHROPIC_API_KEY=<key>` (nunca en `.env.local`) · `npx supabase functions deploy importar-paritaria` · probar con `docs/fixtures/acta-76-75-junio-2026.pdf` (esperado: 3 tramos, 5 categorías con básicos > 0). Commit `feat: edge function importar-paritaria con extraccion via Haiku y validacion de auth`.

### Task 5.4: Store + permiso + pestaña UI [⚙️ medio]

**Files:** Create `src/store/importacionesStore.js` · Modify `src/utils/permisos.js` + `permisos.test.js` · Create `src/components/config/TabImportarParitaria.jsx` + test · Modify `src/pages/ConfiguracionPage.jsx:31`.

Copiar del plan fuente Tasks 5, 5b, 6 (líneas 694-1086): store (sin `persist`, con `try/catch` de red de la Fase 3), permiso `importar_paritaria: ['admin','rrhh']` (⚠ **decisión pendiente con el usuario**: si prefiere alinear con `editar_configuracion` = `['admin']`, cambiar el array y el test), `TabImportarParitaria.jsx` (4 estados, diff con checkboxes, badge "revisar", huérfanas separadas, avisos de `validarPropuesta`), hook en `ConfiguracionPage.jsx` gating por `puede(rolesNomina, 'importar_paritaria')`. `npm test` completo verde. Commit `feat(ui): pestana de importacion de paritarias con revision de diff`.

### Task 5.5: Verificación end-to-end con el acta real [⚙️ no código]

Seguir el plan fuente Task 7 (líneas 1090-1133): subir el acta zona A → 3 tramos, 5 categorías, "½ Oficial" → Medio oficial, 0 huérfanas; aplicar solo 2026-06-01 → 5 filas y vigencias anteriores intactas; verificar `tramos_propuestos = 3`, `tramos_aplicados = 1` en `nom_importaciones`; rechazo de `.txt` renombrado a `.pdf`. Commit final `test: verificacion end-to-end del importador con acta 76/75`.

---

## Fase 6 — Fiscal (manual; sin SICOSS)

### Task 6.1: Documentar el flujo fiscal manual [⚙️ bajo]

- [ ] **Step 1:** `docs/FISCAL-FLOW.md`: cómo el estudio genera el reporte de aportes/contribuciones (ReportesPage → CSV), cómo lo vuelca al F.931 en ARCA, cadencia (mensual, antes del día 10 o plazo vigente). Incluir capturas de los exports.
- [ ] **Step 2:** Validar cadencia y detalle con el estudio contable de la PYME.
- [ ] **Step 3:** Commit `docs: flujo fiscal manual (F.931) sin SICOSS`.

### Task 6.2/6.3 (opcionales, diferidas): SiRADIG / Ganancias

Solo si el usuario lo pide. Referencias en `docs/2026-07-29-plan-f931-siradig-ganancias.md`. No implementar en esta tanda.

---

## Fase 7 — Operación y repo

### Task 7.1: CI en GitHub Actions [⚙️ medio]

**Files:** Create `.github/workflows/ci.yml`.

- [ ] **Step 1:**
  ```yaml
  name: CI
  on: [push, pull_request]
  jobs:
    lint:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: npm }
        - run: npm ci
        - run: npm run lint
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: npm }
        - run: npm ci
        - run: npx vitest run
    rls:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: npm }
        - run: npm ci
        - run: npx vitest run tests/rls
          env:
            SUPABASE_TEST_URL: ${{ secrets.SUPABASE_TEST_URL }}
            SUPABASE_TEST_ANON: ${{ secrets.SUPABASE_TEST_ANON }}
            RLS_TEST_USER_A_EMAIL: ${{ secrets.RLS_TEST_USER_A_EMAIL }}
            RLS_TEST_USER_A_PASSWORD: ${{ secrets.RLS_TEST_USER_A_PASSWORD }}
            RLS_TEST_USER_B_EMAIL: ${{ secrets.RLS_TEST_USER_B_EMAIL }}
            RLS_TEST_USER_B_PASSWORD: ${{ secrets.RLS_TEST_USER_B_PASSWORD }}
    build:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: npm }
        - run: npm ci
        - run: npm run build
  ```
- [ ] **Step 2:** El job `rls` con el repo sin tests propios: si `tests/rls` falla por credenciales ausentes en el primer push, documentar en el README del job (los secrets se cargan en GitHub → Settings → Secrets).
- [ ] **Step 3:** Commit `ci: lint, test, rls y build en GitHub Actions`.

### Task 7.2: Bundle y performance [⚙️ medio]

**Files:** Modify `vite.config.js`, `src/App.jsx`.

- [ ] **Step 1:** `React.lazy` + `Suspense` en `App.jsx` para `DashboardPage` (arrastra recharts) y páginas pesadas.
- [ ] **Step 2:** `vite.config.js`:
  ```js
  export default defineConfig({
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            charts: ['recharts'],
            state: ['zustand'],
          },
        },
      },
    },
  })
  ```
- [ ] **Step 3:** `npm run build` → verificar chunk principal < 300 kB gzip (`ls -lh dist/assets/ | sort -k5`). Commit `perf: separar bundle de vendor y lazy load de paginas pesadas`.

### Task 7.3: Emails de notificación del flujo [⚙️ medio]

**Files:** Edge Function de notificación (patrón Resend) o hook en `avanzar_flujo`.

- [ ] **Step 1:** Edge Function `notificar-paso` que envía "Tenés una liquidación para aprobar" al responsable del siguiente paso (email del vínculo). Fallback silencioso sin API key (`if (!Deno.env.get('RESEND_API_KEY')) return json({ ok: true, salteado: true })`).
- [ ] **Step 2:** Llamarla desde el store al `avanzar_flujo`/`enviar_a_aprobacion` (fire-and-forget). Commit `feat: email de notificacion del siguiente paso en el flujo`.

### Task 7.4: README, motor como workspace, config.toml, limpieza [⚙️ bajo]

- [ ] **Step 1:** README real (qué es, cómo correr con `nvm use` + `npm run dev`, estructura, deploy). Commit.
- [ ] **Step 2:** `packages/motor` en `workspaces` de `package.json`; borrar su `node_modules`/lock propio y re-`npm install`. Verificar que `npx vitest run packages/motor` sigue verde.
- [ ] **Step 3:** `supabase/config.toml` mínimo: `[auth]`, `[storage]`, y `verify_jwt = true` en las Edge Functions (hoy no existe `config.toml` → `verify_jwt` inverificable).
- [ ] **Step 4:** Borrar `.git_broken/` y `.git_broken2/` **con OK del usuario**.
- [ ] **Step 5:** Backups: doc + `pg_dump` programado (cron del dueño o Supabase dashboard daily backups). Documentar en README.

### Task 7.5 (no urgente): Migrar a `react-router@8.3.0`

Cuando el equipo lo decida: cambiar imports `react-router-dom` → `react-router`, `npm audit` en 0 highs, verificar rutas/lazy. No urgente (vulnerabilidad no explotable en SPA pura).

---

## Fase 8 — Futuro post-v1 (opcional)

Sin implementación en esta tanda: portal del empleado, SICOSS (solo si un cliente lo exige), LSD descartado (Decreto 407/2026).

---

## Checklist de verificación final (para el agente)

- [ ] `npm run lint` sin errores.
- [ ] `npm test` completo en verde (incluye motor, golden, stores, componentes, utils).
- [ ] `npx vitest run tests/rls` en verde con credenciales de prueba.
- [ ] Migraciones aplicadas en orden: 0026, 0031–0042, 0043–0049.
- [ ] Edge Functions desplegadas: `liquidar-periodo`, `invitar-usuario`, `importar-paritaria`.
- [ ] `npm run build` OK y chunk principal < 300 kB gzip.
- [ ] `grep -rn "FOR ALL" supabase/migrations/*.sql` — cada resultado justificado por escrito (las de superadmin de 0008 son legítimas).
- [ ] Gate del contador laboralista documentado en `docs/VALIDACION-CONTADOR.md`.
