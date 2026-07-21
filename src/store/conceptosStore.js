import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const conceptoFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, convenioId: r.convenio_id, codigo: r.codigo, nombre: r.nombre,
  tipo: r.tipo, formula: r.formula, orden: r.orden, imprimible: r.imprimible,
  categorias: r.categorias ?? null, config: r.config ?? null,
  reglas: (r.nom_concepto_reglas || []).map((x) => ({ id: x.id, orden: x.orden, condicion: x.condicion, formula: x.formula })),
})

export const conceptoToDB = (c, empresaId) => ({
  empresa_id: empresaId, convenio_id: c.convenioId, codigo: c.codigo, nombre: c.nombre,
  tipo: c.tipo, formula: c.formula, orden: c.orden, imprimible: c.imprimible ?? true,
  categorias: c.categorias ?? null, config: c.config ?? null,
})

export const useConceptosStore = create((set) => ({
  conceptos: [], cargando: false, error: null,

  cargarConceptos: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_conceptos').select('*, nom_concepto_reglas(*)')
      .or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order('orden')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ conceptos: (data || []).map(conceptoFromDB), cargando: false })
  },

  guardarConcepto: async (concepto, empresaId) => {
    const row = conceptoToDB(concepto, empresaId)
    const query = concepto.id
      ? supabase.from('nom_conceptos').update(row).eq('id', concepto.id).select().single()
      : supabase.from('nom_conceptos').insert(row).select().single()
    const { data, error } = await query
    if (error) return { ok: false, error: error.message }
    await useConceptosStore.getState().cargarConceptos(empresaId)
    return { ok: true, concepto: conceptoFromDB(data) }
  },
}))
