import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLegajoStore } from '../store/legajoStore'
import { useAuthStore } from '../store/authStore'
import SemaforoLegajo from '../components/legajo/SemaforoLegajo'
import DocumentosLegajo from '../components/legajo/DocumentosLegajo'
import EditorDatosLegajo from '../components/legajo/EditorDatosLegajo'
import TabFamiliares from '../components/legajo/TabFamiliares'
import TabSanciones from '../components/legajo/TabSanciones'
import { generarLegajoPdf } from '../utils/legajoPdf'

const PESTANAS = ['Datos', 'Familiares', 'Documentación', 'Sanciones', 'Ausencias', 'Liquidaciones']

export default function FichaLegajoPage() {
  const { personalId } = useParams()
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un Superadmin no tiene `empresa` fija: usa la que haya elegido en
  // /superadmin ("entrar en empresa", ver authStore.js) para poder
  // filtrar nom_legajo por empresa_id igual que un usuario normal.
  const empresaActiva = empresa || empresaVista
  const { legajos, familiares, sanciones, error: errorLegajo, cargarLegajos, cargarFamiliares, cargarSanciones } = useLegajoStore()
  const [persona, setPersona] = useState(null)
  const [ausencias, setAusencias] = useState([])
  const [liquidaciones, setLiquidaciones] = useState([])
  const [cargandoPersona, setCargandoPersona] = useState(true)
  const [errorPersona, setErrorPersona] = useState('')
  const [errorAusencias, setErrorAusencias] = useState('')
  const [errorLiquidaciones, setErrorLiquidaciones] = useState('')
  const [errorExport, setErrorExport] = useState('')
  const [pestana, setPestana] = useState(PESTANAS[0])

  useEffect(() => {
    // Reset explícito: sin esto, al navegar de una ficha a otra la página
    // muestra por un instante los datos de la persona anterior mientras
    // llegan las nuevas cargas (revisión de calidad, Task 10).
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

  // No se pasan `documentos`: DocumentosLegajo carga su lista internamente y no la expone al padre (evitar refactor grande).
  const handleExportar = () => {
    setErrorExport('')
    try {
      const doc = generarLegajoPdf({ persona, legajo, familiares, sanciones, ausencias })
      const idArchivo = String(persona.dni || persona.id).replace(/[^\w.-]/g, '_')
      doc.save(`legajo-${idArchivo}.pdf`)
    } catch (e) {
      setErrorExport('No se pudo generar el PDF: ' + e.message)
    }
  }

  if (cargandoPersona) return <div className="page">Cargando…</div>
  if (errorPersona) return <div className="page"><div className="card" style={{ color: 'var(--danger)' }}>Error al cargar la persona: {errorPersona}</div></div>
  if (!persona) return <div className="page"><div className="card">No se encontró el legajo solicitado.</div></div>

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{persona.nombre}</h1>
        <p className="page-subtitle">DNI {persona.dni || '—'} · {persona.puesto || '—'}</p>
        <div style={{ marginTop: 8 }}><SemaforoLegajo legajo={legajo} /></div>
        <button onClick={handleExportar} className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>Exportar legajo (PDF)</button>
      </div>

      {errorLegajo && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error al cargar legajo/familiares/sanciones: {errorLegajo}</div>}
      {errorAusencias && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error al cargar ausencias: {errorAusencias}</div>}
      {errorExport && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{errorExport}</div>}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {PESTANAS.map((p) => (
          <button key={p} className={`btn btn-sm ${pestana === p ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPestana(p)}>
            {p === 'Sanciones' ? `Sanciones (${sanciones.length})` : p}
          </button>
        ))}
      </div>

      {pestana === 'Datos' && (
        <EditorDatosLegajo legajo={legajo} personalId={personalId} empresaId={empresaActiva?.id} />
      )}

      {pestana === 'Familiares' && (
        <TabFamiliares personalId={personalId} empresaId={empresaActiva?.id} />
      )}

      {pestana === 'Documentación' && (
        <DocumentosLegajo personalId={personalId} />
      )}

      {pestana === 'Sanciones' && (
        <TabSanciones personalId={personalId} empresaId={empresaActiva?.id} />
      )}

      {pestana === 'Ausencias' && (
        <div className="card">
          {ausencias.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin ausencias registradas.</p>}
          {ausencias.map((a) => (
            <p key={a.id}>{a.fecha_desde} a {a.fecha_hasta} — {a.tipo} ({a.estado})</p>
          ))}
        </div>
      )}

      {pestana === 'Liquidaciones' && (
        <div className="card">
          {errorLiquidaciones && <p style={{ color: 'var(--danger)' }}>Error al cargar liquidaciones: {errorLiquidaciones}</p>}
          {liquidaciones.length === 0 && !errorLiquidaciones && <p style={{ color: 'var(--text-secondary)' }}>Sin liquidaciones registradas.</p>}
          {liquidaciones.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Bruto</th>
                  <th>Neto</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {liquidaciones.map((l) => (
                  <tr key={l.id}>
                    <td>{l.nom_periodos ? `${l.nom_periodos.tipo} ${l.nom_periodos.fecha_desde} a ${l.nom_periodos.fecha_hasta}` : '—'}</td>
                    <td>{l.bruto}</td>
                    <td>{l.neto}</td>
                    <td>{l.estado}</td>
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
