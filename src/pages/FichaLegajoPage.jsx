import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLegajoStore } from '../store/legajoStore'
import { useAuthStore } from '../store/authStore'
import SeccionColapsable from '../components/legajo/SeccionColapsable'
import SemaforoLegajo from '../components/legajo/SemaforoLegajo'
import DocumentosLegajo from '../components/legajo/DocumentosLegajo'

export default function FichaLegajoPage() {
  const { personalId } = useParams()
  const empresa = useAuthStore((s) => s.empresa)
  const { legajos, familiares, sanciones, error: errorLegajo, cargarLegajos, cargarFamiliares, cargarSanciones } = useLegajoStore()
  const [persona, setPersona] = useState(null)
  const [ausencias, setAusencias] = useState([])
  const [cargandoPersona, setCargandoPersona] = useState(true)
  const [errorPersona, setErrorPersona] = useState('')
  const [errorAusencias, setErrorAusencias] = useState('')

  useEffect(() => {
    if (!empresa?.id) return
    // Reset explícito: sin esto, al navegar de una ficha a otra la página
    // muestra por un instante los datos de la persona anterior mientras
    // llegan las nuevas cargas (revisión de calidad, Task 10).
    setPersona(null)
    setAusencias([])
    setCargandoPersona(true)
    setErrorPersona('')
    setErrorAusencias('')
    useLegajoStore.setState({ familiares: [], sanciones: [] })

    let cancelado = false
    cargarLegajos(empresa.id)
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
    return () => { cancelado = true }
  }, [personalId, empresa?.id])

  const legajo = legajos.find((l) => l.personalId === personalId) || null

  if (cargandoPersona) return <div className="page">Cargando…</div>
  if (errorPersona) return <div className="page"><div className="card" style={{ color: 'var(--danger)' }}>Error al cargar la persona: {errorPersona}</div></div>
  if (!persona) return <div className="page"><div className="card">No se encontró el legajo solicitado.</div></div>

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{persona.nombre}</h1>
        <p className="page-subtitle">DNI {persona.dni || '—'} · {persona.puesto || '—'}</p>
        <div style={{ marginTop: 8 }}><SemaforoLegajo legajo={legajo} /></div>
      </div>

      {errorLegajo && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error al cargar legajo/familiares/sanciones: {errorLegajo}</div>}
      {errorAusencias && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error al cargar ausencias: {errorAusencias}</div>}

      <SeccionColapsable titulo="Datos y estado">
        <p>CUIL: {legajo?.cuil || '—'}</p>
        <p>CBU: {legajo?.cbu || '—'}</p>
        <p>Banco: {legajo?.banco || '—'}</p>
        <p>Obra social: {legajo?.obraSocial || '—'}</p>
        <p>Jornada: {legajo?.jornada || '—'}</p>
      </SeccionColapsable>

      <SeccionColapsable titulo="Documentación">
        <DocumentosLegajo personalId={personalId} />
      </SeccionColapsable>

      <SeccionColapsable titulo="Familiares">
        {familiares.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin familiares cargados.</p>}
        {familiares.map((f) => (
          <p key={f.id}>{f.nombre} — {f.vinculo}{f.fechaNacimiento ? ` (${f.fechaNacimiento})` : ''}</p>
        ))}
      </SeccionColapsable>

      <SeccionColapsable titulo="Sanciones">
        {sanciones.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin sanciones registradas.</p>}
        {sanciones.map((s) => (
          <p key={s.id}>{s.fecha} — {s.tipo}: {s.motivo}{s.diasSuspension ? ` (${s.diasSuspension} días)` : ''}</p>
        ))}
      </SeccionColapsable>

      <SeccionColapsable titulo="Ausencias" defaultAbierta={false}>
        {ausencias.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin ausencias registradas.</p>}
        {ausencias.map((a) => (
          <p key={a.id}>{a.fecha_desde} a {a.fecha_hasta} — {a.tipo} ({a.estado})</p>
        ))}
      </SeccionColapsable>
    </div>
  )
}
