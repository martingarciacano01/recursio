import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const conceptoFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, convenioId: r.convenio_id, codigo: r.codigo, nombre: r.nombre,
  tipo: r.tipo, formula: r.formula, orden: r.orden, imprimible: r.imprimible,
  categorias: r.categorias ?? null, config: r.config ?? null, codigoRecibo: r.codigo_recibo ?? null,
  asignacion: r.asignacion ?? 'categoria',
  reglas: (r.nom_concepto_reglas || []).map((x) => ({ id: x.id, orden: x.orden, condicion: x.condicion, formula: x.formula })),
})

export const conceptoToDB = (c, empresaId) => ({
  empresa_id: empresaId, convenio_id: c.convenioId, codigo: c.codigo, nombre: c.nombre,
  tipo: c.tipo, formula: c.formula, orden: c.orden, imprimible: c.imprimible ?? true,
  categorias: c.categorias ?? null, config: c.config ?? null, codigo_recibo: c.codigoRecibo ?? null,
  asignacion: c.asignacion ?? 'categoria',
})

export const useConceptosStore = create((set, get) => ({
  conceptos: [], cargando: false, error: null, cargadoEmpresaId: null,

  cargarConceptos: async (empresaId, { forzar = false } = {}) => {
    if (!forzar && get().cargadoEmpresaId === empresaId && !get().error) return
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_conceptos').select('*, nom_concepto_reglas(*)')
      .or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order('orden')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ conceptos: (data || []).map(conceptoFromDB), cargando: false, cargadoEmpresaId: empresaId })
  },

  guardarConcepto: async (concepto, empresaId) => {
    const row = conceptoToDB(concepto, empresaId)
    const query = concepto.id
      ? supabase.from('nom_conceptos').update(row).eq('id', concepto.id).select().single()
      : supabase.from('nom_conceptos').insert(row).select().single()
    const { data, error } = await query
    if (error) return { ok: false, error: error.message }
    await useConceptosStore.getState().cargarConceptos(empresaId, { forzar: true })
    return { ok: true, concepto: conceptoFromDB(data) }
  },
}))
