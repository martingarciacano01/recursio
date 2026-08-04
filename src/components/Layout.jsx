import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import Logo from './Logo'
import ToastContainer from './ToastContainer'

// Shell de la app. En escritorio el sidebar es una columna fija; por debajo
// de 900px se convierte en un drawer que se abre desde una barra superior
// (patrón estándar de PWA en móvil). El contenido va dentro de .app-main,
// que centra y limita el ancho para que nada se estire en monitores anchos.
const MEDIA_MOVIL = '(max-width: 900px)'

export default function Layout() {
  const [menuAbierto, setMenuAbierto] = useState(false)
  // Task 4.7: el sidebar en móvil es un drawer oculto por transform (CSS,
  // ver index.css ~509-520) pero seguía siendo focusable/leído por lectores
  // de pantalla mientras estaba "cerrado" — inert lo saca del árbol de
  // accesibilidad y del tab order. En desktop el sidebar es fijo y siempre
  // visible, así que inert nunca debe aplicarse ahí (de ahí el media query
  // en JS, calcado del breakpoint de CSS).
  const [esMovil, setEsMovil] = useState(() => typeof window !== 'undefined' && window.matchMedia(MEDIA_MOVIL).matches)
  const { pathname } = useLocation()

  useEffect(() => {
    const mq = window.matchMedia(MEDIA_MOVIL)
    const onChange = (e) => setEsMovil(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Al navegar se cierra el drawer.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resync intencional del estado UI local al cambiar de ruta.
  useEffect(() => { setMenuAbierto(false) }, [pathname])

  // Bloquea el scroll del fondo mientras el drawer está abierto.
  useEffect(() => {
    if (!menuAbierto) return
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previo }
  }, [menuAbierto])

  // Escape cierra el menú.
  useEffect(() => {
    if (!menuAbierto) return
    const onKey = (e) => { if (e.key === 'Escape') setMenuAbierto(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuAbierto])

  return (
    <div className={`app-shell${menuAbierto ? ' menu-abierto' : ''}`}>
      <header className="topbar">
        <button
          type="button"
          className="topbar-menu"
          onClick={() => setMenuAbierto(true)}
          aria-label="Abrir menú"
          aria-expanded={menuAbierto}
        >
          <Menu size={20} />
        </button>
        <Logo alto={32} />
      </header>

      {menuAbierto && (
        <div className="drawer-fondo" onClick={() => setMenuAbierto(false)} aria-hidden="true" />
      )}

      <div inert={esMovil && !menuAbierto ? '' : undefined} style={{ flexShrink: 0 }}>
        <Sidebar onNavegar={() => setMenuAbierto(false)} />
      </div>

      <main className="app-main">
        <Outlet />
      </main>

      <ToastContainer />
    </div>
  )
}
