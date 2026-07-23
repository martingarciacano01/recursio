// src/utils/reciboLayout.js
// Transforma los ítems liquidados en la estructura de secciones/totales que
// dibuja reciboPdf.js. Función pura, sin jsPDF: testeable en aislamiento.

const ORDEN_DETALLE = ['sindical', 'seguridad_social', 'obra_social', 'inssjp', 'art', 'scvo']
const ETIQUETA_DETALLE = {
  sindical: 'Sindical',
  seguridad_social: 'Seguridad Social',
  obra_social: 'Obra Social',
  inssjp: 'INSSJP',
  art: 'ART',
  scvo: 'SCVO',
}

const suma = (arr) => arr.reduce((s, i) => s + (Number(i.monto) || 0), 0)

export function armarRecibo(items) {
  const lista = items || []
  const contribuciones = lista.filter((i) => i.grupoRecibo === 'contribucion')
  const cct = lista.filter((i) => i.grupoRecibo === 'cct')
  const remunerativos = lista.filter((i) => i.grupoRecibo === 'remunerativo')
  const noRemunerativos = lista.filter((i) => i.grupoRecibo === 'no_remunerativo')
  const descuentos = lista.filter((i) => i.grupoRecibo === 'descuento')

  const subtotalContribuciones = suma(contribuciones) + suma(cct)
  const totalRemunerativo = suma(remunerativos)
  const totalNoRemunerativo = suma(noRemunerativos)
  const sueldoBruto = totalRemunerativo + totalNoRemunerativo
  const totalDescuentos = suma(descuentos)
  const sueldoNeto = sueldoBruto - totalDescuentos
  const costoTotalEmpleador = sueldoBruto + subtotalContribuciones

  // Detalle por organismo: empleador = aporte_patronal, trabajador = descuento.
  const detalle = ORDEN_DETALLE.map((org) => {
    const delOrg = lista.filter((i) => i.detalleRecibo === org)
    const empleador = suma(delOrg.filter((i) => i.tipo === 'aporte_patronal'))
    const trabajador = suma(delOrg.filter((i) => i.tipo === 'descuento'))
    return { organismo: org, etiqueta: ETIQUETA_DETALLE[org], empleador, trabajador }
  }).filter((d) => d.empleador !== 0 || d.trabajador !== 0)

  // Torta: sueldo neto + porción total (empleador + trabajador) por organismo.
  // Empleador + trabajador + neto deben sumar el costo total empleador
  // (el descuento del trabajador también es dinero que el empleador
  // desembolsa con destino al organismo, solo que se lo retiene del bruto).
  const torta = [{ label: 'Sueldo Neto', valor: sueldoNeto }]
  for (const d of detalle) {
    const total = d.empleador + d.trabajador
    if (total > 0) torta.push({ label: d.etiqueta, valor: total })
  }

  return {
    contribuciones, cct, remunerativos, noRemunerativos, descuentos,
    subtotalContribuciones, totalRemunerativo, totalNoRemunerativo,
    sueldoBruto, totalDescuentos, sueldoNeto, costoTotalEmpleador,
    detalle, torta,
  }
}
