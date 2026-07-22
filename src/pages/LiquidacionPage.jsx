import { Fragment, useEffect, useState } from 'react'
const FragmentoLiquidacion = Fragment
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useLiquidacionStore } from '../store/liquidacionStore'
import { useFlujosStore } from '../store/flujosStore'
import { generarReciboPdf } from '../utils/reciboPdf'
import { calcularHashPdf } from '../utils/reciboHash'
import { exportarCsv } from '../utils/exportCsv'
import SelectorPeriodo from '../components/SelectorPeriodo'
import { etiquetaConcepto } from '../utils/etiquetaConcepto'

export default function LiquidacionPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un usuario Superadmin no tiene `empresa` fija: opera sobre la que haya
  // elegido en /superadmin ("entrar en empresa", ver authStore.js). Esto
  // reemplaza al selector local que existía antes en esta misma página.
  const empresaActiva = empresa || empresaVista
  const empresaId = empresaActiva?.id || ''

  const { liquidaciones, calculando, error, omitidos, advertencias, calcularPeriodo, cargarLiquidaciones, emitirRecibo } = useLiquidacionStore()
  const [mostrarAvisos, setMostrarAvisos] = useState(false)
  const [emitiendoRecibo, setEmitiendoRecibo] = useState(null)
  const [errorRecibo, setErrorRecibo] = useState('')
  const { flujos, cargarFlujos, iniciarFlujo } = useFlujosStore()
  const [flujoElegido, setFlujoElegido] = useState('')
  const [enviandoFlujo, setEnviandoFlujo] = useState(false)
  const [errorFlujo, setErrorFlujo] = useState('')
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
  const [busqueda, setBusqueda] = useState('')

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
    cargarFlujos(empresaId)
  }, [empresaId])

  const handleEnviarAFlujo = async () => {
    if (!periodoSeleccionado || !flujoElegido) return
    setEnviandoFlujo(true); setErrorFlujo('')
    const r = await iniciarFlujo(periodoSeleccionado, flujoElegido)
    setEnviandoFlujo(false)
    if (!r.ok) { setErrorFlujo(r.error); return }
    cargarPeriodos()
  }

  useEffect(() => {
    setLiqExpandida(null)
    setItemsPorLiq({})
    if (periodoSeleccionado) cargarLiquidaciones(periodoSeleccionado)
  }, [periodoSeleccionado])

  // Genera el PDF real (art. 140 LCT, src/utils/reciboPdf.js), calcula su
  // hash SHA-256 (src/utils/reciboHash.js) y asigna numero_recibo vía RPC
  // (emitir_recibo, migración 0016) — best-effort en los datos de empresa/
  // legajo que esta pantalla no tenía cargados hasta ahora, para no
  // duplicar todo el fetching que ya hacen FichaLegajoPage/SuperAdminPage.
  const handleEmitirRecibo = async (l) => {
    setErrorRecibo(''); setEmitiendoRecibo(l.id)
    try {
      const [{ data: empresaRow }, { data: legajoRow }] = await Promise.all([
        supabase.from('empresas').select('nombre, cuit, domicilio').eq('id', empresaId).single(),
        supabase.from('nom_legajo').select('cuil, categoria_id, fecha_ingreso').eq('personal_id', l.personalId).eq('empresa_id', empresaId).single(),
      ])
      let categoriaNombre = '—'
      if (legajoRow?.categoria_id) {
        const { data: cat } = await supabase.from('nom_categorias').select('nombre').eq('id', legajoRow.categoria_id).single()
        categoriaNombre = cat?.nombre || '—'
      }
      const items = (itemsPorLiq[l.id] || []).map((i) => ({ nombre: i.concepto_nombre, tipo: i.tipo, monto: Number(i.monto) }))
      const doc = generarReciboPdf({
        empresa: { nombre: empresaRow?.nombre || empresaActiva?.nombre || '—', cuit: empresaRow?.cuit || '—', domicilio: empresaRow?.domicilio || '—' },
        persona: {
          nombre: personalPorId.get(l.personalId) || l.personalId, cuil: legajoRow?.cuil || '—',
          legajo: l.personalId.slice(0, 8), categoria: categoriaNombre, fechaIngreso: legajoRow?.fecha_ingreso || '—',
        },
        periodo: { descripcion: periodoActivo ? `${periodoActivo.tipo} — ${periodoActivo.fecha_desde} a ${periodoActivo.fecha_hasta}` : '' },
        items,
        neto: l.neto,
      })
      const hash = await calcularHashPdf(doc)
      const r = await emitirRecibo(l.id, hash)
      if (!r.ok) { setErrorRecibo(r.error); setEmitiendoRecibo(null); return }
      doc.save(`recibo-${personalPorId.get(l.personalId) || l.personalId}-${r.numeroRecibo}.pdf`)
      await cargarLiquidaciones(periodoSeleccionado)
    } catch (e) {
      setErrorRecibo(e instanceof Error ? e.message : String(e))
    }
    setEmitiendoRecibo(null)
  }

  const handleCalcular = async () => {
    if (!periodoSeleccionado) return
    const r = await calcularPeriodo(periodoSeleccionado)
    if (r.ok) cargarLiquidaciones(periodoSeleccionado)
  }

  const liquidacionesFiltradas = liquidaciones.filter((l) => {
    const nombre = personalPorId.get(l.personalId) || ''
    return nombre.toLowerCase().includes(busqueda.toLowerCase())
  })

  const descargarCsv = () => {
    exportarCsv(`liquidacion-${periodoActivo?.tipo}-${periodoActivo?.fecha_desde}.csv`, [
      { titulo: 'Legajo', valor: (l) => l.personalId.slice(0, 8) },
      { titulo: 'Nombre', valor: (l) => personalPorId.get(l.personalId) || l.personalId },
      { titulo: 'Horas', valor: (l) => l.detalleHoras?.horasTrabajadas ?? 0 },
      { titulo: 'HE 50%', valor: (l) => l.detalleHoras?.horasExtra50 ?? 0 },
      { titulo: 'HE 100%', valor: (l) => l.detalleHoras?.horasExtra100 ?? 0 },
      { titulo: 'Bruto', valor: (l) => l.bruto },
      { titulo: 'Aportes', valor: (l) => l.totalAportes },
      { titulo: 'Contribuciones', valor: (l) => l.totalContribuciones },
      { titulo: 'Neto', valor: (l) => l.neto },
    ], liquidacionesFiltradas)
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
        <SelectorPeriodo periodos={periodos} value={periodoSeleccionado} onChange={setPeriodoSeleccionado} />
        <button
          className="btn btn-primary btn-sm"
          onClick={handleCalcular}
          disabled={!periodoSeleccionado || calculando || periodoActivo?.estado === 'cerrado'}
          title={periodoActivo?.estado === 'cerrado' ? 'período cerrado: no se puede recalcular' : undefined}
        >
          {calculando ? 'Calculando…' : 'Calcular'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setMostrarFormNuevo((v) => !v)} disabled={!empresaId}>
          {mostrarFormNuevo ? 'Cancelar' : 'Nuevo período'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={descargarCsv} disabled={liquidacionesFiltradas.length === 0}>
          Descargar CSV
        </button>
        {periodoActivo?.estado === 'abierto' && flujos.length > 0 && (
          <>
            <select className="input" style={{ maxWidth: 220 }} value={flujoElegido} onChange={(e) => setFlujoElegido(e.target.value)}>
              <option value="">Elegir flujo…</option>
              {flujos.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={handleEnviarAFlujo} disabled={!flujoElegido || enviandoFlujo}>
              {enviandoFlujo ? 'Enviando…' : 'Enviar a aprobación'}
            </button>
          </>
        )}
        {errorFlujo && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorFlujo}</span>}
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
      {errorRecibo && <div className="card" style={{ color: 'var(--danger)' }}>Error al emitir recibo: {errorRecibo}</div>}

      {(omitidos.length > 0 || advertencias.length > 0) && (
        <div className="card" style={{ marginBottom: '1rem', background: 'var(--warning-bg, rgba(234,179,8,0.12))', border: '1px solid var(--warning, #eab308)' }}>
          <div
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={() => setMostrarAvisos((v) => !v)}
          >
            <strong>⚠ {omitidos.length} persona(s) no liquidada(s) / {advertencias.length} advertencia(s)</strong>
            <span style={{ marginLeft: 'auto' }}>{mostrarAvisos ? '▾' : '▸'}</span>
          </div>
          {mostrarAvisos && (
            <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
              {omitidos.map((o) => (
                <div key={o.personal_id}>• {o.nombre || o.personal_id}: {o.motivo}</div>
              ))}
              {advertencias.map((a, i) => (
                <div key={`${a.personal_id}-${i}`}>• {personalPorId.get(a.personal_id) || a.personal_id}: {a.mensaje}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {liquidaciones.length > 0 && periodoActivo && (
        <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong>Período calculado:</strong>
          <span>{periodoActivo.tipo} — {periodoActivo.fecha_desde} a {periodoActivo.fecha_hasta}</span>
          <span className="badge badge-neutral">{periodoActivo.estado}</span>
          <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>{liquidaciones.length} liquidación(es)</span>
        </div>
      )}

      {liquidaciones.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <input className="input" placeholder="Buscar por nombre…" value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)} style={{ maxWidth: 260 }} />
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
              {liquidacionesFiltradas.map((l) => {
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
                      <td>
                        <span className="badge badge-neutral">{l.estado}</span>
                        {l.numeroRecibo && <span className="badge badge-neutral" style={{ marginLeft: 4 }}>recibo #{l.numeroRecibo}{l.version > 1 ? ` v${l.version}` : ''}</span>}
                        {l.anulado && <span className="badge badge-warning" style={{ marginLeft: 4 }}>anulado</span>}
                      </td>
                      <td>{liqExpandida === l.id ? '▾' : '▸'}</td>
                    </tr>
                    {liqExpandida === l.id && (
                      <tr>
                        <td colSpan={13} style={{ background: 'var(--bg-subtle, rgba(255,255,255,0.03))' }}>
                          {items.length > 0 && !l.anulado && (
                            <button className="btn btn-primary btn-sm" style={{ marginBottom: 8 }}
                              onClick={(e) => { e.stopPropagation(); handleEmitirRecibo(l) }} disabled={emitiendoRecibo === l.id}>
                              {emitiendoRecibo === l.id ? 'Generando…' : l.numeroRecibo ? 'Regenerar recibo PDF' : 'Emitir recibo PDF'}
                            </button>
                          )}
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
                                        <td style={{ width: '55%' }}>{etiquetaConcepto(i)} <span style={{ opacity: 0.6 }}>({i.concepto_codigo})</span></td>
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
