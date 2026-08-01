import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// Store de autenticación. NUNCA usa `persist` (Recursio_Plan_Ejecucion_Sonnet5.md,
// instrucción 6: sin persist para datos sensibles). La sesión la maneja
// supabase-js internamente (localStorage propio, compartido con Presencio);
// acá solo se guarda en memoria el perfil derivado (usuario, empresa, rol).
//
// Única excepción: la empresa que un Superadmin está "viendo" se guarda en
// sessionStorage (ver EMPRESA_VISTA_KEY). No son datos sensibles —id, nombre y
// colores de marca, todo lo que ya devuelve get_empresas_superadmin()— y evita
// que recargar la página deje la app vacía. sessionStorage y no localStorage a
// propósito: la elección muere al cerrar la pestaña y no se comparte entre
// pestañas, así que no queda un contexto de empresa "pegado" para siempre.
const EMPRESA_VISTA_KEY = 'recursio:empresaVista'

function guardarEmpresaVista(empresaVista) {
  try {
    if (empresaVista) sessionStorage.setItem(EMPRESA_VISTA_KEY, JSON.stringify(empresaVista))
    else sessionStorage.removeItem(EMPRESA_VISTA_KEY)
  } catch { /* modo privado / sin storage: se sigue operando en memoria */ }
}

export function leerEmpresaVista() {
  try {
    const crudo = sessionStorage.getItem(EMPRESA_VISTA_KEY)
    if (!crudo) return null
    const v = JSON.parse(crudo)
    return v && typeof v.id === 'string' ? v : null
  } catch {
    return null
  }
}

export const useAuthStore = create((set, get) => ({
  session: null,
  usuario: null,
  empresa: null,
  rol: null,
  rolesNomina: [],
  cargando: true,

  // "Entrar en empresa": solo para usuarios Superadmin (que no tienen
  // `empresa` fija, ver SuperAdminPage.jsx). Reemplaza el patrón anterior
  // de que cada página resolviera el problema empresa-null por su cuenta
  // (parche que existió brevemente en LiquidacionPage). Sobrevive a un
  // F5 dentro de la misma pestaña vía sessionStorage; cargarSesion() la
  // descarta si el usuario ya no es superadmin.
  empresaVista: leerEmpresaVista(),

  // Resuelve rol y empresa_id server-side vía la RPC whoami() (mismo patrón
  // de seguridad que appStore.js de Presencio: user_metadata del JWT es
  // editable por el propio cliente, por lo que rol/empresa_id NUNCA se toman
  // de ahí directamente, solo como fallback si la RPC no está disponible).
  _resolverPerfil: async (user) => {
    const meta = user.user_metadata || {}
    let rol = meta.rol || null
    let empresaId = meta.empresa_id || null
    let rolesNomina = []
    try {
      const { data: perfil } = await supabase.rpc('whoami').single()
      if (perfil) {
        rol = perfil.rol || rol
        empresaId = perfil.empresa_id ?? empresaId
      }
    } catch {
      // sin red o RPC no disponible: se usa el fallback de metadata
    }
    try {
      const { data: roles } = await supabase.rpc('whoami_nomina')
      rolesNomina = roles || []
    } catch {
      // sin red o RPC no disponible: sin roles de nomina (gating cierra todo)
    }
    return {
      usuario: { id: user.id, email: user.email, nombre: meta.nombre || user.email.split('@')[0] },
      rol,
      rolesNomina,
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
    guardarEmpresaVista(null)
    set({ session: null, usuario: null, empresa: null, rol: null, rolesNomina: [], empresaVista: null })
  },

  // Solo debería llamarse con rol === 'superadmin'; no hay chequeo acá
  // porque quien la invoca (SuperAdminPage) ya filtró el acceso a la
  // página por rol.
  entrarEnEmpresa: (empresa) => {
    const empresaVista = {
      id: empresa.id,
      nombre: empresa.nombre,
      // Colores de marca de la empresa (mismos campos que devuelve
      // get_empresas_superadmin(), ya usados por Presencio para el
      // avatar de iniciales en su SuperAdminPage) — opcionales, con
      // fallback a los colores de marca de Recursio si la empresa no
      // definió los suyos.
      colorPrimario: empresa.color_primario || empresa.colorPrimario || null,
      colorSecundario: empresa.color_secundario || empresa.colorSecundario || null,
    }
    guardarEmpresaVista(empresaVista)
    set({ empresaVista })
  },

  salirDeEmpresa: () => {
    guardarEmpresaVista(null)
    set({ empresaVista: null })
  },

  // Se llama al montar la app: recupera la sesión existente (compartida con
  // Presencio si el usuario ya estaba logueado en ese dominio) y resuelve el
  // perfil. Si no hay sesión, cargando pasa a false sin usuario.
  cargarSesion: async () => {
    set({ cargando: true })
    const { data } = await supabase.auth.getSession()
    if (!data.session) {
      guardarEmpresaVista(null)
      set({ session: null, usuario: null, empresa: null, rol: null, rolesNomina: [], empresaVista: null, cargando: false })
      return
    }
    const perfil = await get()._resolverPerfil(data.session.user)
    // La empresa vista solo se rehidrata si el usuario sigue siendo
    // superadmin: es el único rol que puede operar en nombre de otra
    // empresa, y la RLS del backend igual no le daría datos a nadie más.
    const empresaVista = perfil.rol === 'superadmin' ? leerEmpresaVista() : null
    if (!empresaVista) guardarEmpresaVista(null)
    set({ session: data.session, ...perfil, empresaVista, cargando: false })
  },
}))
