import { jsPDF } from 'jspdf'
import { numeroALetras } from './numeroALetras'

const LEYENDA_RECEPCION = 'Recibí el importe neto y duplicado de la presente liquidación en pago de mi remuneración correspondiente al período indicado.'

// Recibo de haberes en doble copia (A4 apaisado): dos mitades idénticas
// dentro de la misma hoja — izquierda "Firma Empleador", derecha "Firma
// Empleado" con la leyenda de recepción agregada. Incluye logo opcional,
// tabla de conceptos (Cod/Concepto/Hab. C-Desc/Hab. S-Desc/Deducciones) y
// el neto expresado en letras (numeroALetras, Fase 5C Task 41).
export function generarReciboPdf({ empresa, persona, periodo, items, neto, codigoRecibo }) {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' })
  const anchoPagina = doc.internal.pageSize.getWidth()
  const altoPagina = doc.internal.pageSize.getHeight()
  const margenExterno = 10
  const margenCentral = 6
  const anchoMitad = (anchoPagina - margenExterno * 2 - margenCentral) / 2

  const fmtMonto = (n) => `$${(Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const dibujarCopia = (offsetX, ancho, esCopiaEmpleado) => {
    let y = 12
    const xIzq = offsetX + 4
    const anchoUtil = ancho - 8

    // Encabezado: logo (opcional, nunca rompe el layout si falta) + datos
    // fiscales de la empresa (nombre, CUIT, domicilio).
    let xTexto = xIzq
    if (empresa?.logoBase64) {
      try {
        doc.addImage(empresa.logoBase64, 'PNG', xIzq, y, 18, 18)
        xTexto = xIzq + 22
      } catch {
        // Logo inválido/corrupto: se ignora y el recibo se genera sin él.
        xTexto = xIzq
      }
    }
    doc.setFontSize(11)
    doc.setFont(undefined, 'bold')
    doc.text(String(empresa?.nombre || '—'), xTexto, y + 4)
    doc.setFont(undefined, 'normal')
    doc.setFontSize(8)
    doc.text(`CUIT: ${empresa?.cuit || '—'}`, xTexto, y + 9)
    doc.text(String(empresa?.domicilio || '—'), xTexto, y + 13)
    y += 22

    doc.setFontSize(11)
    doc.setFont(undefined, 'bold')
    doc.text('RECIBO DE REMUNERACIONES', xIzq, y)
    doc.setFont(undefined, 'normal')
    doc.setFontSize(8)
    y += 5
    if (codigoRecibo) { doc.text(`Recibo N°: ${codigoRecibo}`, xIzq, y); y += 4 }
    doc.text(`Período: ${periodo?.descripcion || '—'}`, xIzq, y)
    y += 6

    // Bloque empleado.
    doc.setFontSize(8)
    doc.text(`Legajo: ${persona?.legajo || '—'}`, xIzq, y)
    doc.text(`Apellido y Nombres: ${persona?.nombre || '—'}`, xIzq + 30, y)
    y += 4
    doc.text(`CUIL: ${persona?.cuil || '—'}`, xIzq, y)
    doc.text(`Fecha Ing.: ${persona?.fechaIngreso || '—'}`, xIzq + 45, y)
    doc.text(`Categoría: ${persona?.categoria || '—'}`, xIzq + 90, y)
    y += 6

    // Tabla de conceptos (manual, mismo estilo que el resto del archivo:
    // columnas de x fijas dentro de la mitad, sin librería adicional).
    const colCod = xIzq
    const colConcepto = xIzq + 12
    const colHabCD = xIzq + anchoUtil * 0.55
    const colHabSD = xIzq + anchoUtil * 0.72
    const colDeduc = xIzq + anchoUtil * 0.89

    doc.setFont(undefined, 'bold')
    doc.text('Cod', colCod, y)
    doc.text('Concepto', colConcepto, y)
    doc.text('Hab. C/Desc.', colHabCD, y)
    doc.text('Hab. S/Desc.', colHabSD, y)
    doc.text('Deducciones', colDeduc, y)
    doc.setFont(undefined, 'normal')
    y += 2
    doc.line(xIzq, y, xIzq + anchoUtil, y)
    y += 4

    let totalHabCD = 0
    let totalHabSD = 0
    let totalDeduc = 0

    ;(items || []).forEach((i) => {
      const monto = Number(i.monto) || 0
      doc.text(String(i.codigo || i.concepto_codigo || '—'), colCod, y)
      doc.text(String(i.nombre || ''), colConcepto, y)
      if (i.tipo === 'remunerativo') {
        doc.text(fmtMonto(monto), colHabCD, y)
        totalHabCD += monto
      } else if (i.tipo === 'no_remunerativo') {
        doc.text(fmtMonto(monto), colHabSD, y)
        totalHabSD += monto
      } else if (i.tipo === 'descuento' || i.tipo === 'aporte_patronal') {
        doc.text(fmtMonto(monto), colDeduc, y)
        totalDeduc += monto
      }
      y += 4.5
    })

    y += 2
    doc.line(xIzq, y, xIzq + anchoUtil, y)
    y += 4

    // Pie: totales, neto y monto en letras.
    doc.setFont(undefined, 'bold')
    doc.text('TOTALES', colConcepto, y)
    doc.text(fmtMonto(totalHabCD), colHabCD, y)
    doc.text(fmtMonto(totalHabSD), colHabSD, y)
    doc.text(fmtMonto(totalDeduc), colDeduc, y)
    doc.setFont(undefined, 'normal')
    y += 6

    doc.setFont(undefined, 'bold')
    doc.text(`NETO A COBRAR: ${fmtMonto(neto)}`, xIzq, y)
    doc.setFont(undefined, 'normal')
    y += 5
    doc.setFontSize(7)
    const sonPesos = doc.splitTextToSize(`Son ${numeroALetras(Number(neto) || 0)}`, anchoUtil)
    sonPesos.forEach((l) => { doc.text(l, xIzq, y); y += 3.5 })
    doc.setFontSize(8)
    y += 4

    // Firmas.
    const yFirma = Math.max(y, altoPagina - 30)
    doc.line(xIzq, yFirma, xIzq + anchoUtil * 0.4, yFirma)
    doc.text(esCopiaEmpleado ? 'Firma Empleado' : 'Firma Empleador', xIzq, yFirma + 4)

    if (esCopiaEmpleado) {
      doc.setFontSize(6.5)
      const leyenda = doc.splitTextToSize(LEYENDA_RECEPCION, anchoUtil)
      let yLeyenda = yFirma + 9
      leyenda.forEach((l) => { doc.text(l, xIzq, yLeyenda); yLeyenda += 3 })
      doc.setFontSize(8)
    }
  }

  dibujarCopia(margenExterno, anchoMitad, false)
  doc.line(anchoPagina / 2, 6, anchoPagina / 2, altoPagina - 6)
  dibujarCopia(margenExterno + anchoMitad + margenCentral, anchoMitad, true)

  return doc
}
