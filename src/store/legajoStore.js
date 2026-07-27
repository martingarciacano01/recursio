import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Mappers puros (sin red) — testeados por separado del resto del store.
export const legajoFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, personalId: r.personal_id, cuil: r.cuil,
  fechaNacimiento: r.fecha_nacimiento, domicilio: r.domicilio, fechaIngreso: r.fecha_ingreso,
  convenioId: r.convenio_id, categoriaId: r.categoria_id, cbu: r.cbu, banco: r.banco,
  obraSocial: r.obra_social, jornada: r.jornada,
  fueraConvenio: r.fuera_convenio ?? false, sueldoConvenido: r.sueldo_convenido,
  fechaBaja: r.fecha_baja, motivoBaja: r.motivo_baja, liquidacionFinalId: r.liquidacion_final_id,
  localidad: r.localidad, provincia: r.provincia, codigoPostal: r.codigo_postal,
})

export const legajoToDB = (l, empresaId) => ({
  empresa_id: empresaId,
  personal_id: l.personalId,
  ...(l.cuil !== undefined && { cuil: l.cuil }),
  ...(l.fechaNacimiento !== undefined && { fecha_nacimiento: l.fechaNacimiento }),
  ...(l.domicilio !== undefined && { domicilio: l.domicilio }),
  ...(l.fechaIngreso !== undefined && { fecha_ingreso: l.fechaIngreso }),
  ...(l.convenioId !== undefined && { convenio_id: l.convenioId }),
  ...(l.categoriaId !== undefined && { categoria_id: l.categoriaId }),
  ...(l.cbu !== undefined && { cbu: l.cbu }),
  ...(l.banco !== undefined && { banco: l.banco }),
  ...(l.obraSocial !== undefined && { obra_social: l.obraSocial }),
  ...(l.jornada !== undefined && { jornada: l.jornada }),
  ...(l.fueraConvenio !== undefined && { fuera_convenio: l.fueraConvenio }),
  ...(l.sueldoConvenido !== undefined && { sueldo_convenido: l.sueldoConvenido ? Number(l.sueldoConvenido) : null }),
  ...(l.fechaBaja !== undefined && { fecha_baja: l.fechaBaja || null }),
  ...(l.motivoBaja !== undefined && { motivo_baja: l.motivoBaja || null }),
  ...(l.localidad !== undefined && { localidad: l.localidad }),
  ...(l.provincia !== undefined && { provincia: l.provincia }),
  ...(l.codigoPostal !== undefined && { codigo_postal: l.codigoPostal }),
})

export const familiarFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, personalId: r.personal_id, vinculo: r.vinculo,
  nombre: r.nombre, cuil: r.cuil, fechaNacimiento: r.fecha_nacimiento, docPath: r.doc_path,
})

export const familiarToDB = (f, personalId, empresaId) => ({
  empresa_id: empresaId,
  personal_id: personalId,
  vinculo: f.vinculo,
  nombre: f.nombre,
  ...(f.cuil !== undefined && { cuil: f.cuil || null }),
  ...(f.fechaNacimiento !== undefined && { fecha_nacimiento: f.fechaNacimiento || null }),
})

export const sancionFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, personalId: r.personal_id, tipo: r.tipo,
  motivo: r.motivo, fecha: r.fecha, diasSuspension: r.dias_suspension, docPath: r.doc_path,
})

export const sancionToDB = (s, personalId, empresaId) => ({
  empresa_id: empresaId,
  personal_id: personalId,
  tipo: s.tipo,
  motivo: s.motivo,
  fecha: s.fecha,
  ...(s.diasSuspension !== undefined && { dias_suspension: s.diasSuspension ? Number(s.diasSuspension) : null }),
})

// Contadores de secuencia por colección: si se dispara una carga nueva
// antes de que termine la anterior (ej. cambio rápido de empresaId o
// personalId), la respuesta vieja se descarta al llegar tarde en vez de
// pisar el estado con datos desactualizados (revisión de calidad, Task 8).
let seqLegajos = 0
let seqFamiliares = 0
let seqSanciones = 0

export const useLegajoStore = create((set, get) => ({
  legajos: [], familiares: [], sanciones: [], cargando: false, error: null,

  cargarLegajos: async (empresaId) => {
    const miSeq = ++seqLegajos
    set({ cargando: true, error: null })
    try {
      const { data, error } = await supabase.from('nom_legajo').select('*').eq('empresa_id', empresaId)
      if (miSeq !== seqLegajos) return // llegó una carga más nueva primero, descartar
      if (error) { set({ error: error.message, cargando: false }); return }
      set({ legajos: (data || []).map(legajoFromDB), cargando: false })
    } catch (e) {
      if (miSeq !== seqLegajos) return
      set({ error: e.message, cargando: false })
    }
  },

  guardarLegajo: async (legajo, empresaId) => {
    set({ error: null })
    try {
      const row = legajoToDB(legajo, empresaId)
      const query = legajo.id
        ? supabase.from('nom_legajo').update(row).eq('id', legajo.id).select().single()
        : supabase.from('nom_legajo').insert(row).select().single()
      const { data, error } = await query
      if (error) { set({ error: error.message }); return { ok: false, error: error.message } }
      const nuevo = legajoFromDB(data)
      set((s) => ({ legajos: legajo.id ? s.legajos.map((l) => (l.id === nuevo.id ? nuevo : l)) : [...s.legajos, nuevo] }))
      return { ok: true, legajo: nuevo }
    } catch (e) {
      set({ error: e.message })
      return { ok: false, error: e.message }
    }
  },

  cargarFamiliares: async (personalId) => {
    const miSeq = ++seqFamiliares
    set({ cargando: true, error: null })
    try {
      const { data, error } = await supabase.from('nom_familiares').select('*').eq('personal_id', personalId)
      if (miSeq !== seqFamiliares) return
      if (error) { set({ error: error.message, cargando: false }); return }
      set({ familiares: (data || []).map(familiarFromDB), cargando: false })
    } catch (e) {
      if (miSeq !== seqFamiliares) return
      set({ error: e.message, cargando: false })
    }
  },

  guardarFamiliar: async (familiar, personalId, empresaId) => {
    set({ error: null })
    try {
      const row = familiarToDB(familiar, personalId, empresaId)
      const query = familiar.id
        ? supabase.from('nom_familiares').update(row).eq('id', familiar.id).select().single()
        : supabase.from('nom_familiares').insert(row).select().single()
      const { data, error } = await query
      if (error) { set({ error: error.message }); return { ok: false, error: error.message } }
      const nuevo = familiarFromDB(data)
      set((s) => ({ familiares: familiar.id ? s.familiares.map((f) => (f.id === nuevo.id ? nuevo : f)) : [...s.familiares, nuevo] }))
      return { ok: true, familiar: nuevo }
    } catch (e) {
      set({ error: e.message })
      return { ok: false, error: e.message }
    }
  },

  eliminarFamiliar: async (id) => {
    set({ error: null })
    try {
      const { error } = await supabase.from('nom_familiares').delete().eq('id', id)
      if (error) { set({ error: error.message }); return { ok: false, error: error.message } }
      set((s) => ({ familiares: s.familiares.filter((f) => f.id !== id) }))
      return { ok: true }
    } catch (e) {
      set({ error: e.message })
      return { ok: false, error: e.message }
    }
  },

  cargarSanciones: async (personalId) => {
    const miSeq = ++seqSanciones
    set({ cargando: true, error: null })
    try {
      const { data, error } = await supabase.from('nom_sanciones_personal').select('*').eq('personal_id', personalId).order('fecha', { ascending: false })
      if (miSeq !== seqSanciones) return
      if (error) { set({ error: error.message, cargando: false }); return }
      set({ sanciones: (data || []).map(sancionFromDB), cargando: false })
    } catch (e) {
      if (miSeq !== seqSanciones) return
      set({ error: e.message, cargando: false })
    }
  },

  guardarSancion: async (sancion, personalId, empresaId) => {
    set({ error: null })
    try {
      const row = sancionToDB(sancion, personalId, empresaId)
      const query = sancion.id
        ? supabase.from('nom_sanciones_personal').update(row).eq('id', sancion.id).select().single()
        : supabase.from('nom_sanciones_personal').insert(row).select().single()
      const { data, error } = await query
      if (error) { set({ error: error.message }); return { ok: false, error: error.message } }
      const nueva = sancionFromDB(data)
      set((s) => {
        const resto = s.sanciones.filter((x) => x.id !== nueva.id)
        return { sanciones: [...resto, nueva].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)) }
      })
      return { ok: true, sancion: nueva }
    } catch (e) {
      set({ error: e.message })
      return { ok: false, error: e.message }
    }
  },

  eliminarSancion: async (id) => {
    set({ error: null })
    try {
      const { error } = await supabase.from('nom_sanciones_personal').delete().eq('id', id)
      if (error) { set({ error: error.message }); return { ok: false, error: error.message } }
      set((s) => ({ sanciones: s.sanciones.filter((x) => x.id !== id) }))
      return { ok: true }
    } catch (e) {
      set({ error: e.message })
      return { ok: false, error: e.message }
    }
  },
}))
