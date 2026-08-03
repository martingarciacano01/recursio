import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAprobacionesStore } from '../store/aprobacionesStore'
import { useAuthStore } from '../store/authStore'
import { usePaginado } from '../hooks/usePaginado'

const fmt = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtHs = (detalleHoras) => {
  if (!detalleHoras) return '—'
  const total = Object.values(detalleHoras).reduce((acc, v) => acc + (Number(v) || 0), 0)
  return `${total.toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`
}

const TAMANO_PAGINA = 10

export default function AprobacionesPage() {
  const { instancias, recibosPorPeriodo, agregadosPorPeriodo, personalPorId, cargando, error, cargarInstancias, actuar, revisarLiquidacion } = useAprobacionesStore()
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const empresaActiva = empresa || empresaVista
  const [comentarios, setComentarios] = useState({})
  const [seleccion, setSeleccion] = useState([])
  const [seleccionPorPeriodo, setSeleccionPorPeriodo] = useState({})
  const [motivoPorRecibo, setMotivoPorRecibo] = useState({})
  const [errorAccion, setErrorAccion] = useState(null)
  const [procesando, setProcesando] = useState(false)
  const { pagina, rango, siguientePagina, reset, hayMasPaginas } = usePaginado(TAMANO_PAGINA)

  useEffect(() => { if (empresaActiva?.id) cargarInstancias(empresaActiva.id) }, [empresaActiva?.id])
  useEffect(() => { reset() }, [empresaActiva?.id])

  // Recarga al recuperar el foco de la ventana (Task 4.1): otra persona
  // puede haber revisado recibos de este mismo período en otra
  // pestaña/dispositivo mientras esta pantalla estaba de fondo.
  useEffect(() => {
    if (!empresaActiva?.id) return
    const onFocus = () => cargarInstancias(empresaActiva.id)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [empresaActiva?.id])

  if (!empresaActiva) return <div className="page"><div className="card">Elegí una empresa en Superadmin → "Entrar" para ver sus aprobaciones.</div></div>
  if (cargando) return <div className="page"><div className="card">Cargando…</div></div>
  if (error) return <div className="page"><div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div></div>

  const toggleSeleccion = (id) => setSeleccion((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])
  const toggleSeleccionRecibo = (periodoId, reciboId) => setSeleccionPorPeriodo((s) => {
    const actual = s[periodoId] || []
    const nueva = actual.includes(reciboId) ? actual.filter((x) => x !== reciboId) : [...actual, reciboId]
    return { ...s, [periodoId]: nueva }
  })

  const accionar = async (ids, accion) => {
    setProcesando(true); setErrorAccion(null)
    for (const id of ids) {
      const r = await actuar(id, accion, comentarios[id] || null)
      if (!r.ok) { setErrorAccion(`${id}: ${r.error}`); setProcesando(false); return }
    }
    setProcesando(false); setSeleccion([])
    await cargarInstancias(empresaActiva?.id)
  }

  const revisarRecibos = async (periodoId, ids, accion, comentario) => {
    setProcesando(true); setErrorAccion(null)
    for (const id of ids) {
      const r = await revisarLiquidacion(id, accion, comentario ?? null)
      if (!r.ok) { setErrorAccion(`${id}: ${r.error}`); setProcesando(false); return }
    }
    setProcesando(false)
    setSeleccionPorPeriodo((s) => ({ ...s, [periodoId]: [] }))
    await cargarInstancias(empresaActiva?.id)
  }

  const instanciasPagina = instancias.slice(rango[0], rango[1] + 1)

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Aprobaciones</h1>
        <p className="page-subtitle">Períodos pendientes del paso que te corresponde en el flujo</p>
      </div>

      {errorAccion && <div className="card" style={{ color: 'var(--danger)' }}>Error: {errorAccion}</div>}

      {seleccion.length > 0 && (
        <div className="card card-compacta" style={{ marginBottom: '1rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{seleccion.length} períodos seleccionados</span>
          <button className="btn btn-primary btn-sm" disabled={procesando} onClick={() => accionar(seleccion, 'aprobado')}>Aprobar seleccionados</button>
          <button className="btn btn-ghost btn-sm" disabled={procesando} onClick={() => accionar(seleccion, 'rechazado')}>Rechazar seleccionados</button>
        </div>
      )}

      {instancias.length === 0 && <div className="card">No tenés períodos pendientes de aprobación.</div>}

      {instanciasPagina.map((i) => {
        const recibos = recibosPorPeriodo[i.periodoId] || []
        const agregados = agregadosPorPeriodo[i.periodoId] || { bruto: 0, totalAportes: 0, neto: 0, cantidad: 0 }
        const seleccionRecibos = seleccionPorPeriodo[i.periodoId] || []
        const motivoLote = motivoPorRecibo[`lote-${i.periodoId}`] || ''

        return (
          <div key={i.id} className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <input type="checkbox" checked={seleccion.includes(i.id)} onChange={() => toggleSeleccion(i.id)} />
              <h3 style={{ margin: 0 }}>
                Período {i.periodo?.tipo} {i.periodo?.fechaDesde} → {i.periodo?.fechaHasta}
              </h3>
              <span className="badge badge-neutral">paso {i.pasoActual?.orden}: {i.pasoActual?.nombre}</span>
              <Link to={`/liquidacion?periodo=${i.periodoId}`}>Ver detalle</Link>
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap', color: 'var(--texto-secundario)' }}>
              <span>Bruto total: ${fmt(agregados.bruto)}</span>
              <span>Descuentos: ${fmt(agregados.totalAportes)}</span>
              <span>Neto total: ${fmt(agregados.neto)}</span>
              <span>{agregados.cantidad} recibos</span>
            </div>

            <textarea className="input" placeholder="comentario (opcional)" style={{ width: '100%', marginBottom: 8 }}
              value={comentarios[i.id] || ''} onChange={(e) => setComentarios((c) => ({ ...c, [i.id]: e.target.value }))} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button className="btn btn-primary btn-sm" disabled={procesando} onClick={() => accionar([i.id], 'aprobado')}>Aprobar período</button>
              <button className="btn btn-ghost btn-sm" disabled={procesando} onClick={() => accionar([i.id], 'rechazado')}>Rechazar período</button>
            </div>

            {seleccionRecibos.length > 0 && (
              <div className="card card-compacta" style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{seleccionRecibos.length} recibos seleccionados</span>
                <button className="btn btn-primary btn-sm" disabled={procesando}
                  onClick={() => revisarRecibos(i.periodoId, seleccionRecibos, 'aprobado')}>Aprobar seleccionados</button>
                <textarea className="input" placeholder="motivo del rechazo" style={{ minWidth: 220 }}
                  value={motivoLote} onChange={(e) => setMotivoPorRecibo((m) => ({ ...m, [`lote-${i.periodoId}`]: e.target.value }))} />
                <button className="btn btn-ghost btn-sm" disabled={procesando || !motivoLote.trim()}
                  onClick={() => revisarRecibos(i.periodoId, seleccionRecibos, 'rechazado', motivoLote)}>Rechazar seleccionados</button>
              </div>
            )}

            <table className="tabla">
              <thead>
                <tr><th></th><th>Persona</th><th>Bruto</th><th>Descuentos</th><th>Neto</th><th>Horas</th><th>Estado</th><th>Motivo</th><th></th></tr>
              </thead>
              <tbody>
                {recibos.map((r) => {
                  const motivo = motivoPorRecibo[r.id] || ''
                  return (
                    <tr key={r.id}>
                      <td><input type="checkbox" aria-label={`seleccionar recibo de ${personalPorId[r.personalId] || r.personalId}`}
                        checked={seleccionRecibos.includes(r.id)} onChange={() => toggleSeleccionRecibo(i.periodoId, r.id)} /></td>
                      <td>{personalPorId[r.personalId] || r.personalId}</td>
                      <td>${fmt(r.bruto)}</td>
                      <td>${fmt(r.totalAportes)}</td>
                      <td>${fmt(r.neto)}</td>
                      <td>{fmtHs(r.detalleHoras)}</td>
                      <td><span className={`badge badge-${r.estadoRevision === 'aprobado' ? 'success' : r.estadoRevision === 'rechazado' ? 'danger' : 'neutral'}`}>{r.estadoRevision}</span></td>
                      <td>{r.motivoRechazo || '—'}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn btn-primary btn-sm" disabled={procesando}
                          onClick={() => revisarRecibos(i.periodoId, [r.id], 'aprobado')}>Aprobar</button>
                        <textarea className="input" placeholder="motivo del rechazo" style={{ minWidth: 160 }}
                          value={motivo} onChange={(e) => setMotivoPorRecibo((m) => ({ ...m, [r.id]: e.target.value }))} />
                        <button className="btn btn-ghost btn-sm" disabled={procesando || !motivo.trim()}
                          onClick={() => revisarRecibos(i.periodoId, [r.id], 'rechazado', motivo)}>Rechazar</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}

      {(pagina > 0 || hayMasPaginas(instancias.length)) && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
          {hayMasPaginas(instancias.length) && <button className="btn btn-ghost btn-sm" onClick={siguientePagina}>Ver más períodos</button>}
        </div>
      )}
    </div>
  )
}
