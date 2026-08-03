import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
import { agruparPorAnio } from '../utils/ordenarPeriodos'

// Select nativo agrupado por año (Fase 6b — Liquidaciones individuales):
// reemplaza los recuadros anidados año → mes → botón, que se veían mal y
// iban a acumular información sin límite con el tiempo. Un <optgroup> por
// año alcanza — los navegadores ya saben colapsar/buscar dentro de un
// <select> largo, así que no hace falta un combobox a medida.
//
// El orden dentro de cada año es mes descendente y, dentro del mes, por tipo
// (ver src/utils/ordenarPeriodos.js). La etiqueta arranca con "Mes Año · tipo"
// para poder buscar tipeando el mes, y deja las fechas exactas al final.
export default function SelectorPeriodo({ periodos, value, onChange, disabled = false }) {
  const grupos = agruparPorAnio(periodos)

  return (
    <select
      className="input"
      aria-label="Período"
      style={{ maxWidth: 380 }}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Elegir período…</option>
      {grupos.map(([anio, delAnio]) => (
        <optgroup key={anio} label={anio}>
          {delAnio.map((p) => (
            <option key={p.id} value={p.id}>
              {etiquetaPeriodo(p)} · {p.fecha_desde} a {p.fecha_hasta}{p.estado === 'cerrado' ? ' (cerrado)' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
