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
    <div className="lista-fichas">
      {propios.length === 0 && !creando && (
        <p className="texto-secundario" style={{ fontSize: '0.88rem' }}>
          Todavía no tenés convenios propios. Creá uno nuevo o personalizá una plantilla.
        </p>
      )}
      {propios.map((c) => (
        <div key={c.id} className="card card-compacta">
          <div className="acciones">
            <strong className="ficha-titulo">{c.nombre}</strong>
            <span className="badge badge-neutral">{c.modalidad}</span>
            {editandoId !== c.id && (
              <button className="btn btn-ghost btn-sm" onClick={() => empezarEdicion(c)}>Editar</button>
            )}
          </div>
          {editandoId === c.id && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <div className="input-group input-medio" style={{ marginBottom: 16 }}>
                <label className="input-label" htmlFor={`modalidad-${c.id}`}>Modalidad</label>
                <select id={`modalidad-${c.id}`} className="input"
                  value={edicion.modalidad} onChange={(e) => setEdicion((v) => ({ ...v, modalidad: e.target.value }))}>
                  <option value="quincenal">Quincenal</option>
                  <option value="mensual">Mensual</option>
                </select>
              </div>

              {/* Solo se muestran los cortes de la modalidad elegida: antes
                  se veían los seis campos juntos aunque cuatro no aplicaran. */}
              {edicion.modalidad === 'quincenal' ? (
                <>
                  <div className="grupo-cortes">
                    <span className="grupo-cortes-titulo">1ra quincena</span>
                    <div className="cortes-fila">
                      {/* El label visible es corto porque el grupo ya dice de
                          qué quincena se trata; el aria-label mantiene el
                          nombre completo para lectores de pantalla. */}
                      <div className="input-group">
                        <label className="input-label" htmlFor={`q1d-${c.id}`}>Día desde</label>
                        <input id={`q1d-${c.id}`} aria-label="1ra quincena — desde" className="input input-dia" type="number" min="1" max="31"
                          value={edicion.corteQ1Desde} onChange={(e) => setEdicion((v) => ({ ...v, corteQ1Desde: Number(e.target.value) }))} />
                      </div>
                      <div className="input-group">
                        <label className="input-label" htmlFor={`q1h-${c.id}`}>Día hasta</label>
                        <input id={`q1h-${c.id}`} aria-label="1ra quincena — hasta" className="input input-dia" type="number" min="1" max="31"
                          value={edicion.corteQ1Hasta} onChange={(e) => setEdicion((v) => ({ ...v, corteQ1Hasta: Number(e.target.value) }))} />
                      </div>
                    </div>
                  </div>

                  <div className="grupo-cortes">
                    <span className="grupo-cortes-titulo">2da quincena</span>
                    <div className="cortes-fila">
                      <div className="input-group">
                        <label className="input-label" htmlFor={`q2d-${c.id}`}>Día desde</label>
                        <input id={`q2d-${c.id}`} aria-label="2da quincena — desde" className="input input-dia" type="number" min="1" max="31"
                          value={edicion.corteQ2Desde} onChange={(e) => setEdicion((v) => ({ ...v, corteQ2Desde: Number(e.target.value) }))} />
                      </div>
                      <div className="input-group">
                        <label className="input-label" htmlFor={`q2h-${c.id}`}>Día hasta</label>
                        <input id={`q2h-${c.id}`} aria-label="2da quincena — hasta" className="input input-dia" type="number" min="1" max="31" placeholder="fin"
                          value={edicion.corteQ2Hasta ?? ''} onChange={(e) => setEdicion((v) => ({ ...v, corteQ2Hasta: e.target.value ? Number(e.target.value) : null }))} />
                      </div>
                      <span className="cortes-ayuda">Vacío = último día del mes</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="grupo-cortes">
                  <span className="grupo-cortes-titulo">Período mensual</span>
                  <div className="cortes-fila">
                    <div className="input-group">
                      <label className="input-label" htmlFor={`mesd-${c.id}`}>Día desde</label>
                      <input id={`mesd-${c.id}`} aria-label="Mensual — desde" className="input input-dia" type="number" min="1" max="31"
                        value={edicion.corteMensualDesde} onChange={(e) => setEdicion((v) => ({ ...v, corteMensualDesde: Number(e.target.value) }))} />
                    </div>
                    <div className="input-group">
                      <label className="input-label" htmlFor={`mesh-${c.id}`}>Día hasta</label>
                      <input id={`mesh-${c.id}`} aria-label="Mensual — hasta" className="input input-dia" type="number" min="1" max="31" placeholder="fin"
                        value={edicion.corteMensualHasta ?? ''} onChange={(e) => setEdicion((v) => ({ ...v, corteMensualHasta: e.target.value ? Number(e.target.value) : null }))} />
                    </div>
                    <span className="cortes-ayuda">Vacío = último día del mes</span>
                  </div>
                </div>
              )}

              {errorEditar && <p style={{ color: 'var(--danger)', marginBottom: 10 }}>{errorEditar}</p>}
              <div className="acciones">
                <button className="btn btn-primary btn-sm" onClick={guardarEdicion}>Guardar cambios</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditandoId(null); setErrorEditar('') }}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {!creando && <button className="btn btn-primary btn-sm" onClick={() => setCreando(true)}>Nuevo convenio</button>}
      {creando && (
        <div className="card">
          <h3 style={{ fontSize: '1rem', marginBottom: 12 }}>Nuevo convenio</h3>
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <div className="input-group">
              <label className="input-label" htmlFor="nc-nombre">Nombre</label>
              <input id="nc-nombre" className="input" placeholder="ej: UOCRA"
                value={nuevo.nombre} onChange={(e) => setNuevo((v) => ({ ...v, nombre: e.target.value }))} />
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="nc-regimen">Régimen</label>
              <select id="nc-regimen" className="input"
                value={nuevo.regimen} onChange={(e) => setNuevo((v) => ({ ...v, regimen: e.target.value }))}>
                <option value="lct">LCT (Ley 20.744)</option>
                <option value="22250">Construcción (Ley 22.250)</option>
              </select>
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="nc-modalidad">Modalidad</label>
              <select id="nc-modalidad" className="input"
                value={nuevo.modalidad} onChange={(e) => setNuevo((v) => ({ ...v, modalidad: e.target.value }))}>
                <option value="quincenal">Quincenal</option>
                <option value="mensual">Mensual</option>
              </select>
            </div>
          </div>
          {errorCrear && <p style={{ color: 'var(--danger)', marginBottom: 10 }}>{errorCrear}</p>}
          <div className="acciones">
            <button className="btn btn-primary btn-sm" onClick={handleCrear} disabled={!nuevo.nombre.trim()}>Guardar convenio</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setCreando(false); setErrorCrear('') }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
