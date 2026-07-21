import { useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { useConceptosStore } from '../store/conceptosStore'
import EditorReglas from '../components/config/EditorReglas'

export default function ConfiguracionPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un usuario Superadmin no tiene `empresa` fija: opera sobre la que haya
  // elegido en /superadmin ("entrar en empresa", ver authStore.js).
  const empresaActiva = empresa || empresaVista
  const { conceptos, cargando, error, cargarConceptos, guardarConcepto } = useConceptosStore()

  useEffect(() => {
    if (empresaActiva?.id) cargarConceptos(empresaActiva.id)
  }, [empresaActiva?.id])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Configuración</h1>
        <p className="page-subtitle">Conceptos y reglas de liquidación</p>
      </div>
      {!empresaActiva && (
        <div className="card">Elegí una empresa en Superadmin → "Entrar" para ver su configuración.</div>
      )}
      {error && <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>}
      {empresaActiva && cargando && <div className="card">Cargando…</div>}
      {!cargando && conceptos.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: '1rem' }}>
          <h3>{c.orden}. {c.nombre} <span className="badge badge-neutral">{c.tipo}</span></h3>
          <p style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.formula}</p>
          <EditorReglas
            reglas={c.reglas}
            onChange={(reglas) => guardarConcepto({ ...c, reglas }, empresaActiva.id)}
          />
        </div>
      ))}
    </div>
  )
}
