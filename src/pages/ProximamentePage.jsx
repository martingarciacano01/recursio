export default function ProximamentePage({ titulo }) {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{titulo}</h1>
        <p className="page-subtitle">Próximamente</p>
      </div>
      <div className="card">
        <p style={{ color: 'var(--text-secondary)' }}>
          Esta sección todavía no está implementada. Se agrega en una fase posterior del plan de ejecución.
        </p>
      </div>
    </div>
  )
}
