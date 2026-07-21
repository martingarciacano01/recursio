import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const convenioFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, nombre: r.nombre, regimen: r.regimen, descripcion: r.descripcion,
})

export const useConveniosStore = create((set) => ({
  convenios: [], cargando: false, error: null,

  cargarConvenios: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_convenios').select('*')
      .or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order('nombre')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ convenios: (data || []).map(convenioFromDB), cargando: false })
  },

  // Clona un convenio global a la empresa (función SQL SECURITY DEFINER,
  // migración 0012/0013). Devuelve el id del convenio propio. empresaId es
  // necesario cuando lo ejecuta un Superadmin "viendo como" una empresa
  // (auth_empresa_id() da NULL para él); para un usuario normal se ignora
  // del lado del servidor.
  clonarConvenio: async (convenioGlobalId, empresaId) => {
    const { data, error } = await supabase.rpc('clonar_convenio', {
      convenio_global_id: convenioGlobalId, p_empresa_id: empresaId ?? null,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, convenioId: data }
  },
}))
