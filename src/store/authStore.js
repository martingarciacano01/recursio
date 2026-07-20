import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Store de autenticación. NUNCA usa `persist` (Recursio_Plan_Ejecucion_Sonnet5.md,
// instrucción 6: sin persist para datos sensibles). La sesión la maneja
// supabase-js internamente (localStorage propio, compartido con Presencio);
// acá solo se guarda en memoria el perfil derivado (usuario, empresa, rol).
export const useAuthStore = create((set, get) => ({
  session: null,
  usuario: null,
  empresa: null,
  rol: null,
  cargando: true,

  // Resuelve rol y empresa_id server-side vía la RPC whoami() (mismo patrón
  // de seguridad que appStore.js de Presencio: user_metadata del JWT es
  // editable por el propio cliente, por lo que rol/empresa_id NUNCA se toman
  // de ahí directamente, solo como fallback si la RPC no está disponible).
  _resolverPerfil: async (user) => {
    const meta = user.user_metadata || {}
    let rol = meta.rol || null
    let empresaId = meta.empresa_id || null
    try {
      const { data: perfil } = await supabase.rpc('whoami').single()
      if (perfil) {
        rol = perfil.rol || rol
        empresaId = perfil.empresa_id ?? empresaId
      }
    } catch {
      // sin red o RPC no disponible: se usa el fallback de metadata
    }
    return {
      usuario: { id: user.id, email: user.email, nombre: meta.nombre || user.email.split('@')[0] },
      rol,
      empresa: empresaId ? { id: empresaId } : null,
    }
  },

  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { ok: false, error: error.message }
    const perfil = await get()._resolverPerfil(data.user)
    set({ session: data.session, ...perfil, cargando: false })
    return { ok: true }
  },

  logout: async () => {
    await supabase.auth.signOut()
    set({ session: null, usuario: null, empresa: null, rol: null })
  },

  // Se llama al montar la app: recupera la sesión existente (compartida con
  // Presencio si el usuario ya estaba logueado en ese dominio) y resuelve el
  // perfil. Si no hay sesión, cargando pasa a false sin usuario.
  cargarSesion: async () => {
    set({ cargando: true })
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      set({ session: null, usuario: null, empresa: null, rol: null, cargando: false })
      return
    }
    const perfil = await get()._resolverPerfil(data.session.user)
    set({ session: data.session, ...perfil, cargando: false })
  },
}))
