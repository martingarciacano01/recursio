// src/store/empresaConfigStore.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// CUIT/domicilio viven en nom_empresa_config (tabla satélite, ver migración
// 0021); nombre y logo se leen de `empresas` (compartida con Presencio,
// nunca se escribe acá — el logo lo administra Presencio/Superadmin).
export const useEmpresaConfigStore = create((set) => ({
  cuit: '', domicilio: '', nombre: '', logoUrl: null, cargando: false, error: null,

  cargar: async (empresaId) => {
    set({ cargando: true, error: null })
    const [{ data: config, error: e1 }, { data: empresa, error: e2 }] = await Promise.all([
      supabase.from('nom_empresa_config').select('*').eq('empresa_id', empresaId).maybeSingle(),
      supabase.from('empresas').select('nombre, logo_url').eq('id', empresaId).single(),
    ])
    if (e1 || e2) { set({ error: (e1 || e2).message, cargando: false }); return }
    set({
      cuit: config?.cuit || '', domicilio: config?.domicilio || '',
      nombre: empresa?.nombre || '', logoUrl: empresa?.logo_url || null,
      cargando: false,
    })
  },

  guardar: async (empresaId, { cuit, domicilio }) => {
    const { error } = await supabase.from('nom_empresa_config')
      .upsert({ empresa_id: empresaId, cuit, domicilio }, { onConflict: 'empresa_id' })
    if (error) return { ok: false, error: error.message }
    set({ cuit, domicilio })
    return { ok: true }
  },
}))
