// Descarga el logo de la empresa y lo devuelve como data URL con sus
// dimensiones, que es lo que necesita jsPDF.addImage para encajarlo sin
// deformarlo. Nunca lanza: si el logo no está o falla la descarga, devuelve
// null y el recibo se emite igual, sin logo.
const FORMATOS = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WEBP' }

export async function cargarLogoRecibo(url) {
  if (!url) return null
  try {
    const respuesta = await fetch(url, { mode: 'cors' })
    if (!respuesta.ok) return null
    const blob = await respuesta.blob()
    if (!blob.type.startsWith('image/')) return null

    const dataUrl = await new Promise((resolve, reject) => {
      const lector = new FileReader()
      lector.onload = () => resolve(lector.result)
      lector.onerror = reject
      lector.readAsDataURL(blob)
    })

    const { ancho, alto } = await medir(dataUrl)
    if (!ancho || !alto) return null

    return { dataUrl, ancho, alto, formato: FORMATOS[blob.type] || 'PNG' }
  } catch {
    return null
  }
}

function medir(dataUrl) {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve({ ancho: 0, alto: 0 }); return }
    const img = new Image()
    img.onload = () => resolve({ ancho: img.naturalWidth, alto: img.naturalHeight })
    img.onerror = () => resolve({ ancho: 0, alto: 0 })
    img.src = dataUrl
  })
}
