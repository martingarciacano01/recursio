// src/utils/reciboPie.js
// Torta de "Costo Total Empleador" para el recibo. jsPDF no tiene sectores:
// cada porción se rellena con un abanico de triángulos desde el centro.

// Paleta fija (mismo orden que reciboLayout arma las porciones):
// Sueldo Neto (azul), luego organismos.
const COLORES = [
  [31, 78, 121],   // Sueldo Neto - azul
  [192, 0, 0],     // Sindical - rojo
  [237, 125, 49],  // Seguridad Social - naranja
  [112, 173, 71],  // Obra Social - verde
  [255, 192, 0],   // INSSJP - amarillo
  [68, 114, 196],  // ART - azul claro
  [165, 165, 165], // SCVO - gris
]

const fmt = (n) => `$${(Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function dibujarTorta(doc, { cx, cy, radio, porciones, legendX, legendY }) {
  const total = (porciones || []).reduce((s, p) => s + (Number(p.valor) || 0), 0)
  if (total <= 0) return

  const pasos = 60 // triángulos por vuelta completa: suave sin ser pesado
  let anguloInicio = -Math.PI / 2 // arranca arriba (12 en punto)

  porciones.forEach((p, idx) => {
    const valor = Number(p.valor) || 0
    if (valor <= 0) return
    const barrido = (valor / total) * Math.PI * 2
    const nTri = Math.max(1, Math.round((barrido / (Math.PI * 2)) * pasos))
    const paso = barrido / nTri
    const [rr, gg, bb] = COLORES[idx % COLORES.length]
    doc.setFillColor(rr, gg, bb)
    for (let k = 0; k < nTri; k++) {
      const a0 = anguloInicio + paso * k
      const a1 = anguloInicio + paso * (k + 1)
      doc.triangle(
        cx, cy,
        cx + radio * Math.cos(a0), cy + radio * Math.sin(a0),
        cx + radio * Math.cos(a1), cy + radio * Math.sin(a1),
        'F'
      )
    }
    anguloInicio += barrido
  })

  // Leyenda (a la derecha de la torta por defecto).
  const lx = legendX ?? cx + radio + 6
  let ly = legendY ?? cy - radio
  doc.setFontSize(6.5)
  porciones.forEach((p, idx) => {
    if ((Number(p.valor) || 0) <= 0) return
    const [rr, gg, bb] = COLORES[idx % COLORES.length]
    doc.setFillColor(rr, gg, bb)
    doc.rect(lx, ly - 2.2, 3, 3, 'F')
    doc.setTextColor(0, 0, 0)
    const pct = ((Number(p.valor) || 0) / total) * 100
    doc.text(`${p.label}: ${fmt(p.valor)} (${pct.toFixed(1)}%)`, lx + 4.5, ly)
    ly += 4.5
  })
}
