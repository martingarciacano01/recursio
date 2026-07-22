// `i` es una fila de nom_liquidacion_items (concepto_nombre, codigo_recibo
// vía join, o el propio concepto de nom_conceptos con nombre/codigoRecibo).
export function etiquetaConcepto(i) {
  const codigo = i.codigo_recibo ?? i.codigoRecibo
  const nombre = i.concepto_nombre ?? i.nombre
  return codigo ? `${codigo} ${nombre}` : nombre
}
