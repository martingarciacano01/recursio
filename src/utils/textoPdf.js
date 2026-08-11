// src/utils/textoPdf.js
// Utilidades para dibujar texto en jsPDF sin que pise columnas vecinas:
// ajustarTexto trunca con '…' hasta que el texto entra en anchoMax, y
// textoEnPunto dibuja el ya-ajustado en una posición. Funciones puras sobre
// un doc jsPDF (o un stub) que exponga getTextWidth y text: testeables en
// aislamiento sin instanciar jsPDF (Task 3.1, plan 2026-08-11).

export function ajustarTexto(doc, texto, anchoMax) {
  const str = String(texto ?? '')
  if (doc.getTextWidth(str) <= anchoMax) return str
  // Reducción progresiva: se quita un carácter y se reemplaza el último por
  // '…'. con anchoMax muy chico (menor al ancho de '…') queda solo '…'.
  let candidato = str
  while (candidato.length > 1) {
    candidato = `${candidato.slice(0, -1)}…`
    if (doc.getTextWidth(candidato) <= anchoMax) return candidato
    candidato = candidato.slice(0, -1)
  }
  return '…'
}

export function textoEnPunto(doc, texto, x, y, anchoMax, opts) {
  const ajustado = ajustarTexto(doc, texto, anchoMax)
  return doc.text(ajustado, x, y, opts)
}