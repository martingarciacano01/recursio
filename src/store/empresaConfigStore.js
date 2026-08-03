// src/store/empresaConfigStore.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// CUIT/domicilio/logo del recibo viven en nom_empresa_config (tabla satélite,
// migraciones 0021 y 0036); el nombre y el logo "de Presencio" se leen de
// `empresas`, que es compartida y nunca se escribe desde acá.
//
// El logo que se imprime en el recibo es nom_empresa_config.logo_url, con
// fallback a empresas.logo_url para las empresas que ya lo tenían cargado.
const BUCKET_LOGOS = 'nom-logos'
export const TAMANIO_MAX_LOGO = 2 * 1024 * 1024 // 2 MB
const TIPOS_LOGO = ['image/png', 'image/jpeg', 'image/webp']

export const useEmpresaConfigStore = create((set, get) => ({
  cuit: '', domicilio: '', nombre: '',
  logoUrl: null,          // el que se usa en el recibo (propio o heredado)
  logoPropio: null,       // solo el subido desde Nómina (habilita "Quitar")
  cargando: false, error: null, subiendoLogo: false,

  cargar: async (empresaId) => {
    set({ cargando: true, error: null })
    try {
      const [{ data: config, error: e1 }, { data: empresa, error: e2 }] = await Promise.all([
        supabase.from('nom_empresa_config').select('*').eq('empresa_id', empresaId).maybeSingle(),
        supabase.from('empresas').select('nombre, logo_url').eq('id', empresaId).single(),
      ])
      if (e1 || e2) { set({ error: (e1 || e2).message, cargando: false }); return }
      set({
        cuit: config?.cuit || '', domicilio: config?.domicilio || '',
        nombre: empresa?.nombre || '',
        logoPropio: config?.logo_url || null,
        logoUrl: config?.logo_url || empresa?.logo_url || null,
        cargando: false,
      })
    } catch {
      // Caída de red (Task 3.3).
      set({ error: 'no se pudo contactar el servidor', cargando: false })
    }
  },

  guardar: async (empresaId, { cuit, domicilio }) => {
    const { error } = await supabase.from('nom_empresa_config')
      .upsert({ empresa_id: empresaId, cuit, domicilio }, { onConflict: 'empresa_id' })
    if (error) return { ok: false, error: error.message }
    set({ cuit, domicilio })
    return { ok: true }
  },

  // Sube el archivo al bucket público y guarda su URL en nom_empresa_config.
  // El nombre lleva timestamp para que el navegador no sirva el logo viejo
  // desde caché cuando lo reemplazan.
  subirLogo: async (empresaId, archivo) => {
    if (!archivo) return { ok: false, error: 'No se eligió ningún archivo.' }
    if (!TIPOS_LOGO.includes(archivo.type)) {
      return { ok: false, error: 'El logo tiene que ser PNG, JPG o WebP.' }
    }
    if (archivo.size > TAMANIO_MAX_LOGO) {
      return { ok: false, error: 'El archivo supera los 2 MB.' }
    }

    set({ subiendoLogo: true })
    const ext = (archivo.name.split('.').pop() || 'png').toLowerCase()
    const ruta = `${empresaId}/logo-${Date.now()}.${ext}`

    const { error: errSubida } = await supabase.storage
      .from(BUCKET_LOGOS)
      .upload(ruta, archivo, { upsert: true, contentType: archivo.type })
    if (errSubida) { set({ subiendoLogo: false }); return { ok: false, error: errSubida.message } }

    const { data: pub } = supabase.storage.from(BUCKET_LOGOS).getPublicUrl(ruta)
    const url = pub?.publicUrl || null

    const { error: errGuardar } = await supabase.from('nom_empresa_config')
      .upsert({ empresa_id: empresaId, logo_url: url }, { onConflict: 'empresa_id' })
    set({ subiendoLogo: false })
    if (errGuardar) return { ok: false, error: errGuardar.message }

    set({ logoUrl: url, logoPropio: url })
    return { ok: true, url }
  },

  // Vuelve al logo de Presencio (o a "sin logo"). No borra el archivo del
  // bucket: es barato dejarlo y evita romper recibos ya emitidos.
  quitarLogo: async (empresaId) => {
    const { error } = await supabase.from('nom_empresa_config')
      .upsert({ empresa_id: empresaId, logo_url: null }, { onConflict: 'empresa_id' })
    if (error) return { ok: false, error: error.message }
    await get().cargar(empresaId)
    return { ok: true }
  },
}))
