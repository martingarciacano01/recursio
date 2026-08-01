import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLegajoStore } from '../store/legajoStore'
import { useLiquidacionStore } from '../store/liquidacionStore'
import { useAuthStore } from '../store/authStore'
import SemaforoLegajo from '../components/legajo/SemaforoLegajo'
import DocumentosLegajo from '../components/legajo/DocumentosLegajo'
import EditorDatosLegajo from '../components/legajo/EditorDatosLegajo'
import TabFamiliares from '../components/legajo/TabFamiliares'
import TabSanciones from '../components/legajo/TabSanciones'
import TabAdicionalesLegajo from '../components/legajo/TabAdicionalesLegajo'
import TabAusencias from '../components/legajo/TabAusencias'
import ChecklistAlta from '../components/legajo/ChecklistAlta'
import AsistenteAlta from '../components/legajo/AsistenteAlta'
import { useDocumentosStore } from '../store/documentosStore'
import { pasosGuiaAlta, resumenGuia } from '../utils/guiaAlta'
import { generarLegajoPdf } from '../utils/legajoPdf'
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
import { generarYDescargarRecibo, cargarDatosEmpresa } from '../utils/emitirReciboLegajo'

const PESTANAS = ['Datos', 'Familiares', 'Documentación', 'Sanciones', 'Adicionales', 'Ausencias', 'Liquidaciones']

export default function FichaLegajoPage() {
  const { personalId } = useParams()
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un Superadmin no tiene `empresa` fija: usa la que haya elegido en
  // /superadmin ("entrar en empresa", ver authStore.js) para poder
  // filtrar nom_legajo por empresa_id igual que un usuario normal.
  const empresaActiva = empresa || empresaVista
  const { legajos, familiares, sanciones, error: errorLegajo, cargarLegajos, cargarFamiliares, cargarSanciones } = useLegajoStore()
  const { crearPeriodoFinal, emitirRecibo } = useLiquidacionStore()
  const [persona, setPersona] = useState(null)
  const [ausencias, setAusencias] = useState([])
  const [liquidaciones, setLiquidaciones] = useState([])
  const [cargandoPersona, setCargandoPersona] = useState(true)
  const [errorPersona, setErrorPersona] = useState('')
  const [errorAusencias, setErrorAusencias] = useState('')
  const [errorLiquidaciones, setErrorLiquidaciones] = useState('')
  const [errorExport, setErrorExport] = useState('')
  const [generandoFinal, setGenerandoFinal] = useState(false)
  const [errorFinal, setErrorFinal] = useState('')
  const [pestana, setPestana] = useState(PESTANAS[0])
  const [descargandoRecibo, setDescargandoRecibo] = useState(null)
  const [asistenteAbierto, setAsistenteAbierto] = useState(false)

  // La guía de alta necesita saber qué documentación exige la empresa y cuál
  // ya está cargada. Se lee del mismo store que usa la pestaña Documentación,
  // así que no agrega consultas cuando esa pestaña ya se visitó.
  const requeridos = useDocumentosStore((s) => s.requeridos)
  const documentos = useDocumentosStore((s) => s.documentos)
  const cargarRequeridos = useDocumentosStore((s) => s.cargarRequeridos)
  const cargarDocumentos = useDocumentosStore((s) => s.cargarDocumentos)

  useEffect(() => {
    // Reset explícito: sin esto, al navegar de una ficha a otra la página
    // muestra por un instante los datos de la persona anterior mientras
    // llegan las nuevas cargas (revisión de calidad, Task 10).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset intencional al cambiar de persona.
    setPersona(null)
    setAusencias([])
    setLiquidaciones([])
    setCargandoPersona(true)
    setErrorPersona('')
    setErrorAusencias('')
    setErrorLiquidaciones('')
    useLegajoStore.setState({ familiares: [], sanciones: [] })

    let cancelado = false
    // cargarLegajos necesita un empresa_id explícito para filtrar
    // nom_legajo (esa tabla no tiene excepción de superadmin en su RLS
    // todavía). El resto de las consultas (persona, ausencias, familiares,
    // sanciones, liquidaciones) NO dependen de `empresa` en el cliente: la
    // RLS del lado del servidor ya resuelve el aislamiento a partir del
    // JWT. Un Superadmin sin `empresa` fija usa `empresaVista` (elegida en
    // /superadmin) para que cargarLegajos tenga un id explícito.
    if (empresaActiva?.id) cargarLegajos(empresaActiva.id)
    cargarFamiliares(personalId)
    cargarSanciones(personalId)
    cargarDocumentos(personalId)
    if (empresaActiva?.id) cargarRequeridos(empresaActiva.id)
    supabase.from('nom_v_personal').select('*').eq('id', personalId).single().then(({ data, error }) => {
      if (cancelado) return
      if (error) setErrorPersona(error.message)
      setPersona(data)
      setCargandoPersona(false)
    })
    supabase.from('nom_v_ausencias').select('*').eq('personal_id', personalId).order('fecha_desde', { ascending: false }).then(({ data, error }) => {
      if (cancelado) return
      if (error) setErrorAusencias(error.message)
      setAusencias(data || [])
    })
    supabase.from('nom_liquidaciones').select('*, nom_periodos(tipo, fecha_desde, fecha_hasta)').eq('personal_id', personalId).order('created_at', { ascending: false }).then(({ data, error }) => {
      if (cancelado) return
      if (error) setErrorLiquidaciones(error.message)
      setLiquidaciones(data || [])
    })
    return () => { cancelado = true }
  }, [personalId, empresaActiva?.id])

  const legajo = legajos.find((l) => l.personalId === personalId) || null
  const fmtMonto = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Bug arreglado (plan 2026-07-29 §6): antes no se pasaban `documentos` (la
  // sección "2. Documentación" del PDF decía siempre "sin documentos
  // cargados" aunque la persona tuviera todo subido — `documentos` ya está
  // disponible en este componente vía useDocumentosStore, solo faltaba
  // pasarlo) ni `empresa` (el legajo nunca tuvo logo ni datos fiscales;
  // se reusa cargarDatosEmpresa, la misma función que ya resuelve esos
  // datos para el recibo, para no duplicar el fetching).
  const handleExportar = async () => {
    setErrorExport('')
    try {
      const empresaDatos = empresaActiva?.id ? await cargarDatosEmpresa(empresaActiva.id) : null
      const doc = await generarLegajoPdf({ empresa: empresaDatos, persona, legajo, familiares, sanciones, ausencias, documentos })
      const idArchivo = String(persona.dni || persona.id).replace(/[^\w.-]/g, '_')
      doc.save(`legajo-${idArchivo}.pdf`)
    } catch (e) {
      setErrorExport('No se pudo generar el PDF: ' + e.message)
    }
  }

  // Descarga el recibo de una liquidación ya calculada. Si la liquidación
  // todavía no tiene numero_recibo, se lo asigna con la RPC emitir_recibo
  // (misma semántica que la pantalla de Liquidación) y se guarda el hash.
  const handleDescargarRecibo = async (l) => {
    setErrorLiquidaciones('')
    setDescargandoRecibo(l.id)
    try {
      const { data: filasItems } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', l.id)
      const { doc, hash, nombreArchivo } = await generarYDescargarRecibo({
        empresaId: empresaActiva?.id,
        personalId,
        nombrePersona: persona.nombre,
        periodo: l.nom_periodos,
        filasItems,
        numeroRecibo: l.numero_recibo,
      })
      const r = await emitirRecibo(l.id, hash)
      if (!r.ok) { setErrorLiquidaciones(r.error); setDescargandoRecibo(null); return }
      doc.save(`${nombreArchivo}-${r.numeroRecibo}.pdf`)
    } catch (e) {
      setErrorLiquidaciones(e instanceof Error ? e.message : String(e))
    }
    setDescargandoRecibo(null)
  }

  const handleGenerarFinal = async () => {
    setErrorFinal('')
    setGenerandoFinal(true)
    const r = await crearPeriodoFinal(personalId, legajo.fechaBaja, empresaActiva?.id)
    setGenerandoFinal(false)
    if (!r.ok) { setErrorFinal(r.error); return }
    if (empresaActiva?.id) cargarLegajos(empresaActiva.id)
  }

  const pasosGuia = pasosGuiaAlta({ legajo, requeridos, documentos, familiares })
  const resumen = resumenGuia(pasosGuia)

  if (cargandoPersona) return <div className="page">Cargando…</div>
  if (errorPersona) return <div className="page"><div className="card" style={{ color: 'var(--danger)' }}>Error al cargar la persona: {errorPersona}</div></div>
  if (!persona) return <div className="page"><div className="card">No se encontró el legajo solicitado.</div></div>

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{persona.nombre}</h1>
        <p className="page-subtitle">DNI {persona.dni || '—'} · {persona.puesto || '—'}</p>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <SemaforoLegajo legajo={legajo} />
          {legajo?.fechaBaja && <span className="badge badge-danger">Inactivo (baja: {legajo.fechaBaja})</span>}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button onClick={handleExportar} className="btn btn-primary btn-sm">Exportar legajo (PDF)</button>
          {legajo?.fechaBaja && !legajo?.liquidacionFinalId && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleGenerarFinal}
              disabled={generandoFinal || !empresaActiva?.id}
            >
              {generandoFinal ? 'Generando…' : 'Generar liquidación final'}
            </button>
          )}
          {errorFinal && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorFinal}</span>}
        </div>
      </div>

      {/* Aviso de alta en curso: no abre el asistente solo — se ofrece, para
          no interrumpir a quien entró a ver otra cosa. */}
      {!resumen.completo && !legajo?.fechaBaja && (
        <div className="card card-compacta aviso-alta" style={{ marginBottom: '1rem' }}>
          <div>
            <strong style={{ fontSize: '0.92rem' }}>Alta sin terminar</strong>
            <p className="texto-secundario" style={{ fontSize: '0.85rem' }}>
              Faltan {resumen.pendientesObligatorios} dato(s) obligatorio(s): {resumen.nombresPendientes.slice(0, 3).join(', ')}
              {resumen.nombresPendientes.length > 3 ? ` y ${resumen.nombresPendientes.length - 3} más` : ''}.
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setAsistenteAbierto(true)}>
            Completar paso a paso
          </button>
        </div>
      )}

      {asistenteAbierto && (
        <AsistenteAlta
          pasos={pasosGuia}
          legajo={legajo}
          personalId={personalId}
          empresaId={empresaActiva?.id}
          onCerrar={() => setAsistenteAbierto(false)}
        />
      )}

      {errorLegajo && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error al cargar legajo/familiares/sanciones: {errorLegajo}</div>}
      {errorAusencias && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error al cargar ausencias: {errorAusencias}</div>}
      {errorExport && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{errorExport}</div>}

      <div className="tabs" role="tablist" aria-label="Secciones del legajo">
        {PESTANAS.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={pestana === p}
            className={`tab${pestana === p ? ' tab-activa' : ''}`}
            onClick={() => setPestana(p)}
          >
            {p === 'Sanciones' ? `Sanciones (${sanciones.length})` : p}
          </button>
        ))}
      </div>

      {/* En "Datos" el checklist queda al costado como control permanente:
          la documentación vence y los datos cambian, así que sirve más allá
          del alta inicial. */}
      {pestana === 'Datos' && (
        <div className="ficha-columnas">
          <div className="card">
            <EditorDatosLegajo legajo={legajo} personalId={personalId} empresaId={empresaActiva?.id} />
          </div>
          <ChecklistAlta
            pasos={pasosGuia}
            onIrA={(destino) => PESTANAS.includes(destino) && setPestana(destino)}
            onAbrirAsistente={() => setAsistenteAbierto(true)}
          />
        </div>
      )}

      {pestana === 'Familiares' && (
        <TabFamiliares personalId={personalId} empresaId={empresaActiva?.id} />
      )}

      {pestana === 'Documentación' && (
        <DocumentosLegajo personalId={personalId} empresaId={empresaActiva?.id} />
      )}

      {pestana === 'Sanciones' && (
        <TabSanciones personalId={personalId} empresaId={empresaActiva?.id} />
      )}

      {pestana === 'Adicionales' && (
        <TabAdicionalesLegajo legajo={legajo} empresaId={empresaActiva?.id} />
      )}

      {pestana === 'Ausencias' && (
        <TabAusencias ausencias={ausencias} personalId={personalId} legajo={legajo} />
      )}

      {pestana === 'Liquidaciones' && (
        <div className="card">
          {errorLiquidaciones && <p style={{ color: 'var(--danger)' }}>Error: {errorLiquidaciones}</p>}
          {liquidaciones.length === 0 && !errorLiquidaciones && <p style={{ color: 'var(--text-secondary)' }}>Sin liquidaciones registradas.</p>}
          {liquidaciones.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Período</th><th>Bruto</th><th>Aportes</th><th>Neto</th><th>Estado</th><th>Recibo</th><th></th>
                </tr>
              </thead>
              <tbody>
                {liquidaciones.map((l) => (
                  <tr key={l.id}>
                    <td>{etiquetaPeriodo(l.nom_periodos)}</td>
                    <td>${fmtMonto(l.bruto)}</td>
                    <td>${fmtMonto(l.total_aportes)}</td>
                    <td><strong>${fmtMonto(l.neto)}</strong></td>
                    <td>
                      <span className="badge badge-neutral">{l.estado}</span>
                      {l.anulado && <span className="badge badge-warning" style={{ marginLeft: 4 }}>anulado</span>}
                    </td>
                    <td>{l.numero_recibo ? `#${l.numero_recibo}${l.version > 1 ? ` v${l.version}` : ''}` : '—'}</td>
                    <td>
                      {!l.anulado && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleDescargarRecibo(l)}
                          disabled={descargandoRecibo === l.id || !empresaActiva?.id}
                        >
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
      )}
    </div>
  )
}
