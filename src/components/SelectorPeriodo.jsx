import { etiquetaTipoPeriodo } from '../utils/etiquetaPeriodo'

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']

// Agrupa períodos por año → mes (según fecha_desde) para el selector de
// Liquidación. Cada chip muestra tipo + badge de estado; un click llama a
// onChange(periodo.id). Períodos cerrados quedan igual de clickeables
// (la página que lo usa decide si abre en solo lectura).
export default function SelectorPeriodo({ periodos, value, onChange }) {
  const porAnio = new Map()
  for (const p of periodos) {
    const anio = p.fecha_desde.slice(0, 4)
    const mes = Number(p.fecha_desde.slice(5, 7)) - 1
    if (!porAnio.has(anio)) porAnio.set(anio, new Map())
    const porMes = porAnio.get(anio)
    if (!porMes.has(mes)) porMes.set(mes, [])
    porMes.get(mes).push(p)
  }
  const anios = [...porAnio.keys()].sort().reverse()

  return (
    <div>
      {anios.map((anio) => (
        <div key={anio} style={{ marginBottom: 8 }}>
          <strong>{anio}</strong>
          {[...porAnio.get(anio).keys()].sort((a, b) => b - a).map((mes) => (
            <div key={mes} style={{ marginLeft: 12, marginTop: 4 }}>
              <span style={{ color: 'var(--text-secondary)' }}>{MESES[mes]}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                {porAnio.get(anio).get(mes).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`btn btn-sm ${value === p.id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => onChange(p.id)}
                  >
                    {etiquetaTipoPeriodo(p.tipo)}
                    <span className="badge badge-neutral" style={{ marginLeft: 6 }}>{p.estado}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
