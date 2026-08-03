// Task 4.5 (ajuste post-feedback): la checklist de "Primeros pasos" no debe
// forzar a nadie a configurar algo que decidió no usar (ej. una PyME chica
// que no quiere pedir documentación al legajo). Cada hito se puede omitir
// a mano; queda guardado en localStorage por empresa (no es un dato de
// negocio, es una preferencia de UI del usuario en ESTE navegador — no
// amerita una tabla ni sincronizarse entre dispositivos).
const clave = (empresaId) => `recursio:onboarding-omitidos:${empresaId}`

export function leerOmitidos(empresaId) {
  if (!empresaId) return []
  try {
    const crudo = localStorage.getItem(clave(empresaId))
    if (!crudo) return []
    const v = JSON.parse(crudo)
    return Array.isArray(v) ? v : []
  } catch {
    return [] // modo privado / sin storage: no se puede omitir, no rompe nada
  }
}

export function marcarOmitido(empresaId, hitoId) {
  if (!empresaId) return
  try {
    const actuales = leerOmitidos(empresaId)
    if (actuales.includes(hitoId)) return
    localStorage.setItem(clave(empresaId), JSON.stringify([...actuales, hitoId]))
  } catch {
    // sin storage disponible: la próxima carga simplemente vuelve a mostrar el hito
  }
}
