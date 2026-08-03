import { useEffect } from 'react'
import { X, AlertTriangle, CheckCircle2 } from 'lucide-react'

// Notificación flotante simple, sin librería externa. Pensada para errores
// de negocio (ej. "el período ya tiene recibos emitidos") que hoy se
// mostraban como un cartel rojo fijo en la página, indistinguible de un
// error real del sistema. Se auto-cierra sola; el usuario también puede
// cerrarla a mano. Un solo toast a la vez alcanza para los casos actuales
// (no hay una cola/stack todavía — si hiciera falta más de un toast
// simultáneo, extender esto a una lista en vez de duplicar el patrón).
export default function Toast({ mensaje, tipo = 'error', onClose, duracionMs = 6000 }) {
  useEffect(() => {
    if (!mensaje) return
    const t = setTimeout(onClose, duracionMs)
    return () => clearTimeout(t)
  }, [mensaje, duracionMs, onClose])

  if (!mensaje) return null

  const Icono = tipo === 'error' ? AlertTriangle : CheckCircle2

  return (
    <div
      role="alert"
      style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 1000,
        display: 'flex', alignItems: 'flex-start', gap: 10,
        maxWidth: 420, padding: '12px 14px', borderRadius: 10,
        background: tipo === 'error' ? 'var(--danger-bg, #3a1a1a)' : 'var(--success-bg, #123a1a)',
        border: `1px solid ${tipo === 'error' ? 'var(--danger)' : 'var(--success)'}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        color: 'var(--texto)',
      }}
    >
      <Icono size={18} color={tipo === 'error' ? 'var(--danger)' : 'var(--success)'} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>{mensaje}</span>
      <button
        onClick={onClose}
        aria-label="Cerrar"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--texto-secundario)', marginLeft: 4, flexShrink: 0 }}
      >
        <X size={16} />
      </button>
    </div>
  )
}
