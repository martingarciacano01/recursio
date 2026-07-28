import { etiquetaTipoPeriodo } from '../utils/etiquetaPeriodo'

// Select nativo agrupado por año (Fase 6b — Liquidaciones individuales):
// reemplaza los recuadros anidados año → mes → botón, que se veían mal y
// iban a acumular información sin límite con el tiempo. Un <optgroup> por
// año alcanza — los navegadores ya saben colapsar/buscar dentro de un
// <select> largo, así que no hace falta un combobox a medida.
export default function SelectorPeriodo({ periodos, value, onChange }) {
  const porAnio = new Map()
  for (const p of periodos) {
    const anio = p.fecha_desde.slice(0, 4)
    if (!porAnio.has(anio)) porAnio.set(anio, [])
    porAnio.get(anio).push(p)
  }
  const anios = [...porAnio.keys()].sort().reverse()

  return (
    <select
      className="input"
      aria-label="Período"
      style={{ maxWidth: 320 }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Elegir período…</option>
      {anios.map((anio) => (
        <optgroup key={anio} label={anio}>
          {porAnio.get(anio).map((p) => (
            <option key={p.id} value={p.id}>
              {etiquetaTipoPeriodo(p.tipo)} · {p.fecha_desde} a {p.fecha_hasta} ({p.estado})
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
