import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const noRemFromDB = (r) => ({
  id: r.id, convenioId: r.convenio_id, nombre: r.categoria_nombre, valor: Number(r.monto), vigenciaDesde: r.vigencia_desde,
})

export const useNoRemunerativosStore = create((set) => ({
  noRemunerativos: [], cargando: false, error: null,

  cargarNoRemunerativos: async (convenioId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_no_remunerativos').select('*')
      .eq('convenio_id', convenioId).order('categoria_nombre').order('vigencia_desde', { ascending: false })
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ noRemunerativos: (data || []).map(noRemFromDB), cargando: false })
  },

  guardarVigencias: async (convenioId, filas, vigenciaDesde) => {
    const rows = filas.map((f) => ({
      convenio_id: convenioId, categoria_nombre: f.nombre, monto: f.valor, vigencia_desde: vigenciaDesde,
    }))
    const { error } = await supabase.from('nom_no_remunerativos').insert(rows)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}))
