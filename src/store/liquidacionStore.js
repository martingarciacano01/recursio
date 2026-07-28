import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const liquidacionFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, periodoId: r.periodo_id, personalId: r.personal_id,
  bruto: r.bruto, neto: r.neto, estado: r.estado,
  totalAportes: r.total_aportes ?? 0,
  totalContribuciones: r.total_contribuciones ?? 0,
  detalleHoras: r.detalle_horas || null,
  numeroRecibo: r.numero_recibo ?? null,
  hashPdf: r.hash_pdf ?? null,
  version: r.version ?? 1,
  anulado: r.anulado ?? false,
  motivoAnulacion: r.motivo_anulacion ?? null,
})

export const itemFromDB = (r) => ({
  id: r.id, liquidacionId: r.liquidacion_id, conceptoCodigo: r.concepto_codigo,
  conceptoNombre: r.concepto_nombre, tipo: r.tipo, monto: r.monto, reglaAplicada: r.regla_aplicada,
})

// Reintenta la Edge Function liquidar-periodo con reanudar:true mientras
// la respuesta indique completo:false (corte por timeout de la Edge
// Function con muchos empleados). Dos cortes:
//   - tope de 20 intentos (con lotes de ~50 personas por invocación cubre
//     1000 personas, el objetivo de la Decisión 10 del plan maestro);
//   - **falta de progreso**: si `procesados` no avanzó respecto del
//     intento anterior, reinvocar es tirar tiempo a la basura — la
//     función va a saltear exactamente a la misma gente. Sin este corte,
//     un período con personas omitidas (legajo incompleto) disparaba las
//     20 invocaciones completas, cada una releyendo toda la nómina: eso
//     era el "calcular tarda muchísimo" reportado el 28/07/2026.
async function invocarConReintento(body) {
  let respuesta = await supabase.functions.invoke('liquidar-periodo', { body })
  let intentos = 1
  let procesadosPrevios = respuesta.data?.procesados ?? -1
  while (!respuesta.error && respuesta.data?.completo === false && intentos < 20) {
    respuesta = await supabase.functions.invoke('liquidar-periodo', { body: { ...body, reanudar: true } })
    intentos += 1
    const procesados = respuesta.data?.procesados ?? -1
    if (procesados <= procesadosPrevios) break
    procesadosPrevios = procesados
  }
  return respuesta
}

// Store SIN persist: contiene montos de sueldo reales (Recursio_Plan_
// Ejecucion_Sonnet5.md, instrucción 6).
export const useLiquidacionStore = create((set) => ({
  liquidaciones: [], items: [], calculando: false, error: null,
  // Legajos que la Edge Function saltea (incompletos) y advertencias de
  // escala faltante por persona — nada de $0 silenciosos (Fase 5A Task 2).
  omitidos: [], advertencias: [],

  calcularPeriodo: async (periodoId) => {
    set({ calculando: true, error: null })
    const { data, error } = await invocarConReintento({ periodoId })
    if (error) {
      set({ error: error.message, calculando: false, omitidos: [], advertencias: [] })
      return { ok: false, error: error.message }
    }
    set({ calculando: false, omitidos: data?.omitidos ?? [], advertencias: data?.advertencias ?? [] })
    return { ok: true, data }
  },

  // Crea un período tipo 'final' acotado a una sola persona (fecha_desde =
  // fecha_hasta = fecha de baja) e invoca liquidar-periodo con
  // personalIds: [personalId] para no tocar al resto de la nómina
  // (Fase 5E Task 33 — botón "Generar liquidación final" en FichaLegajoPage).
  crearPeriodoFinal: async (personalId, fechaBaja, empresaId) => {
    const { data: periodo, error: errPeriodo } = await supabase.from('nom_periodos').insert({
      empresa_id: empresaId, tipo: 'final', fecha_desde: fechaBaja, fecha_hasta: fechaBaja, estado: 'abierto',
    }).select().single()
    if (errPeriodo) return { ok: false, error: errPeriodo.message }
    const { data, error } = await invocarConReintento({ periodoId: periodo.id, personalIds: [personalId] })
    if (error) {
      // Evita dejar un nom_periodos huérfano en estado 'abierto' sin
      // liquidaciones cuando la Edge Function falla (best-effort: si el
      // delete también falla, queda el mismo huérfano que había antes).
      await supabase.from('nom_periodos').delete().eq('id', periodo.id)
      return { ok: false, error: error.message }
    }
    if (data?.omitidos?.length > 0) return { ok: false, error: data.omitidos[0].motivo }
    return { ok: true, data }
  },

  cargarLiquidaciones: async (periodoId) => {
    // Guarda contra periodoId vacío: Postgres lo rechaza con "invalid input
    // syntax for type uuid" y el mensaje quedaba visible en la pantalla de
    // Liquidación como si el cálculo hubiera fallado.
    if (!periodoId) { set({ liquidaciones: [] }); return }
    const { data, error } = await supabase.from('nom_liquidaciones').select('*').eq('periodo_id', periodoId)
    if (error) { set({ error: error.message }); return }
    // Limpia el error previo: sin esto un error viejo (ej. un periodoId
    // vacío) quedaba pegado en pantalla para siempre, incluso sobre
    // resultados correctos de una corrida posterior.
    set({ liquidaciones: (data || []).map(liquidacionFromDB), error: null })
  },

  cargarItems: async (liquidacionId) => {
    const { data, error } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', liquidacionId)
    if (error) { set({ error: error.message }); return }
    set({ items: (data || []).map(itemFromDB) })
  },

  // Asigna numero_recibo (si no tenía) y guarda el hash del PDF entregado
  // (migración 0016, función emitir_recibo). Se llama después de generar
  // el PDF con jsPDF y calcularHashPdf (src/utils/reciboHash.js).
  emitirRecibo: async (liquidacionId, hashPdf) => {
    const { data, error } = await supabase.rpc('emitir_recibo', { p_liquidacion_id: liquidacionId, p_hash_pdf: hashPdf })
    if (error) return { ok: false, error: error.message }
    return { ok: true, numeroRecibo: data }
  },

  // Anula la liquidación (auditoría, no borra). El caller es responsable
  // de crear la v+1 con liquidacionAnteriorId si corresponde reliquidar.
  anularLiquidacion: async (liquidacionId, motivo) => {
    const { error } = await supabase.rpc('anular_liquidacion', { p_liquidacion_id: liquidacionId, p_motivo: motivo })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}))
