// Kit de estilo compartido para los PDF de Recursio (recibo + legajo), plan
// 2026-07-29 §6. Antes este estilo (bandas verdes de sección, sub-
// encabezados grises, grilla de datos en dos filas, caja de logo con
// relación de aspecto respetada) vivía encerrado como funciones locales
// dentro de reciboPdf.js: no se podía reusar sin copiarlo, y copiarlo
// garantizaba que recibo y legajo se fueran a ver distintos en poco tiempo.
//
// NOTA: reciboPdf.js NO se tocó en este cambio (deliberado): ya tiene tests
// que verifican el texto exacto dibujado en el stream del PDF
// (reciboPdf.test.js, reciboLayout.test.js) y este entorno no pudo correr
// vitest para confirmar un refactor sin regresión visual antes de tocarlo.
// Este módulo es la MISMA lógica (mismos colores, mismas fórmulas de
// posición) extraída de forma independiente para que legajoPdf.js la use
// desde ya; migrar reciboPdf.js para consumir este mismo kit queda como
// siguiente paso, a hacer con los tests corriendo en verde en cada paso.
export const VERDE = [198, 224, 180]  // banda de sección
export const GRIS = [230, 230, 230]   // sub-encabezados

// `doc` ya creado (jsPDF). Devuelve helpers que manejan la coordenada `y`
// internamente (estado mutable compartido — no un closure de solo lectura),
// para que cada llamada avance la posición sin que el caller tenga que
// pasarla de ida y vuelta.
export function crearLienzo(doc, { M = 14, yInicial = 15 } = {}) {
  const W = doc.internal.pageSize.getWidth()
  const anchoUtil = W - M * 2
  const colIzq = M
  const colDer = M + anchoUtil
  const estado = { y: yInicial }
  const margenInferior = doc.internal.pageSize.getHeight() - 15

  function asegurarEspacio(alturaNecesaria = 6) {
    if (estado.y + alturaNecesaria > margenInferior) { doc.addPage(); estado.y = yInicial }
  }

  // Banda verde de sección (título + total opcional a la derecha).
  function banda(titulo, totalTexto) {
    asegurarEspacio(8)
    doc.setFillColor(...VERDE)
    doc.rect(M, estado.y - 4, anchoUtil, 6, 'F')
    doc.setFont(undefined, 'bold'); doc.setFontSize(9)
    doc.text(titulo, colIzq + 1, estado.y)
    if (totalTexto != null) doc.text(String(totalTexto), colDer - 1, estado.y, { align: 'right' })
    doc.setFont(undefined, 'normal')
    estado.y += 7
  }

  // Sub-encabezado gris (secciones menores dentro de una banda).
  function subEncabezado(t) {
    asegurarEspacio(6)
    doc.setFillColor(...GRIS)
    doc.rect(M, estado.y - 3.5, anchoUtil, 5, 'F')
    doc.setFont(undefined, 'bold'); doc.setFontSize(7.5)
    doc.text(t, colIzq + 1, estado.y)
    doc.setFont(undefined, 'normal')
    estado.y += 5.5
  }

  // Grilla de datos en dos filas al estilo del recibo: pares = [label, valor, x].
  // Avanza `y` una sola vez al final de la fila (llamar dos veces para dos filas).
  function grilla(pares) {
    asegurarEspacio(9)
    doc.setFontSize(7.5)
    for (const [label, valor, x] of pares) {
      doc.setFont(undefined, 'bold'); doc.text(label, x, estado.y)
      doc.setFont(undefined, 'normal'); doc.text(String(valor ?? '—'), x, estado.y + 3.5)
    }
    estado.y += 9
  }

  // Fila de una tabla simple: columnas = [{ texto, x, align, color }].
  function fila(columnas, { fontSize = 8, alturaFila = 6 } = {}) {
    asegurarEspacio(alturaFila)
    doc.setFontSize(fontSize)
    for (const c of columnas) {
      if (c.color) doc.setTextColor(...c.color)
      doc.text(String(c.texto ?? '—'), c.x, estado.y, c.align ? { align: c.align } : undefined)
      if (c.color) doc.setTextColor(0, 0, 0)
    }
    estado.y += alturaFila
  }

  // Pie de página: fecha de emisión + nombre de la persona a la izquierda,
  // "Página N de M" a la derecha. `total` se conoce recién al terminar de
  // generar TODO el documento (jsPDF necesita una segunda pasada) — el
  // caller itera con doc.setPage(i) y llama esto para cada una.
  function pie(numeroPagina, totalPaginas, textoIzquierda) {
    const alto = doc.internal.pageSize.getHeight()
    doc.setFontSize(7); doc.setFont(undefined, 'normal')
    if (textoIzquierda) doc.text(textoIzquierda, M, alto - 8)
    doc.text(`Página ${numeroPagina} de ${totalPaginas}`, colDer, alto - 8, { align: 'right' })
  }

  return {
    banda, subEncabezado, grilla, fila, asegurarEspacio, pie,
    get y() { return estado.y }, set y(v) { estado.y = v },
    M, anchoUtil, colIzq, colDer,
  }
}

// Cabecera de empresa (logo + nombre/domicilio/CUIT) reutilizable — mismo
// criterio que reciboPdf.js: el logo puede fallar (try/catch) y el
// documento sigue sin él, nunca se corta la generación por eso.
export function cabeceraEmpresa(doc, empresa, lienzo) {
  const W = doc.internal.pageSize.getWidth()
  if (empresa?.logo?.dataUrl) {
    try {
      const CAJA_ANCHO = 42
      const CAJA_ALTO = 16
      const prop = empresa.logo.alto > 0 ? empresa.logo.ancho / empresa.logo.alto : CAJA_ANCHO / CAJA_ALTO
      let ancho = CAJA_ANCHO
      let alto = ancho / prop
      if (alto > CAJA_ALTO) { alto = CAJA_ALTO; ancho = alto * prop }
      doc.addImage(empresa.logo.dataUrl, empresa.logo.formato || 'PNG', W - lienzo.M - ancho, lienzo.y - 4, ancho, alto)
    } catch { /* logo inválido: se sigue sin él */ }
  }
  doc.setFont(undefined, 'bold'); doc.setFontSize(12)
  doc.text(String(empresa?.nombre || '—'), lienzo.colIzq, lienzo.y); lienzo.y += 5
  doc.setFont(undefined, 'normal'); doc.setFontSize(8)
  doc.text(String(empresa?.domicilio || '—'), lienzo.colIzq, lienzo.y); lienzo.y += 4
  doc.text(`C.U.I.T.: ${empresa?.cuit || '—'}`, lienzo.colIzq, lienzo.y); lienzo.y += 6
}
