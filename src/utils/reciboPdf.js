import { jsPDF } from 'jspdf'

export function generarReciboPdf({ empresa, persona, periodo, items, neto }) {
  const doc = new jsPDF()
  let y = 15
  const margenInferior = doc.internal.pageSize.getHeight() - 15

  // Salto de página: sin esto, recibos con muchos conceptos escriben texto
  // fuera del área visible de la hoja sin ningún aviso (mismo patrón que
  // legajoPdf.js, Fase 1 Task 12).
  const asegurarEspacio = (alto = 6) => { if (y + alto > margenInferior) { doc.addPage(); y = 15 } }
  const linea = (t) => {
    const anchoUtil = doc.internal.pageSize.getWidth() - 28
    doc.splitTextToSize(String(t), anchoUtil).forEach((l) => { asegurarEspacio(6); doc.text(l, 14, y); y += 6 })
  }
  const titulo = (t) => { asegurarEspacio(8); doc.setFontSize(13); doc.text(t, 14, y); y += 8; doc.setFontSize(10) }

  titulo(empresa.nombre)
  linea(`CUIT: ${empresa.cuit}   ${empresa.domicilio}`)
  y += 4

  titulo('Recibo de haberes')
  linea(`${persona.nombre} — CUIL ${persona.cuil} — Legajo ${persona.legajo}`)
  linea(`Categoría: ${persona.categoria}   Fecha de ingreso: ${persona.fechaIngreso}`)
  linea(`Período: ${periodo.descripcion}`)
  y += 4

  titulo('Conceptos')
  const remunerativos = items.filter((i) => i.tipo === 'remunerativo')
  const noRemunerativos = items.filter((i) => i.tipo === 'no_remunerativo')
  const descuentos = items.filter((i) => i.tipo === 'descuento')

  remunerativos.forEach((i) => linea(`${i.nombre}: $${i.monto.toLocaleString('es-AR')}`))
  noRemunerativos.forEach((i) => linea(`${i.nombre} (no remunerativo): $${i.monto.toLocaleString('es-AR')}`))
  descuentos.forEach((i) => linea(`(-) ${i.nombre}: $${i.monto.toLocaleString('es-AR')}`))
  y += 4

  titulo(`Neto a cobrar: $${neto.toLocaleString('es-AR')}`)
  y += 8
  linea('Firma del empleador: ______________________')
  y += 10
  linea('Firma del empleado (conformidad de recepción, art. 140 LCT): ______________________')

  return doc
}
