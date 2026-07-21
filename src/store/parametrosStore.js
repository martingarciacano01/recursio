import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const parametroFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, codigo: r.codigo, valor: Number(r.valor),
  vigenciaDesde: r.vigencia_desde, vigenciaHasta: r.vigencia_hasta,
})

export const parametroToDB = (p, empresaId) => ({
  empresa_id: empresaId, codigo: p.codigo, valor: p.valor,
  vigencia_desde: p.vigenciaDesde, vigencia_hasta: p.vigenciaHasta ?? null,
})

export const useParametrosStore = create((set, get) => ({
  parametros: [], cargando: false, error: null,

  cargarParametros: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_parametros').select('*')
      .eq('empresa_id', empresaId).order('codigo').order('vigencia_desde', { ascending: false })
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ parametros: (data || []).map(parametroFromDB), cargando: false })
  },

  // Versionado: siempre INSERT de una vigencia nueva, nunca UPDATE.
  guardarParametro: async (parametro, empresaId) => {
    const { error } = await supabase.from('nom_parametros').insert(parametroToDB(parametro, empresaId))
    if (error) return { ok: false, error: error.message }
    await get().cargarParametros(empresaId)
    return { ok: true }
  },
}))
