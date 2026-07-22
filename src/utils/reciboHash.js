// Checksum SHA-256 del PDF ya generado (jsPDF), vía Web Crypto (disponible
// en todos los navegadores modernos, sin dependencias nuevas). No es una
// firma criptográfica del emisor: es un hash de integridad para poder
// probar más tarde "este es el PDF que se entregó", ver migración 0016.
export async function calcularHashPdf(doc) {
  const bytes = doc.output('arraybuffer')
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
