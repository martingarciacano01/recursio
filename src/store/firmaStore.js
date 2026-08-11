// src/store/firmaStore.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Firma del aprobador de pago para el recibo "para el Empleado" (Fase 7).
// Guardada por empresa en nom_firma_empresa (migración 0069) y como imagen
// en el bucket público nom-firmas. Mismo patrón que empresaConfigStore
// (logo del recibo, 0036): firma_url es la URL pública del storage.
const BUCKET_FIRMAS = 'nom-firmas'
export const TAMANIO_MAX_FIRMA = 2 * 1024 * 1024 // 2 MB
const TIPOS_FIRMA = ['image/png', 'image/jpeg']

export const useFirmaStore = create((set) => ({
  firmaUrl: null,
  nombreCompleto: '',
  puesto: '',
  cargando: false,
  subiendoFirma: false,
  error: null,

  cargarFirma: async (empresaId) => {
    set({ cargando: true, error: null })
    try {
      const { data, error } = await supabase.from('nom_firma_empresa')
        .select('*').eq('empresa_id', empresaId).maybeSingle()
      if (error) { set({ error: error.message, cargando: false }); return }
      set({
        firmaUrl: data?.firma_url || null,
        nombreCompleto: data?.nombre_completo || '',
        puesto: data?.puesto || '',
        cargando: false,
      })
    } catch {
      set({ error: 'no se pudo contactar el servidor', cargando: false })
    }
  },

  // Sube el archivo al bucket público y guarda la fila (upsert) con la
  // aclaración. El nombre lleva timestamp para no servir la firma vieja
  // desde caché cuando se reemplaza (mismo patrón que subirLogo).
  subirFirma: async ({ empresaId, file, nombreCompleto, puesto }) => {
    const nombre = (nombreCompleto || '').trim()
    const cargo = (puesto || '').trim()
    if (!file) return { ok: false, error: 'No se eligió ningún archivo.' }
    if (!TIPOS_FIRMA.includes(file.type)) {
      return { ok: false, error: 'La firma tiene que ser PNG o JPG.' }
    }
    if (file.size > TAMANIO_MAX_FIRMA) {
      return { ok: false, error: 'El archivo supera los 2 MB.' }
    }
    if (!nombre || !cargo) {
      return { ok: false, error: 'Nombre y puesto del aprobador son obligatorios.' }
    }

    set({ subiendoFirma: true })
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    const ruta = `${empresaId}/firma-${Date.now()}.${ext}`

    const { error: errSubida } = await supabase.storage
      .from(BUCKET_FIRMAS)
      .upload(ruta, file, { upsert: true, contentType: file.type })
    if (errSubida) { set({ subiendoFirma: false }); return { ok: false, error: errSubida.message } }

    const { data: pub } = supabase.storage.from(BUCKET_FIRMAS).getPublicUrl(ruta)
    const url = pub?.publicUrl || null

    const { data: usuario } = await supabase.auth.getUser()
    const { error: errGuardar } = await supabase.from('nom_firma_empresa')
      .upsert({ empresa_id: empresaId, firma_url: url, nombre_completo: nombre, puesto: cargo, configurado_por: usuario?.user?.id || null }, { onConflict: 'empresa_id' })
    set({ subiendoFirma: false })
    if (errGuardar) return { ok: false, error: errGuardar.message }

    set({ firmaUrl: url, nombreCompleto: nombre, puesto: cargo })
    return { ok: true, url }
  },
}))