// Export CSV genérico, sin librerías (los reportes son tablas simples).
// separador ';' porque Excel en configuración regional es-AR interpreta
// coma como separador decimal, no de columnas.
const escaparCsv = (v) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Pura (sin DOM), testeable directamente.
export function armarCsv(columnas, filas) {
  const encabezado = columnas.map((c) => escaparCsv(c.titulo)).join(';')
  const cuerpo = filas.map((fila) => columnas.map((c) => escaparCsv(c.valor(fila))).join(';')).join('\n')
  return `${encabezado}\n${cuerpo}`
}

export function exportarCsv(nombreArchivo, columnas, filas) {
  const contenido = armarCsv(columnas, filas)
  const blob = new Blob([`﻿${contenido}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  a.click()
  URL.revokeObjectURL(url)
}
