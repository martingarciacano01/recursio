import { Fragment, useEffect, useState } from 'react'
const FragmentoLiquidacion = Fragment
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useLiquidacionStore } from '../store/liquidacionStore'

export default function LiquidacionPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un usuario Superadmin no tiene `empresa` fija: opera sobre la que haya
  // elegido en /superadmin ("entrar en empresa", ver authStore.js). Esto
  // reemplaza al selector local que existía antes en esta misma página.
  const empresaActiva = empresa || empresaVista
  const empresaId = empresaActiva?.id || ''

  const { liquidaciones, calculando, error, calcularPeriodo, cargarLiquidaciones } = useLiquidacionStore()
  const [periodos, setPeriodos] = useState([])
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState('')
  const [personalPorId, setPersonalPorId] = useState(new Map())

  const [mostrarFormNuevo, setMostrarFormNuevo] = useState(false)
  const [nuevoTipo, setNuevoTipo] = useState('mensual')
  const [nuevoDesde, setNuevoDesde] = useState('')
  const [nuevoHasta, setNuevoHasta] = useState('')
  const [creandoPeriodo, setCreandoPeriodo] = useState(false)
  const [errorCrearPeriodo, setErrorCrearPeriodo] = useState('')

  const [liqExpandida, setLiqExpandida] = useState(null)
  const [itemsPorLiq, setItemsPorLiq] = useState({})

  const periodoActivo = periodos.find((p) => p.id === periodoSeleccionado)
  const fmt = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtHs = (n) => `${(Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`

  const toggleDetalle = async (liqId) => {
    if (liqExpandida === liqId) { setLiqExpandida(null); return }
    setLiqExpandida(liqId)
    if (!itemsPorLiq[liqId]) {
      const { data } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', liqId)
      setItemsPorLiq((prev) => ({ ...prev, [liqId]: data || [] }))
    }
  }

  const cargarPeriodos = () => {
    if (!empresaId) return
    supabase.from('nom_periodos').select('*').eq('empresa_id', empresaId).order('fecha_desde', { ascending: false })
      .then(({ data }) => setPeriodos(data || []))
  }

  useEffect(() => {
    cargarPeriodos()
    setPeriodoSeleccionado('')
    if (!empresaId) return
    supabase.from('nom_v_personal').select('id, nombre').eq('empresa_id', empresaId)
      .then(({ data }) => setPersonalPorId(new Map((data || []).map((p) => [p.id, p.nombre]))))
  }, [empresaId])

  useEffect(() => {
    setLiqExpandida(null)
    setItemsPorLiq({})
    if (periodoSeleccionado) cargarLiquidaciones(periodoSeleccionado)
  }, [periodoSeleccionado])

  const handleCalcular = async () => {
    if (!periodoSeleccionado) return
    const r = await calcularPeriodo(periodoSeleccionado)
    if (r.ok) cargarLiquidaciones(periodoSeleccionado)
  }

  const handleCrearPeriodo = async () => {
    setErrorCrearPeriodo('')
    if (!empresaId) {
      setErrorCrearPeriodo('Elegí primero una empresa en Superadmin.')
      return
    }
    if (!nuevoDesde || !nuevoHasta) {
      setErrorCrearPeriodo('Completá fecha desde y hasta.')
      return
    }
    if (nuevoHasta < nuevoDesde) {
      setErrorCrearPeriodo('La fecha hasta no puede ser anterior a la fecha desde.')
      return
    }
    setCreandoPeriodo(true)
    const { data, error } = await supabase.from('nom_periodos').insert({
      empresa_id: empresaId,
      tipo: nuevoTipo,
      fecha_desde: nuevoDesde,
      fecha_hasta: nuevoHasta,
      estado: 'abierto',
    }).select().single()
    setCreandoPeriodo(false)
    if (error) { setErrorCrearPeriodo(error.message); return }
    setPeriodos((prev) => [data, ...prev])
    setPeriodoSeleccionado(data.id)
    setMostrarFormNuevo(false)
    setNuevoDesde('')
    setNuevoHasta('')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Liquidación</h1>
        <p className="page-subtitle">Calcular y revisar liquidaciones por período</p>
      </div>

      {!empresaActiva && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          Elegí una empresa en Superadmin → "Entrar" para operar la liquidación.
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 12, alignItems: 'center' }}>
        <select className="input" value={periodoSeleccionado} onChange={(e) => setPeriodoSeleccionado(e.target.value)} disabled={!empresaId} style={{ maxWidth: 320 }}>
          <option value="">Elegir período…</option>
          {periodos.map((p) => (
            <option key={p.id} value={p.id}>{p.tipo} — {p.fecha_desde} a {p.fecha_hasta} ({p.estado})</option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" onClick={handleCalcular} disabled={!periodoSeleccionado || calculando}>
          {calculando ? 'Calculando…' : 'Calcular'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setMostrarFormNuevo((v) => !v)} disabled={!empresaId}>
          {mostrarFormNuevo ? 'Cancelar' : 'Nuevo período'}
        </button>
      </div>

      {mostrarFormNuevo && (
        <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Tipo</label>
            <select className="input" value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value)}>
              <option value="mensual">Mensual</option>
              <option value="quincenal">Quincenal</option>
              <option value="sac">SAC</option>
              <option value="final">Liquidación final</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Desde</label>
            <input type="date" className="input" value={nuevoDesde} onChange={(e) => setNuevoDesde(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: 4 }}>Hasta</label>
            <input type="date" className="input" value={nuevoHasta} onChange={(e) => setNuevoHasta(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleCrearPeriodo} disabled={creandoPeriodo}>
            {creandoPeriodo ? 'Creando…' : 'Crear período'}
          </button>
          {errorCrearPeriodo && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorCrearPeriodo}</span>}
        </div>
      )}

      {error && <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>}

      {liquidaciones.length > 0 && periodoActivo && (
        <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong>Período calculado:</strong>
          <span>{periodoActivo.tipo} — {periodoActivo.fecha_desde} a {periodoActivo.fecha_hasta}</span>
          <span className="badge badge-neutral">{periodoActivo.estado}</span>
          <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>{liquidaciones.length} liquidación(es)</span>
        </div>
      )}

      {liquidaciones.length > 0 && (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Persona</th><th>Horas</th><th>HE 50%</th><th>HE 100%</th>
                <th>Tardanzas</th><th>Faltas inj.</th><th>Faltas just.</th>
                <th>Bruto</th><th>Aportes</th><th>Contribuciones</th><th>Neto</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {liquidaciones.map((l) => {
                const dh = l.detalleHoras || {}
                const items = itemsPorLiq[l.id] || []
                const grupos = [
                  ['remunerativo', 'Remunerativos'],
                  ['no_remunerativo', 'No remunerativos'],
                  ['descuento', 'Aportes del trabajador'],
                  ['aporte_patronal', 'Contribuciones patronales'],
                  ['informativo', 'Informativos'],
                ]
                return (
                  <FragmentoLiquidacion key={l.id}>
                    <tr onClick={() => toggleDetalle(l.id)} style={{ cursor: 'pointer' }}>
                      <td>{personalPorId.get(l.personalId) || l.personalId}</td>
                      <td>{fmtHs(dh.horasTrabajadas)}</td>
                      <td>{fmtHs(dh.horasExtra50)}</td>
                      <td>{fmtHs(dh.horasExtra100)}</td>
                      <td>{dh.tardanzas ?? '—'}</td>
                      <td>{dh.faltasInjustificadas ?? '—'}</td>
                      <td>{dh.faltasJustificadas ?? '—'}</td>
                      <td>${fmt(l.bruto)}</td>
                      <td>${fmt(l.totalAportes)}</td>
                      <td>${fmt(l.totalContribuciones)}</td>
                      <td><strong>${fmt(l.neto)}</strong></td>
                      <td><span className="badge badge-neutral">{l.estado}</span></td>
                      <td>{liqExpandida === l.id ? '▾' : '▸'}</td>
                    </tr>
                    {liqExpandida === l.id && (
                      <tr>
                        <td colSpan={13} style={{ background: 'var(--bg-subtle, rgba(255,255,255,0.03))' }}>
                          {items.length === 0 ? 'Cargando detalle…' : grupos.map(([tipo, titulo]) => {
                            const delGrupo = items.filter((i) => i.tipo === tipo)
                            if (delGrupo.length === 0) return null
                            return (
                              <div key={tipo} style={{ margin: '0.5rem 0' }}>
                                <strong style={{ fontSize: '0.85rem' }}>{titulo}</strong>
                                <table className="table" style={{ marginTop: 4 }}>
                                  <tbody>
                                    {delGrupo.map((i) => (
                                      <tr key={i.id}>
                                        <td style={{ width: '55%' }}>{i.concepto_nombre} <span style={{ opacity: 0.6 }}>({i.concepto_codigo})</span></td>
                                        <td style={{ opacity: 0.6 }}>regla: {i.regla_aplicada}</td>
                                        <td style={{ textAlign: 'right' }}>${fmt(i.monto)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )
                          })}
                        </td>
                      </tr>
                    )}
                  </FragmentoLiquidacion>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
