import { cargarJsPDF } from './cargarJsPDF.js'
import { crearLienzo, cabeceraEmpresa } from './pdfEstilo.js'

const ROJO = [180, 30, 30]

function estaVencido(fechaVencimiento, hoy) {
  if (!fechaVencimiento) return false
  return String(fechaVencimiento) < hoy
}

// PDF de legajo (plan 2026-07-29 §6): reescrito sobre el kit compartido de
// pdfEstilo.js para que se vea consistente con el recibo (misma banda
// verde, mismos sub-encabezados grises, misma grilla de identificación en
// dos filas) en vez de ser una lista de texto plano sin logo ni estructura.
//
// De paso se arregla el bug de FichaLegajoPage.jsx:107 (no pasaba
// `documentos`, así que la sección de Documentación siempre decía "sin
// documentos cargados" aunque la persona tuviera todo subido) y se agrega
// `empresa` (antes ni se pasaba: el legajo nunca tuvo logo ni datos
// fiscales de la empresa).
//
// Async porque jsPDF se carga con import() dinámico (cargarJsPDF.js).
export async function generarLegajoPdf({ empresa, persona, legajo, familiares = [], sanciones = [], ausencias = [], documentos = [] }) {
  const jsPDF = await cargarJsPDF()
  const doc = new jsPDF()
  const L = crearLienzo(doc, { M: 14, yInicial: 15 })
  const hoy = new Date().toISOString().slice(0, 10)

  // ── 1. Cabecera: logo + datos fiscales + título en banda verde ───────
  cabeceraEmpresa(doc, empresa, L)
  L.banda('LEGAJO DEL PERSONAL')

  // ── 2. Grilla de identificación (dos filas, estilo recibo) ────────────
  const x1 = L.colIzq, x2 = L.colIzq + 60, x3 = L.colIzq + 105, x4 = L.colIzq + 145
  L.grilla([
    ['Apellido y Nombre', persona?.nombre || '—', x1],
    ['Legajo', String(persona?.id || '').slice(0, 8) || '—', x2],
    ['DNI', persona?.dni || '—', x3],
    ['CUIL', legajo?.cuil || '—', x4],
  ])
  L.grilla([
    ['Puesto / Categoría', persona?.puesto || '—', x1],
    ['Fecha de ingreso', legajo?.fechaIngreso || persona?.fechaIngreso || '—', x2],
    ['Antigüedad', legajo?.antiguedadReconocida != null ? `${legajo.antiguedadReconocida} años` : '—', x3],
    ['Jornada', legajo?.jornada || '—', x4],
  ])
  L.y += 2

  // ── 3. Datos bancarios y obra social ──────────────────────────────────
  L.banda('DATOS BANCARIOS Y OBRA SOCIAL')
  L.subEncabezado('Cuenta y cobertura')
  L.fila([
    { texto: `CBU: ${legajo?.cbu || '—'}`, x: L.colIzq },
    { texto: `Banco: ${legajo?.banco || '—'}`, x: L.colIzq + 70 },
    { texto: `Obra social: ${legajo?.obraSocial || '—'}`, x: L.colIzq + 120 },
  ])
  L.y += 2

  // ── 4. Datos de contacto ────────────────────────────────────────────────
  L.banda('DATOS DE CONTACTO')
  L.fila([
    { texto: `Dirección: ${legajo?.domicilio || '—'}`, x: L.colIzq },
    { texto: `Teléfono: ${legajo?.telefono || '—'}`, x: L.colIzq + 70 },
  ])
  L.fila([
    { texto: `Correo: ${legajo?.email || '—'}`, x: L.colIzq },
  ])
  L.y += 2

  // ── 4. Documentación (vencidos en rojo) ───────────────────────────────
  L.banda('DOCUMENTACIÓN', documentos.length > 0 ? `${documentos.length} documento(s)` : null)
  if (documentos.length === 0) {
    L.fila([{ texto: 'Sin documentos cargados.', x: L.colIzq }])
  } else {
    L.subEncabezado('Documento — Vencimiento')
    documentos.forEach((d) => {
      const vencido = estaVencido(d.fecha_vencimiento || d.fechaVencimiento, hoy)
      const vencimiento = (d.fecha_vencimiento || d.fechaVencimiento) || 'sin vencimiento'
      L.fila([
        { texto: d.nombre || d.tipo || '—', x: L.colIzq },
        { texto: vencido ? `Vencido (${vencimiento})` : vencimiento, x: L.colIzq + 110, color: vencido ? ROJO : null },
      ])
    })
  }
  L.y += 2

  // ── 5. Licencias y vacaciones ──────────────────────────────────────────
  L.banda('LICENCIAS Y VACACIONES', ausencias.length > 0 ? `${ausencias.length} registro(s)` : null)
  if (ausencias.length === 0) {
    L.fila([{ texto: 'Sin ausencias registradas.', x: L.colIzq }])
  } else {
    L.subEncabezado('Desde — Hasta — Tipo (estado)')
    ausencias.forEach((a) => {
      L.fila([{ texto: `${a.fecha_desde} a ${a.fecha_hasta} — ${a.tipo} (${a.estado})`, x: L.colIzq }])
    })
  }
  L.y += 2

  // ── 6. Sanciones ────────────────────────────────────────────────────────
  L.banda('SANCIONES', sanciones.length > 0 ? `${sanciones.length} registro(s)` : null)
  if (sanciones.length === 0) {
    L.fila([{ texto: 'Sin sanciones registradas.', x: L.colIzq }])
  } else {
    sanciones.forEach((s) => {
      L.fila([{ texto: `${s.fecha} — ${s.tipo}: ${s.motivo}`, x: L.colIzq }])
    })
  }
  L.y += 2

  // ── 7. Familiares ───────────────────────────────────────────────────────
  L.banda('FAMILIARES', familiares.length > 0 ? `${familiares.length} registro(s)` : null)
  if (familiares.length === 0) {
    L.fila([{ texto: 'Sin familiares cargados.', x: L.colIzq }])
  } else {
    familiares.forEach((f) => {
      L.fila([{ texto: `${f.nombre} — ${f.vinculo}`, x: L.colIzq }])
    })
  }

  // ── Pie en TODAS las páginas: "Página N de M" + fecha + persona ────────
  // jsPDF necesita una segunda pasada para saber el total: se cuenta acá
  // (getNumberOfPages) y se itera con setPage al final, no antes.
  const totalPaginas = doc.getNumberOfPages()
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i)
    crearLienzo(doc, { M: 14 }).pie(i, totalPaginas, `Emitido ${hoy} — ${persona?.nombre || '—'}`)
  }

  return doc
}
