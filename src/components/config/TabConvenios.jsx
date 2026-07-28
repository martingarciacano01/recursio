import { useState } from 'react'
import { useConveniosStore } from '../../store/conveniosStore'

// Alta y edición de convenios propios de la empresa (modalidad mensual vs.
// quincenal + fechas de corte). Antes la única forma de tener un convenio
// era "clonar" uno global (personalizar); esto agrega un alta genuina desde
// cero, y la edición de modalidad/corte que hoy no existía en ningún lado.
export default function TabConvenios({ empresaId }) {
  const { convenios, crearConvenio, actualizarConvenio } = useConveniosStore()
  const propios = convenios.filter((c) => c.empresaId === empresaId)

  const [creando, setCreando] = useState(false)
  const [nuevo, setNuevo] = useState({ nombre: '', regimen: 'lct', modalidad: 'quincenal' })
  const [errorCrear, setErrorCrear] = useState('')

  const [editandoId, setEditandoId] = useState(null)
  const [edicion, setEdicion] = useState({})
  const [errorEditar, setErrorEditar] = useState('')

  const handleCrear = async () => {
    setErrorCrear('')
    const r = await crearConvenio(empresaId, nuevo)
    if (!r.ok) { setErrorCrear(r.error); return }
    setCreando(false)
    setNuevo({ nombre: '', regimen: 'lct', modalidad: 'quincenal' })
  }

  const empezarEdicion = (c) => {
    setErrorEditar('')
    setEditandoId(c.id)
    setEdicion({
      modalidad: c.modalidad,
      corteQ1Desde: c.corteQ1Desde, corteQ1Hasta: c.corteQ1Hasta,
      corteQ2Desde: c.corteQ2Desde, corteQ2Hasta: c.corteQ2Hasta,
      corteMensualDesde: c.corteMensualDesde, corteMensualHasta: c.corteMensualHasta,
    })
  }

  const guardarEdicion = async () => {
    setErrorEditar('')
    const r = await actualizarConvenio(editandoId, edicion)
    if (!r.ok) { setErrorEditar(r.error); return }
    setEditandoId(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {propios.map((c) => (
        <div key={c.id} className="card">
          <strong>{c.nombre}</strong> <span className="badge badge-neutral">{c.modalidad}</span>
          {editandoId !== c.id && (
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => empezarEdicion(c)}>Editar</button>
          )}
          {editandoId === c.id && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label htmlFor={`modalidad-${c.id}`}>Modalidad</label>
              <select id={`modalidad-${c.id}`} className="input" style={{ maxWidth: 200 }}
                value={edicion.modalidad} onChange={(e) => setEdicion((v) => ({ ...v, modalidad: e.target.value }))}>
                <option value="quincenal">Quincenal</option>
                <option value="mensual">Mensual</option>
              </select>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label htmlFor={`q1d-${c.id}`}>1ra quincena — desde</label>
                <input id={`q1d-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteQ1Desde} onChange={(e) => setEdicion((v) => ({ ...v, corteQ1Desde: Number(e.target.value) }))} />
                <label htmlFor={`q1h-${c.id}`}>1ra quincena — hasta</label>
                <input id={`q1h-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteQ1Hasta} onChange={(e) => setEdicion((v) => ({ ...v, corteQ1Hasta: Number(e.target.value) }))} />
                <label htmlFor={`q2d-${c.id}`}>2da quincena — desde</label>
                <input id={`q2d-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteQ2Desde} onChange={(e) => setEdicion((v) => ({ ...v, corteQ2Desde: Number(e.target.value) }))} />
                <label htmlFor={`q2h-${c.id}`}>2da quincena — hasta (vacío = fin de mes)</label>
                <input id={`q2h-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteQ2Hasta ?? ''} onChange={(e) => setEdicion((v) => ({ ...v, corteQ2Hasta: e.target.value ? Number(e.target.value) : null }))} />
                <label htmlFor={`mesd-${c.id}`}>Mensual — desde</label>
                <input id={`mesd-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteMensualDesde} onChange={(e) => setEdicion((v) => ({ ...v, corteMensualDesde: Number(e.target.value) }))} />
                <label htmlFor={`mesh-${c.id}`}>Mensual — hasta (vacío = fin de mes)</label>
                <input id={`mesh-${c.id}`} className="input" type="number" style={{ width: 70 }}
                  value={edicion.corteMensualHasta ?? ''} onChange={(e) => setEdicion((v) => ({ ...v, corteMensualHasta: e.target.value ? Number(e.target.value) : null }))} />
              </div>
              {errorEditar && <p style={{ color: 'var(--danger)' }}>{errorEditar}</p>}
              <div>
                <button className="btn btn-primary btn-sm" onClick={guardarEdicion}>Guardar cambios</button>
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => { setEditandoId(null); setErrorEditar('') }}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {!creando && <button className="btn btn-primary btn-sm" onClick={() => setCreando(true)}>Nuevo convenio</button>}
      {creando && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="nc-nombre">Nombre</label>
          <input id="nc-nombre" className="input" value={nuevo.nombre} onChange={(e) => setNuevo((v) => ({ ...v, nombre: e.target.value }))} />
          <label htmlFor="nc-regimen">Régimen</label>
          <select id="nc-regimen" className="input" style={{ maxWidth: 200 }}
            value={nuevo.regimen} onChange={(e) => setNuevo((v) => ({ ...v, regimen: e.target.value }))}>
            <option value="lct">LCT (Ley 20.744)</option>
            <option value="22250">Construcción (Ley 22.250)</option>
          </select>
          <label htmlFor="nc-modalidad">Modalidad</label>
          <select id="nc-modalidad" className="input" style={{ maxWidth: 200 }}
            value={nuevo.modalidad} onChange={(e) => setNuevo((v) => ({ ...v, modalidad: e.target.value }))}>
            <option value="quincenal">Quincenal</option>
            <option value="mensual">Mensual</option>
          </select>
          {errorCrear && <p style={{ color: 'var(--danger)' }}>{errorCrear}</p>}
          <div>
            <button className="btn btn-primary btn-sm" onClick={handleCrear} disabled={!nuevo.nombre.trim()}>Guardar convenio</button>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => { setCreando(false); setErrorCrear('') }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
