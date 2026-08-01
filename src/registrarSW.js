// Registro del service worker (PWA). Solo en producción: en `vite dev` un SW
// activo confunde el hot-reload y sirve bundles viejos.
export function registrarSW() {
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registro) => {
      // Si hay una versión nueva esperando, se activa en la próxima recarga.
      registro.addEventListener('updatefound', () => {
        const nuevo = registro.installing
        if (!nuevo) return
        nuevo.addEventListener('statechange', () => {
          if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
            nuevo.postMessage('SKIP_WAITING')
          }
        })
      })
    }).catch(() => { /* sin PWA la app funciona igual */ })
  })
}
