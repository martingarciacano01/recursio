import { useState } from 'react'
import { useLegajoStore } from '../../store/legajoStore'

const TIPOS = [
  { value: 'apercibimiento', label: 'Apercibimiento' },
  { value: 'suspension', label: 'Suspensión' },
  { value: 'llamado_atencion', label: 'Llamado de atención' },
  { value: 'otra', label: 'Otra' },
]

const FORM_VACIO = { id: null, tipo: 'apercibimiento', fecha: '', motivo: '', diasSuspension: '' }

// CRUD de sanciones del legajo (Task 47; edición agregada en Fase 6 Task 5).
// guardarSancion del store ya hacía UPDATE cuando el objeto trae `id`.
export default function TabSanciones({ personalId, empresaId }) {
  const sanciones = useLegajoStore((s) => s.sanciones)
  const guardarSancion = useLegajoStore((s) => s.guardarSancion)
  const eliminarSancion = useLegajoStore((s) => s.eliminarSancion)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [eliminandoId, setEliminandoId] = useState(null)
  const [error, setError] = useState('')

  const editando = form.id !== null

  const handleGuardar = async () => {
    setError('')
    if (!form.fecha) { setError('La fecha es obligatoria.'); return }
    if (!form.motivo.trim()) { setError('El motivo es obligatorio.'); return }
    setGuardando(true)
    const r = await guardarSancion(
      {
        ...(form.id ? { id: form.id } : {}),
        tipo: form.tipo,
        fecha: form.fecha,
        motivo: form.motivo,
        // En una edición hay que mandar SIEMPRE el campo (aunque sea null)
        // para poder borrar los días si la sanción deja de ser suspensión:
        // sancionToDB omite la columna cuando el valor es `undefined`.
        diasSuspension: form.tipo === 'suspension' ? (form.diasSuspension || null) : null,
      },
      personalId, empresaId
    )
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  const handleEditar = (s) => {
    setError('')
    setForm({
      id: s.id, tipo: s.tipo, fecha: s.fecha, motivo: s.motivo,
      diasSuspension: s.diasSuspension ?? '',
    })
  }

  const handleEliminar = async (id) => {
    setError('')
    setEliminandoId(id)
    const r = await eliminarSancion(id)
    setEliminandoId(null)
    if (!r.ok) { setError(r.error); return }
    if (form.id === id) setForm(FORM_VACIO)
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
                <span style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleEditar(s)}>Editar</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleEliminar(s.id)}
                    disabled={eliminandoId === s.id}
                  >
                    {eliminandoId === s.id ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <strong style={{ fontSize: '0.9rem' }}>{editando ? 'Editar sanción' : 'Registrar sanción'}</strong>
        <div>
          <label htmlFor="san-tipo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Tipo</label>
          <select id="san-tipo" className="input" value={form.tipo} onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value }))}>
            {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="san-fecha" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha</label>
          <input id="san-fecha" className="input" type="date" value={form.fecha} onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="san-motivo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Motivo / descripción</label>
          <textarea id="san-motivo" className="input" value={form.motivo} onChange={(e) => setForm((f) => ({ ...f, motivo: e.target.value }))} />
        </div>
        {form.tipo === 'suspension' && (
          <div>
            <label htmlFor="san-dias" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Días de suspensión</label>
            <input
              id="san-dias"
              className="input"
              type="number"
              min="1"
              value={form.diasSuspension}
              onChange={(e) => setForm((f) => ({ ...f, diasSuspension: e.target.value }))}
            />
          </div>
        )}

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={handleGuardar} disabled={guardando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Agregar'}
          </button>
          {editando && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setForm(FORM_VACIO); setError('') }} disabled={guardando}>
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
