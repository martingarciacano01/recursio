import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { diasEnRango } from '../utils/agruparAusencias'

export const liquidacionFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, periodoId: r.periodo_id, personalId: r.personal_id,
  obraId: r.obra_id ?? null,
  // bruto/neto ?? 0 (Task 3.2, mappers defensivos): fila inesperada (o un
  // shape futuro que los omita) no debe filtrar undefined hacia formateos
  // de moneda río abajo (.toFixed(), etc.) que tirarían y romperían el
  // render entero.
  bruto: r.bruto ?? 0, neto: r.neto ?? 0, estado: r.estado,
  totalAportes: r.total_aportes ?? 0,
  totalContribuciones: r.total_contribuciones ?? 0,
  detalleHoras: r.detalle_horas || null,
  numeroRecibo: r.numero_recibo ?? null,
  hashPdf: r.hash_pdf ?? null,
  version: r.version ?? 1,
  anulado: r.anulado ?? false,
  motivoAnulacion: r.motivo_anulacion ?? null,
  // Fase 7 Task 7.4: se expone por liquidación el estado del flujo de su
  // período (el recibo "para el Empleado" solo se habilita si está en
  // 'aprobado'). El mapper default a false: sin flujo, no hay requisito
  // de aprobación que usar.
  periodoFlujoAprobado: !!r.periodo_flujo_aprobado,
})

export const itemFromDB = (r) => ({
  id: r.id, liquidacionId: r.liquidacion_id, conceptoCodigo: r.concepto_codigo,
  conceptoNombre: r.concepto_nombre, tipo: r.tipo, monto: r.monto ?? 0, reglaAplicada: r.regla_aplicada,
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
// El cliente de supabase-js (`functions.invoke`) colapsa CUALQUIER status
// no-2xx en el mismo error.message genérico ("Edge Function returned a
// non-2xx status code"), sin importar qué haya devuelto la función en el
// body — el bloqueo por recibos emitidos (Task 2.6, 409), "período no
// encontrado" (404), "sin permiso" (403), etc. todos se veían igual de
// "error del sistema". El body real (con el `error` legible que la Edge
// Function sí arma) viaja en `error.context`, un Response — hay que
// leerlo aparte. Ver https://github.com/supabase/supabase-js FunctionsHttpError.
async function mensajeDeErrorEdgeFunction(error) {
  if (!error) return null
  try {
    if (error.context && typeof error.context.json === 'function') {
      const body = await error.context.clone().json()
      if (body?.error) return body.error
    }
  } catch {
    // body no era JSON o ya se consumió: nos quedamos con error.message
  }
  return error.message
}

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
//
// Task 3.1 (race condition C1): cambiar de período mientras una respuesta
// anterior todavía está en vuelo podía pisar la pantalla con datos del
// período viejo si esa respuesta llegaba DESPUÉS de la del período nuevo
// (orden de red no garantizado). Mismo patrón en las 3 acciones que traen
// datos de un período/liquidación puntual: un contador `_seqX` propio por
// acción (no uno solo compartido — así calcularPeriodo y cargarLiquidaciones
// no se invalidan entre sí sin motivo), incrementado ANTES de arrancar el
// pedido; si al volver el contador ya cambió, la respuesta es obsoleta y se
// descarta sin tocar el estado.
export const useLiquidacionStore = create((set, get) => ({
  liquidaciones: [], items: [], calculando: false, error: null,
  // Legajos que la Edge Function saltea (incompletos) y advertencias de
  // escala faltante por persona — nada de $0 silenciosos (Fase 5A Task 2).
  omitidos: [], advertencias: [],
  // Personal sin fichajes ni ausencias aprobadas en el período: no se
  // liquida en $0 silenciosamente, se lista aparte (Fase 5A Task 2).
  sinHoras: [],
  _seqCalculo: 0, _seqLiq: 0, _seqItems: 0,

  calcularPeriodo: async (periodoId) => {
    const seq = get()._seqCalculo + 1
    set({ _seqCalculo: seq, calculando: true, error: null })
    try {
      const { data, error } = await invocarConReintento({ periodoId })
      if (get()._seqCalculo !== seq) return { ok: false, error: 'obsoleto' } // se pidió calcular otro período mientras esta respuesta viajaba
      if (error) {
        const mensaje = await mensajeDeErrorEdgeFunction(error)
        if (get()._seqCalculo !== seq) return { ok: false, error: 'obsoleto' }
        set({ error: mensaje, calculando: false, omitidos: [], advertencias: [], sinHoras: [] })
        return { ok: false, error: mensaje }
      }
      set({ calculando: false, omitidos: data?.omitidos ?? [], advertencias: data?.advertencias ?? [], sinHoras: data?.sinHoras ?? [] })
      return { ok: true, data }
    } catch {
      // invoke() rechaza (no resuelve con {error}) si la red cae antes de
      // llegar a la Edge Function (Task 3.3) — sin este catch, "calculando"
      // quedaba en true para siempre y la UI parecía trabada sin aviso.
      if (get()._seqCalculo !== seq) return { ok: false, error: 'obsoleto' }
      set({ error: 'no se pudo contactar el servidor', calculando: false, omitidos: [], advertencias: [], sinHoras: [] })
      return { ok: false, error: 'no se pudo contactar el servidor' }
    }
  },

  // Crea un período tipo 'final' acotado a una sola persona (fecha_desde =
  // fecha_hasta = fecha de baja) e invoca liquidar-periodo con
  // personalIds: [personalId] para no tocar al resto de la nómina
  // (Fase 5E Task 33 — botón "Generar liquidación final" en FichaLegajoPage).
  crearPeriodoFinal: async (personalId, fechaBaja, empresaId) => {
    const seq = get()._seqCalculo + 1
    set({ _seqCalculo: seq })
    const { data: periodo, error: errPeriodo } = await supabase.from('nom_periodos').insert({
      empresa_id: empresaId, tipo: 'final', fecha_desde: fechaBaja, fecha_hasta: fechaBaja, estado: 'abierto',
    }).select().single()
    if (errPeriodo) return { ok: false, error: errPeriodo.message }
    try {
      const { data, error } = await invocarConReintento({ periodoId: periodo.id, personalIds: [personalId] })
      if (get()._seqCalculo !== seq) return { ok: false, error: 'obsoleto' }
      if (error) {
        // Evita dejar un nom_periodos huérfano en estado 'abierto' sin
        // liquidaciones cuando la Edge Function falla (best-effort: si el
        // delete también falla, queda el mismo huérfano que había antes).
        await supabase.from('nom_periodos').delete().eq('id', periodo.id)
        return { ok: false, error: await mensajeDeErrorEdgeFunction(error) }
      }
      if (data?.omitidos?.length > 0) return { ok: false, error: data.omitidos[0].motivo }
      return { ok: true, data }
    } catch {
      // invoke() rechaza por caída de red (Task 3.3): mismo best-effort de
      // borrar el período huérfano antes de devolver el error.
      await supabase.from('nom_periodos').delete().eq('id', periodo.id)
      return { ok: false, error: 'no se pudo contactar el servidor' }
    }
  },

  // Crea un período tipo 'vacaciones' acotado a una sola persona (vacaciones
  // GOZADAS — Liquidaciones individuales, no confundir con "no gozadas" de
  // la liquidación final) e invoca liquidar-periodo con personalIds:
  // [personalId], simétrico a crearPeriodoFinal. `ausenciaId` viene de una
  // ausencia tipo 'vacaciones' aprobada en Presencio elegida por el usuario;
  // si es null, las fechas se cargaron a mano (sin ausencia registrada).
  // Al terminar, registra la liquidación en nom_vacaciones_liquidadas —
  // tabla propia de Recursio que trackea qué ausencia ya se pagó, porque
  // Recursio no puede escribir en `ausencias` (tabla de Presencio).
  crearPeriodoVacaciones: async (personalId, fechaDesde, fechaHasta, empresaId, ausenciaId) => {
    const seq = get()._seqCalculo + 1
    set({ _seqCalculo: seq })
    const { data: periodo, error: errPeriodo } = await supabase.from('nom_periodos').insert({
      empresa_id: empresaId, tipo: 'vacaciones', fecha_desde: fechaDesde, fecha_hasta: fechaHasta, estado: 'abierto',
    }).select().single()
    if (errPeriodo) return { ok: false, error: errPeriodo.message }
    let data, error
    try {
      const r = await invocarConReintento({ periodoId: periodo.id, personalIds: [personalId] })
      data = r.data; error = r.error
    } catch {
      // invoke() rechaza por caída de red (Task 3.3).
      await supabase.from('nom_periodos').delete().eq('id', periodo.id)
      return { ok: false, error: 'no se pudo contactar el servidor' }
    }
    if (get()._seqCalculo !== seq) return { ok: false, error: 'obsoleto' }
    if (error) {
      // Evita dejar un nom_periodos huérfano en estado 'abierto' sin
      // liquidaciones cuando la Edge Function falla (mismo patrón que
      // crearPeriodoFinal).
      await supabase.from('nom_periodos').delete().eq('id', periodo.id)
      return { ok: false, error: await mensajeDeErrorEdgeFunction(error) }
    }
    if (data?.omitidos?.length > 0) return { ok: false, error: data.omitidos[0].motivo }
    const { data: liq, error: errLiq } = await supabase.from('nom_liquidaciones').select('id')
      .eq('periodo_id', periodo.id).eq('personal_id', personalId).single()
    if (errLiq) return { ok: false, error: errLiq.message }
    const { error: errTraza } = await supabase.from('nom_vacaciones_liquidadas').insert({
      empresa_id: empresaId, personal_id: personalId, ausencia_id: ausenciaId || null,
      liquidacion_id: liq.id, fecha_desde: fechaDesde, fecha_hasta: fechaHasta,
      dias: diasEnRango(fechaDesde, fechaHasta),
      origen: ausenciaId ? 'presencio' : 'manual',
    })
    if (errTraza) return { ok: false, error: errTraza.message }
    return { ok: true, data }
  },

  cargarLiquidaciones: async (periodoId) => {
    const seq = get()._seqLiq + 1
    set({ _seqLiq: seq })
    // Guarda contra periodoId vacío: Postgres lo rechaza con "invalid input
    // syntax for type uuid" y el mensaje quedaba visible en la pantalla de
    // Liquidación como si el cálculo hubiera fallado.
    if (!periodoId) { set({ liquidaciones: [] }); return }
    const { data, error } = await supabase.from('nom_liquidaciones').select('*').eq('periodo_id', periodoId)
    if (get()._seqLiq !== seq) return // se pidió otro período mientras esta respuesta viajaba: descartar
    if (error) { set({ error: error.message }); return }
    // Fase 7 Task 7.4: estado del flujo del período (gate del recibo "para
    // el Empleado"). Un período puede no tener instancia (nunca entró al
    // circuito) → flujoAprobado = false.
    let flujoAprobado = false
    const { data: flujo } = await supabase.from('nom_flujo_instancias').select('estado').eq('periodo_id', periodoId).maybeSingle()
    if (flujo?.estado === 'aprobado') flujoAprobado = true
    if (get()._seqLiq !== seq) return
    // Limpia el error previo: sin esto un error viejo (ej. un periodoId
    // vacío) quedaba pegado en pantalla para siempre, incluso sobre
    // resultados correctos de una corrida posterior.
    set({
      liquidaciones: (data || []).map((r) => liquidacionFromDB({ ...r, periodo_flujo_aprobado: flujoAprobado })),
      error: null,
    })
  },

  cargarItems: async (liquidacionId) => {
    const seq = get()._seqItems + 1
    set({ _seqItems: seq })
    const { data, error } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', liquidacionId)
    if (get()._seqItems !== seq) return // se pidió otra liquidación mientras esta respuesta viajaba: descartar
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

  // Fase 7 Task 7.4: emite una variante puntual con su hash (RPC
  // emitir_recibo_variante, migración 0069). Reutiliza el mismo
  // numero_recibo que la variante ya emitida; valida el gate (flujo
  // aprobado + firma) en el servidor.
  emitirReciboVariante: async (liquidacionId, variante, hashPdf) => {
    const { data, error } = await supabase.rpc('emitir_recibo_variante', {
      p_liquidacion_id: liquidacionId, p_variante: variante, p_hash: hashPdf,
    })
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
