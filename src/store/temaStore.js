import { create } from 'zustand'

// Tema visual de la app. Tres valores posibles:
//   'auto'   -> sigue la preferencia del sistema operativo (default)
//   'oscuro' -> forzado oscuro
//   'claro'  -> forzado claro
//
// El tema efectivo se escribe en <html data-theme="claro|oscuro">, que es lo
// que consumen las variables CSS de src/index.css. La elección se guarda en
// localStorage para que sobreviva a recargas y al modo standalone de la PWA.
const CLAVE = 'recursio:tema'

export const TEMAS = ['auto', 'claro', 'oscuro']

function mqOscuro() {
  if (typeof window === 'undefined' || !window.matchMedia) return null
  return window.matchMedia('(prefers-color-scheme: dark)')
}

export function preferenciaSistema() {
  const mq = mqOscuro()
  return mq && mq.matches ? 'oscuro' : 'claro'
}

export function leerPreferencia() {
  try {
    const v = localStorage.getItem(CLAVE)
    return TEMAS.includes(v) ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function resolverTema(preferencia) {
  return preferencia === 'auto' ? preferenciaSistema() : preferencia
}

// Aplica el tema al <html> y sincroniza la barra de estado del navegador /
// PWA (theme-color) para que no quede un borde blanco en móvil.
export function aplicarTema(efectivo) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', efectivo)
  document.documentElement.style.colorScheme = efectivo === 'claro' ? 'light' : 'dark'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', efectivo === 'claro' ? '#f3f5f8' : '#0d1117')
}

export const useTemaStore = create((set, get) => ({
  preferencia: leerPreferencia(),
  efectivo: resolverTema(leerPreferencia()),

  // Se llama una vez desde App: aplica el tema inicial y queda escuchando
  // cambios del sistema mientras la preferencia sea 'auto'.
  init: () => {
    aplicarTema(get().efectivo)
    const mq = mqOscuro()
    if (!mq) return () => {}
    const onChange = () => {
      if (get().preferencia !== 'auto') return
      const efectivo = preferenciaSistema()
      set({ efectivo })
      aplicarTema(efectivo)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  },

  setTema: (preferencia) => {
    if (!TEMAS.includes(preferencia)) return
    try { localStorage.setItem(CLAVE, preferencia) } catch { /* modo privado */ }
    const efectivo = resolverTema(preferencia)
    set({ preferencia, efectivo })
    aplicarTema(efectivo)
  },

  // Ciclo del botón del sidebar: claro -> oscuro -> auto -> claro
  alternar: () => {
    const orden = ['claro', 'oscuro', 'auto']
    const i = orden.indexOf(get().preferencia)
    get().setTema(orden[(i + 1) % orden.length])
  },
}))
