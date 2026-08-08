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
})

export const excepcionFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, personalId: r.personal_id, bonoId: r.bono_id,
  monto: r.monto == null ? null : Number(r.monto),
})

export const useBonosStore = create((set) => ({
  bonos: [], aplicaciones: [], excepciones: [], cargando: false, error: null,

  cargarBonos: async (empresaId) => {
    set({ cargando: true, error: null })
    const [{ data: bonos, error: errBonos }, { data: aplic, error: errAplic }, { data: excep, error: errExcep }] = await Promise.all([
      supabase.from('nom_bonos').select('*').order('nombre'),
      supabase.from('nom_bono_aplicaciones').select('*').eq('empresa_id', empresaId),
      supabase.from('nom_bono_excepciones').select('*').eq('empresa_id', empresaId),
    ])
    const err = errBonos || errAplic || errExcep
    if (err) { set({ error: err.message, cargando: false }); return }
    set({
      bonos: (bonos || []).map(bonoFromDB),
      aplicaciones: (aplic || []).map(aplicacionFromDB),
      excepciones: (excep || []).map(excepcionFromDB),
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
  // empresa) con un monto. Upsert por (empresa, obra, bono) — UNIQUE de 0062.
  aplicarBono: async ({ empresaId, obraId, bonoId, monto }) => {
    const { data, error } = await supabase.from('nom_bono_aplicaciones')
      .upsert({ empresa_id: empresaId, obra_id: obraId ?? null, bono_id: bonoId, monto }, { onConflict: 'empresa_id,obra_id,bono_id' })
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
