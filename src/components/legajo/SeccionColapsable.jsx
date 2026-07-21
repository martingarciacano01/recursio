import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

let contador = 0

export default function SeccionColapsable({ titulo, children, defaultAbierta = true }) {
  const [abierta, setAbierta] = useState(defaultAbierta)
  const [idContenido] = useState(() => `seccion-colapsable-${++contador}`)
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <button
        onClick={() => setAbierta((a) => !a)}
        aria-expanded={abierta}
        aria-controls={idContenido}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-primary)' }}
      >
        <h3 style={{ fontSize: '1rem' }}>{titulo}</h3>
        {abierta ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {abierta && <div id={idContenido} style={{ marginTop: '1rem' }}>{children}</div>}
    </div>
  )
}
