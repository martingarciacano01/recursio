import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Bonos no remunerativos (plan convenios-por-obra 2026-08-07, migración
// 0062): catálogo global (superadmin, empresa_id implícito NULL en la
// tabla) + aplicación por empresa/obra + excepción por persona. Sin
// `persist`: es dato salarial (regla del plan).

export const bonoFromDB = (r) => ({
  id: r.id, nombre: r.nombre, montoBase: Number(r.monto_base), descripcion: r.descripcion, activo: r.activo,
})

export const aplicacionFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, obraId: r.obra_id, bonoId: r.bono_id, monto: Number(r.monto),
  // 'fijo' (0062) = el monto se paga tal cual; 'por_horas' (0064) = el monto
  // es el valor por hora trabajada y se multiplica por las horas del período.
  tipoMonto: r.tipo_monto ?? 'fijo',
})

export const excepcionFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, personalId: r.personal_id, bonoId: r.bono_id,
  monto: r.monto == null ? null : Number(r.monto),
})

export const useBonosStore = create((set) => ({
  bonos: [], aplicaciones: [], excepciones: [], cargando: false, error: null,

  cargarBonos: async (empresaId) => {
    set({ cargando: true, error: null })
    const [bonosR, aplicR, excepR] = await Promise.all([
      supabase.from('nom_bonos').select('*').order('nombre'),
      supabase.from('nom_bono_aplicaciones').select('*').eq('empresa_id', empresaId),
      supabase.from('nom_bono_excepciones').select('*').eq('empresa_id', empresaId),
    ])
    const err = bonosR.error || aplicR.error || excepR.error
    if (err) { set({ error: err.message, cargando: false }); return }
    // Resuelve el nombre de cada persona excepcionada en la carga (antes se
    // mostraba el UUID en la tabla cuando nom_v_personal todavía no cargaba o
    // no incluía a la persona — ver crítica Liquidaciones 2026-08-09, item 13).
    let excepciones = (excepR.data || []).map(excepcionFromDB)
    if (excepciones.length) {
      const ids = [...new Set(excepciones.map((e) => e.personalId))]
      const { data: pers } = await supabase.from('nom_v_personal').select('id, nombre').in('id', ids)
      const nombrePorId = new Map((pers || []).map((p) => [p.id, p.nombre]))
      excepciones = excepciones.map((e) => ({ ...e, personalNombre: nombrePorId.get(e.personalId) || null }))
    }
    set({
      bonos: (bonosR.data || []).map(bonoFromDB),
      aplicaciones: (aplicR.data || []).map(aplicacionFromDB),
      excepciones,
      cargando: false,
    })
  },

  // Alta del catálogo global (solo superadmin — RLS lo hace cumplir del
  // lado del servidor igual, esto es solo la llamada).
  crearBonoGlobal: async (nombre, montoBase, descripcion) => {
    const { data, error } = await supabase.from('nom_bonos')
      .insert({ nombre, monto_base: montoBase, descripcion: descripcion ?? null }).select().single()
    if (error) return { ok: false, error: error.message }
    set((s) => ({ bonos: [...s.bonos, bonoFromDB(data)] }))
    return { ok: true, bono: bonoFromDB(data) }
  },

  // Aplica (o actualiza) un bono a una obra puntual (obraId null = toda la
  // empresa) con un monto fijo o por hora. Upsert por (empresa, obra, bono) —
  // UNIQUE de 0062; tipo_monto se copia con el resto (0064).
  aplicarBono: async ({ empresaId, obraId, bonoId, monto, tipoMonto }) => {
    const { data, error } = await supabase.from('nom_bono_aplicaciones')
      .upsert({ empresa_id: empresaId, obra_id: obraId ?? null, bono_id: bonoId, monto, tipo_monto: tipoMonto ?? 'fijo' }, { onConflict: 'empresa_id,obra_id,bono_id' })
      .select().single()
    if (error) return { ok: false, error: error.message }
    set((s) => ({
      aplicaciones: [...s.aplicaciones.filter((a) => !(a.obraId === (obraId ?? null) && a.bonoId === bonoId)), aplicacionFromDB(data)],
    }))
    return { ok: true }
  },

  eliminarAplicacion: async (id) => {
    const { error } = await supabase.from('nom_bono_aplicaciones').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    set((s) => ({ aplicaciones: s.aplicaciones.filter((a) => a.id !== id) }))
    return { ok: true }
  },

  // monto null = desactiva el bono para esa persona.
  setExcepcion: async ({ empresaId, personalId, bonoId, monto }) => {
    const { data, error } = await supabase.from('nom_bono_excepciones')
      .upsert({ empresa_id: empresaId, personal_id: personalId, bono_id: bonoId, monto }, { onConflict: 'empresa_id,personal_id,bono_id' })
      .select().single()
    if (error) return { ok: false, error: error.message }
    set((s) => ({
      excepciones: [...s.excepciones.filter((e) => !(e.personalId === personalId && e.bonoId === bonoId)), excepcionFromDB(data)],
    }))
    return { ok: true }
  },

  eliminarExcepcion: async (id) => {
    const { error } = await supabase.from('nom_bono_excepciones').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    set((s) => ({ excepciones: s.excepciones.filter((e) => e.id !== id) }))
    return { ok: true }
  },
}))
