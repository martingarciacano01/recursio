// Criterio compartido de "incompleto para liquidar". Debe ser el MISMO que
// aplica la Edge Function liquidar-periodo (index.ts, chequeo `incompleto`
// del loop principal): si divergen, el semáforo dice verde y la liquidación
// saltea a la persona igual, o al revés.
//
// - Siempre: cuil y cbu.
// - Legajo de convenio: además convenioId y categoriaId.
// - Legajo fuera de convenio: además sueldoConvenido (no tiene convenio ni
//   categoría por definición — su básico sale del monto pactado individualmente).
export function legajoIncompleto(legajo) {
  if (!legajo) return true
  if (!legajo.cuil || !legajo.cbu) return true
  if (legajo.fueraConvenio) return !legajo.sueldoConvenido
  return !legajo.convenioId || !legajo.categoriaId
}
