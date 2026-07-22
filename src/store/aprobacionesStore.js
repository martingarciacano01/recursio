import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const instanciaFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, periodoId: r.periodo_id, flujoId: r.flujo_id,
  pasoActualId: r.paso_actual_id, estado: r.estado,
  periodo: r.nom_periodos ? { id: r.nom_periodos.id, tipo: r.nom_periodos.tipo, fechaDesde: r.nom_periodos.fecha_desde, fechaHasta: r.nom_periodos.fecha_hasta } : null,
  pasoActual: r.paso_actual ? { id: r.paso_actual.id, nombre: r.paso_actual.nombre, orden: r.paso_actual.orden, rolRequerido: r.paso_actual.rol_requerido } : null,
})

// No filtra por empresa_id: RLS ya devuelve solo las instancias visibles
// para el usuario (dueño/admin de su empresa, o revisor_externo/
// aprobador_pagos con acceso puente a varias empresas — nom_usuarios_empresas).
export const useAprobacionesStore = create((set) => ({
  instancias: [], cargando: false, error: null,

  cargarInstancias: async () => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_flujo_instancias')
      .select('*, nom_periodos(id, tipo, fecha_desde, fecha_hasta), paso_actual:nom_flujo_pasos!nom_flujo_instancias_paso_actual_id_fkey(id, nombre, orden, rol_requerido)')
      .eq('estado', 'en_progreso')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ instancias: (data || []).map(instanciaFromDB), cargando: false })
  },

  actuar: async (instanciaId, accion, comentario) => {
    const { error } = await supabase.rpc('avanzar_flujo', {
      p_instancia_id: instanciaId, p_accion: accion, p_comentario: comentario || null,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}))
