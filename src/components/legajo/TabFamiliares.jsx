import { useState } from 'react'
import { useLegajoStore } from '../../store/legajoStore'

const VINCULOS = [
  { value: 'conyuge', label: 'Cónyuge' },
  { value: 'conviviente', label: 'Conviviente' },
  { value: 'hijo', label: 'Hijo/a' },
  { value: 'otro', label: 'Otro' },
]

const FORM_VACIO = { id: null, vinculo: 'hijo', nombre: '', cuil: '', fechaNacimiento: '' }

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

// CRUD de familiares del legajo (Task 46; edición agregada en Fase 6 Task 4).
// El store ya resolvía el UPDATE — guardarFamiliar hace update cuando el
// objeto trae `id` — así que acá sólo se agrega el modo edición de la UI.
export default function TabFamiliares({ personalId, empresaId }) {
  const familiares = useLegajoStore((s) => s.familiares)
  const guardarFamiliar = useLegajoStore((s) => s.guardarFamiliar)
  const eliminarFamiliar = useLegajoStore((s) => s.eliminarFamiliar)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [eliminandoId, setEliminandoId] = useState(null)
  const [error, setError] = useState('')

  const editando = form.id !== null

  const handleGuardar = async () => {
    setError('')
    if (!form.nombre.trim()) { setError('El nombre es obligatorio.'); return }
    setGuardando(true)
    const r = await guardarFamiliar(
      {
        ...(form.id ? { id: form.id } : {}),
        vinculo: form.vinculo,
        nombre: form.nombre,
        cuil: form.cuil || undefined,
        fechaNacimiento: form.fechaNacimiento || undefined,
      },
      personalId, empresaId
    )
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  const handleEditar = (f) => {
    setError('')
    setForm({
      id: f.id, vinculo: f.vinculo, nombre: f.nombre,
      cuil: f.cuil || '', fechaNacimiento: f.fechaNacimiento || '',
    })
  }

  const handleEliminar = async (id) => {
    setError('')
    setEliminandoId(id)
    const r = await eliminarFamiliar(id)
    setEliminandoId(null)
    if (!r.ok) { setError(r.error); return }
    if (form.id === id) setForm(FORM_VACIO)
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
                <span style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleEditar(f)}>Editar</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleEliminar(f.id)}
                    disabled={eliminandoId === f.id}
                  >
                    {eliminandoId === f.id ? 'Eliminando…' : 'Eliminar'}
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <strong style={{ fontSize: '0.9rem' }}>{editando ? 'Editar familiar' : 'Agregar familiar'}</strong>
        <div>
          <label htmlFor="fam-vinculo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Vínculo</label>
          <select id="fam-vinculo" className="input" value={form.vinculo} onChange={(e) => setForm((f) => ({ ...f, vinculo: e.target.value }))}>
            {VINCULOS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="fam-nombre" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Nombre</label>
          <input id="fam-nombre" className="input" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="fam-cuil" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>CUIL (opcional)</label>
          <input id="fam-cuil" className="input" value={form.cuil} onChange={(e) => setForm((f) => ({ ...f, cuil: e.target.value }))} placeholder="20-12345678-9" />
        </div>
        <div>
          <label htmlFor="fam-nac" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha de nacimiento (opcional)</label>
          <input id="fam-nac" className="input" type="date" value={form.fechaNacimiento} onChange={(e) => setForm((f) => ({ ...f, fechaNacimiento: e.target.value }))} />
        </div>

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
