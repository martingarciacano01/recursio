import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore } from '../store/toastStore'

const ICONOS = { error: AlertTriangle, success: CheckCircle2, info: Info }
const COLORES = {
  error: { bg: 'var(--danger-bg, #3a1a1a)', borde: 'var(--danger)' },
  success: { bg: 'var(--success-bg, #123a1a)', borde: 'var(--success)' },
  info: { bg: 'var(--bg-elevated)', borde: 'var(--border-strong)' },
}

// Task 4.3: montado una sola vez en Layout.jsx, apilando los toasts de
// toastStore.js. Cada toast es su propia región `role="status"` con
// `aria-live="polite"` (no `alert`, que interrumpe al lector de pantalla)
// porque son confirmaciones, no errores críticos que corten el flujo.
export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const remove = useToastStore((s) => s.remove)

  if (toasts.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed', bottom: 20, right: 20, zIndex: 1000,
        display: 'flex', flexDirection: 'column-reverse', gap: 10,
        maxWidth: 420,
      }}
    >
      {toasts.map((t) => {
        const Icono = ICONOS[t.tipo] || Info
        const color = COLORES[t.tipo] || COLORES.info
        return (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '12px 14px', borderRadius: 10,
              background: color.bg, border: `1px solid ${color.borde}`,
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)', color: 'var(--text-primary)',
            }}
          >
            <Icono size={18} color={color.borde} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>{t.mensaje}</span>
            <button
              onClick={() => remove(t.id)}
              aria-label="Cerrar"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', marginLeft: 4, flexShrink: 0 }}
            >
              <X size={16} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
