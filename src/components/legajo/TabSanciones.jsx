import { useState } from 'react'
import { useLegajoStore } from '../../store/legajoStore'

const TIPOS = [
  { value: 'apercibimiento', label: 'Apercibimiento' },
  { value: 'suspension', label: 'Suspensión' },
  { value: 'llamado_atencion', label: 'Llamado de atención' },
  { value: 'otra', label: 'Otra' },
]

const FORM_VACIO = { tipo: 'apercibimiento', fecha: '', motivo: '', diasSuspension: '' }

// CRUD de sanciones del legajo (Task 47). Sigue el mismo patrón que
// TabFamiliares: acciones del store, manejo local de errores/loading.
export default function TabSanciones({ personalId, empresaId }) {
  const sanciones = useLegajoStore((s) => s.sanciones)
  const guardarSancion = useLegajoStore((s) => s.guardarSancion)
  const eliminarSancion = useLegajoStore((s) => s.eliminarSancion)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [eliminandoId, setEliminandoId] = useState(null)
  const [error, setError] = useState('')

  const handleAgregar = async () => {
    setError('')
    if (!form.fecha) { setError('La fecha es obligatoria.'); return }
    if (!form.motivo.trim()) { setError('El motivo es obligatorio.'); return }
    setGuardando(true)
    const r = await guardarSancion(
      {
        tipo: form.tipo,
        fecha: form.fecha,
        motivo: form.motivo,
        diasSuspension: form.tipo === 'suspension' ? (form.diasSuspension || undefined) : undefined,
      },
      personalId, empresaId
    )
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  const handleEliminar = async (id) => {
    setError('')
    setEliminandoId(id)
    const r = await eliminarSancion(id)
    setEliminandoId(null)
    if (!r.ok) setError(r.error)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>Sanciones ({sanciones.length})</h3>

      {sanciones.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin sanciones registradas.</p>}
      {sanciones.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sanciones.map((s) => {
            const tipoLabel = TIPOS.find((t) => t.value === s.tipo)?.label || s.tipo
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>
                  {s.fecha} — {tipoLabel}: {s.motivo}
                  {s.diasSuspension ? ` (${s.diasSuspension} días)` : ''}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleEliminar(s.id)}
                  disabled={eliminandoId === s.id}
                >
                  {eliminandoId === s.id ? 'Eliminando…' : 'Eliminar'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Tipo</label>
          <select className="input" value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha</label>
          <input className="input" type="date" value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Motivo / descripción</label>
          <textarea className="input" value={form.motivo} onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))} />
        </div>
        {form.tipo === 'suspension' && (
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Días de suspensión</label>
            <input
              className="input"
              type="number"
              min="1"
              value={form.diasSuspension}
              onChange={(e) => setForm((f) => ({ ...f, diasSuspension: e.target.value }))}
            />
          </div>
        )}

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

        <div>
          <button className="btn btn-primary btn-sm" onClick={handleAgregar} disabled={guardando}>
            {guardando ? 'Agregando…' : 'Agregar'}
          </button>
        </div>
      </div>
    </div>
  )
}
