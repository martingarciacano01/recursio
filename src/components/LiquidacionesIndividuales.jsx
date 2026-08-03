import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLiquidacionStore } from '../store/liquidacionStore'
import { ausenciasVacacionesElegibles } from '../utils/vacacionesElegibles'
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
import { generarYDescargarRecibo } from '../utils/emitirReciboLegajo'

const fmtMonto = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Pestaña "Liquidaciones individuales" de LiquidacionPage (Fase 6b): vacaciones
// y liquidación final son por persona, no períodos masivos — antes se creaban
// con el mismo formulario "Nuevo período" que las quincenas/mensuales, lo que
// para vacaciones era directamente un bug (liquidaba a TODA la nómina activa
// sin personalIds). Acá se buscan/eligen de a una persona por vez.
export default function LiquidacionesIndividuales({ empresaId }) {
  const { crearPeriodoFinal, crearPeriodoVacaciones, emitirRecibo } = useLiquidacionStore()

  const [busqueda, setBusqueda] = useState('')
  const [personas, setPersonas] = useState([])
  const [personaId, setPersonaId] = useState('')
  const [legajo, setLegajo] = useState(null)
  const [ausencias, setAusencias] = useState([])
  const [vacacionesLiquidadas, setVacacionesLiquidadas] = useState([])

  const [ausenciaElegida, setAusenciaElegida] = useState('')
  const [manual, setManual] = useState(false)
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [generandoVac, setGenerandoVac] = useState(false)
  const [errorVac, setErrorVac] = useState('')

  const [generandoFinal, setGenerandoFinal] = useState(false)
  const [errorFinal, setErrorFinal] = useState('')

  const [historial, setHistorial] = useState([])
  const [errorHistorial, setErrorHistorial] = useState('')
  const [descargandoRecibo, setDescargandoRecibo] = useState(null)

  // seqEmpresa/seqPersona (Task 3.4, M2): mismo problema de orden de red
  // no garantizado que en LiquidacionPage/ReportesPage — acá aplica al
  // cambio de empresa activa (Superadmin) y al cambio de persona elegida.
  const seqEmpresaRef = useRef(0)
  const seqPersonaRef = useRef(0)

  useEffect(() => {
    const seq = ++seqEmpresaRef.current
    if (!empresaId) { setPersonas([]); return }
    supabase.from('nom_v_personal').select('id, nombre').eq('empresa_id', empresaId).eq('estado', 'activo').order('nombre')
      .then(({ data }) => { if (seqEmpresaRef.current === seq) setPersonas(data || []) })
  }, [empresaId])

  const seqHistorialRef = useRef(0)
  const cargarHistorial = () => {
    const seq = ++seqHistorialRef.current
    if (!empresaId) { setHistorial([]); return }
    supabase.from('nom_liquidaciones').select('*, nom_periodos!inner(tipo, fecha_desde, fecha_hasta)')
      .eq('empresa_id', empresaId).in('nom_periodos.tipo', ['vacaciones', 'final'])
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (seqHistorialRef.current !== seq) return
        if (error) { setErrorHistorial(error.message); return }
        setHistorial(data || [])
      })
  }

  useEffect(cargarHistorial, [empresaId])

  useEffect(() => {
    const seq = ++seqPersonaRef.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset intencional al cambiar de persona, antes de disparar las cargas.
    setLegajo(null); setAusencias([]); setVacacionesLiquidadas([])
    setAusenciaElegida(''); setManual(false); setFechaDesde(''); setFechaHasta('')
    setErrorVac(''); setErrorFinal('')
    if (!personaId || !empresaId) return
    supabase.from('nom_legajo').select('*').eq('personal_id', personaId).eq('empresa_id', empresaId).maybeSingle()
      .then(({ data }) => { if (seqPersonaRef.current === seq) setLegajo(data) })
    supabase.from('nom_v_ausencias').select('*').eq('personal_id', personaId)
      .then(({ data }) => { if (seqPersonaRef.current === seq) setAusencias(data || []) })
    supabase.from('nom_vacaciones_liquidadas').select('ausencia_id').eq('personal_id', personaId).eq('empresa_id', empresaId)
      .then(({ data }) => { if (seqPersonaRef.current === seq) setVacacionesLiquidadas((data || []).map((v) => v.ausencia_id).filter(Boolean)) })
  }, [personaId, empresaId])

  const personasFiltradas = personas.filter((p) => p.nombre.toLowerCase().includes(busqueda.toLowerCase()))
  const elegibles = ausenciasVacacionesElegibles(ausencias, vacacionesLiquidadas)
  const puedeFinal = legajo?.fecha_baja && !legajo?.liquidacion_final_id

  const handleGenerarVacaciones = async () => {
    setErrorVac('')
    const ausenciaSeleccionada = elegibles.find((a) => a.id === ausenciaElegida)
    const desde = manual ? fechaDesde : ausenciaSeleccionada?.fecha_desde
    const hasta = manual ? fechaHasta : ausenciaSeleccionada?.fecha_hasta
    if (!desde || !hasta) { setErrorVac('Elegí una ausencia o cargá un rango de fechas.'); return }
    setGenerandoVac(true)
    const r = await crearPeriodoVacaciones(personaId, desde, hasta, empresaId, manual ? null : ausenciaElegida)
    setGenerandoVac(false)
    if (!r.ok) { setErrorVac(r.error); return }
    setAusenciaElegida(''); setManual(false); setFechaDesde(''); setFechaHasta('')
    setVacacionesLiquidadas((prev) => (manual ? prev : [...prev, ausenciaElegida]))
    cargarHistorial()
  }

  const handleGenerarFinal = async () => {
    setErrorFinal('')
    setGenerandoFinal(true)
    const r = await crearPeriodoFinal(personaId, legajo.fecha_baja, empresaId)
    setGenerandoFinal(false)
    if (!r.ok) { setErrorFinal(r.error); return }
    setLegajo((l) => ({ ...l, liquidacion_final_id: r.data?.liquidacionId || 'ok' }))
    cargarHistorial()
  }

  const handleDescargarRecibo = async (l) => {
    setErrorHistorial('')
    setDescargandoRecibo(l.id)
    try {
      const { data: filasItems } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', l.id)
      const { doc, hash, nombreArchivo } = await generarYDescargarRecibo({
        empresaId, personalId: l.personal_id,
        nombrePersona: personas.find((p) => p.id === l.personal_id)?.nombre || l.personal_id,
        periodo: l.nom_periodos, filasItems, numeroRecibo: l.numero_recibo,
      })
      const r = await emitirRecibo(l.id, hash)
      if (!r.ok) { setErrorHistorial(r.error); setDescargandoRecibo(null); return }
      doc.save(`${nombreArchivo}-${r.numeroRecibo}.pdf`)
      cargarHistorial()
    } catch (e) {
      setErrorHistorial(e instanceof Error ? e.message : String(e))
    }
    setDescargandoRecibo(null)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label htmlFor="li-busqueda" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Buscar persona</label>
          <input id="li-busqueda" className="input" style={{ maxWidth: 320 }} value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)} placeholder="Nombre…" />
        </div>
        <div>
          <label htmlFor="li-persona" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Persona</label>
          <select id="li-persona" className="input" style={{ maxWidth: 320 }} value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
            <option value="">Elegir persona…</option>
            {personasFiltradas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>

        {personaId && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, borderTop: '0.5px solid var(--border)', paddingTop: 12 }}>
            <div>
              <strong style={{ fontSize: '0.9rem' }}>Vacaciones</strong>
              {elegibles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                  {elegibles.map((a) => (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
                      <input type="radio" name="ausencia-vacaciones" checked={!manual && ausenciaElegida === a.id}
                        onChange={() => { setManual(false); setAusenciaElegida(a.id) }} />
                      {a.fecha_desde} a {a.fecha_hasta}
                    </label>
                  ))}
                </div>
              )}
              {elegibles.length === 0 && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '8px 0' }}>
                  Sin ausencias de vacaciones aprobadas pendientes de liquidar en Presencio.
                </p>
              )}
              <label htmlFor="li-manual" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', marginTop: 8 }}>
                <input id="li-manual" type="checkbox" checked={manual}
                  onChange={(e) => { setManual(e.target.checked); setAusenciaElegida('') }} />
                Cargar manualmente (sin ausencia en Presencio)
              </label>
              {manual && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input type="date" className="input" aria-label="Fecha desde" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
                  <input type="date" className="input" aria-label="Fecha hasta" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
                </div>
              )}
              {errorVac && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: 6 }}>{errorVac}</div>}
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleGenerarVacaciones}
                  disabled={generandoVac || (!manual && !ausenciaElegida) || (manual && (!fechaDesde || !fechaHasta))}
                >
                  {generandoVac ? 'Generando…' : 'Generar vacaciones'}
                </button>
              </div>
            </div>

            {puedeFinal && (
              <div>
                <strong style={{ fontSize: '0.9rem' }}>Liquidación final</strong>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '4px 0 8px' }}>
                  Baja: {legajo.fecha_baja} ({legajo.motivo_baja})
                </p>
                {errorFinal && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 6 }}>{errorFinal}</div>}
                <button className="btn btn-primary btn-sm" onClick={handleGenerarFinal} disabled={generandoFinal}>
                  {generandoFinal ? 'Generando…' : 'Generar liquidación final'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <strong style={{ fontSize: '0.9rem' }}>Historial de liquidaciones individuales</strong>
        {errorHistorial && <p style={{ color: 'var(--danger)' }}>Error: {errorHistorial}</p>}
        {historial.length === 0 && !errorHistorial && <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>Sin liquidaciones individuales registradas.</p>}
        {historial.length > 0 && (
          <table className="table" style={{ marginTop: 8 }}>
            <thead>
              <tr><th>Persona</th><th>Período</th><th>Neto</th><th>Recibo</th><th></th></tr>
            </thead>
            <tbody>
              {historial.map((l) => (
                <tr key={l.id}>
                  <td>{personas.find((p) => p.id === l.personal_id)?.nombre || l.personal_id}</td>
                  <td>{etiquetaPeriodo(l.nom_periodos)}</td>
                  <td><strong>${fmtMonto(l.neto)}</strong></td>
                  <td>{l.numero_recibo ? `#${l.numero_recibo}` : '—'}</td>
                  <td>
                    {!l.anulado && (
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDescargarRecibo(l)} disabled={descargandoRecibo === l.id}>
                        {descargandoRecibo === l.id ? 'Generando…' : l.numero_recibo ? 'Descargar recibo' : 'Emitir recibo'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
