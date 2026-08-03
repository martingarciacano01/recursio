// supabase/functions/liquidar-periodo/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { liquidarConceptos, filtrarPorCategoria, filtrarAsignados, type Concepto } from '../../../packages/motor/src/motor.ts'
import { calcularAsistencia, construirDiasPeriodo } from '../../../packages/motor/src/asistencia.ts'
import { calcularBasicoPeriodo } from '../../../packages/motor/src/basico.ts'
import { partirEnLotes, agruparPorPersonalId } from '../../../packages/motor/src/lotes.ts'
import { generarFormula } from '../../../packages/motor/src/formulas.ts'
import {
  calcularSAC as calcularSACLct,
  calcularVacaciones as calcularVacacionesLct,
  calcularLiquidacionFinal as calcularLiquidacionFinalLct,
  montoVacacionesGozadas,
} from '../../../packages/motor/src/especiales.ts'
import {
  calcularSACProporcional as calcularSACProporcionalUocra,
  diasVacacionesPorAntiguedad as diasVacacionesPorAntiguedadUocra,
  calcularVacacionesNoGozadas as calcularVacacionesNoGozadasUocra,
  calcularLiquidacionFinal as calcularLiquidacionFinalUocra,
} from '../../../packages/motor/src/uocra.ts'

// Mismo patrón CORS que el resto de las Edge Functions de Presencio
// (fichaobra/supabase/functions/invite-user/index.ts): sin esto, el
// navegador bloquea el preflight OPTIONS con "No 'Access-Control-Allow-
// Origin' header" antes de que el POST llegue siquiera a correr.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Concepto tal como lo devuelve nom_conceptos, con el convenio dueño y la
// config cruda todavía adjuntos (se usa tanto en el flujo mensual/quincenal
// como en el de períodos especiales — ver liquidarPeriodoEspecial).
type ConceptoConConvenio = Concepto & { convenioId: string | null; config: any }

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
  // El cliente de datos usa service_role (saltea RLS a propósito, para
  // poder liquidar a toda la empresa de una), así que la autorización NO
  // la puede delegar en RLS: hay que validarla acá explícitamente.
  // Sin esto, cualquier usuario autenticado del proyecto puede pasar el
  // periodoId de OTRA empresa y liquidarle la nómina (hallazgo Fase 5H).
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'falta header Authorization' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const supabaseAuth = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )
  const { data: { user }, error: errUser } = await supabaseAuth.auth.getUser()
  if (errUser || !user) {
    return new Response(JSON.stringify({ error: 'no autenticado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

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
    console.error('liquidar-periodo: error al buscar el período', { periodoId, err: errPeriodo })
    return new Response(JSON.stringify({ error: 'no se pudo leer el período solicitado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!periodo) {
    return new Response(JSON.stringify({ error: 'período no encontrado', periodoIdRecibido: periodoId }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // El usuario tiene que pertenecer a la empresa del período y tener un rol
  // que habilite calcular (matriz de src/utils/permisos.js: calcular_liquidacion
  // => admin, rrhh). Se consulta con el cliente service_role porque
  // nom_usuarios_empresas tiene RLS y acá todavía no hay contexto de usuario.
  // El criterio de superadmin es el mismo que usa el resto del repo
  // (RPC is_superadmin(), ver 0008_superadmin_bypass.sql e invitar-usuario).
  const { data: esSuperadmin } = await supabaseAuth.rpc('is_superadmin')
  if (!esSuperadmin) {
    const { data: vinculos } = await supabase
      .from('nom_usuarios_empresas')
      .select('rol')
      .eq('usuario_id', user.id)
      .eq('empresa_id', periodo.empresa_id)
    const rolesDelUsuario = (vinculos || []).map((v: any) => v.rol)
    const ROLES_QUE_LIQUIDAN = ['admin', 'rrhh']
    if (!rolesDelUsuario.some((r: string) => ROLES_QUE_LIQUIDAN.includes(r))) {
      return new Response(JSON.stringify({ error: 'sin permiso para liquidar este período' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  // Task 2.6 (idempotencia de recibos emitidos): una vez que existe al
  // menos un recibo emitido (numero_recibo no nulo) para este período, no
  // se puede recalcular — recalcular pisaría los montos de un recibo ya
  // entregado, dejando dos versiones distintas bajo el mismo numero_recibo.
  // Decisión: bloquear, no anular+versionar. Para corregir hay que anular
  // los recibos o emitir una rectificativa.
  const { data: emitidos, error: errEmitidos } = await supabase.from('nom_liquidaciones')
    .select('id').eq('periodo_id', periodoId).not('numero_recibo', 'is', null).limit(1)
  if (errEmitidos) {
    return new Response(JSON.stringify({ error: `error al verificar recibos emitidos: ${errEmitidos.message}`, code: errEmitidos.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if ((emitidos || []).length > 0) {
    return new Response(JSON.stringify({
      error: 'el período ya tiene recibos emitidos: no se puede recalcular. Anulá los recibos o emití una rectificativa.',
    }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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
  if (errConceptos) {
    return new Response(JSON.stringify({ error: `error al leer conceptos: ${errConceptos.message}`, code: errConceptos.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const conceptosMotor: ConceptoConConvenio[] = (conceptos || []).map((c: any) => ({
    codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, orden: c.orden, formula: c.formula, imprimible: c.imprimible,
    categorias: c.categorias ?? null, convenioId: c.convenio_id ?? null, config: c.config ?? null,
    asignacion: c.asignacion ?? 'categoria',
    reglas: (c.nom_concepto_reglas || []).map((r: any) => ({ orden: r.orden, condicion: r.condicion, formula: r.formula })),
  }))
  const conceptoIdPorCodigo = new Map((conceptos || []).map((c: any) => [c.codigo, c.id]))

  // ─── Períodos especiales (Fase 4, Task 32, extendido en Task 32b) ─────
  // sac/sac_1/sac_2/vacaciones/final NO pasan por el flujo mensual/
  // quincenal de básico+asistencia de más abajo (no hay básico ni
  // asistencia que calcular para estos rubros puntuales), pero desde la
  // Task 32b SÍ corren sus montos remunerativos por `liquidarConceptos`
  // (jubilación/obra social/sindical/contribuciones patronales), igual que
  // el flujo mensual — ver liquidarPeriodoEspecial más abajo. Se le pasa
  // `conceptosMotor` ya resuelto para no repetir esta misma consulta
  // adentro. Rama temprana y completamente separada del resto de la
  // función — el código mensual/quincenal de aquí en más nunca se ejecuta
  // para estos tipos de período.
  const ESPECIALES = new Set(['sac', 'sac_1', 'sac_2', 'vacaciones', 'final'])
  if (ESPECIALES.has(periodo.tipo)) {
    return await liquidarPeriodoEspecial(supabase, periodo, personalIds, conceptosMotor)
  }

  let queryPersonal = supabase.from('nom_v_personal').select('id, nombre, fecha_ingreso').eq('empresa_id', periodo.empresa_id).eq('estado', 'activo')
  if (Array.isArray(personalIds) && personalIds.length > 0) queryPersonal = queryPersonal.in('id', personalIds)
  const { data: personal, error: errPersonal } = await queryPersonal
  const { data: legajos, error: errLegajos } = await supabase.from('nom_legajo').select('*').eq('empresa_id', periodo.empresa_id)

  // Estos errores se ignoraban (data quedaba null) y la función devolvía
  // {"liquidadas": 0} sin pista alguna — así se ocultó el "permission
  // denied for table personal" de las vistas security_invoker (ver
  // migración 0010). Cualquier error de lectura debe cortar y reportarse.
  const errLectura = errPersonal || errLegajos
  if (errLectura) {
    return new Response(JSON.stringify({ error: `error al leer datos: ${errLectura.message}`, code: errLectura.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const legajoPorPersonal = new Map((legajos || []).map((l: any) => [l.personal_id, l]))

  // Adicionales asignados por legajo (migración 0040, plan 2026-07-29 §3):
  // una consulta para toda la empresa (mismo patrón que fichajes/ausencias
  // de más abajo, pero acá no hace falta partirEnLotes — es una tabla chica
  // por empresa). Filtrado por vigencia contra el CIERRE del período: una
  // asignación vale si empezó on/antes de fecha_hasta y (no tiene fin, o su
  // fin es on/después de fecha_hasta) — mismo criterio que resolverBasico.
  const { data: adicionalesLegajo, error: errAdicionalesLegajo } = await supabase
    .from('nom_legajo_adicionales').select('legajo_id, concepto_id, modo, porcentaje, monto')
    .eq('empresa_id', periodo.empresa_id)
    .lte('vigencia_desde', periodo.fecha_hasta)
    .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${periodo.fecha_hasta}`)
  if (errAdicionalesLegajo) {
    return new Response(JSON.stringify({ error: `error al leer adicionales por legajo: ${errAdicionalesLegajo.message}`, code: errAdicionalesLegajo.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const codigoPorConceptoId = new Map((conceptos || []).map((c: any) => [c.id, c.codigo]))
  // legajo_id → Map<codigoConcepto, override>. 'heredado' = usar el % ya
  // configurado en el concepto del convenio (solo la asignación cambia; el
  // valor no se pisa) — se resuelve más abajo, al generar la fórmula.
  const adicionalesPorLegajo = new Map<string, Map<string, { modo: string; porcentaje: number | null; monto: number | null }>>()
  for (const a of adicionalesLegajo || []) {
    const codigo = codigoPorConceptoId.get(a.concepto_id)
    if (!codigo) continue
    if (!adicionalesPorLegajo.has(a.legajo_id)) adicionalesPorLegajo.set(a.legajo_id, new Map())
    adicionalesPorLegajo.get(a.legajo_id)!.set(codigo, { modo: a.modo, porcentaje: a.porcentaje != null ? Number(a.porcentaje) : null, monto: a.monto != null ? Number(a.monto) : null })
  }

  // Un período 'mensual_fc' liquida SOLO al personal fuera de convenio
  // (cobra mensual mientras su convenio real, si tuviera, cobraría por
  // quincena — nunca lo hace porque fuera_convenio no tiene convenio_id).
  // Un período mensual/quincena_1/quincena_2 pertenece a UN convenio
  // puntual (migración 0035, "períodos por convenio"): liquida solo al
  // personal de ESE convenio, nunca al fuera de convenio. Períodos legado
  // sin convenio_id (sac_1/sac_2, datos previos a la 0035) no discriminan
  // — comportamiento idéntico al de antes de esta migración.
  const esPeriodoFueraConvenio = periodo.tipo === 'mensual_fc'
  let personalAProcesar = (personal || []).filter((p: any) => {
    const l = legajoPorPersonal.get(p.id)
    if (esPeriodoFueraConvenio) return l?.fuera_convenio === true
    if (periodo.convenio_id) return l?.convenio_id === periodo.convenio_id && l?.fuera_convenio !== true
    return l?.fuera_convenio !== true
  })

  // Universo del período: la nómina que ESTE tipo de período debe liquidar
  // (ya filtrada por fuera de convenio arriba). Se guarda antes de aplicar
  // el filtro de `reanudar` porque es el denominador de calculo_total.
  const totalPeriodo = personalAProcesar.length
  if (reanudar) {
    const { data: yaLiquidados } = await supabase.from('nom_liquidaciones')
      .select('personal_id').eq('periodo_id', periodoId)
    const idsYaLiquidados = new Set((yaLiquidados || []).map((l: any) => l.personal_id))
    personalAProcesar = personalAProcesar.filter((p: any) => !idsYaLiquidados.has(p.id))
  }

  await supabase.from('nom_periodos').update({
    calculo_estado: 'calculando',
    calculo_total: totalPeriodo,
    calculo_procesados: totalPeriodo - personalAProcesar.length,
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
  // Task 2.10 (bug): Number('') === 0, así que un `valor` vacío (string
  // vacío, no NULL) topeaba TODA la base en $0 en vez de no tener tope
  // efectivo. Se trata explícitamente el string vacío/blanco como "sin
  // parámetro cargado", igual que el `?? 999999999` ya hacía con NULL.
  const topeSipa = topeRows?.[0]?.valor != null && String(topeRows[0].valor).trim() !== ''
    ? Number(topeRows[0].valor)
    : 999999999 // sin parámetro cargado: sin tope efectivo
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
  // Personal SIN fichajes y SIN ausencias aprobadas en todo el período: no
  // es "legajo incompleto" (el legajo puede estar perfecto), es que no hay
  // ningún dato de asistencia cargado. Antes esto liquidaba en $0 con todos
  // los días como falta injustificada, sin avisar. Se separa en su propia
  // lista para que quien liquida sepa que faltan cargar fichajes/licencias,
  // no que la persona faltó todo el período.
  const sinHoras: { personal_id: string; nombre: string }[] = []

  // Único punto de branching fuera_convenio vs. normal (antes duplicado en
  // dos bloques separados del loop): resuelve básico, no-remunerativo y la
  // lista de conceptos aplicables según corresponda, en un solo lugar.
  // unidad_basico / base_basico: variables GENÉRICAS (independientes de la
  // modalidad) que el concepto "básico" usa como recibo.unidadFormula /
  // recibo.baseFormula (ver migración 0039 y packages/motor/src/motor.ts,
  // que ya sabía evaluar esas dos fórmulas — solo faltaban las variables).
  // Elegidas así, en TODOS los casos BASE × UNIDAD = MONTO (verificable en
  // el PDF):
  //  - modalidad 'hora': unidad = horas liquidadas (ceil), base = valor hora.
  //  - modalidad 'mensual'/'quincenal': unidad = "días liquidados" del
  //    período (días nominales del tipo de período menos faltas
  //    injustificadas), base = básico / divisor de la modalidad (30 o 15 —
  //    el mismo divisor que ya usa calcularBasicoPeriodo para descontar
  //    faltas). Álgebra: diasLiquidados × (basico/divisor) reproduce
  //    exactamente `base - faltas*(basico/divisor)` de basico.ts, para
  //    cualquier combinación modalidad × tipoPeriodo.
  //  - fuera de convenio: sin faltas (sueldo fijo pactado), unidad = días
  //    nominales completos, base = sueldo_convenido / 30 (siempre en base
  //    mensual, igual que el resto de la empresa).
  // Pisa la fórmula de un concepto asignado por legajo con el override
  // configurado en nom_legajo_adicionales (% del básico o monto fijo).
  // 'heredado' no pisa nada: se usa la fórmula que ya trae el concepto del
  // convenio (solo cambia la ASIGNACIÓN, no el valor). generarFormula() es
  // la misma función que usa el formulario de conceptos en el cliente
  // (packages/motor/src/formulas.ts) — una sola fuente de verdad para cómo
  // se arma una fórmula porcentual/nominal.
  function aplicarOverridesAdicionales(
    conceptos: ConceptoConConvenio[],
    asignados: Map<string, { modo: string; porcentaje: number | null; monto: number | null }>
  ): ConceptoConConvenio[] {
    return conceptos.map((c) => {
      if (c.asignacion !== 'legajo') return c
      const ov = asignados.get(c.codigo)
      if (!ov || ov.modo === 'heredado') return c
      const formula = ov.modo === 'nominal'
        ? generarFormula({ modo: 'nominal', monto: ov.monto ?? 0 })
        : generarFormula({ modo: 'porcentaje', porcentaje: ov.porcentaje ?? 0, base: 'basico' })
      return { ...c, formula }
    })
  }

  function unidadYBaseBasico(
    modalidad: 'hora' | 'mensual' | 'quincenal' | null,
    basicoBase: number,
    tipoPeriodo: 'mensual' | 'quincenal',
    horasLiquidadas: number,
    valorHora: number,
    faltasInjustificadas: number,
    sinDescuento: boolean
  ): { unidadBasico: number; baseBasico: number } {
    if (modalidad === 'hora') {
      return { unidadBasico: horasLiquidadas, baseBasico: valorHora }
    }
    const divisorModalidad = modalidad === 'quincenal' ? 15 : 30
    const diasNominales = tipoPeriodo === 'mensual' ? 30 : 15
    const diasLiquidados = sinDescuento ? diasNominales : diasNominales - faltasInjustificadas
    return { unidadBasico: diasLiquidados, baseBasico: basicoBase / divisorModalidad }
  }

  async function resolverBasicoYConceptos(
    legajo: any,
    asistencia: { horasTrabajadas: number; faltasInjustificadas: number },
    personaId: string
  ): Promise<{
    basicoPeriodo: number; basicoConvenio: number; noRem: number; conceptosLegajo: ConceptoConConvenio[]
    horasLiquidadas: number; unidadBasico: number; baseBasico: number
  }> {
    const tipoPeriodo = periodo.tipo === 'mensual' ? 'mensual' : 'quincenal'
    // horas_liquidadas es informativo (CSV/grilla) independientemente de la
    // modalidad — ver plan 2026-07-29 §2.
    const horasLiquidadas = Math.ceil(asistencia.horasTrabajadas)
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
      const { unidadBasico, baseBasico } = unidadYBaseBasico(
        'mensual', basicoConvenio, tipoPeriodo, horasLiquidadas, 0, 0, true
      )
      // fuera de convenio no tiene categoría propia (categoriaNombre '') —
      // filtrarAsignados igual respeta los adicionales asignados por legajo.
      const conceptosLegajoFC = filtrarAsignados(
        conceptosMotor.filter((c) => c.convenioId === null),
        '', new Set(adicionalesPorLegajo.get(legajo.id)?.keys() ?? [])
      )
      return {
        basicoPeriodo,
        basicoConvenio,
        noRem: 0,
        conceptosLegajo: aplicarOverridesAdicionales(conceptosLegajoFC, adicionalesPorLegajo.get(legajo.id) ?? new Map()),
        horasLiquidadas, unidadBasico, baseBasico,
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
    const resultadoBasico = basico
      ? calcularBasicoPeriodo({
          modalidad: basico.modalidad as 'hora' | 'mensual' | 'quincenal',
          basico: basico.basico,
          tipoPeriodo,
          horasTrabajadas: asistencia.horasTrabajadas,
          faltasInjustificadas: asistencia.faltasInjustificadas,
        })
      : { monto: 0, horasLiquidadas: 0, valorHora: 0 }
    const { unidadBasico, baseBasico } = basico
      ? unidadYBaseBasico(
          basico.modalidad as 'hora' | 'mensual' | 'quincenal', basico.basico, tipoPeriodo,
          resultadoBasico.horasLiquidadas, resultadoBasico.valorHora, asistencia.faltasInjustificadas, false
        )
      : { unidadBasico: 0, baseBasico: 0 }
    // Solo conceptos del convenio del legajo (evita duplicar plantilla
    // global + copia de empresa tras clonar_convenio) y de su categoría —
    // salvo los `asignacion: 'legajo'` (adicionales por empleado, migración
    // 0040), que ignoran la categoría y solo entran si este legajo puntual
    // los tiene asignados vigentes (filtrarAsignados).
    const asignadosDeLegajo = new Set(adicionalesPorLegajo.get(legajo.id)?.keys() ?? [])
    const conceptosLegajo = aplicarOverridesAdicionales(
      filtrarAsignados(
        conceptosMotor.filter((c) => c.convenioId === legajo.convenio_id),
        nombreCategoria, asignadosDeLegajo
      ),
      adicionalesPorLegajo.get(legajo.id) ?? new Map()
    )

    return {
      basicoPeriodo: resultadoBasico.monto, basicoConvenio: basico?.basico ?? 0, noRem: noRem ?? 0, conceptosLegajo,
      horasLiquidadas, unidadBasico, baseBasico,
    }
  }

  const idsAProcesar = personalAProcesar.map((p: any) => p.id)
  const fichajesTodos: any[] = []
  const ausenciasTodas: any[] = []
  for (const lote of partirEnLotes(idsAProcesar, 100)) {
    const [{ data: f, error: eF }, { data: a, error: eA }] = await Promise.all([
      supabase.from('nom_v_horas_dia').select('*').in('personal_id', lote)
        .gte('timestamp', periodo.fecha_desde).lte('timestamp', periodo.fecha_hasta),
      // OJO: no filtrar con .eq('estado', 'aprobada') a secas. Del lado de
      // Presencio (fichaobra/src/store/appStore.js), el alta normal de una
      // ausencia históricamente podía guardar la fila sin `estado` (el
      // cliente compensaba mostrándola como "aprobada" via
      // ausenciaFromDB, pero en la base quedaba en NULL o en lo que sea
      // que tuviera la columna en ese momento) — un .eq estricto las
      // descartaba en silencio y esos días caían todos en
      // faltasInjustificadas. Se admite explícitamente NULL como
      // "aprobada" (comportamiento histórico) y se excluye
      // expresamente pendiente/rechazada. Se acota además por rango de
      // fechas y por empresa (antes traía TODO el historial de la
      // persona, de cualquier empresa).
      supabase.from('nom_v_ausencias').select('*').in('personal_id', lote)
        .eq('empresa_id', periodo.empresa_id)
        .or('estado.is.null,estado.eq.aprobada')
        .lte('fecha_desde', periodo.fecha_hasta)
        .gte('fecha_hasta', periodo.fecha_desde),
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

  // Task 2.5: feriados desde Presencio (empresas.config_json ->
  // moduloHorasProyecto -> feriados), vía nom_v_empresa_feriados
  // (migración 0048). El cliente service-role ya bypasea RLS.
  const { data: empFeriados, error: errFeriados } = await supabase.from('nom_v_empresa_feriados')
    .select('feriados').eq('empresa_id', periodo.empresa_id).maybeSingle()
  if (errFeriados) {
    await supabase.from('nom_periodos').update({ calculo_estado: 'error' }).eq('id', periodoId)
    return new Response(JSON.stringify({ error: `error al leer feriados: ${errFeriados.message}`, code: errFeriados.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const feriadosSet = new Set((empFeriados?.feriados || []).map((f: any) => f.fecha))

  // Task 2.12: config de horas extras/jornada por empresa (migración 0050).
  // Sin fila cargada, se comporta exactamente igual que antes (contabiliza
  // HE, sin topes, jornada 8h u 4h si es parcial).
  const { data: cfgHoras } = await supabase.from('nom_config_horas')
    .select('*').eq('empresa_id', periodo.empresa_id).maybeSingle()
  const jornadaHorasConfig = cfgHoras?.jornada_horas != null
    ? Number(cfgHoras.jornada_horas)
    : null

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

    // Override de Recursio: si el legajo tiene su propia fecha_ingreso
    // cargada, prevalece sobre la de Presencio (persona.fecha_ingreso) —
    // ver docs/superpowers/plans/2026-07-31-correcciones-legajos-liquidacion.md.
    const fechaIngresoEfectiva = legajo?.fecha_ingreso || persona.fecha_ingreso || null

    const fichajes = fichajesPorPersona.get(persona.id) ?? []
    const ausencias = ausenciasPorPersona.get(persona.id) ?? []

    const dias = construirDiasPeriodo(
      (fichajes || []).map((f: any) => ({ tipo: f.tipo, timestamp: f.timestamp })),
      (ausencias || []).map((a: any) => ({ fecha_desde: a.fecha_desde, fecha_hasta: a.fecha_hasta })),
      periodo.fecha_desde,
      periodo.fecha_hasta,
      { fechaIngreso: fechaIngresoEfectiva, fechaBaja: legajo?.fecha_baja, feriados: feriadosSet }
    )
    const jornadaHoras = jornadaHorasConfig ?? (legajo.jornada === 'parcial' ? 4 : 8)
    const asistencia = calcularAsistencia(dias, 15, jornadaHoras, {
      contabilizarHorasExtras: cfgHoras?.contabilizar_horas_extras ?? true,
      topeHorasDiarias: cfgHoras?.tope_horas_diarias != null ? Number(cfgHoras.tope_horas_diarias) : undefined,
    })
    if (cfgHoras?.contabilizar_horas_extras === false && asistencia.horasTrabajadas > jornadaHoras * dias.filter((d) => d.horaEntradaEsperada !== null).length) {
      advertencias.push({ personal_id: persona.id, mensaje: 'la persona supera las horas topadas: se paga sin recargo' })
    }

    // Sin ningún fichaje y sin ningún día cubierto por ausencia aprobada:
    // no liquidar en $0 silenciosamente, listar aparte.
    const diasConAusenciaAprobada = dias.filter((d) => d.ausenciaAprobada).length
    if (asistencia.horasTrabajadas === 0 && diasConAusenciaAprobada === 0) {
      sinHoras.push({ personal_id: persona.id, nombre: persona.nombre })
      continue
    }

    // basico_convenio se mantiene por compatibilidad con fórmulas viejas
    // que aún lo referencien directamente. unidad_basico/base_basico son las
    // variables genéricas que el concepto "básico" usa en recibo.
    // unidadFormula/baseFormula (migración 0039) para que BASE × UNIDAD =
    // MONTO sea verificable en el PDF, para cualquier modalidad — ver
    // unidadYBaseBasico más arriba.
    const { basicoPeriodo, basicoConvenio, noRem, conceptosLegajo, horasLiquidadas, unidadBasico, baseBasico } =
      await resolverBasicoYConceptos(legajo, asistencia, persona.id)

    const variablesBase = {
      basico_convenio: basicoConvenio,
      basico_periodo: basicoPeriodo,
      unidad_basico: unidadBasico,
      base_basico: baseBasico,
      horas_trabajadas: asistencia.horasTrabajadas,
      horas_liquidadas: horasLiquidadas,
      tardanzas: asistencia.tardanzas,
      faltas_injustificadas: asistencia.faltasInjustificadas,
      faltas_justificadas: asistencia.faltasJustificadas,
      horas_extra_50: asistencia.horasExtra50,
      horas_extra_100: asistencia.horasExtra100,
      horas_feriado: asistencia.horasFeriado ?? 0, // Task 2.7 (recargo feriado UOCRA, hs_feriado)
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

    // horasLiquidadas se guarda junto a la asistencia (dentro de
    // detalle_horas) para que el CSV y la grilla de LiquidacionPage.jsx
    // puedan mostrarla — ver plan 2026-07-29 §2.
    resultados.push({ personalId: persona.id, resultado, asistencia: { ...asistencia, horasLiquidadas } })
  }

  // Idempotencia: el `upsert` con `onConflict: 'periodo_id,personal_id'`
  // reemplaza sin duplicar filas, sin necesidad de borrar-todo-y-reinsertar
  // primero (evita el bug de la Task 7 donde ese borrado podía alcanzar
  // liquidaciones fuera del scope de `personalIds`).
  let procesadosAcumulados = totalPeriodo - personalAProcesar.length
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

  const totalFinal = totalPeriodo
  // Los omitidos (legajo incompleto) ESTÁN procesados: se los evaluó y se
  // decidió no liquidarlos. Si no se los cuenta acá, `completo` queda en
  // false para siempre y el cliente reinvoca hasta agotar sus reintentos
  // sin que nada cambie nunca (bug de performance del 28/07/2026).
  const procesadosFinal =
    (totalPeriodo - personalAProcesar.length) + resultados.length + omitidos.length + sinHoras.length
  const completo = procesadosFinal >= totalFinal
  await supabase.from('nom_periodos').update({
    calculo_estado: completo ? 'completo' : 'calculando',
    calculo_procesados: procesadosFinal,
  }).eq('id', periodoId)

  return new Response(JSON.stringify({ liquidadas: resultados.length, omitidos, sinHoras, advertencias, completo, procesados: procesadosFinal, total: totalFinal }), {
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

// ─── Períodos especiales: sac / sac_1 / sac_2 / vacaciones / final ──────
// (Fase 4, Task 32; aportes/contribuciones reales agregados en la Task 32b).
// A diferencia del flujo mensual/quincenal de arriba, estos períodos no
// calculan asistencia ni básico vía el motor: el monto remunerativo base
// (SAC, vacaciones no gozadas, días trabajados del mes de la baja, SAC
// proporcional) se resuelve directamente con las funciones puras de
// packages/motor/src/especiales.ts (régimen LCT) o packages/motor/src/
// uocra.ts (régimen 22.250, construcción), según a qué convenio pertenece
// cada legajo. Ese monto SÍ se corre por `liquidarConceptos` (Task 32b) como
// un único concepto remunerativo sintético junto con los conceptos reales de
// descuento/aporte_patronal del convenio del legajo, para que jubilación,
// obra social, ley 19032, retención sindical y contribuciones patronales se
// calculen exactamente igual que en el flujo mensual — ver
// conceptosAportesDelLegajo/liquidarBaseEspecial más abajo.
//
// La ÚNICA excepción, y a propósito: indemnización por antigüedad y preaviso
// (rubros LCT-only del período 'final', motivo 'despido_sin_causa') NUNCA
// pasan por el motor de conceptos. Son indemnizatorios, no remunerativos, y
// están exentos de TODAS las deducciones — incluidas las que usan
// `config.base: 'ambos'` (remunerativo + no_remunerativo, ver migración
// 0029: obra_social, retención_sindical), que de otro modo los tomarían como
// base imponible si se los pasara como concepto `no_remunerativo` al motor.
// Se calculan aparte con aritmética simple y se suman directo a bruto/neto
// fuera de `liquidarConceptos` (ver el branch 'final' abajo).
//
// "Bajo volumen" (se corren para toda la empresa un par de veces al año, o
// para una sola persona en el caso de 'final') — no necesita la maquinaria
// de lotes/reanudar del flujo de arriba: `completo: true` siempre.
//
// Simplificaciones documentadas (aceptadas explícitamente por el plan de
// la Task 32, con comentario en el punto exacto donde se aplican):
//  1. diasTrabajadosSemestre / diasTrabajadosAnio se derivan solo de
//     fecha_ingreso/fecha_baja del legajo, truncando el rango del
//     semestre/año calendario — NO se restan ausencias injustificadas
//     dentro de ese rango (a diferencia del flujo mensual, que sí calcula
//     asistencia día a día). Aproximación razonable: estos rubros ya son
//     "extraordinarios" de baja frecuencia, y un descuento por ausencias
//     puntuales dentro de un semestre/año completo es un efecto de
//     segundo orden frente a la proporción de antigüedad.
//  2. mejorRemuneracionMensualNormal (base del art. 245 LCT en un
//     despido sin causa) usa el sueldo mensual actual ya resuelto por
//     escala, no "la mejor de los últimos meses" — normalmente coinciden
//     salvo aumentos de escala muy recientes.
//  3. Legajos fuera de convenio (sin convenio/categoría) se tratan como
//     régimen 'lct' genérico para estos períodos especiales: no tienen
//     convenio propio del cual leer `regimen`, y LCT es el régimen general
//     por defecto fuera de un convenio colectivo sectorial.
const TIPOS_PERIODO_SALARIAL = ['mensual', 'quincenal', 'quincena_1', 'quincena_2']

function semestreDe(fechaHasta: string): { desde: string; hasta: string } {
  const anio = Number(fechaHasta.slice(0, 4))
  const mes = Number(fechaHasta.slice(5, 7))
  return mes <= 6
    ? { desde: `${anio}-01-01`, hasta: `${anio}-06-30` }
    : { desde: `${anio}-07-01`, hasta: `${anio}-12-31` }
}

function diasEntre(desde: string, hasta: string): number {
  const ms = new Date(hasta).getTime() - new Date(desde).getTime()
  return Math.round(ms / 86400000) + 1
}

// Días trabajados dentro de [rangoDesde, rangoHasta], truncando por
// fecha_ingreso/fecha_baja del legajo si caen dentro del rango (ver
// simplificación #1 arriba: no descuenta ausencias).
function diasTrabajadosEnRango(fechaIngreso: string | null, fechaBaja: string | null, rangoDesde: string, rangoHasta: string): number {
  let desde = rangoDesde
  let hasta = rangoHasta
  if (fechaIngreso && fechaIngreso > desde) desde = fechaIngreso
  if (fechaBaja && fechaBaja < hasta) hasta = fechaBaja
  if (hasta < desde) return 0
  return diasEntre(desde, hasta)
}

function calcularAntiguedadAnios(fechaIngreso: string | null, antiguedadReconocida: number | null, fechaReferencia: string): number {
  const reconocida = Number(antiguedadReconocida ?? 0)
  if (!fechaIngreso) return reconocida
  const ms = new Date(fechaReferencia).getTime() - new Date(fechaIngreso).getTime()
  const anios = ms / (365.25 * 24 * 3600 * 1000)
  return Math.max(anios, 0) + reconocida
}

type InsumosLegajo = {
  regimen: 'lct' | '22250'
  modalidad: 'hora' | 'mensual' | 'quincenal'
  sueldoMensual: number
  valorHora: number
}

async function liquidarPeriodoEspecial(supabase: any, periodo: any, personalIds: string[] | undefined, conceptosMotor: ConceptoConConvenio[]): Promise<Response> {
  const omitidos: { personal_id: string; nombre: string; motivo: string }[] = []
  const advertencias: { personal_id: string; mensaje: string }[] = []

  // Solo los conceptos de deducción/contribución (Task 32b): jubilación,
  // obra social, ley 19032, retención sindical, contribuciones patronales,
  // etc. Deliberadamente se excluyen 'remunerativo'/'no_remunerativo'/
  // 'informativo' del convenio (básico, presentismo, asistencia...) — acá
  // solo interesa aplicar las deducciones/contribuciones sobre el monto ya
  // resuelto por especiales.ts/uocra.ts, no recalcular básico ni otros
  // conceptos de convenio.
  const conceptosAportes = conceptosMotor.filter((c) => c.tipo === 'descuento' || c.tipo === 'aporte_patronal')

  // tope_sipa vigente para el período (mismo patrón que en el flujo mensual,
  // ver más arriba): las fórmulas seed de jubilación/ley_19032/INSSJP
  // (migración 0029) usan `min(remunerativo_acumulado, tope_sipa) * 0.11` —
  // sin este valor en variablesBase, evaluar() de interprete.ts revienta con
  // "variable desconocida: tope_sipa" en el primer legajo con convenio
  // estándar (no hay default a 0 para variables no definidas).
  const { data: topeRowsEspecial, error: errTopeEspecial } = await supabase.from('nom_parametros').select('valor')
    .eq('empresa_id', periodo.empresa_id).eq('codigo', 'tope_sipa')
    .lte('vigencia_desde', periodo.fecha_hasta)
    .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${periodo.fecha_desde}`)
    .order('vigencia_desde', { ascending: false }).limit(1)
  if (errTopeEspecial) {
    return new Response(JSON.stringify({ error: `error al leer parametros: ${errTopeEspecial.message}`, code: errTopeEspecial.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  // Task 2.10: mismo fix que el flujo mensual — Number('') === 0 topeaba
  // todo en $0 si `valor` era un string vacío en vez de NULL.
  const topeSipa = topeRowsEspecial?.[0]?.valor != null && String(topeRowsEspecial[0].valor).trim() !== ''
    ? Number(topeRowsEspecial[0].valor)
    : 999999999 // sin parámetro cargado: sin tope efectivo

  // Mismo patrón que conceptosAportesLegajo en el flujo mensual (ahí se llama
  // conceptosLegajo, ver resolverBasicoYConceptos más arriba — acá se le da
  // un nombre distinto porque este subconjunto es solo descuento/
  // aporte_patronal, no la lista completa de conceptos del legajo): fuera de
  // convenio usa los conceptos "generales" de la empresa (convenio_id null);
  // legajo normal usa los del convenio propio, filtrados por categoría con
  // filtrarPorCategoria.
  async function conceptosAportesDelLegajo(legajo: any): Promise<ConceptoConConvenio[]> {
    if (legajo.fuera_convenio) {
      return conceptosAportes.filter((c) => c.convenioId === null)
    }
    const cat = await categoriaCacheada(legajo.categoria_id)
    const nombreCategoria = cat?.nombre ?? ''
    return filtrarPorCategoria(conceptosAportes.filter((c) => c.convenioId === legajo.convenio_id), nombreCategoria)
  }

  // Wording de la advertencia de "sin aportes configurados": distingue el
  // caso de un legajo fuera_convenio (nunca tuvo convenio propio, depende de
  // los conceptos generales de la empresa) del de un legajo con convenio
  // real al que le faltan conceptos de aportes/contribuciones — no son la
  // misma situación y no hay que insinuar que a un fuera_convenio "le falta"
  // un convenio que nunca debió tener.
  function mensajeSinAportes(legajo: any, sufijoRubro: string): string {
    return legajo.fuera_convenio
      ? `sin conceptos de aportes/contribuciones generales (fuera de convenio) configurados para la empresa: ${sufijoRubro}`
      : `convenio sin conceptos de aportes/contribuciones configurados: ${sufijoRubro}`
  }

  // Nota: a diferencia del flujo mensual (que solo trae personal
  // "activo"), acá NO se filtra por estado — el período 'final' liquida
  // exactamente a alguien que probablemente ya figure inactivo en
  // Presencio (legajo.fecha_baja ya cargada), y filtrar por 'activo' lo
  // excluiría silenciosamente de su propia liquidación final.
  let queryPersonal = supabase.from('nom_v_personal').select('id, nombre, fecha_ingreso').eq('empresa_id', periodo.empresa_id)
  if (Array.isArray(personalIds) && personalIds.length > 0) queryPersonal = queryPersonal.in('id', personalIds)
  const { data: personal, error: errPersonal } = await queryPersonal
  const { data: legajos, error: errLegajos } = await supabase.from('nom_legajo').select('*').eq('empresa_id', periodo.empresa_id)
  const errLectura = errPersonal || errLegajos
  if (errLectura) {
    return new Response(JSON.stringify({ error: `error al leer datos: ${errLectura.message}`, code: errLectura.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const legajoPorPersonal = new Map((legajos || []).map((l: any) => [l.personal_id, l]))

  // Caches para no repetir queries entre legajos que comparten categoría o
  // convenio (mismo patrón que basicoCacheado/noRemCacheado del flujo
  // mensual, ver arriba).
  const cacheCategoria = new Map<string, { convenio_id: string; nombre: string } | null>()
  async function categoriaCacheada(categoriaId: string) {
    if (!cacheCategoria.has(categoriaId)) {
      const { data } = await supabase.from('nom_categorias').select('convenio_id, nombre').eq('id', categoriaId).maybeSingle()
      cacheCategoria.set(categoriaId, data ?? null)
    }
    return cacheCategoria.get(categoriaId) ?? null
  }
  const cacheRegimen = new Map<string, string | null>()
  async function regimenCacheado(convenioId: string) {
    if (!cacheRegimen.has(convenioId)) {
      const { data } = await supabase.from('nom_convenios').select('regimen').eq('id', convenioId).maybeSingle()
      cacheRegimen.set(convenioId, data?.regimen ?? null)
    }
    return cacheRegimen.get(convenioId) ?? null
  }
  const cacheBasico = new Map<string, { basico: number; modalidad: string } | null>()
  async function basicoCacheadoEspecial(convenioId: string | null, nombre: string) {
    const clave = `${convenioId}:${nombre}`
    if (!cacheBasico.has(clave)) cacheBasico.set(clave, await resolverBasico(supabase, convenioId, nombre, periodo.fecha_hasta))
    return cacheBasico.get(clave) ?? null
  }

  async function resolverInsumosLegajo(legajo: any): Promise<InsumosLegajo | { error: string }> {
    if (legajo.fuera_convenio) {
      // Ver simplificación #3: sin convenio propio, se trata como LCT.
      if (!legajo.sueldo_convenido) return { error: 'sin sueldo convenido (legajo fuera de convenio)' }
      return { regimen: 'lct', modalidad: 'mensual', sueldoMensual: Number(legajo.sueldo_convenido), valorHora: 0 }
    }
    if (!legajo.convenio_id || !legajo.categoria_id) return { error: 'legajo sin convenio o categoría' }
    const cat = await categoriaCacheada(legajo.categoria_id)
    if (!cat) return { error: 'categoría del legajo no encontrada' }
    let basico = await basicoCacheadoEspecial(legajo.convenio_id, cat.nombre)
    if (basico === null) basico = await basicoCacheadoEspecial(cat.convenio_id, cat.nombre)
    if (basico === null || basico.basico === 0) return { error: `sin escala vigente para "${cat.nombre}" al ${periodo.fecha_hasta}` }
    const regimen = await regimenCacheado(legajo.convenio_id)
    if (regimen !== 'lct' && regimen !== '22250') return { error: 'convenio sin régimen configurado (nom_convenios.regimen)' }
    const modalidad = basico.modalidad as 'hora' | 'mensual' | 'quincenal'
    const sueldoMensual = modalidad === 'hora' ? 0 : modalidad === 'quincenal' ? basico.basico * 2 : basico.basico
    const valorHora = modalidad === 'hora' ? basico.basico : 0
    return { regimen: regimen as 'lct' | '22250', modalidad, sueldoMensual, valorHora }
  }

  // Períodos salariales del semestre que termina en periodo.fecha_hasta,
  // para el cálculo de "mejor remuneración del semestre" del SAC (una sola
  // consulta para toda la empresa, reusada por persona).
  const semestre = semestreDe(periodo.fecha_hasta)
  const diasSemestre = diasEntre(semestre.desde, semestre.hasta)
  const { data: periodosSemestre, error: errPerSem } = await supabase.from('nom_periodos').select('id')
    .eq('empresa_id', periodo.empresa_id).in('tipo', TIPOS_PERIODO_SALARIAL)
    .gte('fecha_desde', semestre.desde).lte('fecha_desde', semestre.hasta)
  if (errPerSem) {
    return new Response(JSON.stringify({ error: `error al leer períodos del semestre: ${errPerSem.message}`, code: errPerSem.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const idsPeriodosSemestre = (periodosSemestre || []).map((p: any) => p.id)

  // Task 2.1 (bug C1): antes devolvía un bruto por LIQUIDACIÓN (cada
  // quincena ≈ mitad del mes), así que Math.max(...) tomaba la mejor
  // quincena en vez del mejor mes, y calcularSACProporcionalUocra terminaba
  // pagando 25% del mes en vez de 50%. Acá se consolidan las liquidaciones
  // por mes calendario (a partir de nom_periodos.fecha_desde) antes de
  // devolver los brutos, así el llamador siempre recibe brutos MENSUALES.
  async function brutosMensualesDelSemestre(personalId: string, idsPeriodos: string[]): Promise<number[]> {
    if (idsPeriodos.length === 0) return []
    const { data: liqs } = await supabase.from('nom_liquidaciones').select('bruto, periodo_id')
      .eq('personal_id', personalId).in('periodo_id', idsPeriodos)
    const idsUnicos = [...new Set((liqs || []).map((l: any) => l.periodo_id))]
    const { data: periodos } = idsUnicos.length
      ? await supabase.from('nom_periodos').select('id, fecha_desde').in('id', idsUnicos)
      : { data: [] }
    const mesDeId = new Map((periodos || []).map((p: any) => [p.id, String(p.fecha_desde).slice(0, 7)]))
    const porMes = new Map<string, number>()
    for (const l of liqs || []) {
      const mes = mesDeId.get(l.periodo_id)
      if (!mes) continue
      porMes.set(mes, (porMes.get(mes) ?? 0) + Number(l.bruto))
    }
    return [...porMes.values()]
  }

  // reglaAplicada/unidadTexto/baseCalculo/grupoRecibo/detalleRecibo quedan
  // undefined para los ítems que NO pasan por liquidarConceptos
  // (indemnización/preaviso, ver arriba) — se completan solo para los que sí.
  type ItemEspecial = {
    codigo: string; nombre: string; tipo: string; monto: number
    reglaAplicada?: number | 'base'; unidadTexto?: string | null; baseCalculo?: number | null
    grupoRecibo?: string | null; detalleRecibo?: string | null
  }
  const resultados: {
    personalId: string; bruto: number; neto: number
    totalAportes: number; totalContribuciones: number
    items: ItemEspecial[]; esFinal?: boolean
  }[] = []

  // Corre el monto remunerativo base de un período especial (SAC,
  // vacaciones, o el combinado de la liquidación final) por
  // `liquidarConceptos` (Task 32b) junto a los conceptos reales de
  // deducción/contribución del legajo, como si fuera un único concepto
  // remunerativo sintético. `orden: 0` para que corra primero y deje
  // remunerativo_acumulado seteado cuando evalúan los conceptos de
  // aportes/contribuciones (que suelen basarse en `base: 'remunerativo'`).
  function liquidarBaseEspecial(codigo: string, nombre: string, monto: number, conceptosAportesLegajo: ConceptoConConvenio[]) {
    const conceptoBaseEspecial: Concepto = {
      codigo, nombre, tipo: 'remunerativo', orden: 0, formula: String(monto), imprimible: true, categorias: null,
    }
    const resultado = liquidarConceptos([conceptoBaseEspecial, ...conceptosAportesLegajo], { tope_sipa: topeSipa })
    const items: ItemEspecial[] = resultado.items.map((i) => ({
      codigo: i.codigo, nombre: i.nombre, tipo: i.tipo, monto: i.monto,
      reglaAplicada: i.reglaAplicada, unidadTexto: i.unidadTexto, baseCalculo: i.baseCalculo,
      grupoRecibo: i.grupoRecibo, detalleRecibo: i.detalleRecibo,
    }))
    const totalContribuciones = resultado.items.filter((i) => i.tipo === 'aporte_patronal').reduce((s, i) => s + i.monto, 0)
    return { bruto: resultado.bruto, neto: resultado.neto, totalAportes: resultado.totalDescuentos, totalContribuciones, items }
  }

  for (const persona of personal || []) {
    const legajo = legajoPorPersonal.get(persona.id)
    if (!legajo) {
      omitidos.push({ personal_id: persona.id, nombre: persona.nombre, motivo: 'sin legajo cargado' })
      continue
    }
    if (periodo.tipo === 'final' && (!legajo.fecha_baja || !legajo.motivo_baja)) {
      omitidos.push({ personal_id: persona.id, nombre: persona.nombre, motivo: 'falta fecha_baja o motivo_baja: no se puede liquidar el final' })
      continue
    }

    const insumos = await resolverInsumosLegajo(legajo)
    if ('error' in insumos) {
      omitidos.push({ personal_id: persona.id, nombre: persona.nombre, motivo: insumos.error })
      continue
    }

    // Mismo override que en el flujo mensual: legajo.fecha_ingreso (Recursio)
    // prevalece sobre persona.fecha_ingreso (Presencio).
    const fechaIngresoEfectiva = legajo?.fecha_ingreso || persona.fecha_ingreso || null
    const antiguedadAnios = calcularAntiguedadAnios(fechaIngresoEfectiva, legajo.antiguedad_reconocida, periodo.fecha_hasta)

    if (periodo.tipo === 'sac' || periodo.tipo === 'sac_1' || periodo.tipo === 'sac_2') {
      const brutos = await brutosMensualesDelSemestre(persona.id, idsPeriodosSemestre)
      if (brutos.length === 0) {
        advertencias.push({ personal_id: persona.id, mensaje: 'sin liquidaciones mensuales/quincenales en el semestre: SAC calculado en $0' })
      }
      const diasTrabajados = diasTrabajadosEnRango(fechaIngresoEfectiva, legajo.fecha_baja, semestre.desde, semestre.hasta)
      const monto = insumos.regimen === '22250'
        ? calcularSACProporcionalUocra(brutos.length ? Math.max(...brutos) : 0, diasTrabajados, diasSemestre)
        : calcularSACLct({ mejoresBrutosPorMes: brutos, diasTrabajadosSemestre: diasTrabajados, diasSemestre })
      const conceptosAportesLegajo = await conceptosAportesDelLegajo(legajo)
      if (conceptosAportesLegajo.length === 0) {
        // Sin aportes/descuentos configurados: no es necesariamente un error
        // (podría ser una configuración real), pero sí una brecha de
        // configuración inusual — se surface como advertencia en vez de
        // guardar $0 de aportes en silencio.
        advertencias.push({ personal_id: persona.id, mensaje: mensajeSinAportes(legajo, 'SAC liquidado sin deducciones') })
      }
      const r = liquidarBaseEspecial('sac', 'SAC', monto, conceptosAportesLegajo)
      resultados.push({ personalId: persona.id, bruto: r.bruto, neto: r.neto, totalAportes: r.totalAportes, totalContribuciones: r.totalContribuciones, items: r.items })
      continue
    }

    if (periodo.tipo === 'vacaciones') {
      // Vacaciones GOZADAS (Liquidaciones individuales): el monto sale de
      // los días REALES del período (que vienen de una ausencia tipo
      // 'vacaciones' aprobada en Presencio, o de un rango cargado a mano —
      // ver liquidacionStore.crearPeriodoVacaciones), no de una fórmula por
      // antigüedad. "Vacaciones no gozadas" (antigüedad) sigue existiendo,
      // pero solo como parte de la liquidación final (periodo.tipo ===
      // 'final', más abajo) — no se toca acá.
      const monto = montoVacacionesGozadas({
        fechaDesde: periodo.fecha_desde, fechaHasta: periodo.fecha_hasta,
        modalidad: insumos.modalidad, sueldoMensual: insumos.sueldoMensual, valorHora: insumos.valorHora,
      })
      const conceptosAportesLegajo = await conceptosAportesDelLegajo(legajo)
      if (conceptosAportesLegajo.length === 0) {
        advertencias.push({ personal_id: persona.id, mensaje: mensajeSinAportes(legajo, 'vacaciones liquidadas sin deducciones') })
      }
      const r = liquidarBaseEspecial('vacaciones', 'Vacaciones gozadas', monto, conceptosAportesLegajo)
      resultados.push({ personalId: persona.id, bruto: r.bruto, neto: r.neto, totalAportes: r.totalAportes, totalContribuciones: r.totalContribuciones, items: r.items })
      continue
    }

    // periodo.tipo === 'final' (único caso restante; siempre 1 solo legajo,
    // el llamador pasa personalIds: [id]). El semestre relevante para el
    // SAC proporcional es el que contiene fecha_baja, no periodo.fecha_hasta
    // (en la práctica suelen coincidir, pero se calcula explícito).
    const fechaBaja = legajo.fecha_baja as string
    const semestreFinal = semestreDe(fechaBaja)
    const diasSemestreFinal = diasEntre(semestreFinal.desde, semestreFinal.hasta)
    const { data: periodosSemestreFinal, error: errPerSemFinal } = await supabase.from('nom_periodos').select('id')
      .eq('empresa_id', periodo.empresa_id).in('tipo', TIPOS_PERIODO_SALARIAL)
      .gte('fecha_desde', semestreFinal.desde).lte('fecha_desde', semestreFinal.hasta)
    if (errPerSemFinal) {
      return new Response(JSON.stringify({ error: `error al leer períodos del semestre de la baja: ${errPerSemFinal.message}`, code: errPerSemFinal.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const idsSemestreFinal = (periodosSemestreFinal || []).map((p: any) => p.id)
    const brutos = await brutosMensualesDelSemestre(persona.id, idsSemestreFinal)
    const mejorBruto = brutos.length ? Math.max(...brutos) : 0
    const diasTrabajadosSemestreFinal = diasTrabajadosEnRango(fechaIngresoEfectiva, fechaBaja, semestreFinal.desde, semestreFinal.hasta)
    const anioBaja = Number(fechaBaja.slice(0, 4))
    const diasTrabajadosAnioFinal = diasTrabajadosEnRango(fechaIngresoEfectiva, fechaBaja, `${anioBaja}-01-01`, `${anioBaja}-12-31`)
    // Días trabajados del mes de la baja (Task 2.10, antes era solo el día
    // de fecha_baja, sin restar las faltas injustificadas del tramo): del
    // día 1 al día de fecha_baja inclusive, MENOS las faltas injustificadas
    // detectadas en ese tramo (mismo criterio que calcularAsistencia — un
    // día laborable sin fichaje y sin ausencia aprobada).
    const primerDiaMesBaja = `${fechaBaja.slice(0, 7)}-01`
    const diasCalendarioTramoBaja = Number(fechaBaja.slice(8, 10))
    const { data: fichajesTramoBaja, error: errFichajesTramoBaja } = await supabase.from('nom_v_horas_dia')
      .select('*').eq('personal_id', persona.id)
      .gte('timestamp', primerDiaMesBaja).lte('timestamp', fechaBaja)
    const { data: ausenciasTramoBaja, error: errAusenciasTramoBaja } = await supabase.from('nom_v_ausencias')
      .select('fecha_desde, fecha_hasta').eq('personal_id', persona.id).eq('empresa_id', periodo.empresa_id)
      .or('estado.is.null,estado.eq.aprobada')
      .lte('fecha_desde', fechaBaja).gte('fecha_hasta', primerDiaMesBaja)
    if (errFichajesTramoBaja || errAusenciasTramoBaja) {
      const e = (errFichajesTramoBaja || errAusenciasTramoBaja)!
      return new Response(JSON.stringify({ error: `error al leer asistencia del tramo de baja: ${e.message}`, code: e.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const diasTramoBaja = construirDiasPeriodo(
      (fichajesTramoBaja || []).map((f: any) => ({ tipo: f.tipo, timestamp: f.timestamp })),
      (ausenciasTramoBaja || []).map((a: any) => ({ fecha_desde: a.fecha_desde, fecha_hasta: a.fecha_hasta })),
      primerDiaMesBaja, fechaBaja,
      { fechaIngreso: fechaIngresoEfectiva, fechaBaja }
    )
    const faltasInjustificadasTramoBaja = calcularAsistencia(diasTramoBaja, 15).faltasInjustificadas
    const diasTrabajadosMes = Math.max(0, diasCalendarioTramoBaja - faltasInjustificadasTramoBaja)

    // montoBaseEspecial: monto remunerativo combinado (días trabajados del
    // mes + SAC proporcional + vacaciones no gozadas en LCT; vacaciones no
    // gozadas + SAC proporcional en UOCRA — este régimen no tiene "días
    // trabajados del mes" como concepto propio, ver calcularLiquidacionFinal
    // de uocra.ts) que sí corre por liquidarConceptos más abajo, como un
    // único concepto sintético (Task 32b). itemsNoRemunerativos
    // (indemnización/preaviso) quedan afuera a propósito — ver el comentario
    // grande sobre períodos especiales más arriba.
    let montoBaseEspecial: number
    const itemsNoRemunerativos: ItemEspecial[] = []
    if (insumos.regimen === '22250') {
      // Task 2.2 (art. 152 LCT, aplicado por analogía al régimen UOCRA):
      // proporcional a los días trabajados del año de la baja, no la
      // escala completa.
      const diasVacNoGozados = diasVacacionesPorAntiguedadUocra(antiguedadAnios) * (diasTrabajadosAnioFinal / 365)
      const r = calcularLiquidacionFinalUocra({
        remuneracionMensual: insumos.sueldoMensual,
        antiguedadAnios,
        diasVacacionesNoGozados: diasVacNoGozados,
        mejorRemuneracionSemestre: mejorBruto,
        diasTrabajadosSemestre: diasTrabajadosSemestreFinal,
      })
      montoBaseEspecial = r.vacacionesNoGozadas + r.sacProporcional
    } else {
      const sacProporcional = calcularSACLct({ mejoresBrutosPorMes: brutos, diasTrabajadosSemestre: diasTrabajadosSemestreFinal, diasSemestre: diasSemestreFinal })
      const vacacionesNoGozadas = calcularVacacionesLct({
        antiguedadAnios, diasTrabajadosAnio: diasTrabajadosAnioFinal, modalidad: insumos.modalidad,
        sueldoMensual: insumos.sueldoMensual, valorHora: insumos.valorHora,
      }).total
      // mejorRemuneracionMensualNormal: ver simplificación #2 (sueldo
      // mensual actual, no "mejor de los últimos meses").
      const r = calcularLiquidacionFinalLct({
        motivoBaja: legajo.motivo_baja,
        diasTrabajadosMes,
        sueldoMensual: insumos.sueldoMensual,
        sacProporcional,
        vacacionesNoGozadas,
        antiguedadAnios,
        mejorRemuneracionMensualNormal: insumos.sueldoMensual,
      })
      montoBaseEspecial = r.montoDiasTrabajadosMes + r.sacProporcional + r.vacacionesNoGozadas
      // Indemnización y preaviso son NO remunerativos y NUNCA pasan por
      // liquidarConceptos (exentos de toda deducción, incluidas las de
      // base 'ambos' como obra_social/retención_sindical — ver el
      // comentario grande sobre períodos especiales más arriba) — art.
      // 245/231 LCT. Se suman aparte, directo a bruto/neto, más abajo.
      if (r.indemnizacionAntiguedad > 0) itemsNoRemunerativos.push({ codigo: 'indemnizacion_antiguedad', nombre: 'Indemnización por antigüedad', tipo: 'no_remunerativo', monto: r.indemnizacionAntiguedad })
      if (r.preaviso > 0) itemsNoRemunerativos.push({ codigo: 'preaviso', nombre: 'Preaviso', tipo: 'no_remunerativo', monto: r.preaviso })
    }

    const conceptosAportesLegajo = await conceptosAportesDelLegajo(legajo)
    if (conceptosAportesLegajo.length === 0) {
      advertencias.push({ personal_id: persona.id, mensaje: mensajeSinAportes(legajo, 'liquidación final sin deducciones sobre la parte remunerativa') })
    }
    const r = liquidarBaseEspecial('especial_final', 'Liquidación final (días trab. + SAC prop. + vacaciones no gozadas)', montoBaseEspecial, conceptosAportesLegajo)
    const montoNoRemunerativo = itemsNoRemunerativos.reduce((s, i) => s + i.monto, 0)
    resultados.push({
      personalId: persona.id,
      bruto: r.bruto + montoNoRemunerativo,
      neto: r.neto + montoNoRemunerativo,
      totalAportes: r.totalAportes,
      totalContribuciones: r.totalContribuciones,
      items: [...r.items, ...itemsNoRemunerativos],
      esFinal: true,
    })
  }

  if (resultados.length === 0) {
    return new Response(JSON.stringify({ liquidadas: 0, omitidos, advertencias, completo: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const filasLiquidacion = resultados.map((r) => ({
    empresa_id: periodo.empresa_id, periodo_id: periodo.id, personal_id: r.personalId,
    bruto: r.bruto, neto: r.neto, total_aportes: r.totalAportes, total_contribuciones: r.totalContribuciones,
    detalle_horas: null, estado: 'preliminar',
  }))
  const { data: liqs, error: errUpsert } = await supabase.from('nom_liquidaciones')
    .upsert(filasLiquidacion, { onConflict: 'periodo_id,personal_id' })
    .select('id, personal_id')
  if (errUpsert) {
    return new Response(JSON.stringify({ error: `error al guardar liquidaciones: ${errUpsert.message}`, code: errUpsert.code }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const liqIdPorPersonal = new Map((liqs || []).map((l: any) => [l.personal_id, l.id]))
  const idsLiq = [...liqIdPorPersonal.values()]
  if (idsLiq.length > 0) {
    await supabase.from('nom_liquidacion_items').delete().in('liquidacion_id', idsLiq)
  }
  const itemsInsert = resultados.flatMap((r) => {
    const liqId = liqIdPorPersonal.get(r.personalId)
    if (!liqId) return []
    return r.items.map((i) => ({
      empresa_id: periodo.empresa_id, liquidacion_id: liqId, concepto_codigo: i.codigo,
      concepto_nombre: i.nombre, tipo: i.tipo, monto: i.monto,
      // Los ítems que pasaron por liquidarConceptos (Task 32b) traen su
      // reglaAplicada real; indemnización/preaviso (que nunca pasan por el
      // motor) no tienen una, y se documentan con el marcador de siempre.
      regla_aplicada: i.reglaAplicada !== undefined ? String(i.reglaAplicada) : 'periodo_especial',
      unidad_texto: i.unidadTexto ?? null, base_calculo: i.baseCalculo ?? null,
      grupo_recibo: i.grupoRecibo ?? null, detalle_recibo: i.detalleRecibo ?? null,
    }))
  })
  if (itemsInsert.length > 0) {
    await supabase.from('nom_liquidacion_items').insert(itemsInsert)
  }

  // 'final': además de la liquidación en sí, el legajo queda apuntando a
  // ella vía liquidacion_final_id (migración 0018) — así el resto de la
  // app sabe que esta persona ya tiene su liquidación final generada.
  if (periodo.tipo === 'final') {
    for (const r of resultados) {
      if (!r.esFinal) continue
      const liqId = liqIdPorPersonal.get(r.personalId)
      if (!liqId) continue
      await supabase.from('nom_legajo').update({ liquidacion_final_id: liqId }).eq('personal_id', r.personalId).eq('empresa_id', periodo.empresa_id)
    }
  }

  await supabase.from('nom_periodos').update({ calculo_estado: 'completo', calculo_procesados: resultados.length }).eq('id', periodo.id)

  return new Response(JSON.stringify({ liquidadas: resultados.length, omitidos, advertencias, completo: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
