import { Fragment, useEffect, useState } from 'react'
const FragmentoLiquidacion = Fragment
import { Lock, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useLiquidacionStore } from '../store/liquidacionStore'
import { useFlujosStore } from '../store/flujosStore'
import { exportarCsv } from '../utils/exportCsv'
import SelectorPeriodo from '../components/SelectorPeriodo'
import { etiquetaConcepto } from '../utils/etiquetaConcepto'
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
import { generarYDescargarRecibo } from '../utils/emitirReciboLegajo'
import { generarZipRecibos, nombreArchivoZip } from '../utils/reciboZip'
import LiquidacionesIndividuales from '../components/LiquidacionesIndividuales'
import { useConveniosStore } from '../store/conveniosStore'
import { calcularFechasPeriodo } from '../utils/calcularFechasPeriodo'
import { FUERA_DE_CONVENIO, TIPOS_MANUALES, tiposDisponibles, etiquetaTipo, convenioDelPeriodo, conveniosParaPeriodo } from '../utils/tiposPeriodo'
import BorrarPeriodo from '../components/BorrarPeriodo'

const PESTANAS = ['Períodos generales', 'Liquidaciones individuales']

export default function LiquidacionPage() {
  const [pestana, setPestana] = useState(PESTANAS[0])
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un usuario Superadmin no tiene `empresa` fija: opera sobre la que haya
  // elegido en /superadmin ("entrar en empresa", ver authStore.js). Esto
  // reemplaza al selector local que existía antes en esta misma página.
  const empresaActiva = empresa || empresaVista
  const empresaId = empresaActiva?.id || ''

  const { liquidaciones, calculando, error, omitidos, advertencias, sinHoras, calcularPeriodo, cargarLiquidaciones, emitirRecibo } = useLiquidacionStore()
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
  const [nuevoTipo, setNuevoTipo] = useState('')
  const [nuevoAnio, setNuevoAnio] = useState(new Date().getFullYear())
  const [nuevoMes, setNuevoMes] = useState(new Date().getMonth() + 1)
  const [nuevoConvenioId, setNuevoConvenioId] = useState('')
  const [nuevoDesde, setNuevoDesde] = useState('')
  const [nuevoHasta, setNuevoHasta] = useState('')
  const [creandoPeriodo, setCreandoPeriodo] = useState(false)
  const [errorCrearPeriodo, setErrorCrearPeriodo] = useState('')
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [errorCierre, setErrorCierre] = useState('')
  const { convenios, cargarConvenios } = useConveniosStore()

  const [liqExpandida, setLiqExpandida] = useState(null)
  const [itemsPorLiq, setItemsPorLiq] = useState({})
  const [busqueda, setBusqueda] = useState('')

  // Selección múltiple para el ZIP de recibos (plan 2026-07-29 §1).
  const [seleccionadas, setSeleccionadas] = useState(new Set())
  const [generandoZip, setGenerandoZip] = useState(false)
  const [progresoZip, setProgresoZip] = useState(null) // { procesados, total }
  const [erroresZip, setErroresZip] = useState([]) // [{ nombre, error }]
  const [mostrarErroresZip, setMostrarErroresZip] = useState(false)

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

  useEffect(() => { if (empresaId) cargarConvenios(empresaId) }, [empresaId])

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
      const { doc, hash, nombreArchivo } = await generarYDescargarRecibo({
        empresaId,
        personalId: l.personalId,
        nombrePersona: personalPorId.get(l.personalId) || l.personalId,
        periodo: periodoActivo,
        filasItems: itemsPorLiq[l.id] || [],
        numeroRecibo: l.numeroRecibo,
      })
      const r = await emitirRecibo(l.id, hash)
      if (!r.ok) { setErrorRecibo(r.error); setEmitiendoRecibo(null); return }
      doc.save(`${nombreArchivo}-${r.numeroRecibo}.pdf`)
      await cargarLiquidaciones(periodoSeleccionado)
    } catch (e) {
      setErrorRecibo(e instanceof Error ? e.message : String(e))
    }
    setEmitiendoRecibo(null)
  }

  // Cerrar deja el período en solo lectura: `calcularPeriodo` ya se bloquea
  // con estado === 'cerrado' (mismo criterio que el cierre de Reportes, que
  // además valida escalas vencidas antes de cerrar).
  const handleCerrarPeriodo = async () => {
    if (!periodoActivo) return
    setErrorCierre('')
    setCerrando(true)
    const { error: err } = await supabase.from('nom_periodos').update({ estado: 'cerrado' }).eq('id', periodoActivo.id)
    setCerrando(false)
    if (err) { setErrorCierre(err.message); return }
    setPeriodos((prev) => prev.map((p) => (p.id === periodoActivo.id ? { ...p, estado: 'cerrado' } : p)))
  }

  const handlePeriodoBorrado = (id) => {
    setConfirmarBorrado(false)
    setPeriodos((prev) => prev.filter((p) => p.id !== id))
    setPeriodoSeleccionado('')
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
    // Columnas numéricas marcadas con tipo:'numero' para que exportarCsv las
    // formatee con coma decimal es-AR (antes salían con punto, Excel es-AR
    // las leía como separador de miles y el número quedaba corrompido — ver
    // src/utils/exportCsv.js). Tardanzas/Faltas inj./Faltas just. ya se ven
    // en la grilla pero antes no estaban en el CSV.
    exportarCsv(`liquidacion-${periodoActivo?.tipo}-${periodoActivo?.fecha_desde}.csv`, [
      { titulo: 'Legajo', valor: (l) => l.personalId.slice(0, 8) },
      { titulo: 'Nombre', valor: (l) => personalPorId.get(l.personalId) || l.personalId },
      { titulo: 'Horas', valor: (l) => l.detalleHoras?.horasTrabajadas ?? 0, tipo: 'numero' },
      { titulo: 'HE 50%', valor: (l) => l.detalleHoras?.horasExtra50 ?? 0, tipo: 'numero' },
      { titulo: 'HE 100%', valor: (l) => l.detalleHoras?.horasExtra100 ?? 0, tipo: 'numero' },
      { titulo: 'Tardanzas', valor: (l) => l.detalleHoras?.tardanzas ?? 0, tipo: 'numero' },
      { titulo: 'Faltas inj.', valor: (l) => l.detalleHoras?.faltasInjustificadas ?? 0, tipo: 'numero' },
      { titulo: 'Faltas just.', valor: (l) => l.detalleHoras?.faltasJustificadas ?? 0, tipo: 'numero' },
      { titulo: 'Bruto', valor: (l) => l.bruto, tipo: 'numero' },
      { titulo: 'Aportes', valor: (l) => l.totalAportes, tipo: 'numero' },
      { titulo: 'Contribuciones', valor: (l) => l.totalContribuciones, tipo: 'numero' },
      { titulo: 'Neto', valor: (l) => l.neto, tipo: 'numero' },
    ], liquidacionesFiltradas)
  }

  // Deshabilita el checkbox de selección en anuladas (no tiene sentido
  // re-emitirles recibo) o en las que ya sabemos que no tienen items
  // (itemsPorLiq solo se carga al expandir la fila — si todavía no se
  // expandió, se asume seleccionable y recién se descubre "sin items" si
  // falla al generar el PDF, reportado igual en el panel de errores).
  const puedeSeleccionarse = (l) => !l.anulado && (itemsPorLiq[l.id] === undefined || itemsPorLiq[l.id].length > 0)
  const seleccionablesFiltradas = liquidacionesFiltradas.filter(puedeSeleccionarse)

  const toggleSeleccion = (id) => {
    setSeleccionadas((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSeleccionTodos = () => {
    setSeleccionadas((s) => {
      const todosSeleccionados = seleccionablesFiltradas.length > 0 && seleccionablesFiltradas.every((l) => s.has(l.id))
      return todosSeleccionados ? new Set() : new Set(seleccionablesFiltradas.map((l) => l.id))
    })
  }

  // Trae los items de una liquidación (reusa el cache de itemsPorLiq que ya
  // llena toggleDetalle al expandir una fila, para no repetir la query si el
  // usuario ya la había abierto).
  const fetchItemsLiquidacion = async (liqId) => {
    if (itemsPorLiq[liqId]) return itemsPorLiq[liqId]
    const { data } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', liqId)
    setItemsPorLiq((prev) => ({ ...prev, [liqId]: data || [] }))
    return data || []
  }

  // Descarga en un solo ZIP los recibos de las liquidaciones seleccionadas.
  // Cada PDF pasa por emitir_recibo (queda numerado y auditable, igual que
  // el flujo de "Emitir recibo PDF" de a uno) — ver src/utils/reciboZip.js.
  const handleDescargarZip = async () => {
    setErroresZip([]); setMostrarErroresZip(false)
    const liqsElegidas = liquidacionesFiltradas.filter((l) => seleccionadas.has(l.id))
    if (liqsElegidas.length === 0) return
    setGenerandoZip(true)
    setProgresoZip({ procesados: 0, total: liqsElegidas.length })
    try {
      const { blob, fallidos } = await generarZipRecibos({
        liquidaciones: liqsElegidas,
        empresaId,
        periodo: periodoActivo,
        personalPorId,
        fetchItems: fetchItemsLiquidacion,
        emitirRecibo,
        onProgreso: (procesados, total) => setProgresoZip({ procesados, total }),
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombreArchivoZip(periodoActivo)
      a.click()
      URL.revokeObjectURL(url)
      if (fallidos.length > 0) { setErroresZip(fallidos); setMostrarErroresZip(true) }
      setSeleccionadas(new Set())
      await cargarLiquidaciones(periodoSeleccionado) // refresca los números de recibo asignados
    } catch (e) {
      setErroresZip([{ nombre: '—', error: e instanceof Error ? e.message : String(e) }])
      setMostrarErroresZip(true)
    }
    setGenerandoZip(false)
    setProgresoZip(null)
  }

  // El alta de período va convenio → tipo: la modalidad del convenio decide
  // si corresponde quincena o mes (ver src/utils/tiposPeriodo.js).
  const ES_MANUAL = new Set(TIPOS_MANUALES)
  // "Fuera de convenio (LCT)" no se ofrece acá: para ese personal está la
  // opción "Personal fuera de convenio" (ver src/utils/tiposPeriodo.js).
  const conveniosPropios = conveniosParaPeriodo(convenios, empresaId)
  const tiposParaElConvenio = tiposDisponibles(nuevoConvenioId, conveniosPropios)
  const convenioElegido = convenioDelPeriodo(nuevoConvenioId, nuevoTipo, conveniosPropios)

  // Al cambiar de convenio se reencuadra el tipo al primero válido, para que
  // nunca quede una combinación imposible seleccionada.
  const elegirConvenio = (valor) => {
    setNuevoConvenioId(valor)
    setErrorCrearPeriodo('')
    const tipos = tiposDisponibles(valor, conveniosPropios)
    setNuevoTipo(tipos.includes(nuevoTipo) ? nuevoTipo : (tipos[0] || ''))
  }

  let fechasCalculadas = null
  if (nuevoTipo && !ES_MANUAL.has(nuevoTipo)) {
    try {
      fechasCalculadas = calcularFechasPeriodo({ anio: Number(nuevoAnio), mes: Number(nuevoMes), tipo: nuevoTipo, convenio: convenioElegido })
    } catch {
      fechasCalculadas = null
    }
  }

  const handleCrearPeriodo = async () => {
    setErrorCrearPeriodo('')
    if (!empresaId) {
      setErrorCrearPeriodo('Elegí primero una empresa en Superadmin.')
      return
    }
    if (!nuevoConvenioId) { setErrorCrearPeriodo('Elegí primero un convenio.'); return }
    if (!nuevoTipo) { setErrorCrearPeriodo('Elegí el tipo de período.'); return }

    let fechaDesde, fechaHasta
    if (ES_MANUAL.has(nuevoTipo)) {
      if (!nuevoDesde || !nuevoHasta) { setErrorCrearPeriodo('Completá fecha desde y hasta.'); return }
      if (nuevoHasta < nuevoDesde) { setErrorCrearPeriodo('La fecha hasta no puede ser anterior a la fecha desde.'); return }
      fechaDesde = nuevoDesde; fechaHasta = nuevoHasta
    } else {
      try {
        const f = calcularFechasPeriodo({ anio: Number(nuevoAnio), mes: Number(nuevoMes), tipo: nuevoTipo, convenio: convenioElegido })
        fechaDesde = f.fechaDesde; fechaHasta = f.fechaHasta
      } catch (e) {
        setErrorCrearPeriodo(e instanceof Error ? e.message : String(e))
        return
      }
    }
    setCreandoPeriodo(true)
    const { data, error } = await supabase.from('nom_periodos').insert({
      empresa_id: empresaId,
      tipo: nuevoTipo,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      estado: 'abierto',
      ...(convenioElegido && { convenio_id: convenioElegido.id }),
    }).select().single()
    setCreandoPeriodo(false)
    if (error) { setErrorCrearPeriodo(error.message); return }
    setPeriodos((prev) => [data, ...prev])
    setPeriodoSeleccionado(data.id)
    setMostrarFormNuevo(false)
    setNuevoDesde('')
    setNuevoHasta('')
    setNuevoConvenioId('')
    setNuevoTipo('')
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Liquidaciones</h1>
        <p className="page-subtitle">Calcular y revisar liquidaciones por período</p>
      </div>

      {!empresaActiva && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          Elegí una empresa en Superadmin → "Entrar" para operar la liquidación.
        </div>
      )}

      {empresaActiva && (
        <div className="tabs" role="tablist" aria-label="Vistas de liquidación">
          {PESTANAS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={pestana === p}
              className={`tab${pestana === p ? ' tab-activa' : ''}`}
              onClick={() => setPestana(p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {empresaActiva && pestana === 'Liquidaciones individuales' && (
        <LiquidacionesIndividuales empresaId={empresaId} />
      )}

      {confirmarBorrado && periodoActivo && (
        <BorrarPeriodo
          periodo={periodoActivo}
          onBorrado={handlePeriodoBorrado}
          onCancelar={() => setConfirmarBorrado(false)}
        />
      )}

      {pestana === 'Períodos generales' && (
      <>
      <div className="card card-compacta" style={{ marginBottom: '1rem', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
        <button className="btn btn-ghost btn-sm" onClick={handleDescargarZip} disabled={seleccionadas.size === 0 || generandoZip}>
          {generandoZip
            ? `Generando… (${progresoZip?.procesados ?? 0} de ${progresoZip?.total ?? 0})`
            : `Descargar recibos (${seleccionadas.size})`}
        </button>

        {/* Cerrar y borrar solo aplican al período que se está mirando */}
        {periodoActivo && periodoActivo.estado !== 'cerrado' && (
          <button className="btn btn-ghost btn-sm" onClick={handleCerrarPeriodo} disabled={cerrando}>
            <Lock size={14} /> {cerrando ? 'Cerrando…' : 'Cerrar período'}
          </button>
        )}
        {periodoActivo?.estado === 'cerrado' && (
          <span className="badge badge-success"><Lock size={12} /> período cerrado</span>
        )}
        {periodoActivo && (
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmarBorrado(true)}>
            <Trash2 size={14} /> Borrar período
          </button>
        )}
        {errorCierre && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorCierre}</span>}
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
        <div className="card max-900" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 12 }}>Nuevo período</h3>

          {/* Paso 1: convenio. Es lo que define si se liquida por quincena o
              por mes, así que va primero y filtra el resto del formulario. */}
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <div className="input-group">
              <label className="input-label" htmlFor="np-convenio">Convenio</label>
              <select id="np-convenio" className="input" value={nuevoConvenioId} onChange={(e) => elegirConvenio(e.target.value)}>
                <option value="">Elegir convenio…</option>
                {conveniosPropios.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre} ({c.modalidad})</option>
                ))}
                <option value={FUERA_DE_CONVENIO}>Personal fuera de convenio</option>
              </select>
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="np-tipo">Tipo de período</label>
              <select
                id="np-tipo"
                className="input"
                value={nuevoTipo}
                onChange={(e) => { setNuevoTipo(e.target.value); setErrorCrearPeriodo('') }}
                disabled={!nuevoConvenioId}
              >
                {!nuevoConvenioId && <option value="">Elegí un convenio primero</option>}
                {tiposParaElConvenio.map((t) => <option key={t} value={t}>{etiquetaTipo(t)}</option>)}
              </select>
            </div>

            {nuevoTipo && !ES_MANUAL.has(nuevoTipo) && (
              <>
                <div className="input-group">
                  <label className="input-label" htmlFor="np-anio">Año</label>
                  <input id="np-anio" className="input" type="number" value={nuevoAnio} onChange={(e) => setNuevoAnio(e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label" htmlFor="np-mes">Mes</label>
                  <select id="np-mes" className="input" value={nuevoMes} onChange={(e) => setNuevoMes(e.target.value)}>
                    {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {nuevoTipo && ES_MANUAL.has(nuevoTipo) && (
              <>
                <div className="input-group">
                  <label className="input-label" htmlFor="np-desde">Desde</label>
                  <input id="np-desde" type="date" className="input" value={nuevoDesde} onChange={(e) => setNuevoDesde(e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label" htmlFor="np-hasta">Hasta</label>
                  <input id="np-hasta" type="date" className="input" value={nuevoHasta} onChange={(e) => setNuevoHasta(e.target.value)} />
                </div>
              </>
            )}
          </div>

          {/* Fila de acciones propia: el botón no se corre de lugar cuando
              aparecen o desaparecen campos según el tipo elegido. */}
          <div className="acciones" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={handleCrearPeriodo} disabled={creandoPeriodo || !nuevoConvenioId || !nuevoTipo}>
              {creandoPeriodo ? 'Creando…' : 'Crear período'}
            </button>
            {fechasCalculadas && (
              <span className="texto-secundario" style={{ fontSize: '0.85rem' }}>
                Del {fechasCalculadas.fechaDesde} al {fechasCalculadas.fechaHasta}
              </span>
            )}
            {errorCrearPeriodo && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorCrearPeriodo}</span>}
          </div>
        </div>
      )}

      {error && <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>}
      {errorRecibo && <div className="card" style={{ color: 'var(--danger)' }}>Error al emitir recibo: {errorRecibo}</div>}

      {erroresZip.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', background: 'var(--warning-bg, rgba(234,179,8,0.12))', border: '1px solid var(--warning, #eab308)' }}>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => setMostrarErroresZip((v) => !v)}>
            <strong>⚠ {erroresZip.length} recibo(s) no se pudieron generar en el ZIP</strong>
            <span style={{ marginLeft: 'auto' }}>{mostrarErroresZip ? '▾' : '▸'}</span>
          </div>
          {mostrarErroresZip && (
            <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
              {erroresZip.map((e, i) => <div key={i}>• {e.nombre}: {e.error}</div>)}
            </div>
          )}
        </div>
      )}

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

      {sinHoras.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', background: 'var(--warning-bg, rgba(234,179,8,0.12))', border: '1px solid var(--warning, #eab308)' }}>
          <strong>👤 Personal sin horas en el período ({sinHoras.length})</strong>
          <p className="texto-secundario" style={{ fontSize: '0.85rem', marginTop: 4 }}>
            No tienen fichajes ni ausencias aprobadas cargadas en este período — no se liquidaron. Revisar si falta cargar asistencia en Presencio o si corresponde una licencia.
          </p>
          <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
            {sinHoras.map((p) => <div key={p.personal_id}>• {p.nombre}</div>)}
          </div>
        </div>
      )}

      {liquidaciones.length > 0 && periodoActivo && (
        <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong>Período calculado:</strong>
          <span>{etiquetaPeriodo(periodoActivo)}</span>
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

      {calculando && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          Calculando liquidación… (puede tardar unos segundos con muchos empleados)
        </div>
      )}

      {!calculando && liquidaciones.length > 0 && (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos"
                    checked={seleccionablesFiltradas.length > 0 && seleccionablesFiltradas.every((l) => seleccionadas.has(l.id))}
                    ref={(el) => {
                      if (!el) return
                      const algunos = seleccionablesFiltradas.some((l) => seleccionadas.has(l.id))
                      const todos = seleccionablesFiltradas.length > 0 && seleccionablesFiltradas.every((l) => seleccionadas.has(l.id))
                      el.indeterminate = algunos && !todos
                    }}
                    onChange={toggleSeleccionTodos}
                    disabled={seleccionablesFiltradas.length === 0}
                  />
                </th>
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
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${personalPorId.get(l.personalId) || l.personalId}`}
                          checked={seleccionadas.has(l.id)}
                          disabled={!puedeSeleccionarse(l)}
                          onChange={() => toggleSeleccion(l.id)}
                        />
                      </td>
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
                        <td colSpan={14} style={{ background: 'var(--bg-subtle, rgba(255,255,255,0.03))' }}>
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
      </>
      )}
    </div>
  )
}
