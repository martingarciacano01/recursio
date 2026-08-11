import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Toggles por empresa de las funcionalidades del plan convenios-por-obra
// (2026-08-07): migración 0063. Sin `persist` (regla del proyecto para
// datos que gatean flujos salariales). `features` es un Map<feature, boolean>
// — sin fila en la tabla, la feature está apagada (no en el Map -> false).
export const FEATURES = {
  CONVENIOS_POR_OBRA: 'convenios_por_obra',
  TOPES_HORAS_POR_OBRA: 'topes_horas_por_obra',
  AJUSTE_HORAS_PERIODO: 'ajuste_horas_periodo',
  BONOS_NO_REMUNERATIVOS: 'bonos_no_remunerativos',
}

export const useEmpresaFeaturesStore = create((set, get) => ({
  features: {}, // { [empresaId]: { [feature]: boolean } }
  cargando: false,
  error: null,

  cargarFeatures: async (empresaId) => {
    if (!empresaId) return
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_empresa_features')
      .select('feature, activo').eq('empresa_id', empresaId)
    if (error) { set({ error: error.message, cargando: false }); return }
    const mapa = Object.fromEntries((data || []).map((f) => [f.feature, f.activo]))
    set((s) => ({ features: { ...s.features, [empresaId]: mapa }, cargando: false }))
  },

  tieneFeature: (empresaId, feature) => !!get().features[empresaId]?.[feature],

  // Solo superadmin puede escribir (RLS lo exige igual del lado del
  // servidor): habilita/deshabilita una feature para una empresa puntual.
  setFeature: async (empresaId, feature, activo) => {
    const { error } = await supabase.from('nom_empresa_features')
      .upsert({ empresa_id: empresaId, feature, activo }, { onConflict: 'empresa_id,feature' })
    if (error) return { ok: false, error: error.message }
    set((s) => ({
      features: { ...s.features, [empresaId]: { ...(s.features[empresaId] || {}), [feature]: activo } },
    }))
    return { ok: true }
  },
}))
