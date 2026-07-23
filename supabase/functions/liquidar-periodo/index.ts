// supabase/functions/liquidar-periodo/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { liquidarConceptos, filtrarPorCategoria, type Concepto } from '../../../packages/motor/src/motor.ts'
import { calcularAsistencia, construirDiasPeriodo } from '../../../packages/motor/src/asistencia.ts'
import { calcularBasicoPeriodo } from '../../../packages/motor/src/basico.ts'
import { partirEnLotes, agruparPorPersonalId } from '../../../packages/motor/src/lotes.ts'

// Mismo patrón CORS que el resto de las Edge Functions de Presencio
// (fichaobra/supabase/functions/invite-user/index.ts): sin esto, el
// navegador bloquea el preflight OPTIONS con "No 'Access-Control-Allow-
// Origin' header" antes de que el POST llegue siquiera a correr.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// clave de escala: convenio + nombre de la categoría, vigente al cierre del
// período. Se prueba primero contra el convenio del LEGAJO (si el legajo
// quedó apuntando a la fila de categoría del convenio global tras
// clonar_convenio, la escala cargada en el clon de la empresa igual se
// encuentra) y, si no hay nada ahí, se cae al convenio de la fila de
// categoría — nunca se devuelve $0 en silencio: null indica "no hay escala".
async function resolverBasico(supabase: any, convenioId: string | null, nombre: string, fechaHasta: string): Promise<{ basico: number; modalidad: string } | null> {
  if (!convenioId) return null
  const { data } = await supabase.from('nom_categorias').select('basico, modalidad')
    .eq('convenio_id', convenioId).eq('nombre', nombre)
    .lte('vigencia_desde', fechaHasta)
    .order('vigencia_desde', { ascending: false }).limit(1)
  return data?.length ? { basico: Number(data[0].basico), modalidad: data[0].modalidad ?? 'hora' } : null
}

async function resolverNoRem(supabase: any, convenioId: string | null, nombre: string, fechaHasta: string): Promise<number | null> {
  if (!convenioId) return null
  const { data } = await supabase.from('nom_no_remunerativos').select('monto')
    .eq('convenio_id', convenioId).eq('categoria_nombre', nombre)
    .lte('vigencia_desde', fechaHasta)
    .order('vigencia_desde', { ascending: false }).limit(1)
  return data?.length ? Number(data[0].monto) : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let periodoId: string | undefined
  let supabase: ReturnType<typeof createClient> | undefined
  try {
  const body = await req.json()
  periodoId = body.periodoId
  const personalIds = body.personalIds
  const reanudar = body.reanudar
  supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

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

  type ConceptoConConvenio = Concepto & { convenioId: string | null; config: any }
  const conceptosMotor: ConceptoConConvenio[] = (conceptos || []).map((c: any) => ({
    codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, orden: c.orden, formula: c.formula, imprimible: c.imprimible,
    categorias: c.categorias ?? null, convenioId: c.convenio_id ?? null, config: c.config ?? null,
    reglas: (c.nom_concepto_reglas || []).map((r: any) => ({ orden: r.orden, condicion: r.condicion, formula: r.formula })),
  }))

  let queryPersonal = supabase.from('nom_v_personal').select('id, nombre').eq('empresa_id', periodo.empresa_id).eq('estado', 'activo')
  if (Array.isArray(personalIds) && personalIds.length > 0) queryPersonal = queryPersonal.in('id', personalIds)
  const { data: personal, error: errPersonal } = await queryPersonal
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

  let personalAProcesar = personal || []
  if (reanudar) {
    const { data: yaLiquidados } = await supabase.from('nom_liquidaciones')
      .select('personal_id').eq('periodo_id', periodoId)
    const idsYaLiquidados = new Set((yaLiquidados || []).map((l: any) => l.personal_id))
    personalAProcesar = personalAProcesar.filter((p: any) => !idsYaLiquidados.has(p.id))
  }

  await supabase.from('nom_periodos').update({
    calculo_estado: 'calculando',
    calculo_total: (personal || []).length,
    calculo_procesados: (personal || []).length - personalAProcesar.length,
  }).eq('id', periodoId)

  // ─── Consolidación quincenal (Fase 4, Task 28) ────────────────────
  // Si este período es la quincena 2 de un grupo mensual, se expone
  // remunerativo_quincena1 (bruto remunerativo ya liquidado en la
  // quincena 1 del mismo mes, por persona) para que un concepto con
  // base 'acumulado_mensual' (packages/motor/src/formulas.ts) calcule
  // el tope sobre el acumulado del mes y no sobre cada quincena aparte.
  const remunerativoQuincena1PorPersona = new Map<string, number>()
  // clave `${personalId}|${conceptoCodigo}` → monto ya liquidado en Q1 para
  // ese concepto puntual; se usa para restar la diferencia en los
  // conceptos que consolidan sobre 'acumulado_mensual' (ver más abajo,
  // tras liquidarConceptos) y así no cobrar el mes completo dos veces.
  const montoQuincena1PorPersonaYCodigo = new Map<string, number>()
  if (periodo.tipo === 'quincena_2' && periodo.grupo_mensual_id) {
    const { data: q1 } = await supabase.from('nom_periodos').select('id')
      .eq('grupo_mensual_id', periodo.grupo_mensual_id).eq('tipo', 'quincena_1').maybeSingle()
    if (q1) {
      const { data: liqsQ1 } = await supabase.from('nom_liquidaciones').select('id, personal_id').eq('periodo_id', q1.id)
      const personalPorLiq = new Map((liqsQ1 || []).map((l: any) => [l.id, l.personal_id]))
      const idsQ1 = (liqsQ1 || []).map((l: any) => l.id)
      if (idsQ1.length > 0) {
        const { data: itemsQ1 } = await supabase.from('nom_liquidacion_items').select('liquidacion_id, monto, tipo, concepto_codigo')
          .in('liquidacion_id', idsQ1)
        for (const i of itemsQ1 || []) {
          const personalId = personalPorLiq.get(i.liquidacion_id)
          if (!personalId) continue
          if (i.tipo === 'remunerativo') {
            remunerativoQuincena1PorPersona.set(personalId, (remunerativoQuincena1PorPersona.get(personalId) ?? 0) + Number(i.monto))
          }
          const clave = `${personalId}|${i.concepto_codigo}`
          montoQuincena1PorPersonaYCodigo.set(clave, (montoQuincena1PorPersonaYCodigo.get(clave) ?? 0) + Number(i.monto))
        }
      }
    }
  }
  // Códigos de concepto que consolidan sobre el acumulado del mes: se
  // liquidan sobre remunerativo_acumulado + remunerativo_quincena1, así
  // que en la quincena 2 hay que restar lo ya pagado en la quincena 1
  // para ese mismo concepto (si no, se cobraría el mes completo dos
  // veces). Resuelto acá y no en el motor puro para no atarlo a la
  // existencia de "quincenas" — el motor no sabe de calendarios.
  const codigosConsolidadosPorAcumuladoMensual = new Set(
    (conceptos || []).filter((c: any) => c.config?.base === 'acumulado_mensual').map((c: any) => c.codigo)
  )

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

  // categoria_id → { convenioId, nombre } de la fila a la que apunta el
  // legajo (solo para tener el nombre; la escala real se resuelve por
  // persona más abajo, probando primero el convenio DEL LEGAJO).
  const categoriaIds = [...new Set((legajos || []).map((l: any) => l.categoria_id).filter(Boolean))]
  const nombrePorCategoria = new Map<string, string>()
  const convenioPorCategoria = new Map<string, string>()
  if (categoriaIds.length > 0) {
    const { data: cats, error: errCats } = await supabase.from('nom_categorias')
      .select('id, convenio_id, nombre').in('id', categoriaIds)
    if (errCats) {
      return new Response(JSON.stringify({ error: `error al leer categorias: ${errCats.message}`, code: errCats.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    for (const cat of cats || []) {
      nombrePorCategoria.set(cat.id, cat.nombre)
      convenioPorCategoria.set(cat.id, cat.convenio_id)
    }
  }

  // Caches por clave `${convenioId}:${nombre}` para no repetir queries
  // entre legajos que comparten convenio y categoría.
  const cacheBasico = new Map<string, { basico: number; modalidad: string } | null>()
  const cacheNoRem = new Map<string, number | null>()
  async function basicoCacheado(convenioId: string | null, nombre: string) {
    const clave = `${convenioId}:${nombre}`
    if (!cacheBasico.has(clave)) cacheBasico.set(clave, await resolverBasico(supabase, convenioId, nombre, periodo.fecha_hasta))
    return cacheBasico.get(clave) ?? null
  }
  async function noRemCacheado(convenioId: string | null, nombre: string) {
    const clave = `${convenioId}:${nombre}`
    if (!cacheNoRem.has(clave)) cacheNoRem.set(clave, await resolverNoRem(supabase, convenioId, nombre, periodo.fecha_hasta))
    return cacheNoRem.get(clave) ?? null
  }

  // Legajos que se saltean (incompletos) y advertencias de escala faltante
  // por persona — nunca más un $0 silencioso sin explicación.
  const omitidos: { personal_id: string; nombre: string; motivo: string }[] = []
  const advertencias: { personal_id: string; mensaje: string }[] = []

  // Único punto de branching fuera_convenio vs. normal (antes duplicado en
  // dos bloques separados del loop): resuelve básico, no-remunerativo y la
  // lista de conceptos aplicables según corresponda, en un solo lugar.
  async function resolverBasicoYConceptos(
    legajo: any,
    asistencia: { horasTrabajadas: number; faltasInjustificadas: number },
    personaId: string
  ): Promise<{ basicoPeriodo: number; basicoConvenio: number; noRem: number; conceptosLegajo: ConceptoConConvenio[] }> {
    const tipoPeriodo = periodo.tipo === 'mensual' ? 'mensual' : 'quincenal'
    if (legajo.fuera_convenio) {
      // Sin convenio/categoría: el básico sale directo de sueldo_convenido,
      // un monto FIJO mensual pactado individualmente con el empleado — no
      // se calcula con horas trabajadas ni se descuenta por faltas
      // injustificadas (a diferencia del básico "mensual" de un convenio
      // normal, que sí las descuenta vía calcularBasicoPeriodo). En período
      // quincenal se paga la mitad del mensual pactado; en período mensual,
      // el monto completo. Los conceptos que aplican son los "generales" de
      // la empresa (convenio_id NULL) — no los de ningún convenio con
      // categorías, ya que este legajo no pertenece a ninguno. Nunca se
      // empuja la advertencia de "sin escala vigente": no hay escala que
      // resolver para un legajo fuera de convenio.
      const basicoConvenio = Number(legajo.sueldo_convenido)
      const basicoPeriodo = tipoPeriodo === 'mensual' ? basicoConvenio : basicoConvenio / 2
      return {
        basicoPeriodo,
        basicoConvenio,
        noRem: 0,
        conceptosLegajo: conceptosMotor.filter((c) => c.convenioId === null),
      }
    }

    // Legajo normal: resuelve escala y no-remunerativo vigentes por
    // categoría (probando primero el convenio del legajo y, si no hay nada
    // ahí, el de la fila de categoría — ver resolverBasico/resolverNoRem).
    const nombreCategoria = nombrePorCategoria.get(legajo.categoria_id) ?? ''
    const convenioCategoria = convenioPorCategoria.get(legajo.categoria_id) ?? null
    let basico = await basicoCacheado(legajo.convenio_id, nombreCategoria)
    if (basico === null) basico = await basicoCacheado(convenioCategoria, nombreCategoria)
    if (basico === null || basico.basico === 0) {
      advertencias.push({
        personal_id: personaId,
        mensaje: `sin escala vigente para "${nombreCategoria}" al ${periodo.fecha_hasta} (convenio ${legajo.convenio_id})`,
      })
    }
    let noRem = await noRemCacheado(legajo.convenio_id, nombreCategoria)
    if (noRem === null) noRem = await noRemCacheado(convenioCategoria, nombreCategoria)

    // basico_periodo: la base del concepto "básico" ya resuelta según la
    // modalidad pactada en la escala (hora/mensual/quincenal) vs. el tipo
    // de período liquidado — ver packages/motor/src/basico.ts.
    const basicoPeriodo = basico
      ? calcularBasicoPeriodo({
          modalidad: basico.modalidad as 'hora' | 'mensual' | 'quincenal',
          basico: basico.basico,
          tipoPeriodo,
          horasTrabajadas: asistencia.horasTrabajadas,
          faltasInjustificadas: asistencia.faltasInjustificadas,
        })
      : 0
    // Solo conceptos del convenio del legajo (evita duplicar plantilla
    // global + copia de empresa tras clonar_convenio) y de su categoría.
    const conceptosLegajo = filtrarPorCategoria(
      conceptosMotor.filter((c) => c.convenioId === legajo.convenio_id),
      nombreCategoria
    )

    return { basicoPeriodo, basicoConvenio: basico?.basico ?? 0, noRem: noRem ?? 0, conceptosLegajo }
  }

  const idsAProcesar = personalAProcesar.map((p: any) => p.id)
  const fichajesTodos: any[] = []
  const ausenciasTodas: any[] = []
  for (const lote of partirEnLotes(idsAProcesar, 100)) {
    const [{ data: f, error: eF }, { data: a, error: eA }] = await Promise.all([
      supabase.from('nom_v_horas_dia').select('*').in('personal_id', lote)
        .gte('timestamp', periodo.fecha_desde).lte('timestamp', periodo.fecha_hasta),
      supabase.from('nom_v_ausencias').select('*').in('personal_id', lote).eq('estado', 'aprobada'),
    ])
    if (eF || eA) {
      const e = eF || eA
      await supabase.from('nom_periodos').update({ calculo_estado: 'error' }).eq('id', periodoId)
      return new Response(JSON.stringify({ error: `error al leer asistencia en lote: ${e!.message}`, code: e!.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    fichajesTodos.push(...(f || []))
    ausenciasTodas.push(...(a || []))
  }
  const fichajesPorPersona = agruparPorPersonalId(fichajesTodos)
  const ausenciasPorPersona = agruparPorPersonalId(ausenciasTodas)

  const resultados = []
  for (const persona of personalAProcesar) {
    const legajo = legajoPorPersonal.get(persona.id)
    const incompleto = !legajo?.cuil || !legajo?.cbu ||
      (!legajo?.fuera_convenio && (!legajo?.convenio_id || !legajo?.categoria_id)) ||
      (legajo?.fuera_convenio && !legajo?.sueldo_convenido)
    if (incompleto) {
      const faltan = [
        !legajo?.cuil && 'CUIL', !legajo?.cbu && 'CBU',
        !legajo?.fuera_convenio && !legajo?.convenio_id && 'convenio',
        !legajo?.fuera_convenio && !legajo?.categoria_id && 'categoría',
        legajo?.fuera_convenio && !legajo?.sueldo_convenido && 'sueldo convenido',
      ].filter(Boolean).join(', ')
      omitidos.push({ personal_id: persona.id, nombre: persona.nombre, motivo: `legajo incompleto: falta ${faltan}` })
      continue
    }

    const fichajes = fichajesPorPersona.get(persona.id) ?? []
    const ausencias = ausenciasPorPersona.get(persona.id) ?? []

    const dias = construirDiasPeriodo(
      (fichajes || []).map((f: any) => ({ tipo: f.tipo, timestamp: f.timestamp })),
      (ausencias || []).map((a: any) => ({ fecha_desde: a.fecha_desde, fecha_hasta: a.fecha_hasta })),
      periodo.fecha_desde,
      periodo.fecha_hasta
    )
    const asistencia = calcularAsistencia(dias, 15, legajo.jornada === 'parcial' ? 4 : 8)

    // basico_convenio se mantiene por compatibilidad con fórmulas viejas
    // que aún lo referencien directamente.
    const { basicoPeriodo, basicoConvenio, noRem, conceptosLegajo } =
      await resolverBasicoYConceptos(legajo, asistencia, persona.id)

    const variablesBase = {
      basico_convenio: basicoConvenio,
      basico_periodo: basicoPeriodo,
      horas_trabajadas: asistencia.horasTrabajadas,
      tardanzas: asistencia.tardanzas,
      faltas_injustificadas: asistencia.faltasInjustificadas,
      faltas_justificadas: asistencia.faltasJustificadas,
      horas_extra_50: asistencia.horasExtra50,
      horas_extra_100: asistencia.horasExtra100,
      adelanto_monto: adelantoPorPersona.get(persona.id) ?? 0,
      tope_sipa: topeSipa,
      no_rem_convenio: noRem,
      remunerativo_quincena1: remunerativoQuincena1PorPersona.get(persona.id) ?? 0,
    }

    const resultado = liquidarConceptos(conceptosLegajo, variablesBase)

    // Ajuste de consolidación quincenal: los conceptos con base
    // 'acumulado_mensual' calcularon sobre remunerativo_acumulado +
    // remunerativo_quincena1 (el mes completo); hay que restar lo ya
    // pagado en Q1 para ese mismo concepto y no cobrar el mes dos veces.
    if (periodo.tipo === 'quincena_2' && codigosConsolidadosPorAcumuladoMensual.size > 0) {
      for (const item of resultado.items) {
        if (!codigosConsolidadosPorAcumuladoMensual.has(item.codigo)) continue
        const yaPagadoQ1 = montoQuincena1PorPersonaYCodigo.get(`${persona.id}|${item.codigo}`) ?? 0
        if (yaPagadoQ1 === 0) continue
        const original = item.monto
        item.monto = original - yaPagadoQ1
        const delta = item.monto - original
        if (item.tipo === 'descuento') resultado.totalDescuentos += delta
        if (item.tipo === 'remunerativo' || item.tipo === 'no_remunerativo') resultado.bruto += delta
      }
      resultado.neto = resultado.bruto - resultado.totalDescuentos
    }

    resultados.push({ personalId: persona.id, resultado, asistencia })
  }

  // Idempotencia: el `upsert` con `onConflict: 'periodo_id,personal_id'`
  // reemplaza sin duplicar filas, sin necesidad de borrar-todo-y-reinsertar
  // primero (evita el bug de la Task 7 donde ese borrado podía alcanzar
  // liquidaciones fuera del scope de `personalIds`).
  let procesadosAcumulados = personal.length - personalAProcesar.length
  for (const loteResultados of partirEnLotes(resultados, 50)) {
    const filasLiquidacion = loteResultados.map((r) => ({
      empresa_id: periodo.empresa_id, periodo_id: periodoId, personal_id: r.personalId,
      bruto: r.resultado.bruto, neto: r.resultado.neto, total_aportes: r.resultado.totalDescuentos,
      total_contribuciones: r.resultado.items
        .filter((i) => i.tipo === 'aporte_patronal')
        .reduce((s, i) => s + i.monto, 0),
      detalle_horas: r.asistencia, estado: 'preliminar',
    }))
    const { data: liqsLote, error: errUpsert } = await supabase.from('nom_liquidaciones')
      .upsert(filasLiquidacion, { onConflict: 'periodo_id,personal_id' })
      .select('id, personal_id')
    if (errUpsert) {
      await supabase.from('nom_periodos').update({ calculo_estado: 'error' }).eq('id', periodoId)
      return new Response(JSON.stringify({ error: `error al guardar liquidaciones: ${errUpsert.message}`, code: errUpsert.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const liqIdPorPersonal = new Map((liqsLote || []).map((l: any) => [l.personal_id, l.id]))
    // Idempotencia de items: al re-liquidar (ej. tras un reanudar parcial de
    // un intento anterior fallido) hay que limpiar los items viejos de estas
    // liquidaciones antes de reinsertar, si no se duplican.
    const idsLote = [...liqIdPorPersonal.values()]
    if (idsLote.length > 0) {
      await supabase.from('nom_liquidacion_items').delete().in('liquidacion_id', idsLote)
    }
    const itemsLote = loteResultados.flatMap((r) => {
      const liqId = liqIdPorPersonal.get(r.personalId)
      if (!liqId) return []
      return r.resultado.items.map((i) => ({
        empresa_id: periodo.empresa_id, liquidacion_id: liqId, concepto_codigo: i.codigo,
        concepto_nombre: i.nombre, tipo: i.tipo, monto: i.monto, regla_aplicada: String(i.reglaAplicada),
        unidad_texto: i.unidadTexto ?? null,
        base_calculo: i.baseCalculo ?? null,
        grupo_recibo: i.grupoRecibo ?? null,
        detalle_recibo: i.detalleRecibo ?? null,
      }))
    })
    if (itemsLote.length > 0) {
      await supabase.from('nom_liquidacion_items').insert(itemsLote)
    }
    procesadosAcumulados += loteResultados.length
    await supabase.from('nom_periodos').update({
      calculo_procesados: procesadosAcumulados,
    }).eq('id', periodoId)
  }

  const totalFinal = (personal || []).length
  const procesadosFinal = (personal.length - personalAProcesar.length) + resultados.length
  const completo = procesadosFinal >= totalFinal
  await supabase.from('nom_periodos').update({
    calculo_estado: completo ? 'completo' : 'calculando',
    calculo_procesados: procesadosFinal,
  }).eq('id', periodoId)

  return new Response(JSON.stringify({ liquidadas: resultados.length, omitidos, advertencias, completo, procesados: procesadosFinal, total: totalFinal }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
  } catch (err) {
    if (periodoId && supabase) {
      await supabase.from('nom_periodos').update({ calculo_estado: 'error' }).eq('id', periodoId)
    }
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
