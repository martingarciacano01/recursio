import { useState } from 'react'
import { useLegajoStore } from '../../store/legajoStore'

const VINCULOS = [
  { value: 'conyuge', label: 'Cónyuge' },
  { value: 'conviviente', label: 'Conviviente' },
  { value: 'hijo', label: 'Hijo/a' },
  { value: 'otro', label: 'Otro' },
]

const FORM_VACIO = { vinculo: 'hijo', nombre: '', cuil: '', fechaNacimiento: '' }

function calcularEdad(fechaNacimiento) {
  if (!fechaNacimiento) return null
  const nacimiento = new Date(fechaNacimiento)
  const hoy = new Date()
  let edad = hoy.getFullYear() - nacimiento.getFullYear()
  const noCumplioAun = hoy.getMonth() < nacimiento.getMonth() ||
    (hoy.getMonth() === nacimiento.getMonth() && hoy.getDate() < nacimiento.getDate())
  if (noCumplioAun) edad -= 1
  return edad
}

// CRUD de familiares del legajo (Task 46). Sigue el mismo patrón que
// EditorDatosLegajo: acciones del store, manejo local de errores/loading.
export default function TabFamiliares({ personalId, empresaId }) {
  const familiares = useLegajoStore((s) => s.familiares)
  const guardarFamiliar = useLegajoStore((s) => s.guardarFamiliar)
  const eliminarFamiliar = useLegajoStore((s) => s.eliminarFamiliar)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [eliminandoId, setEliminandoId] = useState(null)
  const [error, setError] = useState('')

  const handleAgregar = async () => {
    setError('')
    if (!form.nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setGuardando(true)
    const r = await guardarFamiliar(
      { vinculo: form.vinculo, nombre: form.nombre, cuil: form.cuil || undefined, fechaNacimiento: form.fechaNacimiento || undefined },
      personalId, empresaId
    )
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  const handleEliminar = async (id) => {
    setError('')
    setEliminandoId(id)
    const r = await eliminarFamiliar(id)
    setEliminandoId(null)
    if (!r.ok) setError(r.error)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {familiares.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin familiares cargados.</p>}
      {familiares.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {familiares.map((f) => {
            const edad = calcularEdad(f.fechaNacimiento)
            const vinculoLabel = VINCULOS.find((v) => v.value === f.vinculo)?.label || f.vinculo
            return (
              <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>
                  {f.nombre} — {vinculoLabel}
                  {edad !== null ? ` (${edad} años)` : ''}
                  {f.cuil ? ` · CUIL ${f.cuil}` : ''}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleEliminar(f.id)}
                  disabled={eliminandoId === f.id}
                >
                  {eliminandoId === f.id ? 'Eliminando…' : 'Eliminar'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Vínculo</label>
          <select className="input" value={form.vinculo} onChange={(e) => setForm((f) => ({ ...f, vinculo: e.target.value }))}>
            {VINCULOS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Nombre</label>
          <input className="input" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>CUIL (opcional)</label>
          <input className="input" value={form.cuil} onChange={(e) => setForm((f) => ({ ...f, cuil: e.target.value }))} placeholder="20-12345678-9" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha de nacimiento (opcional)</label>
          <input className="input" type="date" value={form.fechaNacimiento} onChange={(e) => setForm((f) => ({ ...f, fechaNacimiento: e.target.value }))} />
        </div>

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
