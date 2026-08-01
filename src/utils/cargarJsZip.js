// Carga diferida de jszip (~100 kB), mismo patrón que cargarJsPDF.js: import()
// dinámico para que el chunk se pida recién cuando el usuario arma un ZIP de
// recibos, no en el bundle inicial.
let promesa = null

export function cargarJsZip() {
  if (!promesa) {
    promesa = import('jszip')
      .then((m) => m.default)
      .catch((e) => { promesa = null; throw e })
  }
  return promesa
}
