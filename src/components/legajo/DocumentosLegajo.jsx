import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

function estadoVencimiento(fechaVencimiento) {
  if (!fechaVencimiento) return { label: 'Sin vencimiento', clase: 'badge-neutral' }
  const dias = (new Date(fechaVencimiento) - new Date()) / (1000 * 60 * 60 * 24)
  if (dias < 0) return { label: 'Vencido', clase: 'badge-danger' }
  if (dias <= 30) return { label: 'Por vencer', clase: 'badge-warning' }
  return { label: 'Vigente', clase: 'badge-success' }
}

export default function DocumentosLegajo({ personalId }) {
  const [documentos, setDocumentos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    setCargando(true)
    setError('')
    supabase.from('documentos_personal').select('*').eq('personal_id', personalId).order('fecha_vencimiento')
      .then(({ data, error: err }) => {
        if (cancelado) return
        if (err) { setError(err.message); setCargando(false); return }
        setDocumentos(data || [])
        setCargando(false)
      })
    return () => { cancelado = true }
  }, [personalId])

  if (cargando) return <p style={{ color: 'var(--text-secondary)' }}>Cargando documentos…</p>
  if (error) return <p style={{ color: 'var(--danger)' }}>Error al cargar documentos: {error}</p>
  if (documentos.length === 0) return <p style={{ color: 'var(--text-secondary)' }}>Sin documentos cargados.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {documentos.map((d) => {
        const est = estadoVencimiento(d.fecha_vencimiento)
        return (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{d.nombre}</span>
            <span className={`badge ${est.clase}`}>{est.label}</span>
          </div>
        )
      })}
    </div>
  )
}
