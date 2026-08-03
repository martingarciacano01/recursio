import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const instanciaFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, periodoId: r.periodo_id, flujoId: r.flujo_id,
  pasoActualId: r.paso_actual_id, estado: r.estado,
  periodo: r.nom_periodos ? { id: r.nom_periodos.id, tipo: r.nom_periodos.tipo, fechaDesde: r.nom_periodos.fecha_desde, fechaHasta: r.nom_periodos.fecha_hasta } : null,
  pasoActual: r.paso_actual ? { id: r.paso_actual.id, nombre: r.paso_actual.nombre, orden: r.paso_actual.orden, rolRequerido: r.paso_actual.rol_requerido } : null,
})

// reciboFromDB (Task 4.1): un recibo individual (fila de nom_liquidaciones)
// dentro de un período en revisión. estado_revision/motivo_rechazo son
// independientes del estado del período (nom_flujo_instancias) — ver
// spec docs/superpowers/specs/2026-08-03-aprobaciones-detalle-rechazo-individual-design.md.
export const reciboFromDB = (r) => ({
  id: r.id, periodoId: r.periodo_id, personalId: r.personal_id,
  bruto: r.bruto ?? 0, totalAportes: r.total_aportes ?? 0, neto: r.neto ?? 0,
  detalleHoras: r.detalle_horas || null,
  estadoRevision: r.estado_revision, motivoRechazo: r.motivo_rechazo ?? null,
})

const agregadosVacios = { bruto: 0, totalAportes: 0, neto: 0, cantidad: 0 }

// No filtra por empresa_id: RLS ya devuelve solo las instancias visibles
// para el usuario (dueño/admin de su empresa, o revisor_externo/
// aprobador_pagos con acceso puente a varias empresas — nom_usuarios_empresas).
export const useAprobacionesStore = create((set) => ({
  instancias: [], recibosPorPeriodo: {}, agregadosPorPeriodo: {}, personalPorId: {},
  cargando: false, error: null,

  // empresaId (Task 3.4, M9): sin este filtro, un usuario con acceso puente
  // a varias empresas (revisor_externo/aprobador_pagos vía
  // nom_usuarios_empresas) veía en una sola lista las instancias
  // pendientes de TODAS las empresas a las que tiene acceso, mezcladas —
  // acá filtramos por la empresa activa en pantalla (empresa fija o
  // empresaVista si es Superadmin operando "como" otra empresa).
  cargarInstancias: async (empresaId) => {
    if (!empresaId) { set({ instancias: [], recibosPorPeriodo: {}, agregadosPorPeriodo: {}, personalPorId: {} }); return }
    set({ cargando: true, error: null })
    try {
      const { data, error } = await supabase.from('nom_flujo_instancias')
        .select('*, nom_periodos(id, tipo, fecha_desde, fecha_hasta), paso_actual:nom_flujo_pasos!nom_flujo_instancias_paso_actual_id_fkey(id, nombre, orden, rol_requerido)')
        .eq('estado', 'en_progreso')
        .eq('empresa_id', empresaId)
      if (error) { set({ error: error.message, cargando: false }); return }
      const instancias = (data || []).map(instanciaFromDB)

      // Task 4.1: además de las instancias, traer el detalle de recibos de
      // cada período (bruto/descuentos/neto/horas) para mostrar y para
      // poder revisar/rechazar por persona sin frenar el resto del
      // período — ver spec 2026-08-03. Agregados (sum/count) se calculan
      // acá en JS: son PyMEs, un período tiene a lo sumo unos cientos de
      // legajos, no se justifica un RPC de agregación (más superficie,
      // sin ganancia real de performance ni seguridad — RLS ya protege
      // esta misma query).
      const periodoIds = instancias.map((i) => i.periodoId)
      let recibosPorPeriodo = {}
      let agregadosPorPeriodo = {}
      let personalPorId = {}
      if (periodoIds.length > 0) {
        const { data: recibosData, error: errRecibos } = await supabase.from('nom_liquidaciones')
          .select('id, periodo_id, personal_id, bruto, total_aportes, neto, detalle_horas, estado_revision, motivo_rechazo')
          .in('periodo_id', periodoIds)
        if (errRecibos) { set({ error: errRecibos.message, cargando: false }); return }
        const recibos = (recibosData || []).map(reciboFromDB)

        for (const periodoId of periodoIds) { recibosPorPeriodo[periodoId] = []; agregadosPorPeriodo[periodoId] = { ...agregadosVacios } }
        for (const r of recibos) {
          recibosPorPeriodo[r.periodoId].push(r)
          const ag = agregadosPorPeriodo[r.periodoId]
          ag.bruto += r.bruto; ag.totalAportes += r.totalAportes; ag.neto += r.neto; ag.cantidad += 1
        }

        const personalIds = [...new Set(recibos.map((r) => r.personalId))]
        if (personalIds.length > 0) {
          const { data: personalData } = await supabase.from('nom_v_personal').select('id, nombre').in('id', personalIds)
          for (const p of (personalData || [])) personalPorId[p.id] = p.nombre
        }
      }

      set({ instancias, recibosPorPeriodo, agregadosPorPeriodo, personalPorId, cargando: false })
    } catch {
      // Caída de red (Task 3.3).
      set({ error: 'no se pudo contactar el servidor', cargando: false })
    }
  },

  actuar: async (instanciaId, accion, comentario) => {
    const { error } = await supabase.rpc('avanzar_flujo', {
      p_instancia_id: instanciaId, p_accion: accion, p_comentario: comentario || null,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },

  // revisarLiquidacion (Task 4.1): aprueba/rechaza el pago de UN recibo
  // sin tocar el resto del período. Sin refetch automático a propósito
  // (igual que `actuar`): la página decide cuándo recargar, para poder
  // encadenar varias revisiones en lote sin refrescar entre medio.
  revisarLiquidacion: async (liquidacionId, accion, comentario) => {
    const { error } = await supabase.rpc('revisar_liquidacion', {
      p_liquidacion_id: liquidacionId, p_accion: accion, p_comentario: comentario || null,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}))
