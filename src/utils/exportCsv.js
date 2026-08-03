// Export CSV genérico, sin librerías (los reportes son tablas simples).
// separador ';' porque Excel en configuración regional es-AR interpreta
// coma como separador decimal, no de columnas.
const escaparCsv = (v) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Formatea un número para CSV en configuración regional es-AR: coma como
// separador decimal, SIN separador de miles (si lo tuviera, un punto de
// miles rompería el parseo de Excel al abrir el archivo — el mismo bug que
// se arregla acá, pero al revés). Bug original: los números se escribían
// con String(v), o sea con punto decimal ("352594.48"); Excel es-AR
// interpreta ese punto como separador de miles, no de decimales, y el
// número deja de ser válido.
const formatearNumero = (v) => {
  const n = Number(v ?? 0)
  if (Number.isNaN(n)) return escaparCsv(v)
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
}

// Pura (sin DOM), testeable directamente. `columnas` es
// `{ titulo, valor, tipo? }`: tipo 'numero' formatea con coma decimal
// es-AR; cualquier otro valor (o ausente) se trata como texto plano, igual
// que antes.
export function armarCsv(columnas, filas) {
  const encabezado = columnas.map((c) => escaparCsv(c.titulo)).join(';')
  const cuerpo = filas.map((fila) => columnas.map((c) => {
    const v = c.valor(fila)
    return c.tipo === 'numero' ? formatearNumero(v) : escaparCsv(v)
  }).join(';')).join('\n')
  return `${encabezado}\n${cuerpo}`
}

export function exportarCsv(nombreArchivo, columnas, filas) {
  const contenido = armarCsv(columnas, filas)
  // eslint-disable-next-line no-irregular-whitespace -- BOM intencional para que Excel detecte UTF-8.
  const blob = new Blob([`﻿${contenido}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  // revokeObjectURL diferido (Task 3.4, M5): ver mismo comentario en
  // LiquidacionPage.jsx (handleDescargarZip) — revocar en el mismo tick
  // corre el riesgo de invalidar la URL antes de que el navegador dispare
  // la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
