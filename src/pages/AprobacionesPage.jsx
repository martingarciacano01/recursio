import { useEffect, useState } from 'react'
import { useAprobacionesStore } from '../store/aprobacionesStore'

export default function AprobacionesPage() {
  const { instancias, cargando, error, cargarInstancias, actuar } = useAprobacionesStore()
  const [comentarios, setComentarios] = useState({})
  const [seleccion, setSeleccion] = useState([])
  const [errorAccion, setErrorAccion] = useState(null)
  const [procesando, setProcesando] = useState(false)

  useEffect(() => { cargarInstancias() }, [])

  if (cargando) return <div className="page"><div className="card">Cargando…</div></div>
  if (error) return <div className="page"><div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div></div>

  const toggleSeleccion = (id) => setSeleccion((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])

  const accionar = async (ids, accion) => {
    setProcesando(true); setErrorAccion(null)
    for (const id of ids) {
      const r = await actuar(id, accion, comentarios[id] || null)
      if (!r.ok) { setErrorAccion(`${id}: ${r.error}`); setProcesando(false); return }
    }
    setProcesando(false); setSeleccion([])
    await cargarInstancias()
  }

  const masivas = instancias.filter((i) => seleccion.includes(i.id))

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Aprobaciones</h1>
        <p className="page-subtitle">Períodos pendientes del paso que te corresponde en el flujo</p>
      </div>

      {errorAccion && <div className="card" style={{ color: 'var(--danger)' }}>Error: {errorAccion}</div>}

      {seleccion.length > 0 && (
        <div className="card card-compacta" style={{ marginBottom: '1rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{seleccion.length} seleccionados</span>
          <button className="btn btn-primary btn-sm" disabled={procesando} onClick={() => accionar(seleccion, 'aprobado')}>Aprobar seleccionados</button>
          <button className="btn btn-ghost btn-sm" disabled={procesando} onClick={() => accionar(seleccion, 'rechazado')}>Rechazar seleccionados</button>
        </div>
      )}

      {instancias.length === 0 && <div className="card">No tenés períodos pendientes de aprobación.</div>}

      {instancias.map((i) => (
        <div key={i.id} className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <input type="checkbox" checked={seleccion.includes(i.id)} onChange={() => toggleSeleccion(i.id)} />
            <h3 style={{ margin: 0 }}>
              Período {i.periodo?.tipo} {i.periodo?.fechaDesde} → {i.periodo?.fechaHasta}
            </h3>
            <span className="badge badge-neutral">paso {i.pasoActual?.orden}: {i.pasoActual?.nombre}</span>
          </div>
          <textarea className="input" placeholder="comentario (opcional)" style={{ width: '100%', marginBottom: 8 }}
            value={comentarios[i.id] || ''} onChange={(e) => setComentarios((c) => ({ ...c, [i.id]: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={procesando} onClick={() => accionar([i.id], 'aprobado')}>Aprobar</button>
            <button className="btn btn-ghost btn-sm" disabled={procesando} onClick={() => accionar([i.id], 'rechazado')}>Rechazar</button>
          </div>
        </div>
      ))}
    </div>
  )
}
