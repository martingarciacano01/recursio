import { useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { useConceptosStore } from '../store/conceptosStore'
import EditorReglas from '../components/config/EditorReglas'

export default function ConfiguracionPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const { conceptos, cargando, error, cargarConceptos, guardarConcepto } = useConceptosStore()

  useEffect(() => {
    if (empresa?.id) cargarConceptos(empresa.id)
  }, [empresa?.id])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Configuración</h1>
        <p className="page-subtitle">Conceptos y reglas de liquidación</p>
      </div>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>}
      {cargando && <div className="card">Cargando…</div>}
      {!cargando && conceptos.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: '1rem' }}>
          <h3>{c.orden}. {c.nombre} <span className="badge badge-neutral">{c.tipo}</span></h3>
          <p style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.formula}</p>
          <EditorReglas
            reglas={c.reglas}
            onChange={(reglas) => guardarConcepto({ ...c, reglas }, empresa.id)}
          />
        </div>
      ))}
    </div>
  )
}
