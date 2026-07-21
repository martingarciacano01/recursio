// supabase/functions/liquidar-periodo/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { liquidarConceptos, filtrarPorCategoria, type Concepto } from '../../../packages/motor/src/motor.ts'
import { calcularAsistencia, construirDiasPeriodo } from '../../../packages/motor/src/asistencia.ts'

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

  const { data: conceptos, error: errConceptos } = await supabase
    .from('nom_conceptos')
    .select('*, nom_concepto_reglas(*)')
    .or(`empresa_id.is.null,empresa_id.eq.${periodo.empresa_id}`)

  type ConceptoConConvenio = Concepto & { convenioId: string | null }
  const conceptosMotor: ConceptoConConvenio[] = (conceptos || []).map((c: any) => ({
    codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, orden: c.orden, formula: c.formula, imprimible: c.imprimible,
    categorias: c.categorias ?? null, convenioId: c.convenio_id ?? null,
    reglas: (c.nom_concepto_reglas || []).map((r: any) => ({ orden: r.orden, condicion: r.condicion, formula: r.formula })),
  }))

  const { data: personal, error: errPersonal } = await supabase.from('nom_v_personal').select('id').eq('empresa_id', periodo.empresa_id).eq('estado', 'activo')
  const { data: legajos, error: errLegajos } = await supabase.from('nom_legajo').select('*').eq('empresa_id', periodo.empresa_id)

  // Estos errores se ignoraban (data quedaba null) y la función devolvía
  // {"liquidadas": 0} sin pista alguna — así se ocultó el "permission
  // denied for table personal" de las vistas security_invoker (ver
  // migración 0010). Cualquier error de lectura debe cortar y reportarse.
  const errLectura = errConceptos || errPersonal || errLegajos
  if (errLectura) {
    return new Response(JSON.stringify({ error: `error al leer datos: ${errLectura.message}`, code: errLectura.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const legajoPorPersonal = new Map((legajos || []).map((l: any) => [l.personal_id, l]))

  // ─── Variables que antes eran TODO ────────────────────────────────
  // tope_sipa vigente para el período (nom_parametros, versionado por vigencia)
  const { data: topeRows, error: errTope } = await supabase.from('nom_parametros').select('valor')
    .eq('empresa_id', periodo.empresa_id).eq('codigo', 'tope_sipa')
    .lte('vigencia_desde', periodo.fecha_hasta)
    .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${periodo.fecha_desde}`)
    .order('vigencia_desde', { ascending: false }).limit(1)
  // adelantos del período por persona
  const { data: adelantos, error: errAdel } = await supabase.from('nom_pagos_adelantos').select('personal_id, monto')
    .eq('empresa_id', periodo.empresa_id)
    .gte('fecha', periodo.fecha_desde).lte('fecha', periodo.fecha_hasta)
  if (errTope || errAdel) {
    const e = (errTope || errAdel)!
    return new Response(JSON.stringify({ error: `error al leer parametros/adelantos: ${e.message}`, code: e.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const topeSipa = Number(topeRows?.[0]?.valor ?? 999999999) // sin parámetro cargado: sin tope efectivo
  const adelantoPorPersona = new Map<string, number>()
  for (const a of adelantos || []) {
    adelantoPorPersona.set(a.personal_id, (adelantoPorPersona.get(a.personal_id) ?? 0) + Number(a.monto))
  }

  // basico vigente por categoría: legajo.categoria_id apunta a UNA fila de
  // nom_categorias, pero la escala se versiona por (convenio, nombre,
  // vigencia_desde) — hay que buscar la fila vigente al cierre del período.
  const categoriaIds = [...new Set((legajos || []).map((l: any) => l.categoria_id).filter(Boolean))]
  const basicoPorCategoria = new Map<string, number>()
  const nombrePorCategoria = new Map<string, string>()
  const noRemPorCategoria = new Map<string, number>()
  if (categoriaIds.length > 0) {
    const { data: cats, error: errCats } = await supabase.from('nom_categorias')
      .select('id, convenio_id, nombre').in('id', categoriaIds)
    if (errCats) {
      return new Response(JSON.stringify({ error: `error al leer categorias: ${errCats.message}`, code: errCats.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    for (const cat of cats || []) {
      const { data: vig } = await supabase.from('nom_categorias').select('basico')
        .eq('convenio_id', cat.convenio_id).eq('nombre', cat.nombre)
        .lte('vigencia_desde', periodo.fecha_hasta)
        .order('vigencia_desde', { ascending: false }).limit(1)
      basicoPorCategoria.set(cat.id, Number(vig?.[0]?.basico ?? 0))

      nombrePorCategoria.set(cat.id, cat.nombre)
      const { data: nr } = await supabase.from('nom_no_remunerativos').select('monto')
        .eq('convenio_id', cat.convenio_id).eq('categoria_nombre', cat.nombre)
        .lte('vigencia_desde', periodo.fecha_hasta)
        .order('vigencia_desde', { ascending: false }).limit(1)
      noRemPorCategoria.set(cat.id, Number(nr?.[0]?.monto ?? 0))
    }
  }

  const resultados = []
  for (const persona of personal || []) {
    const legajo = legajoPorPersonal.get(persona.id)
    if (!legajo?.cuil || !legajo?.cbu || !legajo?.convenio_id || !legajo?.categoria_id) continue // legajo incompleto, no liquida

    const { data: fichajes, error: errFichajes } = await supabase.from('nom_v_horas_dia').select('*')
      .eq('personal_id', persona.id).gte('timestamp', periodo.fecha_desde).lte('timestamp', periodo.fecha_hasta)
    const { data: ausencias, error: errAusencias } = await supabase.from('nom_v_ausencias').select('*')
      .eq('personal_id', persona.id).eq('estado', 'aprobada')
    if (errFichajes || errAusencias) {
      const e = errFichajes || errAusencias
      return new Response(JSON.stringify({ error: `error al leer asistencia de ${persona.id}: ${e!.message}`, code: e!.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const dias = construirDiasPeriodo(
      (fichajes || []).map((f: any) => ({ tipo: f.tipo, timestamp: f.timestamp })),
      (ausencias || []).map((a: any) => ({ fecha_desde: a.fecha_desde, fecha_hasta: a.fecha_hasta })),
      periodo.fecha_desde,
      periodo.fecha_hasta
    )
    const asistencia = calcularAsistencia(dias, 15, legajo.jornada === 'parcial' ? 4 : 8)

    const variablesBase = {
      basico_convenio: basicoPorCategoria.get(legajo.categoria_id) ?? 0,
      horas_trabajadas: asistencia.horasTrabajadas,
      tardanzas: asistencia.tardanzas,
      faltas_injustificadas: asistencia.faltasInjustificadas,
      faltas_justificadas: asistencia.faltasJustificadas,
      horas_extra_50: asistencia.horasExtra50,
      horas_extra_100: asistencia.horasExtra100,
      adelanto_monto: adelantoPorPersona.get(persona.id) ?? 0,
      tope_sipa: topeSipa,
      no_rem_convenio: noRemPorCategoria.get(legajo.categoria_id) ?? 0,
    }

    // Solo conceptos del convenio del legajo (evita duplicar plantilla
    // global + copia de empresa tras clonar_convenio) y de su categoría.
    const conceptosLegajo = filtrarPorCategoria(
      conceptosMotor.filter((c) => c.convenioId === legajo.convenio_id),
      nombrePorCategoria.get(legajo.categoria_id) ?? ''
    )
    const resultado = liquidarConceptos(conceptosLegajo, variablesBase)
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
      total_contribuciones: r.resultado.items
        .filter((i) => i.tipo === 'aporte_patronal')
        .reduce((s, i) => s + i.monto, 0),
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
