import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const liquidacionFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, periodoId: r.periodo_id, personalId: r.personal_id,
  bruto: r.bruto, neto: r.neto, estado: r.estado,
  totalAportes: r.total_aportes ?? 0,
  totalContribuciones: r.total_contribuciones ?? 0,
  detalleHoras: r.detalle_horas || null,
})

export const itemFromDB = (r) => ({
  id: r.id, liquidacionId: r.liquidacion_id, conceptoCodigo: r.concepto_codigo,
  conceptoNombre: r.concepto_nombre, tipo: r.tipo, monto: r.monto, reglaAplicada: r.regla_aplicada,
})

// Store SIN persist: contiene montos de sueldo reales (Recursio_Plan_
// Ejecucion_Sonnet5.md, instrucción 6).
export const useLiquidacionStore = create((set) => ({
  liquidaciones: [], items: [], calculando: false, error: null,

  calcularPeriodo: async (periodoId) => {
    set({ calculando: true, error: null })
    const { data, error } = await supabase.functions.invoke('liquidar-periodo', { body: { periodoId } })
    if (error) { set({ error: error.message, calculando: false }); return { ok: false, error: error.message } }
    set({ calculando: false })
    return { ok: true, data }
  },

  cargarLiquidaciones: async (periodoId) => {
    const { data, error } = await supabase.from('nom_liquidaciones').select('*').eq('periodo_id', periodoId)
    if (error) { set({ error: error.message }); return }
    set({ liquidaciones: (data || []).map(liquidacionFromDB) })
  },

  cargarItems: async (liquidacionId) => {
    const { data, error } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', liquidacionId)
    if (error) { set({ error: error.message }); return }
    set({ items: (data || []).map(itemFromDB) })
  },
}))
