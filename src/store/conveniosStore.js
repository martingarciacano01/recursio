import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const convenioFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, nombre: r.nombre, regimen: r.regimen, descripcion: r.descripcion,
  modalidad: r.modalidad,
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
  // migración 0012/0013). Devuelve el id del convenio propio. empresaId es
  // necesario cuando lo ejecuta un Superadmin "viendo como" una empresa
  // (auth_empresa_id() da NULL para él); para un usuario normal se ignora
  // del lado del servidor.
  clonarConvenio: async (convenioGlobalId, empresaId) => {
    const { data, error } = await supabase.rpc('clonar_convenio', {
      convenio_global_id: convenioGlobalId, p_empresa_id: empresaId ?? null,
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true, convenioId: data }
  },

  // Alta de un convenio propio desde cero (Configuración → Convenios),
  // sin depender de clonar un template global. Fechas de corte con default
  // 1-15/16-fin/1-fin si no se pasan explícitas.
  crearConvenio: async (empresaId, { nombre, regimen, modalidad, descripcion, corteQ1Desde, corteQ1Hasta, corteQ2Desde, corteQ2Hasta, corteMensualDesde, corteMensualHasta }) => {
    const { data, error } = await supabase.from('nom_convenios').insert({
      empresa_id: empresaId, nombre, regimen, modalidad: modalidad || 'quincenal', descripcion: descripcion ?? null,
      corte_q1_desde: corteQ1Desde ?? 1, corte_q1_hasta: corteQ1Hasta ?? 15,
      corte_q2_desde: corteQ2Desde ?? 16, corte_q2_hasta: corteQ2Hasta ?? null,
      corte_mensual_desde: corteMensualDesde ?? 1, corte_mensual_hasta: corteMensualHasta ?? null,
    }).select().single()
    if (error) return { ok: false, error: error.message }
    await get().cargarConvenios(empresaId, { forzar: true })
    return { ok: true, convenioId: data.id }
  },

  // Edita modalidad y/o fechas de corte de un convenio existente.
  actualizarConvenio: async (convenioId, cambios) => {
    const columnas = {
      ...(cambios.modalidad !== undefined && { modalidad: cambios.modalidad }),
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
      convenios: state.convenios.map((c) => (c.id === convenioId ? { ...c, ...cambios } : c)),
    }))
    return { ok: true }
  },
}))
