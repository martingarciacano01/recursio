import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const flujoFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, nombre: r.nombre, activo: r.activo,
})

export const pasoFromDB = (r) => ({
  id: r.id, flujoId: r.flujo_id, orden: r.orden, nombre: r.nombre,
  rolRequerido: r.rol_requerido, esMasivo: r.es_masivo,
})

export const ROLES_PASO = [
  { value: 'revisor_interno', label: 'Revisor interno' },
  { value: 'revisor_externo', label: 'Revisor externo' },
  { value: 'aprobador_pagos', label: 'Aprobador de pagos' },
  { value: 'admin', label: 'Dueño/Admin de la empresa' },
]

export const useFlujosStore = create((set, get) => ({
  flujos: [], pasos: [], cargando: false, error: null,

  cargarFlujos: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_flujos').select('*, nom_flujo_pasos(*)')
      .eq('empresa_id', empresaId).order('nombre')
    if (error) { set({ error: error.message, cargando: false }); return }
    const flujos = (data || []).map(flujoFromDB)
    const pasos = (data || []).flatMap((f) => (f.nom_flujo_pasos || []).map(pasoFromDB))
      .sort((a, b) => a.orden - b.orden)
    set({ flujos, pasos, cargando: false })
  },

  crearFlujo: async (nombre, empresaId) => {
    const { data, error } = await supabase.from('nom_flujos').insert({ nombre, empresa_id: empresaId }).select().single()
    if (error) return { ok: false, error: error.message }
    await get().cargarFlujos(empresaId)
    return { ok: true, flujo: flujoFromDB(data) }
  },

  // filas: [{ nombre, rolRequerido, esMasivo }] en el orden deseado.
  // Reemplaza todos los pasos del flujo (borra y reinserta) — más simple
  // que un diff fino y el builder siempre manda la lista completa.
  guardarPasos: async (flujoId, filas, empresaId) => {
    const { error: errDel } = await supabase.from('nom_flujo_pasos').delete().eq('flujo_id', flujoId)
    if (errDel) return { ok: false, error: errDel.message }
    const rows = filas.map((f, i) => ({
      flujo_id: flujoId, orden: i + 1, nombre: f.nombre,
      rol_requerido: f.rolRequerido, es_masivo: f.esMasivo ?? true,
    }))
    if (rows.length > 0) {
      const { error } = await supabase.from('nom_flujo_pasos').insert(rows)
      if (error) return { ok: false, error: error.message }
    }
    await get().cargarFlujos(empresaId)
    return { ok: true }
  },

  iniciarFlujo: async (periodoId, flujoId) => {
    const { data, error } = await supabase.rpc('iniciar_flujo', { p_periodo_id: periodoId, p_flujo_id: flujoId })
    if (error) return { ok: false, error: error.message }
    return { ok: true, instanciaId: data }
  },
}))
