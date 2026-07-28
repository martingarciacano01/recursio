# Fase 5H — Seguridad y confidencialidad — Plan de ejecución

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el gate de seguridad obligatorio antes de usar Recursio en producción con datos salariales reales: que los permisos del backend igualen a los de la UI, que ninguna Edge Function permita cruzar empresas, que exista auditoría de acceso a datos sensibles y que la suite RLS corra de verdad.

**Architecture:** Tres capas independientes que se refuerzan: (1) RLS por rol en Postgres — el único gate real de datos; (2) validación de identidad/rol al inicio de cada Edge Function, porque `service_role` saltea RLS y por lo tanto la RLS no la protege; (3) auditoría de accesos como registro posterior. La UI (`src/utils/permisos.js`) sigue siendo solo cosmética: evita mostrar botones que fallarían igual en el servidor.

**Tech Stack:** Postgres/Supabase (RLS, policies, RPC SECURITY DEFINER), Deno (Edge Functions), React 19 + Zustand, Vitest.

---

## Hallazgos del relevamiento (2026-07-28) — leer antes de la Task 1

Estos son hechos verificados en el repo, no supuestos. El master plan (`2026-07-21-fase5-correcciones-y-mejoras.md`) asumía algunas cosas que resultaron falsas:

1. **La migración `0026_rls_roles.sql` NUNCA se escribió.** La Fase 5G quedó incompleta: `0025_roles_nomina.sql` solo aporta los helpers (`has_rol_nomina`, `whoami_nomina`) y las tablas `nom_regiones`/`nom_regiones_obras`. Quedan **27 policies `FOR ALL`** en 9 migraciones (`0002`, `0004`, `0005`, `0007`, `0008`, `0012`, `0014`, `0021`, `0025`) que le dan a cualquier usuario autenticado de la empresa lectura Y escritura sobre casi todo. El propio comentario de `src/utils/permisos.js:3` dice "el gating real de datos vive en RLS (migración 0026)" — apuntando a un archivo inexistente. **Hoy el backend no distingue roles.**

2. **`liquidar-periodo` no valida al llamador — peor de lo que decía el master plan.** `supabase/functions/liquidar-periodo/index.ts:69` crea el cliente con `SUPABASE_SERVICE_ROLE_KEY` (saltea toda RLS) y el archivo tiene **cero** referencias a `getUser`, `Authorization` o `has_rol_nomina`. Nunca compara la empresa del usuario contra `periodo.empresa_id`. Un usuario autenticado de la empresa A puede pasar el `periodoId` de la empresa B y liquidar/leer su nómina. El master plan decía "hoy valida empresa; agregar rol" — **no valida empresa tampoco**. `supabase/functions/invitar-usuario/index.ts` sí usa `getUser`: es el patrón de referencia a copiar.

3. **`vercel.json` no tiene ningún header de seguridad** configurado.

4. **`persist` en stores: limpio.** `grep -rn "persist" src/store/` solo devuelve comentarios que documentan que no se usa. No hace falta corregir nada, solo dejar un test que lo congele.

5. **`createSignedUrl`: cero usos en `src/`.** Hay que verificar cómo sirve archivos `DocumentosLegajo.jsx` antes de asumir que hay algo que endurecer (puede que la feature de storage no esté conectada todavía).

6. **RPCs SECURITY DEFINER: bien.** Las 7 existentes (`clonar_convenio`, `avanzar_flujo`, `iniciar_flujo`, `emitir_recibo`, `siguiente_numero_recibo`, `anular_liquidacion`, `has_rol_nomina`/`whoami_nomina`) ya declaran `SET search_path = public`. Falta auditar que cada una valide empresa+rol en el cuerpo.

**Numeración de migraciones:** `0026` está libre (reservada para RLS por rol desde el master plan). El log de auditoría NO puede ser `0028` como decía el master plan (ya la usó `0028_recibo_costo_laboral.sql`): va como **`0031`**.

**Decisión del usuario sobre el entorno de tests:** los tests RLS corren contra el proyecto actual (`Presencio-dev`) con usuarios y empresas de prueba dedicados. Implica que los tests escriben en la misma base que se usa para probar la app: cada test DEBE limpiar lo que crea y NUNCA tocar filas que no haya creado él mismo (ver Task 3, Step 1).

---

## Orden y dependencias

| Task | Contenido | Depende de |
|---|---|---|
| 1 | Edge Function `liquidar-periodo`: validar JWT + empresa + rol | — (**primero: es el agujero que RLS no puede tapar**) |
| 2 | Migración `0026_rls_roles.sql` — RLS por rol en todas las `nom_*` | — |
| 3 | Suite RLS ejecutable con usuarios de prueba | 1 y 2 (si no, verifica permisos que no existen) |
| 4 | Auditoría de accesos (`0031`) + gating de exports | 2 |
| 5 | Endurecimiento (headers, storage, barrido de logs, checklist RPC) | 2 |

---

## Task 1: `liquidar-periodo` valida identidad, empresa y rol [⚙️ esfuerzo medio]

**Por qué primero:** la función usa `service_role`, que ignora RLS. Por más perfecta que quede la Task 2, esta ruta seguiría permitiendo cruzar empresas. Es el hallazgo nº 2 del relevamiento.

**Files:**
- Modify: `supabase/functions/liquidar-periodo/index.ts`
- Reference (NO modificar): `supabase/functions/invitar-usuario/index.ts` — patrón de `getUser` ya usado en el repo

- [ ] **Step 1: Leer el patrón de referencia.** Abrir `supabase/functions/invitar-usuario/index.ts` completo y anotar exactamente cómo obtiene el usuario a partir del header `Authorization` (qué cliente crea, con qué key, cómo maneja el token). Replicar ESE patrón, no inventar uno nuevo.

- [ ] **Step 2: Agregar la validación al inicio del handler.** En `Deno.serve`, después del early-return de `OPTIONS` y ANTES de cualquier lectura de datos, insertar:

```ts
  // El cliente de datos usa service_role (saltea RLS a propósito, para
  // poder liquidar a toda la empresa de una), así que la autorización NO
  // la puede delegar en RLS: hay que validarla acá explícitamente.
  // Sin esto, cualquier usuario autenticado del proyecto puede pasar el
  // periodoId de OTRA empresa y liquidarle la nómina.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'falta header Authorization' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: errUser } = await supabaseAuth.auth.getUser()
  if (errUser || !user) {
    return new Response(JSON.stringify({ error: 'no autenticado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
```

- [ ] **Step 3: Validar empresa + rol contra el período.** Después de cargar `periodo` (la función ya lo hace, buscar `.from('nom_periodos').select('*').eq('id', periodoId).single()`) y ANTES de tocar cualquier otro dato, agregar:

```ts
  // El usuario tiene que pertenecer a la empresa del período y tener un rol
  // que habilite calcular (matriz de src/utils/permisos.js: calcular_liquidacion
  // => admin, rrhh). Se consulta con el cliente service_role porque
  // nom_usuarios_empresas tiene RLS y acá todavía no hay contexto de usuario.
  const { data: vinculos } = await supabase
    .from('nom_usuarios_empresas')
    .select('rol')
    .eq('usuario_id', user.id)
    .eq('empresa_id', periodo.empresa_id)
  const rolesDelUsuario = (vinculos || []).map((v: any) => v.rol)
  const ROLES_QUE_LIQUIDAN = ['admin', 'rrhh']
  const esSuperadmin = user.app_metadata?.rol === 'superadmin'
  if (!esSuperadmin && !rolesDelUsuario.some((r) => ROLES_QUE_LIQUIDAN.includes(r))) {
    return new Response(JSON.stringify({ error: 'sin permiso para liquidar este período' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
```

  **Verificar antes de escribirlo:** (a) el nombre real de la columna de usuario en `nom_usuarios_empresas` (`usuario_id` vs `user_id`) con `grep -n "usuario_id\|user_id" supabase/migrations/0014_flujos_aprobacion.sql supabase/migrations/0025_roles_nomina.sql`; (b) cómo se marca superadmin en este proyecto — buscar el patrón real con `grep -rn "superadmin" supabase/migrations/0008_superadmin_bypass.sql` y usar ESE criterio, no `app_metadata.rol` si el repo usa otro.

- [ ] **Step 4: Verificar que no se rompió el flujo normal.** `npx vitest run` completo (la Edge Function no tiene cobertura vitest; se corre para confirmar que no se tocó nada más). Recordá `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use` antes.

- [ ] **Step 5: Commit.** `git add supabase/functions/liquidar-periodo/index.ts && git commit -m "fix(seguridad): liquidar-periodo valida JWT, empresa y rol del llamador"`

- [ ] **Step 6: Deploy + prueba manual (el usuario).** `supabase functions deploy liquidar-periodo`. **Criterio de aceptación:** liquidar un período propio sigue funcionando; invocar la función con el `periodoId` de otra empresa devuelve 403.

---

## Task 2: Migración `0026_rls_roles.sql` — RLS por rol [⚙️ esfuerzo medio]

Es la deuda de la Fase 5G (hallazgo nº 1). Reemplaza las policies `FOR ALL` amplias por SELECT amplio + escritura restringida con `has_rol_nomina()`.

**Files:**
- Create: `supabase/migrations/0026_rls_roles.sql`

- [ ] **Step 1: Inventariar las policies actuales.** Correr y guardar la salida (va al commit message):

```bash
grep -rn "FOR ALL" supabase/migrations/*.sql
```

Anotar tabla por tabla cuál es el nombre exacto de cada policy: la migración las tiene que dropear por nombre (`DROP POLICY IF EXISTS <nombre> ON <tabla>`).

- [ ] **Step 2: Escribir la migración** siguiendo esta matriz (del master plan §5G Task 29). Para CADA tabla: dropear la policy `FOR ALL` vieja, crear una de SELECT y una de escritura separadas.

| Tabla(s) | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `nom_legajo`, `nom_familiares`, `nom_sanciones_personal`, documentos | admin, rrhh, consulta, supervisor (su alcance) | admin, rrhh |
| `nom_convenios`, `nom_categorias`, `nom_conceptos`, `nom_parametros`, `nom_no_remunerativos` | todos los roles internos | admin, rrhh |
| `nom_periodos`, `nom_liquidaciones`, `nom_liquidacion_items` | admin, rrhh, consulta, revisores con instancia en su paso, supervisor (su alcance) | admin, rrhh |
| `nom_flujos`, `nom_flujo_pasos` | admin, rrhh | admin |
| `nom_usuarios_empresas` | admin | admin |
| `nom_aprobaciones` | participantes del flujo | solo vía RPC `avanzar_flujo` |

Patrón por tabla (ejemplo con `nom_legajo` — repetir adaptando):

```sql
DROP POLICY IF EXISTS nom_legajo_all ON nom_legajo;

CREATE POLICY nom_legajo_select ON nom_legajo FOR SELECT TO authenticated
  USING (
    empresa_id = auth_empresa_id()
    AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])
  );

CREATE POLICY nom_legajo_write ON nom_legajo FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

CREATE POLICY nom_legajo_update ON nom_legajo FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']))
  WITH CHECK (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));

CREATE POLICY nom_legajo_delete ON nom_legajo FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh']));
```

- [ ] **Step 3: NO romper el bypass de superadmin.** `0008_superadmin_bypass.sql` agrega policies de superadmin. Verificar con `sed -n '1,60p' supabase/migrations/0008_superadmin_bypass.sql` que siguen aplicando (son policies separadas: en Postgres las policies de un mismo comando se combinan con OR, así que conviven). Si alguna tabla nueva de 5C–5E no tiene su policy de superadmin, agregarla acá.

- [ ] **Step 4: Cuidado con el orden de aplicación.** Esta migración cambia permisos de la app en vivo: si `has_rol_nomina` devuelve `false` para el propio usuario del usuario (porque no tiene fila en `nom_usuarios_empresas`), **se queda afuera de su propia app**. Incluir al final de la migración un bloque idempotente que garantice que el/los usuarios actuales tengan rol `admin`:

```sql
-- Red de seguridad: si la empresa tiene legajos pero ningún usuario con rol
-- de nómina, nadie podría entrar tras aplicar estas policies. Se le da rol
-- admin al owner de la empresa. Idempotente.
INSERT INTO nom_usuarios_empresas (usuario_id, empresa_id, rol)
SELECT e.owner_id, e.id, 'admin'
FROM empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM nom_usuarios_empresas u WHERE u.empresa_id = e.id AND u.rol = 'admin'
)
ON CONFLICT DO NOTHING;
```

  **Verificar antes:** que `empresas` tenga realmente una columna `owner_id` (`grep -rn "owner_id\|CREATE TABLE.*empresas" supabase/migrations/*.sql`). Si no existe, adaptar el criterio (por ejemplo, tomar de `nom_usuarios_empresas` los vínculos ya existentes) y **preguntarle al usuario** antes de asumir a quién darle admin: darle admin a la persona equivocada es un problema de seguridad, no un detalle.

- [ ] **Step 5:** Pedirle al usuario que la aplique en Supabase. Commit: `feat(db): migracion 0026 RLS por rol — cierra la deuda de la Fase 5G`

- [ ] **Step 6: Prueba manual guiada (el usuario).** Entrar a la app con su usuario habitual y confirmar que sigue viendo legajos y liquidaciones. **Si algo se rompe, el rollback es dropear las policies nuevas y recrear las `FOR ALL`** — tener el SQL de rollback listo en el mismo commit, en un comentario al pie de la migración.

---

## Task 3: Suite RLS ejecutable

Hoy `tests/rls/*.test.js` usan `describe.skipIf(!tieneCredenciales)` y nunca corren. El usuario eligió correrlos contra el proyecto actual (`Presencio-dev`) con usuarios de prueba dedicados.

**Files:**
- Create: `tests/rls/README.md`
- Create: `tests/rls/setup.md` (o script SQL de alta de usuarios de prueba)
- Modify: `tests/rls/nomina_core.rls.test.js`, `tests/rls/legajo.rls.test.js`
- Create: `tests/rls/roles.rls.test.js`

- [ ] **Step 1: Escribir `tests/rls/README.md` PRIMERO, con la advertencia de seguridad arriba de todo.** Los tests corren contra la misma base que la app: tienen que crear sus propios datos con un prefijo reconocible (ej. empresas `ZZ-TEST-A` / `ZZ-TEST-B`), limpiarlos en `afterAll`, y no borrar NUNCA nada que no hayan creado. Documentar:
  - qué usuarios de prueba hay que crear a mano en Supabase Auth (dos, uno por empresa) y con qué rol en `nom_usuarios_empresas`;
  - qué variables de entorno leen los tests (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `RLS_TEST_USER_A_EMAIL`, `RLS_TEST_USER_A_PASSWORD`, etc.) y que van en `.env.local`, **nunca commiteadas**;
  - cómo correrlos: `npx vitest run tests/rls`.

- [ ] **Step 2: Casos mínimos** (del master plan §5H Task 32). Cada uno como un `it` con aserción concreta:
  - usuario de empresa A **no** lee legajos / liquidaciones / recibos / documentos de empresa B;
  - `revisor_externo` solo ve períodos con instancia en su paso — nada de legajos ni configuración;
  - `supervisor` de sitio X no ve personal del sitio Y;
  - `consulta` **no puede escribir** en ninguna tabla (INSERT/UPDATE/DELETE rechazados);
  - `anon` no lee nada `nom_*`;
  - storage: usuario de A no obtiene URL firmada de un recibo de B (**si** el storage está conectado — ver Task 5 Step 2; si no lo está, dejar el caso escrito y explícitamente `skip` con un comentario que diga por qué).

- [ ] **Step 3:** Correr `npx vitest run tests/rls` con las credenciales cargadas. **Se espera que varios FALLEN** si las Tasks 1 y 2 no se aplicaron todavía en la base — eso es la señal de que el test sirve. Anotar cuáles fallan y por qué.

- [ ] **Step 4:** Una vez aplicadas las migraciones, todos en verde. Commit: `test(rls): suite de aislamiento entre empresas y por rol, ejecutable`

- [ ] **Step 5: Gate de CI (opcional, confirmar con el usuario).** Si hay CI configurada, agregar `npx vitest run tests/rls` como job aparte con los secrets. Si no hay CI, anotarlo como pendiente en el README y no inventar un pipeline.

---

## Task 4: Auditoría de accesos a datos sensibles

**Files:**
- Create: `supabase/migrations/0031_auditoria_accesos.sql`
- Modify: `src/pages/LiquidacionPage.jsx` (emisión/descarga de recibo, export CSV)
- Modify: `src/pages/ReportesPage.jsx` (export CSV)
- Create: `src/utils/__tests__/auditoria.test.js`

- [ ] **Step 1: Migración.**

```sql
-- 0031_auditoria_accesos.sql  (0028 estaba tomada por el recibo de costo laboral)
CREATE TABLE IF NOT EXISTS nom_accesos_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id  UUID NOT NULL,
  recurso     TEXT NOT NULL CHECK (recurso IN ('recibo_pdf','export_csv','liquidacion_detalle','libro_sueldos')),
  recurso_id  UUID,
  detalle     TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_accesos_log ENABLE ROW LEVEL SECURITY;

-- Solo admin (y superadmin vía 0008) leen el log; nadie lo edita ni lo borra:
-- un log de auditoría que el auditado puede modificar no sirve de nada.
DROP POLICY IF EXISTS nom_accesos_log_select ON nom_accesos_log;
CREATE POLICY nom_accesos_log_select ON nom_accesos_log FOR SELECT TO authenticated
  USING (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin']));

GRANT SELECT ON nom_accesos_log TO authenticated;
CREATE INDEX IF NOT EXISTS nom_accesos_log_empresa_idx ON nom_accesos_log(empresa_id, created_at DESC);

-- El INSERT va solo por esta RPC: el cliente no puede falsear usuario_id.
CREATE OR REPLACE FUNCTION registrar_acceso(p_recurso TEXT, p_recurso_id UUID, p_detalle TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO nom_accesos_log (empresa_id, usuario_id, recurso, recurso_id, detalle)
  VALUES (auth_empresa_id(), auth.uid(), p_recurso, p_recurso_id, p_detalle);
END $$;
GRANT EXECUTE ON FUNCTION registrar_acceso(TEXT, UUID, TEXT) TO authenticated;
```

- [ ] **Step 2: Test del helper cliente (TDD).** `src/utils/auditoria.js` expone `registrarAcceso(supabase, recurso, recursoId, detalle)`. Test que falla primero: verifica que llama a `supabase.rpc('registrar_acceso', {...})` con los parámetros correctos y que **nunca incluye montos ni CUIL en `detalle`** (el detalle es contexto: "período 2026-07 quincena_1", no datos salariales).

- [ ] **Step 3: Conectar en los 3 puntos:** emisión/descarga de recibo PDF, todo export CSV (LiquidacionPage y ReportesPage), y apertura de detalle de liquidación. Cada llamada es *fire-and-forget* (un fallo de log no debe romper la descarga: `.catch(() => {})` con comentario explicando la decisión).

- [ ] **Step 4: Restringir exports a admin/rrhh** con `puede(rolesNomina, 'exportar')` (ya existe en la matriz de `permisos.js`): esconder el botón y, más importante, que la RLS de la Task 2 ya impida leer los datos si el rol no corresponde.

- [ ] **Step 5:** Suite completa verde. Commit: `feat(seguridad): log de accesos a recibos y exports + gating por rol`

- [ ] **Step 6 (opcional, confirmar con el usuario):** vista "Accesos" en `SuperAdminPage.jsx` con filtros por usuario y fecha.

---

## Task 5: Endurecimiento

**Files:**
- Modify: `vercel.json`
- Modify: `supabase/functions/invitar-usuario/index.ts` (solo si el barrido encuentra algo)
- Create: `src/store/__tests__/sin-persist.test.js`

- [ ] **Step 1: Headers de seguridad en `vercel.json`** (hoy no hay ninguno). Agregar:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

  **Cuidado:** `vercel.json` ya tiene contenido (rewrites de SPA). NO sobrescribir el archivo: leerlo entero y agregar la clave `headers` conservando lo que hay.

- [ ] **Step 2: Storage — averiguar primero si aplica.** `grep -rn "createSignedUrl" src/` da **cero** resultados hoy. Antes de "endurecer" algo que no existe: leer `src/components/legajo/DocumentosLegajo.jsx` y ver cómo sirve los archivos realmente. Si usa URLs públicas o `getPublicUrl`, **eso sí es un hallazgo** (documentación de legajo accesible sin firmar) y hay que reportarlo y corregirlo a URL firmada ≤ 5 min. Si la feature no está conectada a storage todavía, anotarlo como "no aplica aún" y seguir — no inventar código para un bucket que no se usa.

- [ ] **Step 3: Barrido de logs sensibles.** `grep -rn "console.log" src/ supabase/functions/ | grep -iE "cuil|cbu|monto|neto|bruto|sueldo|salario"` — debe quedar vacío. Corregir lo que aparezca.

- [ ] **Step 4: Test que congela el "sin persist".** Los stores con datos salariales nunca deben persistir. Test que lee los archivos de `src/store/` y falla si alguno importa `persist` de `zustand/middleware`:

```js
// src/store/__tests__/sin-persist.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Los stores de nómina tienen sueldos, CUIL y CBU en memoria. Persistirlos
// en localStorage los dejaría legibles por cualquier script del navegador
// y sobrevivirían al logout (Recursio_Plan_Ejecucion_Sonnet5.md, instrucción 6).
describe('stores sin persist', () => {
  it('ningun store importa el middleware persist de zustand', () => {
    const dir = join(process.cwd(), 'src/store')
    const infractores = readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => /from\s+['"]zustand\/middleware['"]/.test(readFileSync(join(dir, f), 'utf8')))
    expect(infractores).toEqual([])
  })
})
```

- [ ] **Step 5: Checklist de RPCs SECURITY DEFINER.** Las 7 existentes ya tienen `SET search_path = public` (verificado). Falta revisar una por una que validen empresa+rol en el cuerpo y que no armen SQL dinámico concatenado. Leer cada una y anotar el resultado en una tabla en el commit message; corregir las que no validen.

- [ ] **Step 6:** Suite completa verde. Commit: `chore(seguridad): headers, barrido de logs sensibles y test anti-persist`

---

## Verificación final de la sub-fase

- [ ] `npx vitest run` completo en verde (base: 241 tests al cierre de la Fase 5E) + `npx vitest run tests/rls` en verde con credenciales.
- [ ] Migraciones `0026` y `0031` aplicadas por el usuario; `liquidar-periodo` redesplegada.
- [ ] **Prueba de cruce manual, como criterio de aceptación del gate:** con el usuario de la empresa A, intentar (a) leer un legajo de la empresa B por API directa y (b) invocar `liquidar-periodo` con un `periodoId` de B. Ambas deben fallar. Documentar el resultado en `docs/`.
- [ ] `grep -rn "FOR ALL" supabase/migrations/*.sql` — cada resultado restante justificado por escrito (las de superadmin de `0008` son legítimas).
- [ ] Nota para el usuario: este gate cubre RLS, autorización de Edge Functions y auditoría. **No** cubre pentesting, rotación de secretos ni backups — si el piloto es con datos reales de empleados, esos temas van aparte.
