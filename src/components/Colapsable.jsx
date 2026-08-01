import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'

// Tarjeta plegable genérica. Se usa para cada concepto de Configuración
// (aportes, contribuciones, adicionales, no remunerativos): con 15 o 20
// conceptos, tenerlos todos desplegados dejaba una tabla interminable en la
// que había que scrollear para encontrar uno.
//
// `titulo` y `insignias` arman el encabezado siempre visible; `resumen` es
// una línea chica (típicamente la fórmula) que también se ve plegado, para
// poder identificar el concepto sin abrirlo.
export default function Colapsable({ titulo, insignias = null, resumen = null, defaultAbierta = false, children }) {
  const [abierta, setAbierta] = useState(defaultAbierta)
  const idContenido = useId()

  return (
    <div className={`colapsable${abierta ? ' colapsable-abierta' : ''}`}>
      <button
        type="button"
        className="colapsable-cabecera"
        onClick={() => setAbierta((a) => !a)}
        aria-expanded={abierta}
        aria-controls={idContenido}
      >
        <ChevronDown size={16} className="colapsable-flecha" aria-hidden="true" />
        <span className="colapsable-texto">
          <span className="colapsable-titulo">{titulo}</span>
          {resumen && <span className="colapsable-resumen">{resumen}</span>}
        </span>
        {insignias && <span className="colapsable-insignias">{insignias}</span>}
      </button>
      {abierta && <div id={idContenido} className="colapsable-cuerpo">{children}</div>}
    </div>
  )
}
