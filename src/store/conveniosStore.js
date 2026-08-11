import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const convenioFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, nombre: r.nombre, regimen: r.regimen, descripcion: r.descripcion,
  obraId: r.obra_id, modalidad: r.modalidad,
  corteQ1Desde: r.corte_q1_desde, corteQ1Hasta: r.corte_q1_hasta,
  corteQ2Desde: r.corte_q2_desde, corteQ2Hasta: r.corte_q2_hasta,
  corteMensualDesde: r.corte_mensual_desde, corteMensualHasta: r.corte_mensual_hasta,
})

export const useConveniosStore = create((set, get) => ({
  convenios: [], cargando: false, error: null, cargadoEmpresaId: null,

  cargarConvenios: async (empresaId, { forzar = false } = {}) => {
    if (!forzar && get().cargadoEmpresaId === empresaId && !get().error) return
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_convenios').select('*')
      .or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order('nombre')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ convenios: (data || []).map(convenioFromDB), cargando: false, cargadoEmpresaId: empresaId })
  },

  // Clona un convenio global a la empresa (función SQL SECURITY DEFINER,
  // migración 0012/0013, extendida por 0059 con p_obra_id — plan
  // convenios-por-obra 2026-08-07). Devuelve el id del convenio propio.
  // empresaId es necesario cuando lo ejecuta un Superadmin "viendo como"
  // una empresa (auth_empresa_id() da NULL para él); para un usuario
  // normal se ignora del lado del servidor. obraId opcional: si se pasa,
  // el clon queda atado a esa obra (nom_convenios.obra_id) y solo
  // re-apunta los legajos de esa obra; sin obraId, comportamiento previo
  // (clon genérico de empresa).
  clonarConvenio: async (convenioGlobalId, empresaId, obraId) => {
    const { data, error } = await supabase.rpc('clonar_convenio', {
      convenio_global_id: convenioGlobalId, p_empresa_id: empresaId ?? null, p_obra_id: obraId ?? null,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, convenioId: data }
  },

  // Alta de un convenio propio desde cero (Configuración → Convenios),
  // sin depender de clonar un template global. Fechas de corte con default
  // 1-15/16-fin/1-fin si no se pasan explícitas. `obraId` opcional: el
  // convenio queda atado a esa obra (nom_convenios.obra_id, plan
  // convenios-por-obra) y se usa para la liquidación del personal de esa obra.
  crearConvenio: async (empresaId, { nombre, regimen, modalidad, descripcion, obraId, corteQ1Desde, corteQ1Hasta, corteQ2Desde, corteQ2Hasta, corteMensualDesde, corteMensualHasta }) => {
    const { data, error } = await supabase.from('nom_convenios').insert({
      empresa_id: empresaId, nombre, regimen, modalidad: modalidad || 'quincenal', descripcion: descripcion ?? null,
      obra_id: obraId ?? null,
      corte_q1_desde: corteQ1Desde ?? 1, corte_q1_hasta: corteQ1Hasta ?? 15,
      corte_q2_desde: corteQ2Desde ?? 16, corte_q2_hasta: corteQ2Hasta ?? null,
      corte_mensual_desde: corteMensualDesde ?? 1, corte_mensual_hasta: corteMensualHasta ?? null,
    }).select().single()
    if (error) return { ok: false, error: error.message }
    await get().cargarConvenios(empresaId, { forzar: true })
    return { ok: true, convenioId: data.id }
  },

  // Edita modalidad y/o fechas de corte de un convenio existente. `obraId`
  // se puede setear o limpiar (null = convenio genérico de empresa).
  actualizarConvenio: async (convenioId, cambios) => {
    const columnas = {
      ...(cambios.modalidad !== undefined && { modalidad: cambios.modalidad }),
      ...(cambios.obraId !== undefined && { obra_id: cambios.obraId ?? null }),
      ...(cambios.corteQ1Desde !== undefined && { corte_q1_desde: cambios.corteQ1Desde }),
      ...(cambios.corteQ1Hasta !== undefined && { corte_q1_hasta: cambios.corteQ1Hasta }),
      ...(cambios.corteQ2Desde !== undefined && { corte_q2_desde: cambios.corteQ2Desde }),
      ...(cambios.corteQ2Hasta !== undefined && { corte_q2_hasta: cambios.corteQ2Hasta }),
      ...(cambios.corteMensualDesde !== undefined && { corte_mensual_desde: cambios.corteMensualDesde }),
      ...(cambios.corteMensualHasta !== undefined && { corte_mensual_hasta: cambios.corteMensualHasta }),
    }
    const { error } = await supabase.from('nom_convenios').update(columnas).eq('id', convenioId)
    if (error) return { ok: false, error: error.message }
    set((state) => ({
      convenios: state.convenios.map((c) => (c.id === convenioId ? { ...c, ...cambios, obraId: cambios.obraId ?? null } : c)),
    }))
    return { ok: true }
  },

  // Item 11 (crítica Liquidaciones 2026-08-09): replica un convenio PROPIO
  // (a diferencia de clonar_convenio, que solo copia plantillas globales)
  // copiando estructura + valores de escalas, conceptos y reglas — sin
  // re-apuntar legajos (la copia queda sin uso, lista para editar). Permite
  // pedir una obra distinta para el clon.
  // Feedback 2026-08-09: si la copia queda atada a una obra puntual, el
  // nombre pasa a ser "convenio + nombre de obra" (identificación directa
  // en la lista); sin obra (toda la empresa) se mantiene "(copia)".
  replicarConvenio: async (convenioId, empresaId, { obraId, nombreObra } = {}) => {
    const { data: origen, error: errOrigen } = await supabase.from('nom_convenios').select('*').eq('id', convenioId).maybeSingle()
    if (errOrigen || !origen) return { ok: false, error: errOrigen?.message || 'convenio no encontrado' }
    const nombre = nombreObra ? `${origen.nombre} ${nombreObra}` : `${origen.nombre} (copia)`
    const { data: nuevo, error: errNuevo } = await supabase.from('nom_convenios').insert({
      empresa_id: empresaId, nombre, regimen: origen.regimen, descripcion: origen.descripcion,
      obra_id: obraId ?? origen.obra_id ?? null,
      modalidad: origen.modalidad,
      corte_q1_desde: origen.corte_q1_desde, corte_q1_hasta: origen.corte_q1_hasta,
      corte_q2_desde: origen.corte_q2_desde, corte_q2_hasta: origen.corte_q2_hasta,
      corte_mensual_desde: origen.corte_mensual_desde, corte_mensual_hasta: origen.corte_mensual_hasta,
    }).select().single()
    if (errNuevo) return { ok: false, error: errNuevo.message }

    const { data: cats } = await supabase.from('nom_categorias')
      .select('nombre, basico, vigencia_desde, modalidad').eq('convenio_id', convenioId)
    if ((cats || []).length > 0) {
      const { error: errCat } = await supabase.from('nom_categorias').insert(
        cats.map((c) => ({ ...c, convenio_id: nuevo.id }))
      )
      if (errCat) return { ok: false, error: errCat.message }
    }

    const { data: nrs } = await supabase.from('nom_no_remunerativos')
      .select('categoria_nombre, monto, vigencia_desde').eq('convenio_id', convenioId)
    if ((nrs || []).length > 0) {
      const { error: errNoRem } = await supabase.from('nom_no_remunerativos').insert(
        nrs.map((n) => ({ ...n, convenio_id: nuevo.id }))
      )
      if (errNoRem) return { ok: false, error: errNoRem.message }
    }

    // Copia conceptos del convenio con sus reglas. Se insertan por lote para
    // mapear concepto_id viejo → nuevo y re-apuntar las reglas.
    const { data: conceptosOrigen } = await supabase.from('nom_conceptos')
      .select('*').eq('convenio_id', convenioId)
    const reglasPorConcepto = new Map()
    for (const c of conceptosOrigen || []) {
      const { data: reglas } = await supabase.from('nom_concepto_reglas')
        .select('orden, condicion, formula').eq('concepto_id', c.id)
      reglasPorConcepto.set(c.id, reglas || [])
    }
    for (const c of conceptosOrigen || []) {
      const { data: nuevoConcepto, error: errC } = await supabase.from('nom_conceptos').insert({
        empresa_id: empresaId, convenio_id: nuevo.id,
        codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, formula: c.formula,
        orden: c.orden, imprimible: c.imprimible, categorias: c.categorias,
        config: c.config, codigo_recibo: c.codigo_recibo,
      }).select().single()
      if (errC) return { ok: false, error: errC.message }
      for (const r of reglasPorConcepto.get(c.id) || []) {
        const { error: errR } = await supabase.from('nom_concepto_reglas').insert({
          concepto_id: nuevoConcepto.id, orden: r.orden, condicion: r.condicion, formula: r.formula,
        })
        if (errR) return { ok: false, error: errR.message }
      }
    }

    await get().cargarConvenios(empresaId, { forzar: true })
    return { ok: true, convenioId: nuevo.id }
  },

  // Item 4 (sesión 2026-08-08): borrado de convenios propios. Antes no había
  // forma de quitar uno erróneo; pero borrar a ciegas dejaría legajos y
  // períodos apuntando a un convenio que ya no existe. Por eso se valida el
  // uso ANTES de eliminar: si hay legajos o períodos que lo referencian, se
  // avisa y NO se borra. `empresaId` se usa para recargar la lista tras el
  // borrado (mismo patrón que crearConvenio).
  eliminarConvenio: async (convenioId, empresaId) => {
    const [{ data: legajos }, { data: periodos }] = await Promise.all([
      supabase.from('nom_legajo').select('id').eq('convenio_id', convenioId),
      supabase.from('nom_periodos').select('id').eq('convenio_id', convenioId),
    ])
    const usos = { legajos: (legajos || []).length, periodos: (periodos || []).length }
    if (usos.legajos > 0 || usos.periodos > 0) {
      return { ok: false, error: 'un convenio no se borra si hay personal o períodos creados con él', usos }
    }
    const { data, error } = await supabase.from('nom_convenios').delete().eq('id', convenioId)
    if (error) return { ok: false, error: error.message }
    if (empresaId) await get().cargarConvenios(empresaId, { forzar: true })
    return { ok: true, data }
  },
}))
