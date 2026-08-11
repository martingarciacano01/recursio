import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useLiquidacionStore } from '../store/liquidacionStore'
import { ausenciasVacacionesElegibles } from '../utils/vacacionesElegibles'
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
import { generarYDescargarRecibo } from '../utils/emitirReciboLegajo'
import { filtrarConveniosVisibles, categoriasVigentes } from '../utils/convenios'

const fmtMonto = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Pestaña "Liquidaciones individuales" de LiquidacionPage (Fase 6b): vacaciones
// y liquidación final son por persona, no períodos masivos — antes se creaban
// con el mismo formulario "Nuevo período" que las quincenas/mensuales, lo que
// para vacaciones era directamente un bug (liquidaba a TODA la nómina activa
// sin personalIds). Acá se buscan/eligen de a una persona por vez.
export default function LiquidacionesIndividuales({ empresaId }) {
  const { crearPeriodoFinal, crearPeriodoVacaciones, emitirRecibo } = useLiquidacionStore()

  const [busqueda, setBusqueda] = useState('')
  const [incluirBajas, setIncluirBajas] = useState(false)
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

  // Item 3 (sesión 2026-08-08): dar de baja + liquidación final en un mismo
  // lugar. Antes, si la persona no tenía fecha de baja, acá no aparecía NADA
  // salvo el mensaje "Sin ausencias…" y había que ir a la ficha → Datos →
  // Editar → Dar de baja para después volver a liquidar el final.
  const [dandoBaja, setDandoBaja] = useState(false)
  const [fechaBaja, setFechaBaja] = useState('')
  const [motivoBaja, setMotivoBaja] = useState('')
  const [guardandoBaja, setGuardandoBaja] = useState(false)
  const [errorBaja, setErrorBaja] = useState('')
  const handleConfirmarBaja = async () => {
    setErrorBaja('')
    setGuardandoBaja(true)
    const { error } = await supabase.from('nom_legajo').update({
      fecha_baja: fechaBaja || null,
      motivo_baja: motivoBaja || null,
    }).eq('id', legajo.id)
    setGuardandoBaja(false)
    if (error) { setErrorBaja(error.message); return }
    setLegajo((l) => ({ ...l, fecha_baja: fechaBaja, motivo_baja: motivoBaja }))
    setDandoBaja(false)
  }

  // Item 8 (plan convenios-por-obra 2026-08-07): conmutar el convenio del
  // legajo desde esta vista, antes de generar vacaciones/final. Los convenios
  // disponibles son los visibles para la empresa (globales + propios + los
  // clonados por obra de Presencio), igual que en Configuración → Convenios;
  // la categoría se vuelve a elegir porque depende del convenio.
  const [convenios, setConvenios] = useState([])
  const [obrasMap, setObrasMap] = useState({})
  const [editandoConvenio, setEditandoConvenio] = useState(false)
  const [convenioSel, setConvenioSel] = useState('')
  const [categoriaSel, setCategoriaSel] = useState('')
  const [categoriasSel, setCategoriasSel] = useState([])
  const [cargandoCategorias, setCargandoCategorias] = useState(false)
  const [guardandoConvenio, setGuardandoConvenio] = useState(false)
  const [errorConvenio, setErrorConvenio] = useState('')

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset intencional al no haber empresa activa.
    if (!empresaId) { setPersonas([]); return }
    // Item 9 (plan convenios-por-obra 2026-08-07): el buscador por defecto
    // muestra solo personal ACTICO (los períodos individuales — vacaciones,
    // final — son para personas que trabajan). El checkbox "incluir personal
    // con baja" agrega los que ya no están activos, necesarios para la
    // liquidación final de una persona dada de baja.
    const query = incluirBajas
      ? supabase.from('nom_v_personal')
          .select('id, nombre, obra_id').eq('empresa_id', empresaId).order('nombre')
      : supabase.from('nom_v_personal').select('id, nombre, obra_id')
          .eq('empresa_id', empresaId).eq('estado', 'activo').order('nombre')
    query
      .then(({ data }) => { if (seqEmpresaRef.current === seq) setPersonas(data || []) })
  }, [empresaId, incluirBajas])

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

  // eslint-disable-next-line react-hooks/set-state-in-effect -- kickoff del historial; resetea el estado si no hay empresa activa.
  useEffect(cargarHistorial, [empresaId])

  useEffect(() => {
    const seq = ++seqPersonaRef.current
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset intencional al cambiar de persona, antes de disparar las cargas.
    setLegajo(null); setAusencias([]); setVacacionesLiquidadas([])
    setAusenciaElegida(''); setManual(false); setFechaDesde(''); setFechaHasta('')
    setErrorVac(''); setErrorFinal('')
    setEditandoConvenio(false); setErrorConvenio('')
    setDandoBaja(false); setFechaBaja(''); setMotivoBaja(''); setErrorBaja('')
    if (!personaId || !empresaId) return
    supabase.from('nom_legajo').select('*').eq('personal_id', personaId).eq('empresa_id', empresaId).maybeSingle()
      .then(({ data }) => { if (seqPersonaRef.current === seq) setLegajo(data) })
    supabase.from('nom_v_ausencias').select('*').eq('personal_id', personaId)
      .then(({ data }) => { if (seqPersonaRef.current === seq) setAusencias(data || []) })
    supabase.from('nom_vacaciones_liquidadas').select('ausencia_id').eq('personal_id', personaId).eq('empresa_id', empresaId)
      .then(({ data }) => { if (seqPersonaRef.current === seq) setVacacionesLiquidadas((data || []).map((v) => v.ausencia_id).filter(Boolean)) })
  }, [personaId, empresaId])

  // Item 8: convenios visibles para la empresa + obras (para etiquetar los de
  // obra en el <select> y mostrar la obra a la que pertenece la persona).
  useEffect(() => {
    if (!empresaId) return
    let cancelado = false
    Promise.all([
      supabase.from('nom_convenios').select('id, nombre, empresa_id, obra_id').order('nombre'),
      supabase.from('nom_v_obras').select('id, nombre').eq('empresa_id', empresaId).order('nombre'),
    ]).then(([{ data: conveniosData }, { data: obrasData }]) => {
      if (cancelado) return
      setConvenios(filtrarConveniosVisibles(conveniosData || []))
      setObrasMap(Object.fromEntries((obrasData || []).map((o) => [o.id, o.nombre])))
    })
    return () => { cancelado = true }
  }, [empresaId])

  // Categorías del convenio elegido al conmutar (ígual que en EditorDatosLegajo).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset/kickoff intencional al cambiar de convenio.
    if (!editandoConvenio || !convenioSel) { setCategoriasSel([]); setCategoriaSel(''); setCargandoCategorias(false); return }
    let cancelado = false
    setCargandoCategorias(true)
    supabase.from('nom_categorias').select('id, nombre, vigencia_desde').eq('convenio_id', convenioSel).order('nombre')
      .then(({ data }) => {
        if (cancelado) return
        setCategoriasSel(categoriasVigentes(data || []))
        setCargandoCategorias(false)
      })
    return () => { cancelado = true }
  }, [editandoConvenio, convenioSel])

  const personasFiltradas = personas.filter((p) => p.nombre.toLowerCase().includes(busqueda.toLowerCase()))
  const elegibles = ausenciasVacacionesElegibles(ausencias, vacacionesLiquidadas)
  const puedeFinal = legajo?.fecha_baja && !legajo?.liquidacion_final_id

  // Item 8: resolver el nombre de obra del convenio (etiqueta en el select) y
  // la obra a la que pertenece la persona (para avisar si existe convenio por
  // obra). `personas` trae `obra_id` de nom_v_personal.
  const personaObraId = personas.find((p) => p.id === personaId)?.obra_id || null
  const nombreObra = (obraId) => (obraId && obrasMap[obraId]) || null
  const nombreConvenio = (convenioId) => {
    const c = convenios.find((x) => x.id === convenioId)
    return c ? (c.obra_id ? `${c.nombre} (obra: ${nombreObra(c.obra_id) || c.obra_id})` : c.nombre) : null
  }
  const habilitado = personaId && !!legajo && !legajo.fuera_convenio

  const guardarConvenio = async () => {
    setErrorConvenio('')
    setGuardandoConvenio(true)
    const { error } = await supabase.from('nom_legajo').update({
      convenio_id: convenioSel || null,
      categoria_id: categoriaSel || null,
    }).eq('id', legajo.id)
    setGuardandoConvenio(false)
    if (error) { setErrorConvenio(error.message); return }
    setLegajo((l) => ({ ...l, convenio_id: convenioSel || null, categoria_id: categoriaSel || null }))
    setEditandoConvenio(false)
  }

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
          <label htmlFor="li-incluir-bajas" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', marginTop: 8 }}>
            <input id="li-incluir-bajas" type="checkbox" checked={incluirBajas}
              onChange={(e) => { setIncluirBajas(e.target.checked); setPersonaId('') }} />
            Incluir personal con baja
          </label>
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
            {habilitado && (
              <div>
                <strong style={{ fontSize: '0.9rem' }}>Convenio del legajo</strong>
                {!editandoConvenio ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: '0.85rem', color: legajo?.convenio_id ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {legajo?.convenio_id ? nombreConvenio(legajo.convenio_id) : 'Sin convenio (fuera de convenio)'}
                    </span>
                    {personaObraId && (
                      <span className="badge badge-neutral">{nombreObra(personaObraId) || 'obra sin nombre'}</span>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => { setConvenioSel(legajo?.convenio_id || ''); setCategoriaSel(legajo?.categoria_id || ''); setEditandoConvenio(true) }}>
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    <div>
                      <label htmlFor="li-convenio" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Convenio</label>
                      <select id="li-convenio" className="input" style={{ maxWidth: 360 }} value={convenioSel}
                        onChange={(e) => { setConvenioSel(e.target.value); setCategoriaSel('') }}>
                        <option value="">Sin convenio (fuera de convenio)</option>
                        {convenios.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.obra_id ? `${c.nombre} (obra: ${nombreObra(c.obra_id) || c.obra_id})` : c.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    {convenioSel && (
                      <div>
                        <label htmlFor="li-categoria" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Categoría</label>
                        <select id="li-categoria" className="input" style={{ maxWidth: 360 }} value={categoriaSel}
                          onChange={(e) => setCategoriaSel(e.target.value)} disabled={cargandoCategorias}>
                          <option value="">Elegir categoría…</option>
                          {categoriasSel.map((ct) => <option key={ct.id} value={ct.id}>{ct.nombre}</option>)}
                        </select>
                      </div>
                    )}
                    {errorConvenio && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorConvenio}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary btn-sm" onClick={guardarConvenio} disabled={guardandoConvenio || (convenioSel && !categoriaSel && !cargandoCategorias)}>
                        {guardandoConvenio ? 'Guardando…' : 'Guardar'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditandoConvenio(false)} disabled={guardandoConvenio}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            )}
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

            {!legajo?.fecha_baja ? (
              <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 12 }}>
                <strong style={{ fontSize: '0.9rem' }}>Podés dar de baja al personal y hacer la liquidación final</strong>
                {!dandoBaja ? (
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setDandoBaja(true)}>
                    Dar de baja
                  </button>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    <div>
                      <label htmlFor="li-fecha-baja" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha de baja</label>
                      <input id="li-fecha-baja" aria-label="Fecha de baja" className="input" type="date" value={fechaBaja} onChange={(e) => setFechaBaja(e.target.value)} />
                    </div>
                    <div>
                      <label htmlFor="li-motivo-baja" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Motivo de baja</label>
                      <select id="li-motivo-baja" aria-label="Motivo de baja" className="input" value={motivoBaja} onChange={(e) => setMotivoBaja(e.target.value)}>
                        <option value="">Elegir motivo…</option>
                        <option value="renuncia">Renuncia</option>
                        <option value="despido_sin_causa">Despido sin causa</option>
                        <option value="despido_con_causa">Despido con causa</option>
                        <option value="fin_obra">Fin de obra</option>
                        <option value="mutuo_acuerdo">Mutuo acuerdo</option>
                        <option value="fallecimiento">Fallecimiento</option>
                      </select>
                    </div>
                    {errorBaja && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorBaja}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-danger btn-sm" onClick={handleConfirmarBaja} disabled={guardandoBaja || !fechaBaja || !motivoBaja}>
                        {guardandoBaja ? 'Guardando…' : 'Confirmar baja'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDandoBaja(false)} disabled={guardandoBaja}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ borderTop: '0.5px solid var(--border)', paddingTop: 12 }}>
                <strong style={{ fontSize: '0.9rem' }}>Dado de baja {legajo.fecha_baja} ({legajo.motivo_baja || 'sin motivo'})</strong>
              </div>
            )}

            {puedeFinal && (
              <div>
                <strong style={{ fontSize: '0.9rem' }}>Liquidación final</strong>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '4px 0 8px' }}>
                  Liquidar la quincena y sacar la cuenta que corresponde por la baja: {legajo.fecha_baja} ({legajo.motivo_baja}).
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
          /* Task 6.10 (plan 2026-08-11): historial sin scroll horizontal, se aplastaba en mobile. */
          <div className="table-scroll">
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
          </div>
        )}
      </div>
    </div>
  )
}
