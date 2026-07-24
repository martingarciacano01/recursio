import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { agruparAusencias } from '../../utils/agruparAusencias'

// Pestaña de solo lectura: nom_v_ausencias es una vista de Presencio, no
// editable desde acá. Separa justificadas (estado === 'aprobada') de
// injustificadas (cualquier otro estado) para el año seleccionado, con el
// total de días de cada grupo (Task 48, Fase 5D).
export default function TabAusencias({ personalId }) {
  const [ausencias, setAusencias] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [anio, setAnio] = useState(new Date().getFullYear())

  useEffect(() => {
    let cancelado = false
    setCargando(true)
    setError('')
    supabase.from('nom_v_ausencias').select('*').eq('personal_id', personalId).order('fecha_desde', { ascending: false }).then(({ data, error }) => {
      if (cancelado) return
      if (error) setError(error.message)
      setAusencias(data || [])
      setCargando(false)
    })
    return () => { cancelado = true }
  }, [personalId])

  const { justificadas, injustificadas, totalDiasJustificadas, totalDiasInjustificadas } = useMemo(
    () => agruparAusencias(ausencias, anio),
    [ausencias, anio]
  )

  const anios = useMemo(() => {
    const set = new Set(ausencias.map((a) => Number(a.fecha_desde.slice(0, 4))))
    set.add(new Date().getFullYear())
    return Array.from(set).sort((a, b) => b - a)
  }, [ausencias])

  if (cargando) return <div className="card">Cargando…</div>

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && <div style={{ color: 'var(--danger)' }}>Error al cargar ausencias: {error}</div>}

      <div>
        <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Año</label>
        <select className="input" value={anio} onChange={(e) => setAnio(Number(e.target.value))} style={{ maxWidth: 160 }}>
          {anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div>
        <h3 style={{ marginBottom: 8 }}>Justificadas ({totalDiasJustificadas} días)</h3>
        {justificadas.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin ausencias justificadas en {anio}.</p>}
        {justificadas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {justificadas.map((a) => (
              <p key={a.id} style={{ margin: 0 }}>{a.fecha_desde} a {a.fecha_hasta} — {a.tipo} ({a.estado})</p>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 style={{ marginBottom: 8 }}>Injustificadas ({totalDiasInjustificadas} días)</h3>
        {injustificadas.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin ausencias injustificadas en {anio}.</p>}
        {injustificadas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {injustificadas.map((a) => (
              <p key={a.id} style={{ margin: 0 }}>{a.fecha_desde} a {a.fecha_hasta} — {a.tipo} ({a.estado})</p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
