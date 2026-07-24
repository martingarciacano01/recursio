# Fase 5G — Usuarios, roles y gating (bite-sized) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roles de nómina server-side (`whoami_nomina()`), ABM de usuarios con invitación por email, y gating de UI/RLS consistente en toda la app — sin esto, cualquier usuario de la empresa ve y toca todo.

**Architecture:** Extiende `nom_usuarios_empresas` (ya existe desde 0014) en vez de crear otra tabla de roles. Los roles se resuelven server-side vía RPC `whoami_nomina()` (mismo patrón que `whoami()` en `authStore.js` — nunca se confía en `user_metadata` del cliente). Gating de UI centralizado en `src/utils/permisos.js` (función pura `puede(rolesNomina, accion)`), consumido por `Sidebar.jsx` y un componente `ProtectedRoute`. RLS se endurece en una migración aparte que reemplaza los `FOR ALL ... empresa_id = auth_empresa_id()` amplios por policies separadas de lectura/escritura usando el helper SQL `has_rol_nomina(roles[])`.

**Tech Stack:** React 19, Vite, Zustand, react-router-dom 7, Supabase (Postgres + Auth Admin API vía Edge Function), Vitest.

**Decisiones ya confirmadas con el usuario:**
- Los 7 roles se migran tal cual, todos en esta vuelta: `admin`, `rrhh`, `revisor_interno`, `aprobador_pagos`, `revisor_externo`, `supervisor`, `consulta`.
- Se incluye invitación de usuarios nuevos por email (no solo vincular existentes) — vía Supabase Auth Admin API (`inviteUserByEmail`), en una Edge Function nueva porque requiere `SUPABASE_SERVICE_ROLE_KEY` (no se puede llamar desde el cliente).
- Enviar un email real es una acción irreversible hacia un tercero: la función solo se invoca cuando el usuario hace clic en "Invitar" desde `UsuariosPage.jsx` — nunca se dispara automáticamente ni se prueba contra una casilla real durante el desarrollo/testing de este plan.

---

## Task 28: Roles de nómina, migración y ABM de usuarios

**Files:**
- Create: `supabase/migrations/0025_roles_nomina.sql`
- Create: `src/utils/permisos.js`
- Create: `src/utils/__tests__/permisos.test.js`
- Create: `supabase/functions/invitar-usuario/index.ts`
- Create: `src/store/usuariosStore.js`
- Create: `src/store/__tests__/usuariosStore.test.js`
- Create: `src/pages/UsuariosPage.jsx`
- Create: `src/pages/__tests__/UsuariosPage.test.jsx`
- Modify: `src/store/authStore.js` (cargar `rolesNomina` vía `whoami_nomina()`)
- Modify: `src/store/__tests__/authStore.test.js`
- Modify: `src/App.jsx` (reemplazar el placeholder de `/usuarios`)

### Step 1: Migración 0025 — ampliar roles, alcances y `has_rol_nomina`

```sql
-- 0025_roles_nomina.sql
-- Amplía nom_usuarios_empresas (0014) de "solo revisor_externo/aprobador_pagos
-- multi-empresa" a la tabla de roles completa de Nómina, con alcance
-- opcional (sitio/región) para supervisor. has_rol_nomina() es el único
-- punto de verdad que las policies nuevas (0026) van a consultar — nunca
-- se resuelve el rol desde user_metadata del cliente.

ALTER TABLE nom_usuarios_empresas
  DROP CONSTRAINT IF EXISTS nom_usuarios_empresas_rol_check;
ALTER TABLE nom_usuarios_empresas
  ADD CONSTRAINT nom_usuarios_empresas_rol_check
  CHECK (rol IN ('admin','rrhh','revisor_interno','aprobador_pagos','revisor_externo','supervisor','consulta'));

ALTER TABLE nom_usuarios_empresas
  ADD COLUMN IF NOT EXISTS alcance_tipo TEXT NOT NULL DEFAULT 'empresa'
    CHECK (alcance_tipo IN ('empresa','region','sitio')),
  ADD COLUMN IF NOT EXISTS alcance_id UUID;

-- Regiones propias de Nómina (agrupan obras de Presencio para el alcance
-- "region" de un supervisor). nom_regiones_obras vincula cada obra
-- (nom_v_personal.obra_id) a 0..N regiones.
CREATE TABLE IF NOT EXISTS nom_regiones (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_regiones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_regiones_all ON nom_regiones;
CREATE POLICY nom_regiones_all ON nom_regiones FOR ALL TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id())
  WITH CHECK (is_superadmin() OR empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_regiones TO authenticated;

CREATE TABLE IF NOT EXISTS nom_regiones_obras (
  region_id  UUID NOT NULL REFERENCES nom_regiones(id) ON DELETE CASCADE,
  obra_id    UUID NOT NULL,
  PRIMARY KEY (region_id, obra_id)
);
ALTER TABLE nom_regiones_obras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_regiones_obras_all ON nom_regiones_obras;
CREATE POLICY nom_regiones_obras_all ON nom_regiones_obras FOR ALL TO authenticated
  USING (is_superadmin() OR EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id()))
  WITH CHECK (is_superadmin() OR EXISTS (SELECT 1 FROM nom_regiones r WHERE r.id = region_id AND r.empresa_id = auth_empresa_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_regiones_obras TO authenticated;

-- Helper SQL usado por TODAS las policies de escritura nuevas (0026) y por
-- whoami_nomina(). SECURITY DEFINER + STABLE: corre con los permisos del
-- owner (evita recursión de RLS al leer nom_usuarios_empresas) pero solo
-- lee, nunca escribe. Superadmin siempre pasa.
CREATE OR REPLACE FUNCTION has_rol_nomina(roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT is_superadmin() OR EXISTS (
    SELECT 1 FROM nom_usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid()
      AND ue.empresa_id = auth_empresa_id()
      AND ue.rol = ANY(roles)
  );
$$;
GRANT EXECUTE ON FUNCTION has_rol_nomina(TEXT[]) TO authenticated;

-- whoami_nomina(): analogía de whoami() (Presencio) para los roles de
-- Nómina. Un usuario puede tener más de un rol/empresa (ej. rrhh en su
-- empresa dueña + revisor_externo en otra) — de ahí que devuelva filas,
-- no una sola. El cliente NUNCA deriva roles de user_metadata editable.
CREATE OR REPLACE FUNCTION whoami_nomina()
RETURNS TABLE (rol TEXT, alcance_tipo TEXT, alcance_id UUID, empresa_id UUID)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT ue.rol, ue.alcance_tipo, ue.alcance_id, ue.empresa_id
  FROM nom_usuarios_empresas ue
  WHERE ue.usuario_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION whoami_nomina() TO authenticated;
```

- [ ] Avisar al usuario que la aplique en Supabase (SQL Editor) antes de probar el resto de esta tarea — sin esto, `whoami_nomina()`/`has_rol_nomina()` no existen y las siguientes tareas fallan.
- [ ] Commit: `git add supabase/migrations/0025_roles_nomina.sql && git commit -m "feat(db): migracion 0025 roles de nomina, alcances y whoami_nomina"`

### Step 2: Helper de permisos puro `src/utils/permisos.js`

Matriz de acciones por rol (§ del plan maestro, tabla de la Fase 5G):

| Acción | Roles que pueden |
|---|---|
| `ver_legajos` | admin, rrhh, consulta, supervisor |
| `editar_legajos` | admin, rrhh |
| `ver_liquidacion` | admin, rrhh, consulta, supervisor |
| `calcular_liquidacion` | admin, rrhh |
| `enviar_a_aprobacion` | admin, rrhh |
| `aprobar` | admin, revisor_interno, revisor_externo |
| `aprobar_pago` | admin, aprobador_pagos |
| `emitir_recibos` | admin, rrhh |
| `exportar` | admin, rrhh |
| `ver_configuracion` | admin, rrhh |
| `editar_configuracion` | admin |
| `gestionar_usuarios` | admin |
| `ver_reportes` | admin, rrhh, aprobador_pagos |
| `ver_dashboard` | admin, rrhh, aprobador_pagos, supervisor, consulta |

- [ ] **Step 2.1: Test que falla**

```js
// src/utils/__tests__/permisos.test.js
import { describe, it, expect } from 'vitest'
import { puede } from '../permisos'

describe('puede', () => {
  it('admin puede todo lo que hay en la matriz', () => {
    const roles = [{ rol: 'admin' }]
    expect(puede(roles, 'gestionar_usuarios')).toBe(true)
    expect(puede(roles, 'editar_configuracion')).toBe(true)
    expect(puede(roles, 'aprobar_pago')).toBe(true)
  })

  it('rrhh no puede gestionar usuarios ni aprobar', () => {
    const roles = [{ rol: 'rrhh' }]
    expect(puede(roles, 'calcular_liquidacion')).toBe(true)
    expect(puede(roles, 'gestionar_usuarios')).toBe(false)
    expect(puede(roles, 'aprobar')).toBe(false)
  })

  it('revisor_externo solo puede aprobar', () => {
    const roles = [{ rol: 'revisor_externo' }]
    expect(puede(roles, 'aprobar')).toBe(true)
    expect(puede(roles, 'ver_legajos')).toBe(false)
    expect(puede(roles, 'ver_liquidacion')).toBe(false)
  })

  it('consulta solo lee, nunca exporta ni edita', () => {
    const roles = [{ rol: 'consulta' }]
    expect(puede(roles, 'ver_legajos')).toBe(true)
    expect(puede(roles, 'ver_liquidacion')).toBe(true)
    expect(puede(roles, 'exportar')).toBe(false)
    expect(puede(roles, 'editar_legajos')).toBe(false)
  })

  it('usuario con varios roles obtiene la union de permisos', () => {
    const roles = [{ rol: 'rrhh' }, { rol: 'aprobador_pagos' }]
    expect(puede(roles, 'calcular_liquidacion')).toBe(true)
    expect(puede(roles, 'aprobar_pago')).toBe(true)
  })

  it('sin roles, no puede nada', () => {
    expect(puede([], 'ver_dashboard')).toBe(false)
    expect(puede(null, 'ver_dashboard')).toBe(false)
  })
})
```

- [ ] **Step 2.2:** Run `npx vitest run src/utils/__tests__/permisos.test.js` → Expected: FAIL (módulo no existe).

- [ ] **Step 2.3: Implementación mínima**

```js
// src/utils/permisos.js
// Matriz de acciones por rol de Nómina. Único punto de verdad del lado del
// cliente para gating de UI (Sidebar, ProtectedRoute, botones) — el
// gating real de datos vive en RLS (migración 0026); esto es SOLO para no
// mostrar botones/rutas que igual fallarían en el servidor.
const MATRIZ = {
  ver_legajos: ['admin', 'rrhh', 'consulta', 'supervisor'],
  editar_legajos: ['admin', 'rrhh'],
  ver_liquidacion: ['admin', 'rrhh', 'consulta', 'supervisor'],
  calcular_liquidacion: ['admin', 'rrhh'],
  enviar_a_aprobacion: ['admin', 'rrhh'],
  aprobar: ['admin', 'revisor_interno', 'revisor_externo'],
  aprobar_pago: ['admin', 'aprobador_pagos'],
  emitir_recibos: ['admin', 'rrhh'],
  exportar: ['admin', 'rrhh'],
  ver_configuracion: ['admin', 'rrhh'],
  editar_configuracion: ['admin'],
  gestionar_usuarios: ['admin'],
  ver_reportes: ['admin', 'rrhh', 'aprobador_pagos'],
  ver_dashboard: ['admin', 'rrhh', 'aprobador_pagos', 'supervisor', 'consulta'],
}

// rolesNomina: array de filas { rol, alcance_tipo?, alcance_id? } (la
// forma que devuelve whoami_nomina()). Un usuario puede tener más de un
// rol: el resultado es la union de lo que cada rol individual permite.
export function puede(rolesNomina, accion) {
  const permitidos = MATRIZ[accion]
  if (!permitidos || !Array.isArray(rolesNomina)) return false
  return rolesNomina.some((r) => permitidos.includes(r.rol))
}
```

- [ ] **Step 2.4:** Run → Expected: PASS (6 tests). Commit: `git add src/utils/permisos.js src/utils/__tests__/permisos.test.js && git commit -m "feat(roles): matriz de permisos puede(rolesNomina, accion)"`

### Step 3: `authStore.js` carga `rolesNomina` vía `whoami_nomina()`

- [ ] **Step 3.1: Test que falla** (leer primero `src/store/__tests__/authStore.test.js` completo para matchear el mock de `supabase` ya usado ahí antes de escribir este caso):

```js
// agregar a src/store/__tests__/authStore.test.js
it('cargarSesion resuelve rolesNomina via whoami_nomina()', async () => {
  vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
    data: { session: { user: { id: 'u1', email: 'a@a.com', user_metadata: {} } } },
  })
  vi.spyOn(supabase, 'rpc').mockImplementation((fn) => {
    if (fn === 'whoami') return { single: () => Promise.resolve({ data: { rol: 'admin', empresa_id: 'e1' } }) }
    if (fn === 'whoami_nomina') return Promise.resolve({ data: [{ rol: 'rrhh', alcance_tipo: 'empresa', alcance_id: null, empresa_id: 'e1' }], error: null })
    return { single: () => Promise.resolve({ data: null }) }
  })
  await useAuthStore.getState().cargarSesion()
  expect(useAuthStore.getState().rolesNomina).toEqual([{ rol: 'rrhh', alcance_tipo: 'empresa', alcance_id: null, empresa_id: 'e1' }])
})
```

  Adaptar el mock exacto de `supabase.rpc`/`supabase.auth.getSession` a como ya esté mockeado en el archivo real — el snippet de arriba asume el patrón más común (`vi.spyOn`), pero si el archivo usa `vi.mock('../../lib/supabase', ...)` con `vi.fn()`, seguir ese mismo patrón en vez de mezclarlos.

- [ ] **Step 3.2:** Run → Expected: FAIL (`rolesNomina` no existe en el store).

- [ ] **Step 3.3: Implementación.** En `src/store/authStore.js`:
  - Agregar `rolesNomina: []` al estado inicial.
  - En `_resolverPerfil`, después de resolver `perfil` de `whoami()`, agregar una llamada a `whoami_nomina()` y devolver `rolesNomina` como parte del objeto que retorna:

```js
_resolverPerfil: async (user) => {
  const meta = user.user_metadata || {}
  let rol = meta.rol || null
  let empresaId = meta.empresa_id || null
  let rolesNomina = []
  try {
    const { data: perfil } = await supabase.rpc('whoami').single()
    if (perfil) {
      rol = perfil.rol || rol
      empresaId = perfil.empresa_id ?? empresaId
    }
  } catch {
    // sin red o RPC no disponible: se usa el fallback de metadata
  }
  try {
    const { data: roles } = await supabase.rpc('whoami_nomina')
    rolesNomina = roles || []
  } catch {
    // sin red o RPC no disponible: sin roles de nomina (gating cierra todo)
  }
  return {
    usuario: { id: user.id, email: user.email, nombre: meta.nombre || user.email.split('@')[0] },
    rol,
    rolesNomina,
    empresa: empresaId ? { id: empresaId } : null,
  }
},
```

  - En `login`, `cargarSesion`, y `logout` (reset a `[]`), incluir `rolesNomina` en los `set({...})` correspondientes (login/cargarSesion ya hacen spread de `...perfil`, así que se propaga solo; en `logout` agregar `rolesNomina: []` explícito).

- [ ] **Step 3.4:** Run `npx vitest run src/store/__tests__/authStore.test.js` → PASS. Commit: `git add src/store/authStore.js src/store/__tests__/authStore.test.js && git commit -m "feat(roles): authStore carga rolesNomina via whoami_nomina()"`

### Step 4: Edge Function `invitar-usuario` (Auth Admin API)

**Importante:** esta función envía un email real vía Supabase Auth cuando se invoca. El código se implementa y se deja listo, pero **no se prueba contra una casilla real** en este flujo — la primera invitación real la dispara el usuario desde la UI, cuando esté conforme.

```ts
// supabase/functions/invitar-usuario/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Invita un usuario nuevo por email (Supabase Auth Admin API — requiere
// SERVICE_ROLE_KEY, por eso vive en una Edge Function y no se puede llamar
// desde el cliente) y lo vincula a nom_usuarios_empresas con el rol/alcance
// elegidos. Si el email ya existe en Auth, se omite el invite y solo se
// crea el vínculo (no falla: es el caso "vincular usuario existente").
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email, empresaId, rol, alcanceTipo, alcanceId } = await req.json()
    if (!email || !empresaId || !rol) {
      return new Response(JSON.stringify({ error: 'faltan email, empresaId o rol' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Verifica quién llama y que sea admin/superadmin de la empresa destino
    // — sin esto, cualquier usuario autenticado podría invitar a cualquier
    // rol en cualquier empresa con solo conocer el endpoint.
    const authHeader = req.headers.get('Authorization') ?? ''
    const { data: userData, error: errUser } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (errUser || !userData?.user) {
      return new Response(JSON.stringify({ error: 'no autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: esAdmin } = await supabase.rpc('has_rol_nomina', { roles: ['admin'] })
    if (!esAdmin) {
      return new Response(JSON.stringify({ error: 'requiere rol admin' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let usuarioId: string
    const { data: existentes } = await supabase.auth.admin.listUsers()
    const existente = existentes?.users?.find((u: any) => u.email === email)
    if (existente) {
      usuarioId = existente.id
    } else {
      const { data: invitado, error: errInvite } = await supabase.auth.admin.inviteUserByEmail(email)
      if (errInvite || !invitado?.user) {
        return new Response(JSON.stringify({ error: `no se pudo invitar: ${errInvite?.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      usuarioId = invitado.user.id
    }

    const { error: errVinculo } = await supabase.from('nom_usuarios_empresas').upsert({
      usuario_id: usuarioId, empresa_id: empresaId, rol,
      alcance_tipo: alcanceTipo || 'empresa', alcance_id: alcanceId || null,
    }, { onConflict: 'usuario_id,empresa_id,rol' })
    if (errVinculo) {
      return new Response(JSON.stringify({ error: `usuario invitado pero no se pudo vincular: ${errVinculo.message}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, usuarioId, yaExistia: Boolean(existente) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
```

- [ ] Commit: `git add supabase/functions/invitar-usuario/index.ts && git commit -m "feat(usuarios): edge function invitar-usuario con Auth Admin API"`
- [ ] Recordar al usuario: requiere `supabase functions deploy invitar-usuario`, y que la casilla de origen de las invitaciones se configura en el panel de Supabase (Auth → Email Templates) — no algo que este código controle.

### Step 5: `src/store/usuariosStore.js`

- [ ] **Step 5.1: Test que falla**

```js
// src/store/__tests__/usuariosStore.test.js
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'v1', usuario_id: 'u1', empresa_id: 'e1', rol: 'rrhh', alcance_tipo: 'empresa', alcance_id: null }],
        error: null,
      }),
      delete: vi.fn().mockReturnThis(),
    })),
    functions: { invoke: vi.fn().mockResolvedValue({ data: { ok: true, usuarioId: 'u2' }, error: null }) },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  },
}))

import { useUsuariosStore, usuarioEmpresaFromDB } from '../usuariosStore'

describe('usuarioEmpresaFromDB', () => {
  it('mapea snake_case a camelCase', () => {
    const row = { id: 'v1', usuario_id: 'u1', empresa_id: 'e1', rol: 'rrhh', alcance_tipo: 'empresa', alcance_id: null }
    expect(usuarioEmpresaFromDB(row)).toEqual({
      id: 'v1', usuarioId: 'u1', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null,
    })
  })
})

describe('useUsuariosStore', () => {
  it('cargarUsuarios trae y mapea los vinculos de la empresa', async () => {
    await useUsuariosStore.getState().cargarUsuarios('e1')
    expect(useUsuariosStore.getState().usuarios).toEqual([
      { id: 'v1', usuarioId: 'u1', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null },
    ])
  })

  it('invitarUsuario invoca la edge function y devuelve ok', async () => {
    const r = await useUsuariosStore.getState().invitarUsuario({
      email: 'nuevo@x.com', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null,
    })
    expect(r.ok).toBe(true)
  })
})
```

- [ ] **Step 5.2:** Run → FAIL (módulo no existe).

- [ ] **Step 5.3: Implementación**

```js
// src/store/usuariosStore.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const usuarioEmpresaFromDB = (r) => ({
  id: r.id, usuarioId: r.usuario_id, empresaId: r.empresa_id,
  rol: r.rol, alcanceTipo: r.alcance_tipo, alcanceId: r.alcance_id,
})

export const useUsuariosStore = create((set) => ({
  usuarios: [], cargando: false, error: null,

  cargarUsuarios: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_usuarios_empresas').select('*')
      .eq('empresa_id', empresaId).order('rol')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ usuarios: (data || []).map(usuarioEmpresaFromDB), cargando: false })
  },

  // Invita (o vincula, si el email ya existe en Auth) un usuario a la
  // empresa con el rol/alcance elegidos. Corre server-side (Edge Function
  // invitar-usuario) porque requiere el Service Role Key de Supabase Auth.
  invitarUsuario: async ({ email, empresaId, rol, alcanceTipo, alcanceId }) => {
    const { data, error } = await supabase.functions.invoke('invitar-usuario', {
      body: { email, empresaId, rol, alcanceTipo, alcanceId },
    })
    if (error) return { ok: false, error: error.message }
    if (data?.error) return { ok: false, error: data.error }
    return { ok: true, usuarioId: data.usuarioId, yaExistia: data.yaExistia }
  },

  quitarRol: async (vinculoId) => {
    const { error } = await supabase.from('nom_usuarios_empresas').delete().eq('id', vinculoId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}))
```

- [ ] **Step 5.4:** Run → PASS. Commit: `git add src/store/usuariosStore.js src/store/__tests__/usuariosStore.test.js && git commit -m "feat(usuarios): store de ABM de usuarios (cargar, invitar, quitar rol)"`

### Step 6: `UsuariosPage.jsx`

- [ ] **Step 6.1: Test que falla**

```jsx
// src/pages/__tests__/UsuariosPage.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UsuariosPage from '../UsuariosPage'

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector) => selector({ empresa: { id: 'e1' }, empresaVista: null }),
}))

const invitarUsuario = vi.fn().mockResolvedValue({ ok: true, usuarioId: 'u2' })
const cargarUsuarios = vi.fn()
vi.mock('../../store/usuariosStore', () => ({
  useUsuariosStore: () => ({
    usuarios: [{ id: 'v1', usuarioId: 'u1', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null }],
    cargando: false, error: null, cargarUsuarios, invitarUsuario, quitarRol: vi.fn(),
  }),
}))

describe('UsuariosPage', () => {
  it('lista los usuarios vinculados con su rol', () => {
    render(<UsuariosPage />)
    expect(screen.getByText('rrhh')).toBeInTheDocument()
  })

  it('invita un usuario nuevo por email con el rol elegido', async () => {
    render(<UsuariosPage />)
    fireEvent.change(screen.getByPlaceholderText('email@empresa.com'), { target: { value: 'nuevo@x.com' } })
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByText('Invitar'))
    await waitFor(() => expect(invitarUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'nuevo@x.com', empresaId: 'e1', rol: 'admin' })
    ))
  })
})
```

- [ ] **Step 6.2:** Run → FAIL.

- [ ] **Step 6.3: Implementación**

```jsx
// src/pages/UsuariosPage.jsx
import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useUsuariosStore } from '../store/usuariosStore'

const ROLES = ['admin', 'rrhh', 'revisor_interno', 'aprobador_pagos', 'revisor_externo', 'supervisor', 'consulta']

export default function UsuariosPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const empresaActiva = empresa || empresaVista
  const { usuarios, cargando, error, cargarUsuarios, invitarUsuario, quitarRol } = useUsuariosStore()

  const [email, setEmail] = useState('')
  const [rol, setRol] = useState('rrhh')
  const [invitando, setInvitando] = useState(false)
  const [errorInvitar, setErrorInvitar] = useState('')
  const [mensaje, setMensaje] = useState('')

  useEffect(() => { if (empresaActiva?.id) cargarUsuarios(empresaActiva.id) }, [empresaActiva?.id])

  const handleInvitar = async () => {
    setErrorInvitar(''); setMensaje(''); setInvitando(true)
    const r = await invitarUsuario({ email: email.trim(), empresaId: empresaActiva.id, rol, alcanceTipo: 'empresa', alcanceId: null })
    setInvitando(false)
    if (!r.ok) { setErrorInvitar(r.error); return }
    setMensaje(r.yaExistia ? 'Usuario vinculado (ya tenía cuenta).' : 'Invitación enviada por email.')
    setEmail('')
    cargarUsuarios(empresaActiva.id)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Usuarios</h1>
        <p className="page-subtitle">Roles y accesos de la empresa</p>
      </div>

      {!empresaActiva && <div className="card">Elegí una empresa en Superadmin → "Entrar" para gestionar usuarios.</div>}

      {empresaActiva && (
        <>
          <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" placeholder="email@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: 260 }} />
            <select className="input" aria-label="Rol" value={rol} onChange={(e) => setRol(e.target.value)} style={{ maxWidth: 200 }}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={handleInvitar} disabled={!email.trim() || invitando}>
              {invitando ? 'Invitando…' : 'Invitar'}
            </button>
          </div>
          {errorInvitar && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{errorInvitar}</div>}
          {mensaje && <div className="card" style={{ marginBottom: '1rem' }}>{mensaje}</div>}
          {error && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error: {error}</div>}

          {cargando ? <div className="card">Cargando…</div> : (
            <div className="card table-scroll">
              <table className="table">
                <thead><tr><th>Usuario</th><th>Rol</th><th>Alcance</th><th></th></tr></thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u.id}>
                      <td>{u.usuarioId.slice(0, 8)}</td>
                      <td>{u.rol}</td>
                      <td>{u.alcanceTipo}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={async () => { await quitarRol(u.id); cargarUsuarios(empresaActiva.id) }}>
                          Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 6.4:** Run → PASS. Commit: `git add src/pages/UsuariosPage.jsx src/pages/__tests__/UsuariosPage.test.jsx && git commit -m "feat(usuarios): pantalla de ABM con invitacion por email"`

### Step 7: Enganchar la ruta real

- [ ] Leer `src/App.jsx` completo. Reemplazar `<Route path="usuarios" element={<ProximamentePage titulo="Usuarios" />} />` por `<Route path="usuarios" element={<UsuariosPage />} />`, importando `UsuariosPage` desde `./pages/UsuariosPage`. Si el archivo usa lazy-loading (`React.lazy`) para otras páginas, seguir el mismo patrón en vez de un import estático directo.
- [ ] `npx vitest run` completo → PASS, sin regresiones vs. baseline (146 + los nuevos tests de este Task). Commit: `git add src/App.jsx && git commit -m "feat(usuarios): habilitar ruta /usuarios real"`

---

## Task 29: Gating de UI por rol

**Regla de oro (diseño §2.3): "Permisos backend = permisos UI. Nunca solo control de UI."** Esta tarea es SOLO el lado del cliente (ocultar/deshabilitar); el lado servidor (RLS reforzada con `has_rol_nomina`) queda para una migración `0026_rls_roles.sql` en una vuelta siguiente — no se incluye acá para no mezclar un cambio de UI con uno de seguridad de datos en el mismo commit/revisión. Advertir esto explícitamente al usuario al cerrar esta tarea.

**Files:**
- Modify: `src/components/Sidebar.jsx` (filtrar `NAV_ITEMS` con `puede()`)
- Create: `src/components/ProtectedRoute.jsx`
- Create: `src/components/__tests__/ProtectedRoute.test.jsx`
- Modify: `src/App.jsx` (envolver rutas sensibles con `ProtectedRoute`)
- Modify: `src/components/Sidebar.jsx` test si existe (buscar con `find src/components -iname "*sidebar*test*"`)

### Step 1: `ProtectedRoute.jsx`

- [ ] **Step 1.1: Test que falla**

```jsx
// src/components/__tests__/ProtectedRoute.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProtectedRoute from '../ProtectedRoute'

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector) => selector({ rolesNomina: [{ rol: 'rrhh' }] }),
}))

describe('ProtectedRoute', () => {
  it('renderiza los children si el usuario puede la accion', () => {
    render(
      <MemoryRouter>
        <ProtectedRoute accion="calcular_liquidacion"><div>Contenido</div></ProtectedRoute>
      </MemoryRouter>
    )
    expect(screen.getByText('Contenido')).toBeInTheDocument()
  })

  it('redirige (no renderiza children) si el usuario no puede', () => {
    render(
      <MemoryRouter>
        <ProtectedRoute accion="gestionar_usuarios"><div>Contenido</div></ProtectedRoute>
      </MemoryRouter>
    )
    expect(screen.queryByText('Contenido')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 1.2:** Run → FAIL.

- [ ] **Step 1.3: Implementación**

```jsx
// src/components/ProtectedRoute.jsx
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { puede } from '../utils/permisos'

// Envuelve una <Route element={...}> y redirige a "/" si el usuario no
// tiene ningun rol de nomina que permita `accion` (ver src/utils/permisos.js).
// Esto es gating de UI únicamente — la RLS del backend es la que
// realmente protege los datos (0026_rls_roles.sql).
export default function ProtectedRoute({ accion, children }) {
  const rolesNomina = useAuthStore((s) => s.rolesNomina)
  if (!puede(rolesNomina, accion)) return <Navigate to="/" replace />
  return children
}
```

- [ ] **Step 1.4:** Run → PASS. Commit: `git add src/components/ProtectedRoute.jsx src/components/__tests__/ProtectedRoute.test.jsx && git commit -m "feat(roles): ProtectedRoute redirige si el usuario no puede la accion"`

### Step 2: Filtrar `Sidebar.jsx` por rol

- [ ] **Step 2.1:** Leer `src/components/Sidebar.jsx` completo (ya listado arriba en el contexto de esta sesión) y buscar si existe un test (`find src/components -iname "*sidebar*"`). Si no existe test, crear `src/components/__tests__/Sidebar.test.jsx`:

```jsx
// src/components/__tests__/Sidebar.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from '../Sidebar'

vi.mock('../../store/authStore', () => ({
  useAuthStore: () => ({
    usuario: { email: 'a@a.com' }, rol: null, empresa: { id: 'e1' }, empresaVista: null,
    rolesNomina: [{ rol: 'revisor_externo' }], logout: vi.fn(), salirDeEmpresa: vi.fn(),
  }),
}))

describe('Sidebar', () => {
  it('revisor_externo solo ve Aprobaciones (y Dashboard/logout, siempre visibles)', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>)
    expect(screen.getByText('Aprobaciones')).toBeInTheDocument()
    expect(screen.queryByText('Legajos')).not.toBeInTheDocument()
    expect(screen.queryByText('Configuración')).not.toBeInTheDocument()
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2.2:** Run → FAIL (todavía se muestran todos los items).

- [ ] **Step 2.3: Implementación.** En `Sidebar.jsx`:
  - Importar `puede` desde `../utils/permisos`.
  - Agregar `accion` a cada entrada de `NAV_ITEMS` que corresponda restringir (Dashboard sin `accion` = siempre visible para cualquier usuario logueado):

```js
const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/legajos', icon: FileText, label: 'Legajos', accion: 'ver_legajos' },
  { to: '/liquidacion', icon: Calculator, label: 'Liquidación', accion: 'ver_liquidacion' },
  { to: '/aprobaciones', icon: CheckSquare, label: 'Aprobaciones', accion: 'aprobar' },
  { to: '/reportes', icon: BarChart3, label: 'Reportes', accion: 'ver_reportes' },
  { to: '/usuarios', icon: UserCog, label: 'Usuarios', accion: 'gestionar_usuarios' },
  { to: '/configuracion', icon: Settings, label: 'Configuración', accion: 'ver_configuracion' },
]
```

  - Dentro del componente, leer `rolesNomina` del store (`const { usuario, rol, empresa, empresaVista, rolesNomina, logout, salirDeEmpresa } = useAuthStore()`), y filtrar:

```js
const navItems = (rol === 'superadmin'
  ? [...NAV_ITEMS, { to: '/superadmin', icon: ShieldAlert, label: 'Superadmin', dividerBefore: true }]
  : NAV_ITEMS
).filter((item) => !item.accion || rol === 'superadmin' || puede(rolesNomina, item.accion))
```

  (superadmin sigue viendo todo, igual que hoy — el gating por `accion` es solo para usuarios de empresa).

- [ ] **Step 2.4:** Run → PASS. Suite completa `npx vitest run` → PASS, sin regresiones. Commit: `git add src/components/Sidebar.jsx src/components/__tests__/Sidebar.test.jsx && git commit -m "feat(roles): Sidebar filtra items de navegacion por permisos"`

### Step 3: Envolver rutas sensibles en `App.jsx`

- [ ] Leer `src/App.jsx` completo. Envolver con `<ProtectedRoute accion="...">` las rutas que correspondan, usando la misma tabla acción↔ruta de `NAV_ITEMS`:

```jsx
<Route path="legajos" element={<ProtectedRoute accion="ver_legajos"><LegajosPage /></ProtectedRoute>} />
<Route path="liquidacion" element={<ProtectedRoute accion="ver_liquidacion"><LiquidacionPage /></ProtectedRoute>} />
<Route path="aprobaciones" element={<ProtectedRoute accion="aprobar"><AprobacionesPage /></ProtectedRoute>} />
<Route path="reportes" element={<ProtectedRoute accion="ver_reportes"><ReportesPage /></ProtectedRoute>} />
<Route path="usuarios" element={<ProtectedRoute accion="gestionar_usuarios"><UsuariosPage /></ProtectedRoute>} />
<Route path="configuracion" element={<ProtectedRoute accion="ver_configuracion"><ConfiguracionPage /></ProtectedRoute>} />
```

  Adaptar a los nombres de import reales del archivo (rutas/paths pueden diferir levemente — leer antes de editar). No envolver `/` (Dashboard) ni `/superadmin` (esa ya tiene su propio chequeo de `rol === 'superadmin'`, verificar cómo lo hace `SuperAdminPage.jsx` antes de tocarla).

- [ ] `npx vitest run` completo → PASS. Commit: `git add src/App.jsx && git commit -m "feat(roles): proteger rutas sensibles con ProtectedRoute"`

---

## Verificación final de la sub-fase (Tasks 28-29)

- [ ] `npx vitest run` completo en verde, sin regresiones vs. la base previa (146 tests al cierre de la Fase 5B).
- [ ] Confirmar con el usuario que aplicó la migración `0025_roles_nomina.sql` y que corrió `supabase functions deploy invitar-usuario`.
- [ ] Prueba manual guiada: loguearse como un usuario con rol `rrhh` (asignado a mano en `nom_usuarios_empresas` si todavía no hay ABM probado) y confirmar que el Sidebar NO muestra "Usuarios" ni "Configuración" con roles que no correspondan; loguearse como `admin` y confirmar que sí.
- [ ] Nota para el usuario: la RLS de backend (`has_rol_nomina` aplicado a las tablas `nom_*`, migración `0026_rls_roles.sql`) queda pendiente — el gating de hoy es solo de UI. No usar esto en producción con datos reales de sueldos hasta cerrar esa migración (Fase 5H es el gate obligatorio antes de producción, según el plan maestro).
