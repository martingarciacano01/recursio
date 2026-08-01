/* Service worker de Recursio.
 *
 * Alcance deliberadamente conservador: cachea SOLO el shell de la aplicación
 * (HTML, JS, CSS, fuentes e íconos). NUNCA cachea respuestas de Supabase ni
 * de ninguna API: en nómina, mostrar un sueldo viejo sería peor que mostrar
 * un error. Sin conexión la app abre y avisa que no hay datos.
 *
 * Al cambiar CACHE_VERSION se invalidan las cachés anteriores.
 */
const CACHE_VERSION = 'recursio-shell-v1'
const OFFLINE_URL = '/offline.html'

const PRECACHE = [
  '/',
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((c) => c !== CACHE_VERSION).map((c) => caches.delete(c))
      ))
      .then(() => self.clients.claim())
  )
})

// Permite que la app fuerce la activación de una versión nueva.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

function esEstatico(url) {
  return /\.(?:js|css|woff2?|ttf|png|jpe?g|svg|webp|ico)$/i.test(url.pathname)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Nada de APIs ni de otros orígenes que no sean assets propios/fuentes.
  const esMismoOrigen = url.origin === self.location.origin
  const esFuenteGoogle = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)
  if (!esMismoOrigen && !esFuenteGoogle) return
  if (esMismoOrigen && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/rest/'))) return

  // Navegación: red primero (para tomar siempre el deploy más nuevo),
  // con la última copia cacheada -o la página offline- como respaldo.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((respuesta) => {
          const copia = respuesta.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put('/', copia))
          return respuesta
        })
        .catch(async () => (await caches.match('/')) || caches.match(OFFLINE_URL))
    )
    return
  }

  // Assets: cache first con refresco en segundo plano (los bundles de Vite
  // llevan hash en el nombre, así que no hay riesgo de servir uno viejo).
  if (esEstatico(url) || esFuenteGoogle) {
    event.respondWith(
      caches.match(request).then((cacheada) => {
        const red = fetch(request)
          .then((respuesta) => {
            if (respuesta && respuesta.status === 200) {
              const copia = respuesta.clone()
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copia))
            }
            return respuesta
          })
          .catch(() => cacheada)
        return cacheada || red
      })
    )
  }
})
