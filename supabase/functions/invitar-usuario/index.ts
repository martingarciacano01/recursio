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

    // has_rol_nomina() solo prueba "soy admin de ALGUNA empresa" (la propia,
    // resuelta server-side vía auth_empresa_id()) — NO prueba que sea admin
    // de la empresa indicada en el body. Sin este chequeo, un admin de la
    // Empresa A podría mandar empresaId de la Empresa B y auto-otorgarse
    // (o a un tercero) el rol admin ahí. Superadmin sigue exceptuado, igual
    // que en el resto del código (ver 0008_superadmin_bypass.sql).
    const { data: esSuperadmin } = await supabase.rpc('is_superadmin')
    if (!esSuperadmin) {
      const { data: miEmpresaId } = await supabase.rpc('auth_empresa_id')
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
