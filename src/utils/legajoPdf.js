import { jsPDF } from 'jspdf'

export function generarLegajoPdf({ persona, legajo, familiares = [], sanciones = [], ausencias = [], documentos = [] }) {
  const doc = new jsPDF()
  let y = 15
  const margenInferior = doc.internal.pageSize.getHeight() - 15

  // Salto de página: sin esto, legajos con muchas ausencias/sanciones/
  // familiares escriben texto fuera del área visible de la hoja sin
  // ningún aviso (revisión de calidad, Task 12).
  const asegurarEspacio = (alturaNecesaria = 6) => {
    if (y + alturaNecesaria > margenInferior) { doc.addPage(); y = 15 }
  }

  const titulo = (t) => { asegurarEspacio(8); doc.setFontSize(14); doc.text(t, 14, y); y += 8; doc.setFontSize(10) }
  // splitTextToSize hace wrap del texto largo al ancho de la página en vez
  // de cortarlo en el margen derecho.
  const linea = (t) => {
    const anchoUtil = doc.internal.pageSize.getWidth() - 28
    const lineas = doc.splitTextToSize(String(t), anchoUtil)
    lineas.forEach((l) => {
      asegurarEspacio(6)
      doc.text(l, 14, y)
      y += 6
    })
  }
  const salto = () => { y += 4 }

  titulo(`Legajo — ${persona.nombre}`)
  linea(`DNI: ${persona.dni || '—'}   Puesto: ${persona.puesto || '—'}`)
  salto()

  titulo('1. Datos y estado')
  linea(`CUIL: ${legajo?.cuil || '—'}`)
  linea(`CBU: ${legajo?.cbu || '—'}   Banco: ${legajo?.banco || '—'}`)
  linea(`Obra social: ${legajo?.obraSocial || '—'}   Jornada: ${legajo?.jornada || '—'}`)
  salto()

  titulo('2. Documentación')
  if (documentos.length === 0) linea('Sin documentos cargados.')
  documentos.forEach((d) => linea(`${d.nombre} — vence ${d.fecha_vencimiento || 'sin vencimiento'}`))
  salto()

  titulo('3. Licencias y vacaciones')
  if (ausencias.length === 0) linea('Sin ausencias registradas.')
  ausencias.forEach((a) => linea(`${a.fecha_desde} a ${a.fecha_hasta} — ${a.tipo} (${a.estado})`))
  salto()

  titulo('4. Sanciones')
  if (sanciones.length === 0) linea('Sin sanciones registradas.')
  sanciones.forEach((s) => linea(`${s.fecha} — ${s.tipo}: ${s.motivo}`))
  salto()

  titulo('5. Familiares')
  if (familiares.length === 0) linea('Sin familiares cargados.')
  familiares.forEach((f) => linea(`${f.nombre} — ${f.vinculo}`))

  return doc
}
