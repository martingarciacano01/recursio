import { useEffect, useRef } from 'react'

const SELECTOR_ENFOCABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Task 4.7: accesibilidad de los modales (AsistenteAlta, BorrarPeriodo).
// Antes ninguno de los dos cerraba con Escape ni atrapaba el foco — con el
// teclado (o un lector de pantalla) era fácil terminar interactuando con la
// página de atrás sin darse cuenta de que había un modal abierto encima.
//
// Uso: `const modalRef = useModalA11y(onCerrar)` y poner `ref={modalRef}`
// (+ `tabIndex={-1}`, para que el contenedor mismo sea foco-able como
// fallback si no hay ningún elemento enfocable adentro) en el `<div
// className="modal">` — NO en el overlay, para no capturar clicks fuera.
export function useModalA11y(onCerrar) {
  const ref = useRef(null)

  useEffect(() => {
    const nodo = ref.current
    if (!nodo) return

    const enfocables = () => [...nodo.querySelectorAll(SELECTOR_ENFOCABLE)]

    // Foco inicial: al abrir un modal, el foco debe moverse adentro (si no,
    // sigue en el botón que lo disparó, atrás del overlay).
    const primero = enfocables()[0] || nodo
    primero.focus()

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { onCerrar?.(); return }
      if (e.key !== 'Tab') return
      const focusables = enfocables()
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    nodo.addEventListener('keydown', onKeyDown)
    return () => nodo.removeEventListener('keydown', onKeyDown)
  }, [onCerrar])

  return ref
}
