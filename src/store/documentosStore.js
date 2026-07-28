import { create } from 'zustand'
import { supabase } from '../lib/supabase'

const BUCKET = 'nom-documentos'

export const requeridoFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, codigo: r.codigo, nombre: r.nombre,
  obligatorio: r.obligatorio, vence: r.vence, diasAviso: r.dias_aviso, orden: r.orden,
})

export const requeridoToDB = (r, empresaId) => ({
  empresa_id: empresaId, codigo: r.codigo, nombre: r.nombre,
  obligatorio: r.obligatorio ?? true, vence: r.vence ?? false,
  dias_aviso: Number(r.diasAviso ?? 30), orden: Number(r.orden ?? 100),
})

// `origen` distingue los documentos propios de Recursio de los que vienen
// de Presencio (documentos_personal). La ficha muestra una sola lista con
// los dos orígenes; solo los de origen 'recursio' son editables desde acá.
export const documentoFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, personalId: r.personal_id, requeridoId: r.requerido_id,
  nombre: r.nombre, storagePath: r.storage_path, fechaEmision: r.fecha_emision,
  fechaVencimiento: r.fecha_vencimiento, observaciones: r.observaciones, origen: 'recursio',
})

export const documentoPresencioFromDB = (r) => ({
  id: `presencio:${r.id}`, personalId: r.personal_id, requeridoId: null,
  nombre: r.nombre, storagePath: null, fechaEmision: null,
  fechaVencimiento: r.fecha_vencimiento ?? null, observaciones: null, origen: 'presencio',
})

// Estado de vencimiento con los días de aviso configurados por documento.
// `hoy` es inyectable para poder testear sin congelar el reloj.
export function estadoDocumento(doc, diasAviso = 30, hoy = new Date().toISOString().slice(0, 10)) {
  if (!doc.fechaVencimiento) return { clave: 'sin_vencimiento', label: 'Sin vencimiento', clase: 'badge-neutral' }
  const dias = Math.floor((new Date(doc.fechaVencimiento) - new Date(hoy)) / 86400000)
  if (dias < 0) return { clave: 'vencido', label: 'Vencido', clase: 'badge-danger' }
  if (dias <= diasAviso) return { clave: 'por_vencer', label: `Por vencer (${dias} d)`, clase: 'badge-warning' }
  return { clave: 'vigente', label: 'Vigente', clase: 'badge-success' }
}

// Documentos obligatorios de la empresa que esta persona todavía no cargó.
export function faltantes(requeridos, documentos) {
  const cargados = new Set(documentos.map((d) => d.requeridoId).filter(Boolean))
  return requeridos.filter((r) => r.obligatorio && !cargados.has(r.id))
}

export const useDocumentosStore = create((set, get) => ({
  requeridos: [], documentos: [], cargando: false, error: null,

  cargarRequeridos: async (empresaId) => {
    if (!empresaId) { set({ requeridos: [] }); return }
    const { data, error } = await supabase.from('nom_documentos_requeridos').select('*')
      .eq('empresa_id', empresaId).order('orden').order('nombre')
    if (error) { set({ error: error.message }); return }
    set({ requeridos: (data || []).map(requeridoFromDB), error: null })
  },

  guardarRequerido: async (requerido, empresaId) => {
    const row = requeridoToDB(requerido, empresaId)
    const query = requerido.id
      ? supabase.from('nom_documentos_requeridos').update(row).eq('id', requerido.id)
      : supabase.from('nom_documentos_requeridos').insert(row)
    const { error } = await query
    if (error) return { ok: false, error: error.message }
    await get().cargarRequeridos(empresaId)
    return { ok: true }
  },

  eliminarRequerido: async (id, empresaId) => {
    const { error } = await supabase.from('nom_documentos_requeridos').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    await get().cargarRequeridos(empresaId)
    return { ok: true }
  },

  // Une los documentos propios (nom_documentos_legajo) con los de
  // Presencio (documentos_personal, solo lectura).
  cargarDocumentos: async (personalId) => {
    set({ cargando: true, error: null })
    const [{ data: propios, error: errPropios }, { data: presencio }] = await Promise.all([
      supabase.from('nom_documentos_legajo').select('*').eq('personal_id', personalId).order('created_at', { ascending: false }),
      supabase.from('documentos_personal').select('*').eq('personal_id', personalId),
    ])
    if (errPropios) { set({ error: errPropios.message, cargando: false }); return }
    set({
      documentos: [
        ...(propios || []).map(documentoFromDB),
        ...(presencio || []).map(documentoPresencioFromDB),
      ],
      cargando: false,
    })
  },

  // Sube el archivo al bucket privado y registra la fila. Si la subida
  // falla, no se inserta nada (nunca queda una fila apuntando a un archivo
  // inexistente). El archivo es opcional: se puede registrar solo la fecha
  // de vencimiento de un documento en papel.
  subirDocumento: async ({ archivo, nombre, requeridoId, fechaEmision, fechaVencimiento, observaciones }, personalId, empresaId) => {
    let storagePath = null
    if (archivo) {
      storagePath = `${empresaId}/${personalId}/${Date.now()}-${archivo.name.replace(/[^\w.-]/g, '_')}`
      const { error: errUpload } = await supabase.storage.from(BUCKET).upload(storagePath, archivo)
      if (errUpload) return { ok: false, error: `no se pudo subir el archivo: ${errUpload.message}` }
    }
    const { error } = await supabase.from('nom_documentos_legajo').insert({
      empresa_id: empresaId, personal_id: personalId,
      requerido_id: requeridoId || null, nombre,
      storage_path: storagePath,
      fecha_emision: fechaEmision || null,
      fecha_vencimiento: fechaVencimiento || null,
      observaciones: observaciones || null,
    })
    if (error) return { ok: false, error: error.message }
    await get().cargarDocumentos(personalId)
    return { ok: true }
  },

  eliminarDocumento: async (id, personalId) => {
    const doc = get().documentos.find((d) => d.id === id)
    if (doc?.storagePath) await supabase.storage.from(BUCKET).remove([doc.storagePath])
    const { error } = await supabase.from('nom_documentos_legajo').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    await get().cargarDocumentos(personalId)
    return { ok: true }
  },

  // URL firmada de 60 s para ver/descargar sin exponer el bucket.
  urlFirmada: async (storagePath) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60)
    if (error) return { ok: false, error: error.message }
    return { ok: true, url: data.signedUrl }
  },
}))
