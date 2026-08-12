# PLAN — Lanzamiento de Recursio a PROD (hoy)

> **Objetivo:** dejar Recursio corriendo contra el proyecto Supabase **prod
> `Presencio` (`qsgzbfusjhgnyacdbbzg`)** — el mismo que usa el frontend de
> Presencio — con esquema `nom_*`, Edge Functions, storage y frontend en
> Vercel. Así el legajo cargado desde Presencio (migración 042) queda
> visible y operativo en Recursio.
>
> **Fecha:** 2026-08-12 · **Ejecutor:** agente + usuario (los pasos que
> requieren acceso a la DB prod se hacen por SQL Editor / Dashboard).
>
> **Principio rector:** NO se usa `supabase db push` contra prod. El
> `schema_migrations` de prod está incompleto (solo trackea `021`) y el repo
> contiene `000_02_setup_demo_NO_EJECUTAR_EN_PROD.sql` (DROP TABLE CASCADE).
> Las migraciones de Recursio se aplican **una a una por SQL Editor**, en
> orden, como ya se hace en dev (runbook).

---

## ⚠️ Hallazgos del relevamiento (2026-08-12)

- **Recursio**: repo con 69 migraciones (`0001` → `0070`). Git limpio salvo
  `supabase/supabase/` (carpeta vacía untracked, ignorar o borrar).
  Migraciones aplicadas en **dev** (`hlipootstxojwdxwkrwl`): hasta `0070`
  (runbook registra 0036–0042, 0058–0069, 0070; consolidado 0066 aplicado).
- **Edge Functions de Recursio**: `invitar-usuario`, `liquidar-periodo`
  (ambas deployadas en dev, versión 25 de liquidar-periodo).
- **No hay `.vercel/`** en Recursio (nunca se desplegó) ni setup-config.
- **Vercel CLI**: logueado como `martingarciacano01` (ok). Proyecto
  `presencio` ya existe (el front de Presencia).
- **`schema_migrations` de prod está incompleto** → `supabase db push`
  re-ejecutaría migraciones viejas incluyendo la destructiva `000_02`.
  **NO correr `db push` en prod.** Aplicar por SQL Editor.
- **No hay password de la DB prod** disponible en el entorno → backup y
  aplicación de migraciones los hace el usuario (SQL Editor / Dashboard).
- **Prod no debería tener `nom_*` todavía** (verificar en Paso 2). Si ya
  existen, pausar y avisar.
- Presencio ya tiene migración `042` (legajo) — su código en develop ya está
  listo y prueba el esquema compartido.

---

## Paso 1 — Preflight (usuario + agente)

1. **Commit de Recursio** (si hace falta):
   ```bash
   cd /Users/martin/Documents/Claude/Projects/Fichaobra/recursio
   git status --short          # esperado: solo supabase/supabase/ (vacío)
   # si hay algo más, commitear en orden lógico y actualizar runbook
   ```
2. **Backup de prod** (obligatorio, usuario):
   - Dashboard → proyecto `Presencio` (`qsgzbfusjhgnyacdbbzg`) → Backups →
     Take snapshot. Anotar timestamp.
   - O alternativamente `pg_dump` con el connection string de la DB
     (Settings → Database → Connection string). Guardar fuera del repo.
3. **Vercel logueado**: `vercel whoami` → `martingarciacano01` (ya verificado).

---

## Paso 2 — Verificación de prod (SQL Editor, usuario)

Pegar en SQL Editor del proyecto prod `Presencio`:

```sql
-- ¿Ya existen tablas nom_*? (si sí → pausar, algo se desplegó antes)
select tablename from pg_tables
 where schema='public' and tablename like 'nom\_%' order by 1;

-- Funciones que Recursio necesita y que Presencio ya tiene:
select proname from pg_proc
 where proname in ('auth_empresa_id','is_superadmin','has_rol_nomina');

-- Tablas base de Presencio que Recursio lee:
select tablename from pg_tables where schema='public' and tablename in
  ('personal','empresas','documentos_personal','usuarios_empresa','superadmins');
```

**Gate:** `nom_*` NO debe existir. Si existe, pausar y avisar.

---

## Paso 3 — Aplicar migraciones de Recursio a prod (SQL Editor, usuario)

**Orden estricto** (una a una, verificar "Success. No rows returned"):

1. Listar en orden: `ls supabase/migrations/*.sql | sort`
   (en `/Users/martin/Documents/Claude/Projects/Fichaobra/recursio`).
2. Pegar CADA archivo en el SQL Editor de prod, en orden alfabético:
   `0001` → `0070` (intercalan `0001b_*`, `0002b_*`).
3. **NO pegar el bloque completo** — una a una, para saber cuál falla.
4. Las migraciones son idempotentes (`CREATE TABLE IF NOT EXISTS`,
   `DROP POLICY IF EXISTS`, `CREATE OR REPLACE`, seeds con `WHERE NOT
   EXISTS`) → seguras sobre lo que ya haya creado la 042 de Presencio.

**Casos especiales a vigilar:**
- `0002_nomina_core.sql`: crea `nom_legajo`/`nom_convenios`/`nom_categorias`
  → ya las creó la 042 de Presencio; `IF NOT EXISTS` no las duplica.
- `0032_documentos_legajo.sql`: crea bucket `nom-documentos` + policy.
- `0043_storage_ruta_empresa.sql`: policy de storage aislada por empresa.
- `0066_schemas_pendientes.sql`: consolidado con diagnóstico; si ya se
  aplicó todo por separado, da "todo ok" (idempotente).
- `0069_firma_recibos.sql`: requiere `0054` (estado_revision) aplicada antes.

**Verificación post-aplicación:**
```sql
select tablename from pg_tables where schema='public' and tablename like 'nom\_%' order by 1;
select count(*) from nom_convenios;
select count(*) from nom_conceptos where codigo='basico';
```

---

## Paso 4 — Buckets, storage y secrets (usuario, Dashboard)

1. Verificar buckets en Storage:
   - `nom-documentos` (privado) — lo crea 0032.
   - `nom-firmas` (público) — lo crea 0069.
   - `documentos-licencias` (de Presencio) debe seguir intacto.
2. Secrets de Edge Functions (Dashboard → Edge Functions → Secrets):
   - Si `invitar-usuario`/`liquidar-periodo` usan secrets (ANTHROPIC_API_KEY
     para el importador de paritarias, si aplica) → agregarlos. Verificar
     en el código de cada función qué `Deno.env.get(...)` usan.

---

## Paso 5 — Deploy Edge Functions a prod (agente, CLI)

```bash
cd /Users/martin/Documents/Claude/Projects/Fichaobra/recursio
supabase functions deploy invitar-usuario --project-ref qsgzbfusjhgnyacdbbzg
supabase functions deploy liquidar-periodo --project-ref qsgzbfusjhgnyacdbbzg
```

Verificación: abrir la URL de la función en el Dashboard y probar con JWT
de un admin (período propio → 200; período ajeno → 403).

---

## Paso 6 — Frontend Recursio en Vercel (agente + usuario)

1. Crear `recursio/.env.production` (NO se commitea — `.gitignore` cubre
   `.env.*` salvo `.env.example`):
   ```
   VITE_SUPABASE_URL=https://qsgzbfusjhgnyacdbbzg.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key de fichaobra/.env.production.local>
   ```
2. Build local:
   ```bash
   cd /Users/martin/Documents/Claude/Projects/Fichaobra/recursio
   nvm use && npm ci && npm run build
   ```
3. Publicar en Vercel (proyecto NUEVO "recursio"):
   ```bash
   vercel link --yes --project recursio
   vercel env add VITE_SUPABASE_URL production      # https://qsgzbfusjhgnyacdbbzg.supabase.co
   vercel env add VITE_SUPABASE_ANON_KEY production # la anon key
   vercel --prod
   ```
   > Si `vercel link --project recursio` pide crear el proyecto, confirmar.
4. Verificar en el dominio:
   - Login con un usuario de Recurs (Paso 7).
   - Recargar ruta profunda (SPA funciona — `vercel.json` tiene rewrites).
   - Headers de seguridad presentes (X-Content-Type-Options, etc.).

---

## Paso 7 — Usuarios y acceso en prod (usuario + agente)

- `auth_empresa_id()` lee `usuarios_empresa` (de Presencio). Los admins de
  Presencio ya tienen fila → ven la empresa y pueden operar.
- Para usuarios de Recursio sin fila en `usuarios_empresa`: usar la Edge
  Function `invitar-usuario` (deployed en Paso 5) con `empresaId` y rol
  ∈ `['admin','rrhh','consulta',...]`. Crear primero la fila en
  `usuarios_empresa` con esa empresa (SQL Editor, `select id from empresas`).
- Roles de nómina de Recurs viven en `nom_usuarios_empresas` (0025) y se
  asignan desde el menú "Usuarios" de Recurs una vez logueado.

---

## Paso 8 — Verificación end-to-end en prod (gate final)

1. **DB**: `nom_*` completo (query del Paso 3); datos de Presencia intactos
   (counts de `personal`, `fichajes` iguales al backup).
2. **Edge Functions**: `invitar-usuario` y `liquidar-periodo` responden.
3. **Frontend Recurs prod**: login con usuario RRHH → ve el personal de
   Presencia (`nom_v_personal`) y abre la Ficha Legajo de un empleado con
   datos cargados desde Presencio (familiares, sanciones, documentación).
4. **Registrar** en `recursio/docs/RUNBOOK-DE-MIGRACIONES.md` las migraciones
   aplicadas a prod (versión, nombre, fecha, base="Presencio prod") y
   commitear.

> **Criterio de salida:** Recurs prod funcional contra `Presencio`,
> esquema `nom_*` completo, Edge Functions y storage operativos, frontend
> publicado en Vercel, usuarios con acceso. Recién ahí se cumple el
> **legajo único compartido** y se puede cerrar el plan hermano de Presencia.

---

## Orden de ejecución y responsables

| Paso | Responsable | Requiere |
|---|---|---|
| 1. Preflight + backup | Usuario (backup) / agente (git) | Dashboard |
| 2. Verificación prod | Usuario | SQL Editor |
| 3. Migraciones 0001–0070 | Usuario | SQL Editor |
| 4. Buckets + secrets | Usuario | Dashboard |
| 5. Deploy Edge Functions | Agente | CLI supabase |
| 6. Frontend Vercel | Agente + usuario (link) | CLI vercel |
| 7. Usuarios/RLS | Usuario + agente | SQL Editor + función |
| 8. Verificación e2e | Agente + usuario | — |
