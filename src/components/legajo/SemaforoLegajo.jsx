import { legajoIncompleto } from '../../utils/legajoCompletitud'

export default function SemaforoLegajo({ legajo }) {
  const incompleto = legajoIncompleto(legajo)
  return (
    <span className={`badge ${incompleto ? 'badge-warning' : 'badge-success'}`}>
      {incompleto ? 'Incompleto' : 'Completo'}
    </span>
  )
}
