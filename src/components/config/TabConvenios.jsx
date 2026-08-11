import { useEffect, useState } from 'react'
import { useConveniosStore } from '../../store/conveniosStore'
import { supabase } from '../../lib/supabase'

// Alta y edición de convenios propios de la empresa (modalidad mensual vs.
// quincenal + fechas de corte). Antes la única forma de tener un convenio
// era "clonar" uno global (personalizar); esto agrega un alta genuina desde
// cero, y la edición de modalidad/corte que hoy no existía en ningún lado.
// Item 11 (crítica Liquidaciones 2026-08-09): se puede atar un convenio a
// una obra (plan convenios-por-obra) y replicar un convenio propio.
export default function TabConvenios({ empresaId }) {
  const { convenios, crearConvenio, actualizarConvenio, eliminarConvenio, replicarConvenio } = useConveniosStore()
  const propios = convenios.filter((c) => c.empresaId === empresaId)

  // Obras de Presencio (nom_v_obras, migración 0058) para el selector de obra.
  const [obras, setObras] = useState([])
  useEffect(() => {
    if (!empresaId) return
    let activo = true
    supabase.from('nom_v_obras').select('id, nombre').eq('empresa_id', empresaId).order('nombre')
      .then(({ data }) => { if (activo) setObras(data || []) })
    return () => { activo = false }
  }, [empresaId])
  const nombreObra = (obraId) => (obraId ? (obras.find((o) => o.id === obraId)?.nombre || obraId.slice(0, 8)) : null)

  const [creando, setCreando] = useState(false)
  const [nuevo, setNuevo] = useState({ nombre: '', regimen: 'lct', modalidad: 'quincenal', obraId: '' })
  const [errorCrear, setErrorCrear] = useState('')

  const [editandoId, setEditandoId] = useState(null)
  const [edicion, setEdicion] = useState({})
  const [errorEditar, setErrorEditar] = useState('')

  // Item 11: replicar un convenio (copia con escalas/conceptos). Como el
  // borrado, es una operación que crea datos, así que se pide confirmación
  // en un primer click y el clon corre recién con "Sí, replicar".
  const [replicandoId, setReplicandoId] = useState(null)
  const [replicaObraId, setReplicaObraId] = useState('')
  const [replicando, setReplicando] = useState(false)
  const [errorReplicar, setErrorReplicar] = useState('')

  const [confirmandoBorrarId, setConfirmandoBorrarId] = useState(null)
  const [errorBorrar, setErrorBorrar] = useState('')

  // Item 4 (sesión 2026-08-08): borrar convenio = zona de riesgo (es una
  // destrucción irreversible de escalas/conceptos). Se pide confirmación
  // explícita con un primer click que arma el estado "confirmando", y recién
  // un segundo click ejecuta el borrado. Además `eliminarConvenio` valida
  // en el store que no haya legajos/períodos usando el convenio y devuelve
  // un aviso sin borrar si los hay.
  const handleBorrar = async (c) => {
    setErrorBorrar('')
    const r = await eliminarConvenio(c.id, empresaId)
    if (!r.ok) { setErrorBorrar(r.error || 'no se pudo borrar el convenio'); return }
    setConfirmandoBorrarId(null)
    setErrorBorrar('')
  }

  const handleCrear = async () => {
    setErrorCrear('')
    const r = await crearConvenio(empresaId, { ...nuevo, obraId: nuevo.obraId || null })
    if (!r.ok) { setErrorCrear(r.error); return }
    setCreando(false)
    setNuevo({ nombre: '', regimen: 'lct', modalidad: 'quincenal', obraId: '' })
  }

  const empezarEdicion = (c) => {
    setErrorEditar('')
    setEditandoId(c.id)
    setEdicion({
      obraId: c.obraId ?? '',
      modalidad: c.modalidad,
      corteQ1Desde: c.corteQ1Desde, corteQ1Hasta: c.corteQ1Hasta,
      corteQ2Desde: c.corteQ2Desde, corteQ2Hasta: c.corteQ2Hasta,
      corteMensualDesde: c.corteMensualDesde, corteMensualHasta: c.corteMensualHasta,
    })
  }

  const guardarEdicion = async () => {
    setErrorEditar('')
    const r = await actualizarConvenio(editandoId, { ...edicion, obraId: edicion.obraId || null })
    if (!r.ok) { setErrorEditar(r.error); return }
    setEditandoId(null)
  }

  const handleReplicar = async (c) => {
    setErrorReplicar('')
    setReplicando(true)
    const obraDestino = replicaObraId || c.obraId || null
    const r = await replicarConvenio(c.id, empresaId, {
      obraId: obraDestino,
      nombreObra: obraDestino ? nombreObra(obraDestino) : null,
    })
    setReplicando(false)
    if (!r.ok) { setErrorReplicar(r.error); return }
    setReplicandoId(null)
    setReplicaObraId('')
    setErrorReplicar('')
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
            {c.obraId && <span className="badge badge-neutral">obra: {nombreObra(c.obraId) || c.obraId}</span>}
            {editandoId !== c.id && (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => { empezarEdicion(c); setConfirmandoBorrarId(null); setReplicandoId(null); setErrorBorrar(''); setErrorReplicar('') }}>Editar</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setReplicandoId(replicandoId === c.id ? null : c.id); setConfirmandoBorrarId(null); setErrorReplicar(''); setErrorBorrar('') }}>
                  Replicar
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => { setConfirmandoBorrarId(confirmandoBorrarId === c.id ? null : c.id); setReplicandoId(null); setErrorBorrar(''); setErrorReplicar('') }}>
                  Eliminar
                </button>
              </>
            )}
          </div>
          {replicandoId === c.id && (
            <div
              className="card-compacta"
              style={{ marginTop: 12, borderLeft: '3px solid var(--brand-secondary)', paddingLeft: 12 }}
            >
              <p style={{ fontSize: '0.88rem', marginBottom: 8 }}>
                Se copia "{c.nombre}" con sus escalas y conceptos. La copia queda sin personal asignado
                y podés editarle la obra o los valores.
              </p>
              {obras.length > 0 && (
                <div className="input-group input-medio" style={{ marginBottom: 8 }}>
                  <label className="input-label" htmlFor={`replica-obra-${c.id}`}>Obra de la copia (opcional)</label>
                  <select id={`replica-obra-${c.id}`} className="input" value={replicaObraId}
                    onChange={(e) => setReplicaObraId(e.target.value)}>
                    <option value="">Igual que el original ({c.obraId ? nombreObra(c.obraId) || 'obra' : 'toda la empresa'})</option>
                    {obras.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                </div>
              )}
              <div className="acciones">
                <button className="btn btn-primary btn-sm" onClick={() => handleReplicar(c)} disabled={replicando}>
                  {replicando ? 'Replicando…' : 'Sí, replicar'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setReplicandoId(null); setErrorReplicar('') }} disabled={replicando}>Cancelar</button>
              </div>
              {errorReplicar && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: 8 }}>⚠ {errorReplicar}</p>}
            </div>
          )}
          {confirmandoBorrarId === c.id && (
            <div
              className="card-compacta"
              style={{ marginTop: 12, borderLeft: '3px solid var(--danger)', paddingLeft: 12 }}
            >
              <p style={{ fontSize: '0.88rem', marginBottom: 8 }}>
                ¿Borrar "{c.nombre}"? Se eliminan también sus escalas y conceptos. Si personal o períodos ya
                usan este convenio, el borrado se cancela con un aviso.
              </p>
              <div className="acciones">
                <button className="btn btn-danger btn-sm" onClick={() => handleBorrar(c)}>Sí, borrar</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setConfirmandoBorrarId(null)}>Cancelar</button>
              </div>
              {errorBorrar && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: 8 }}>⚠ {errorBorrar}</p>}
            </div>
          )}
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

              {obras.length > 0 && (
                <div className="input-group input-medio" style={{ marginBottom: 16 }}>
                  <label className="input-label" htmlFor={`obra-${c.id}`}>Obra (opcional)</label>
                  <select id={`obra-${c.id}`} className="input"
                    value={edicion.obraId} onChange={(e) => setEdicion((v) => ({ ...v, obraId: e.target.value }))}>
                    <option value="">Toda la empresa</option>
                    {obras.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                  <span className="texto-muted" style={{ fontSize: '0.78rem' }}>
                    Si elegís una obra, la liquidación usa este convenio para el personal de esa obra.
                  </span>
                </div>
              )}

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
            {obras.length > 0 && (
              <div className="input-group">
                <label className="input-label" htmlFor="nc-obra">Obra (opcional)</label>
                <select id="nc-obra" className="input"
                  value={nuevo.obraId} onChange={(e) => setNuevo((v) => ({ ...v, obraId: e.target.value }))}>
                  <option value="">Toda la empresa</option>
                  {obras.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                </select>
              </div>
            )}
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
