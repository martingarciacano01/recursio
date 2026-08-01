import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Fila genérica versionada: { nombre, valor, vigenciaDesde }
export const categoriaFromDB = (r) => ({
  id: r.id, convenioId: r.convenio_id, nombre: r.nombre, valor: Number(r.basico), vigenciaDesde: r.vigencia_desde,
  modalidad: r.modalidad,
})

// Agrupa filas versionadas por nombre: vigente = mayor vigenciaDesde <= hoy;
// historial completo ordenado descendente. Orden alfabético por nombre.
export function agruparVigencias(filas, hoy) {
  const porNombre = new Map()
  for (const f of filas) {
    if (!porNombre.has(f.nombre)) porNombre.set(f.nombre, [])
    porNombre.get(f.nombre).push({ valor: f.valor, vigenciaDesde: f.vigenciaDesde })
  }
  return [...porNombre.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([nombre, versiones]) => {
      const historial = [...versiones].sort((a, b) => b.vigenciaDesde.localeCompare(a.vigenciaDesde))
      const vigente = historial.find((v) => v.vigenciaDesde <= hoy) ?? null
      return { nombre, vigente, historial }
    })
}

export const useEscalasStore = create((set, get) => ({
  categorias: [], cargando: false, error: null, cargadoConvenioId: null,

  cargarEscala: async (convenioId, { forzar = false } = {}) => {
    if (!forzar && get().cargadoConvenioId === convenioId && !get().error) return
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_categorias').select('*')
      .eq('convenio_id', convenioId).order('nombre').order('vigencia_desde', { ascending: false })
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ categorias: (data || []).map(categoriaFromDB), cargando: false, cargadoConvenioId: convenioId })
  },

  // Alta de una vigencia nueva para varias categorías a la vez (paritaria).
  // filas: [{ nombre, valor }]. Nunca se actualiza una fila existente.
  guardarVigencias: async (convenioId, filas, vigenciaDesde) => {
    const rows = filas.map((f) => ({
      convenio_id: convenioId, nombre: f.nombre, basico: f.valor, vigencia_desde: vigenciaDesde,
      modalidad: f.modalidad || 'hora',
    }))
    const { error } = await supabase.from('nom_categorias').insert(rows)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  },
}))
