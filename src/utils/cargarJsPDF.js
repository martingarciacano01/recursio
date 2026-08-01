// Carga diferida de jsPDF. Junto con html2canvas y purify (sus dependencias)
// son ~380 kB que antes viajaban en el bundle inicial aunque el usuario nunca
// emitiera un recibo. Con import() dinámico Vite los deja en chunks aparte que
// se piden recién al generar el primer PDF; el módulo queda cacheado, así que
// la segunda descarga ya es instantánea.
let promesa = null

export function cargarJsPDF() {
  if (!promesa) {
    promesa = import('jspdf')
      .then((m) => m.jsPDF)
      // Si la descarga del chunk falla (offline, deploy nuevo), se limpia la
      // promesa para poder reintentar en el próximo click.
      .catch((e) => { promesa = null; throw e })
  }
  return promesa
}
