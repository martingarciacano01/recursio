import { cargarJsPDF } from './cargarJsPDF.js'
import { numeroALetras } from './numeroALetras.js'
import { armarRecibo } from './reciboLayout.js'
import { dibujarTorta } from './reciboPie.js'
import { textoEnPunto } from './textoPdf.js'

const VERDE = [198, 224, 180]        // banda de sección (mismo verde del modelo)
const GRIS = [230, 230, 230]         // sub-encabezados (REMUNERATIVO, etc.)
const LEYENDA = 'Recibí conforme copia del original del presente recibo, y el importe neto en pago de mi remuneración del período indicado.'

const fmt = (n) => `$${(Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Recibo de costo laboral (modelo AR), A4 vertical, una hoja. Segrega costo
// empleador (contribuciones + derivados CCT) y sueldo del trabajador
// (remunerativo/no remunerativo/descuentos), con columnas Unidad/Base/Monto,
// composición salarial, neto en letras, detalle por organismo y torta.
// jsPDF (+ html2canvas) pesa ~380 kB y solo hace falta cuando alguien emite un
// recibo, así que se carga con import() dinámico: por eso la función es async.
export async function generarReciboPdf({ empresa, persona, periodo, items, codigoRecibo }) {
  const jsPDF = await cargarJsPDF()
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4' })
  const R = armarRecibo(items)
  const M = 10                         // margen
  const W = doc.internal.pageSize.getWidth()
  const anchoUtil = W - M * 2
  // Columnas de la tabla (x absolutas): Concepto | Unidad | Base | Monto
  const colConcepto = M + 1
  const colUnidad = M + anchoUtil * 0.52
  const colBase = M + anchoUtil * 0.68
  const colMonto = M + anchoUtil * 0.99 // alineado a derecha
  let y = 12

  const banda = (titulo, total) => {
    doc.setFillColor(...VERDE)
    doc.rect(M, y - 4, anchoUtil, 6, 'F')
    doc.setFont(undefined, 'bold'); doc.setFontSize(9)
    doc.text(titulo, colConcepto, y)
    if (total != null) doc.text(fmt(total), colMonto, y, { align: 'right' })
    doc.setFont(undefined, 'normal')
    y += 7
  }

  const subEncabezado = (t) => {
    doc.setFillColor(...GRIS)
    doc.rect(M, y - 3.5, anchoUtil, 5, 'F')
    doc.setFont(undefined, 'bold'); doc.setFontSize(7.5)
    doc.text(t, colConcepto, y)
    doc.setFont(undefined, 'normal')
    y += 5.5
  }

  const encColumnas = () => {
    doc.setFont(undefined, 'bold'); doc.setFontSize(7)
    doc.text('CONCEPTO', colConcepto, y)
    doc.text('UNIDAD', colUnidad, y)
    doc.text('BASE', colBase, y)
    doc.text('MONTO', colMonto, y, { align: 'right' })
    doc.setFont(undefined, 'normal')
    y += 4
  }

  const filaItem = (i) => {
    doc.setFontSize(7.5)
    textoEnPunto(doc, String(i.nombre || ''), colConcepto, y, colUnidad - colConcepto - 3)
    if (i.unidadTexto != null) doc.text(String(i.unidadTexto), colUnidad, y)
    if (i.baseCalculo != null) textoEnPunto(doc, fmt(i.baseCalculo), colBase, y, colMonto - colBase - 3)
    doc.text(fmt(i.monto), colMonto, y, { align: 'right' })
    y += 4.2
  }

  // ── Cabecera: empresa + datos fiscales ──────────────────────────────
  // El logo (Configuración → Empresa) va arriba a la derecha, encajado en un
  // recuadro fijo respetando su relación de aspecto. Si falla el dibujado no
  // se corta la emisión: el recibo sale igual, sin logo.
  const CAJA_ANCHO = 42
  const CAJA_ALTO = 16
  const tieneLogo = !!(empresa?.logo?.dataUrl)
  if (tieneLogo) {
    try {
      const prop = empresa.logo.alto > 0 ? empresa.logo.ancho / empresa.logo.alto : CAJA_ANCHO / CAJA_ALTO
      let ancho = CAJA_ANCHO
      let alto = ancho / prop
      if (alto > CAJA_ALTO) { alto = CAJA_ALTO; ancho = alto * prop }
      doc.addImage(empresa.logo.dataUrl, empresa.logo.formato || 'PNG', W - M - ancho, y - 4, ancho, alto)
    } catch { /* logo inválido: se sigue sin él */ }
  }

  doc.setFont(undefined, 'bold'); doc.setFontSize(12)
  // Con logo a la derecha, el nombre se trunca para no pisar la caja (Task 3.4).
  textoEnPunto(doc, String(empresa?.nombre || '—'), colConcepto, y, tieneLogo ? anchoUtil - CAJA_ANCHO - 4 : anchoUtil)
  y += 5
  doc.setFont(undefined, 'normal'); doc.setFontSize(8)
  doc.text(String(empresa?.domicilio || '—'), colConcepto, y); y += 4
  doc.text(`C.U.I.T.: ${empresa?.cuit || '—'}`, colConcepto, y); y += 6

  // Grilla de datos del empleado (dos filas, estilo modelo). Cada cell trunca
  // con '…' hasta la siguiente columna menos un margen de 2: un banco o
  // apellido largo ya no pisa la celda vecina (Task 3.2, plan 2026-08-11).
  doc.setFontSize(7.5)
  const g = (label, valor, x, anchoMax) => {
    doc.setFont(undefined, 'bold'); textoEnPunto(doc, label, x, y, anchoMax)
    doc.setFont(undefined, 'normal'); textoEnPunto(doc, String(valor ?? '—'), x, y + 3.5, anchoMax)
  }
  g('Mes/Año', `${periodo?.mes || '—'}/${periodo?.anio || '—'}`, M, 28)
  g('Apellido y Nombre', persona?.nombre || '—', M + 30, 63)
  g('Legajo', persona?.legajo || '—', M + 95, 23)
  g('Categoría', persona?.categoria || '—', M + 120, anchoUtil - 120 - 2)
  y += 9
  g('Fecha Ingreso', persona?.fechaIngreso || '—', M, 28)
  g('Antig. Reconocida', persona?.antiguedadReconocida || '—', M + 30, 43)
  g('C.U.I.L.', persona?.cuil || '—', M + 75, 43)
  g('Banco', persona?.banco || '—', M + 120, 28)
  g('Período / Pago', `${periodo?.descripcion || '—'}`, M + 150, anchoUtil - 150 - 2)
  y += 11

  // ── COSTO TOTAL EMPLEADOR ───────────────────────────────────────────
  banda('COSTO TOTAL EMPLEADOR', R.costoTotalEmpleador)
  encColumnas()
  if (R.contribuciones.length > 0) R.contribuciones.forEach(filaItem)
  if (R.cct.length > 0) {
    subEncabezado('COSTO DERIVADO DEL CCT')
    R.cct.forEach(filaItem)
  }
  if (R.subtotalContribuciones !== 0) banda('SUBTOTAL CONTRIBUCIONES EMPLEADOR', R.subtotalContribuciones)

  // ── SUELDO BRUTO ────────────────────────────────────────────────────
  banda('SUELDO BRUTO', R.sueldoBruto)
  encColumnas()
  if (R.remunerativos.length > 0) {
    subEncabezado('REMUNERATIVO')
    R.remunerativos.forEach(filaItem)
  }
  if (R.noRemunerativos.length > 0) {
    subEncabezado('NO REMUNERATIVO')
    R.noRemunerativos.forEach(filaItem)
  }
  if (R.descuentos.length > 0) {
    subEncabezado('DESCUENTOS')
    R.descuentos.forEach(filaItem)
  }

  // ── COMPOSICIÓN SALARIAL ────────────────────────────────────────────
  y += 1
  doc.setFillColor(...GRIS); doc.rect(M, y - 3.5, anchoUtil, 5, 'F')
  doc.setFont(undefined, 'bold'); doc.setFontSize(7.5)
  doc.text('COMPOSICIÓN SALARIAL »', colConcepto, y)
  textoEnPunto(doc, `Rem.: ${fmt(R.totalRemunerativo)}`, M + anchoUtil * 0.40, y, anchoUtil * 0.20)
  textoEnPunto(doc, `No rem.: ${fmt(R.totalNoRemunerativo)}`, M + anchoUtil * 0.62, y, anchoUtil * 0.19)
  textoEnPunto(doc, `Desc.: ${fmt(R.totalDescuentos)}`, M + anchoUtil * 0.83, y, anchoUtil * 0.16)
  doc.setFont(undefined, 'normal')
  y += 6

  // ── SUELDO NETO ─────────────────────────────────────────────────────
  banda('SUELDO NETO', R.sueldoNeto)
  doc.setFontSize(7.5)
  const letras = doc.splitTextToSize(`Son pesos: ${numeroALetras(R.sueldoNeto)}`, anchoUtil)
  letras.forEach((l) => { doc.text(l, colConcepto, y); y += 3.5 })
  y += 3

  // ── Detalle de la composición salarial (por organismo) ──────────────
  doc.setFont(undefined, 'bold'); doc.setFontSize(8)
  doc.text('Detalle de la composición salarial', colConcepto, y)
  doc.setFont(undefined, 'normal'); y += 4
  doc.setFontSize(7)
  doc.setFont(undefined, 'bold')
  doc.text('Organismo', colConcepto, y)
  doc.text('Empleador', M + anchoUtil * 0.22, y)
  doc.text('Trabajador', M + anchoUtil * 0.35, y)
  doc.setFont(undefined, 'normal'); y += 4
  const yDetalleInicio = y
  R.detalle.forEach((d) => {
    doc.text(d.etiqueta, colConcepto, y)
    doc.text(fmt(d.empleador), M + anchoUtil * 0.22, y)
    doc.text(fmt(d.trabajador), M + anchoUtil * 0.35, y)
    y += 4
  })

  // ── Torta (a la derecha del detalle) ────────────────────────────────
  dibujarTorta(doc, {
    cx: M + anchoUtil * 0.72, cy: yDetalleInicio + 14, radio: 15,
    porciones: R.torta, legendX: M + anchoUtil * 0.82, legendY: yDetalleInicio,
  })

  // ── Firma ───────────────────────────────────────────────────────────
  const altoPagina = doc.internal.pageSize.getHeight()
  let yFirma = Math.max(y + 8, altoPagina - 24)
  doc.setFontSize(7)
  const leyenda = doc.splitTextToSize(LEYENDA, anchoUtil)
  leyenda.forEach((l) => { doc.text(l, colConcepto, yFirma); yFirma += 3.2 })
  yFirma += 8
  doc.line(M + anchoUtil * 0.55, yFirma, M + anchoUtil, yFirma)
  doc.text('Firma del Empleado', M + anchoUtil * 0.7, yFirma + 4)
  if (codigoRecibo) doc.text(`Recibo N°: ${codigoRecibo}`, colConcepto, yFirma + 4)

  return doc
}
