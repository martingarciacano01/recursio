import { useEffect, useState } from 'react'
import { useDocumentosStore } from '../../store/documentosStore'

const FORM_VACIO = { id: null, codigo: '', nombre: '', obligatorio: true, vence: false, diasAviso: 30, orden: 100 }

// Configuración de qué documentación exige la empresa en cada legajo
// (Fase 6 Task 6). La ficha del legajo usa esta lista para avisar qué
// falta cargar y con cuántos días de anticipación marcar "por vencer".
export default function TabDocumentacion({ empresaId }) {
  const requeridos = useDocumentosStore((s) => s.requeridos)
  const cargarRequeridos = useDocumentosStore((s) => s.cargarRequeridos)
  const guardarRequerido = useDocumentosStore((s) => s.guardarRequerido)
  const eliminarRequerido = useDocumentosStore((s) => s.eliminarRequerido)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (empresaId) cargarRequeridos(empresaId) }, [empresaId])

  const editando = form.id !== null

  const handleGuardar = async () => {
    setError('')
    if (!form.codigo.trim() || !form.nombre.trim()) { setError('Completá código y nombre.'); return }
    setGuardando(true)
    const r = await guardarRequerido({ ...form, codigo: form.codigo.trim(), nombre: form.nombre.trim() }, empresaId)
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Documentación exigida en cada legajo. Los marcados como obligatorios aparecen como
        "falta cargar" en la ficha de la persona y suman al contador de legajos a revisar del Dashboard.
      </p>

      <table className="table">
        <thead>
          <tr><th>Código</th><th>Nombre</th><th>Obligatorio</th><th>Vence</th><th>Aviso</th><th></th></tr>
        </thead>
        <tbody>
          {requeridos.map((r) => (
            <tr key={r.id}>
              <td><code>{r.codigo}</code></td>
              <td>{r.nombre}</td>
              <td>{r.obligatorio ? 'Sí' : 'No'}</td>
              <td>{r.vence ? 'Sí' : 'No'}</td>
              <td>{r.vence ? `${r.diasAviso} días` : '—'}</td>
              <td style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setForm({ ...r })}>Editar</button>
                <button className="btn btn-ghost btn-sm" onClick={() => eliminarRequerido(r.id, empresaId)}>Eliminar</button>
              </td>
            </tr>
          ))}
          {requeridos.length === 0 && <tr><td colSpan={6}>Sin documentación configurada.</td></tr>}
        </tbody>
      </table>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <strong style={{ fontSize: '0.9rem' }}>{editando ? 'Editar tipo de documento' : 'Agregar tipo de documento'}</strong>
        <div>
          <label htmlFor="req-codigo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Código</label>
          <input id="req-codigo" className="input" value={form.codigo} placeholder="art"
            onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="req-nombre" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Nombre</label>
          <input id="req-nombre" className="input" value={form.nombre} placeholder="Constancia de ART"
            onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
        </div>
        <label htmlFor="req-oblig" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
          <input id="req-oblig" type="checkbox" checked={form.obligatorio}
            onChange={(e) => setForm((f) => ({ ...f, obligatorio: e.target.checked }))} />
          Obligatorio
        </label>
        <label htmlFor="req-vence" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
          <input id="req-vence" type="checkbox" checked={form.vence}
            onChange={(e) => setForm((f) => ({ ...f, vence: e.target.checked }))} />
          Vence
        </label>
        {form.vence && (
          <div>
            <label htmlFor="req-aviso" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Avisar N días antes</label>
            <input id="req-aviso" className="input" type="number" min="1" value={form.diasAviso}
              onChange={(e) => setForm((f) => ({ ...f, diasAviso: e.target.value }))} />
          </div>
        )}

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={handleGuardar} disabled={guardando}>
            {guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Agregar'}
          </button>
          {editando && <button className="btn btn-ghost btn-sm" onClick={() => setForm(FORM_VACIO)}>Cancelar</button>}
        </div>
      </div>
    </div>
  )
}
