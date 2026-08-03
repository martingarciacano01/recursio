import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const usuarioEmpresaFromDB = (r) => ({
  id: r.id, usuarioId: r.usuario_id, empresaId: r.empresa_id,
  rol: r.rol, alcanceTipo: r.alcance_tipo, alcanceId: r.alcance_id, email: r.email ?? null,
})

export const useUsuariosStore = create((set) => ({
  usuarios: [], cargando: false, error: null,

  // Usa el RPC listar_usuarios_empresa (0056) en vez de un select directo:
  // nom_usuarios_empresas no guarda el email (vive en auth.users, que el
  // cliente no puede leer), así que sin esto la UI solo tenía el usuarioId
  // crudo para mostrar (Task 4.2).
  cargarUsuarios: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.rpc('listar_usuarios_empresa', { p_empresa_id: empresaId })
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
