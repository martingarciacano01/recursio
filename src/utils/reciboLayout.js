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
  // Task 2.1 (plan 2026-08-11): un ítem en $0 no aporta al total y ensucia el
  // recibo (ej. la resta de quincena 1 en quincena 2 deja el ítem en $0 dentro
  // de la lista — index.ts:838-850). Se descartan de las secciones; se
  // conservan los informativos (cantidad de horas sin monto).
  const conMonto = (i) => Number(i.monto) !== 0 || i.tipo === 'informativo'
  const contribuciones = lista.filter((i) => i.grupoRecibo === 'contribucion' && conMonto(i))
  const cct = lista.filter((i) => i.grupoRecibo === 'cct' && conMonto(i))
  const remunerativos = lista.filter((i) => i.grupoRecibo === 'remunerativo' && conMonto(i))
  const noRemunerativos = lista.filter((i) => i.grupoRecibo === 'no_remunerativo' && conMonto(i))
  const descuentos = lista.filter((i) => i.grupoRecibo === 'descuento' && conMonto(i))

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
