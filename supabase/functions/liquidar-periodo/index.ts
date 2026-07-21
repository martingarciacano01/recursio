// supabase/functions/liquidar-periodo/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { liquidarConceptos, type Concepto } from '../../../packages/motor/src/motor.ts'
import { calcularAsistencia, type DiaAsistencia } from '../../../packages/motor/src/asistencia.ts'

// Mismo patrón CORS que el resto de las Edge Functions de Presencio
// (fichaobra/supabase/functions/invite-user/index.ts): sin esto, el
// navegador bloquea el preflight OPTIONS con "No 'Access-Control-Allow-
// Origin' header" antes de que el POST llegue siquiera a correr.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
  const { periodoId } = await req.json()
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: periodo, error: errPeriodo } = await supabase.from('nom_periodos').select('*').eq('id', periodoId).single()
  if (errPeriodo) {
    // Antes esto colapsaba CUALQUIER error de Postgres (columna
    // inexistente, permiso denegado, etc.) en el mismo "período no
    // encontrado", ocultando la causa real. Devolvemos el mensaje real
    // del error para poder diagnosticar sin acceso a los logs de Supabase.
    return new Response(JSON.stringify({ error: `error al buscar el período: ${errPeriodo.message}`, code: errPeriodo.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!periodo) {
    return new Response(JSON.stringify({ error: 'período no encontrado', periodoIdRecibido: periodoId }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (periodo.estado === 'cerrado') {
    return new Response(JSON.stringify({ error: 'período cerrado: no se puede recalcular' }), {
      status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: conceptos } = await supabase
    .from('nom_conceptos')
    .select('*, nom_concepto_reglas(*)')
    .or(`empresa_id.is.null,empresa_id.eq.${periodo.empresa_id}`)

  const conceptosMotor: Concepto[] = (conceptos || []).map((c: any) => ({
    codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, orden: c.orden, formula: c.formula, imprimible: c.imprimible,
    reglas: (c.nom_concepto_reglas || []).map((r: any) => ({ orden: r.orden, condicion: r.condicion, formula: r.formula })),
  }))

  const { data: personal } = await supabase.from('nom_v_personal').select('id').eq('empresa_id', periodo.empresa_id).eq('estado', 'activo')
  const { data: legajos } = await supabase.from('nom_legajo').select('*').eq('empresa_id', periodo.empresa_id)
  const legajoPorPersonal = new Map((legajos || []).map((l: any) => [l.personal_id, l]))

  const resultados = []
  for (const persona of personal || []) {
    const legajo = legajoPorPersonal.get(persona.id)
    if (!legajo?.cuil || !legajo?.cbu || !legajo?.convenio_id || !legajo?.categoria_id) continue // legajo incompleto, no liquida

    const { data: fichajes } = await supabase.from('nom_v_horas_dia').select('*')
      .eq('personal_id', persona.id).gte('timestamp', periodo.fecha_desde).lte('timestamp', periodo.fecha_hasta)
    const { data: ausencias } = await supabase.from('nom_v_ausencias').select('*')
      .eq('personal_id', persona.id).eq('estado', 'aprobada')

    // Construcción del snapshot diario de asistencia a partir de eventos
    // crudos: agrupa por fecha, toma la primera 'entrada' del día. El
    // turno esperado por ahora es fijo (08:00) hasta que se resuelva
    // dónde vive esa configuración (pendiente: Presencio no expone turno
    // por persona, ver nota en 0001_vistas_contrato.sql de Fase 0).
    const porDia = new Map<string, DiaAsistencia>()
    for (const f of fichajes || []) {
      const fecha = f.timestamp.slice(0, 10)
      if (f.tipo !== 'entrada') continue
      const hora = f.timestamp.slice(11, 16)
      const existente = porDia.get(fecha)
      if (!existente || hora < existente.horaEntradaReal!) {
        porDia.set(fecha, {
          fecha, horaEntradaEsperada: '08:00', horaEntradaReal: hora,
          ausenciaAprobada: (ausencias || []).some((a: any) => fecha >= a.fecha_desde && fecha <= a.fecha_hasta),
        })
      }
    }
    const asistencia = calcularAsistencia([...porDia.values()], 15)

    const variablesBase = {
      basico_convenio: 0, // TODO Fase 2 Task 18: viene de nom_categorias por categoria_id + vigencia
      tardanzas: asistencia.tardanzas,
      faltas_injustificadas: asistencia.faltasInjustificadas,
      horas_extra_50: asistencia.horasExtra50,
      horas_extra_100: asistencia.horasExtra100,
      adelanto_monto: 0, // TODO: sumar nom_pagos_adelantos del período
      tope_sipa: 999999999, // TODO: viene de nom_parametros vigente
    }

    const resultado = liquidarConceptos(conceptosMotor, variablesBase)
    resultados.push({ personalId: persona.id, resultado, asistencia })
  }

  // Idempotencia: borra liquidaciones/items previos de este período antes
  // de reinsertar, así un reintento no duplica filas.
  const { data: liquidacionesPrevias } = await supabase.from('nom_liquidaciones').select('id').eq('periodo_id', periodoId)
  if (liquidacionesPrevias?.length) {
    await supabase.from('nom_liquidacion_items').delete().in('liquidacion_id', liquidacionesPrevias.map((l: any) => l.id))
    await supabase.from('nom_liquidaciones').delete().eq('periodo_id', periodoId)
  }

  for (const r of resultados) {
    const { data: liq } = await supabase.from('nom_liquidaciones').insert({
      empresa_id: periodo.empresa_id, periodo_id: periodoId, personal_id: r.personalId,
      bruto: r.resultado.bruto, neto: r.resultado.neto, total_aportes: r.resultado.totalDescuentos,
      detalle_horas: r.asistencia, estado: 'preliminar',
    }).select().single()
    if (liq) {
      await supabase.from('nom_liquidacion_items').insert(
        r.resultado.items.map((i) => ({
          empresa_id: periodo.empresa_id, liquidacion_id: liq.id, concepto_codigo: i.codigo,
          concepto_nombre: i.nombre, tipo: i.tipo, monto: i.monto, regla_aplicada: String(i.reglaAplicada),
        }))
      )
    }
  }

  return new Response(JSON.stringify({ liquidadas: resultados.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
  } catch (err) {
    // Cualquier error no contemplado explícitamente (JSON inválido en el
    // body, error de Postgres no manejado, etc.) también debe llevar los
    // headers CORS — si no, el navegador lo reporta como el mismo
    // "Failed to send a request to the Edge Function" genérico, aunque la
    // función sí haya respondido con un error real.
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
