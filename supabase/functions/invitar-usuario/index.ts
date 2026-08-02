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
    // Validación de formato: el body llega directo del cliente sin pasar
    // por RLS (esta función usa service_role recién más abajo), así que
    // nada garantiza que `email`/`rol` tengan una forma sensata antes de
    // esto — un email mal formado terminaría invitando a una dirección
    // rara, y un `rol` fuera de la lista rompería el CHECK constraint de
    // nom_usuarios_empresas (0025) con un error 500 poco claro.
    const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
    if (!EMAIL_REGEX.test(email)) {
      return new Response(JSON.stringify({ error: 'email inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const ROLES_VALIDOS = ['admin', 'rrhh', 'consulta', 'supervisor', 'revisor_interno', 'revisor_externo', 'aprobador_pagos']
    if (!ROLES_VALIDOS.includes(rol)) {
      return new Response(JSON.stringify({ error: 'rol inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Bug corregido (Fase 1, Task 1.4): las validaciones de abajo hacían
    // supabase.rpc(...) con el cliente SERVICE_ROLE, que no lleva el JWT
    // del llamante — dentro de esas funciones SQL, auth.uid() daba NULL y
    // has_rol_nomina() devolvía false SIEMPRE, sin importar el rol real
    // del usuario (403 permanente). Mismo patrón que liquidar-periodo
    // (Task 1.1): un cliente "auth" con el Authorization del llamante
    // para validar identidad/rol, y el cliente service_role reservado
    // para lo que de verdad lo necesita (Auth Admin API y el upsert final
    // — nom_usuarios_empresas tiene RLS y acá conviene no depender de que
    // el admin que invita también tenga permiso de escritura directa).
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Verifica quién llama y que sea admin/superadmin de la empresa destino
    // — sin esto, cualquier usuario autenticado podría invitar a cualquier
    // rol en cualquier empresa con solo conocer el endpoint.
    const { data: userData, error: errUser } = await supabaseAuth.auth.getUser()
    if (errUser || !userData?.user) {
      return new Response(JSON.stringify({ error: 'no autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { data: esAdmin } = await supabaseAuth.rpc('has_rol_nomina', { roles: ['admin'] })
    if (!esAdmin) {
      return new Response(JSON.stringify({ error: 'requiere rol admin' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // has_rol_nomina() solo prueba "soy admin de ALGUNA empresa" (la propia,
    // resuelta server-side vía auth_empresa_id()) — NO prueba que sea admin
    // de la empresa indicada en el body. Sin este chequeo, un admin de la
    // Empresa A podría mandar empresaId de la Empresa B y auto-otorgarse
    // (o a un tercero) el rol admin ahí. Superadmin sigue exceptuado, igual
    // que en el resto del código (ver 0008_superadmin_bypass.sql).
    const { data: esSuperadmin } = await supabaseAuth.rpc('is_superadmin')
    if (!esSuperadmin) {
      const { data: miEmpresaId } = await supabaseAuth.rpc('auth_empresa_id')
      if (!miEmpresaId || miEmpresaId !== empresaId) {
        return new Response(JSON.stringify({ error: 'no autorizado para esta empresa' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
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
