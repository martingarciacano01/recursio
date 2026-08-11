import { cargarJsZip } from './cargarJsZip'
import { generarYDescargarRecibo, cargarDatosEmpresa } from './emitirReciboLegajo'

// Emite (RPC emitir_recibo, migración 0016) y arma en un solo ZIP los
// recibos de varias liquidaciones seleccionadas (plan 2026-07-29 §1). A
// diferencia de descargar uno por uno, acá:
//  - los datos de EMPRESA (nombre/CUIT/domicilio/logo) se resuelven una sola
//    vez y se reusan para todas las personas (antes: 3 queries + 1 descarga
//    de logo POR PERSONA — con 30 recibos, 90 queries y 30 descargas del
//    mismo logo repetidas).
//  - el orden es SECUENCIAL, nunca Promise.all: emitir_recibo asigna
//    números correlativos vía una función de Postgres; si dos llamadas
//    corren en paralelo pueden pisarse o saltearse un número.
//  - si una persona falla, se sigue con el resto del lote y se reporta al
//    final — un solo legajo con datos raros no debe abortar los otros 29.
//
// Params:
//  liquidaciones: array de liquidaciones a emitir (ya filtradas: sin
//    anuladas, con items) — cada una necesita al menos
//    { id, personalId, numeroRecibo }.
//  empresaId, periodo: mismos datos que ya usa generarYDescargarRecibo.
//  personalPorId: Map personalId → nombre (para el nombre de archivo).
//  fetchItems: async (liquidacionId) => filasItems de nom_liquidacion_items.
//  emitirRecibo: async (liquidacionId, hashPdf) => { ok, numeroRecibo, error }
//    (acción del store — se le inyecta acá para no importar supabase directo;
//    para variante, el caller pasa emitirReciboVariante).
//  variante: 'empleado' | 'empleador' (Fase 7 Task 7.5): propaga la
//    variante a cada recibo del lote y sufija los nombres con -empleado/-empleador.
//  firma: opcional, imagen de la firma para la variante empleado.
//  onProgreso: (procesados, total) => void, opcional.
//
// Devuelve { blob, emitidos, fallidos } — nunca lanza por un fallo puntual
// de una persona (sí puede lanzar si falla algo transversal, ej. cargar los
// datos de la empresa).
export async function generarZipRecibos({
  liquidaciones, empresaId, periodo, personalPorId, fetchItems, emitirRecibo, variante = 'empleador', firma = null, onProgreso,
}) {
  const JSZip = await cargarJsZip()
  const zip = new JSZip()
  const empresaCacheada = await cargarDatosEmpresa(empresaId)

  const emitidos = []
  const fallidos = []
  const total = liquidaciones.length

  for (let i = 0; i < total; i++) {
    const l = liquidaciones[i]
    const nombrePersona = personalPorId.get(l.personalId) || l.personalId
    try {
      const filasItems = await fetchItems(l.id)
      const { doc, hash } = await generarYDescargarRecibo({
        empresaId, personalId: l.personalId, nombrePersona, periodo,
        filasItems, numeroRecibo: l.numeroRecibo, empresaCacheada, variante, firma,
      })
      // emitir_recibo asigna el número correlativo — tiene que pasar ANTES
      // de nombrar el archivo. Secuencial a propósito (ver comentario de
      // arriba): no se dispara junto con la próxima iteración.
      const r = await emitirRecibo(l.id, hash)
      if (!r.ok) {
        fallidos.push({ personalId: l.personalId, nombre: nombrePersona, error: r.error })
      } else {
        const arrayBuffer = doc.output('arraybuffer')
        const nombreSlug = nombrePersona.replace(/[^\w.-]/g, '_')
        const sufijoVariante = variante === 'empleado' ? '-empleado' : '-empleador'
        zip.file(`recibo-${r.numeroRecibo}-${nombreSlug}${sufijoVariante}.pdf`, arrayBuffer)
        emitidos.push({ personalId: l.personalId, nombre: nombrePersona, numeroRecibo: r.numeroRecibo })
      }
    } catch (e) {
      fallidos.push({ personalId: l.personalId, nombre: nombrePersona, error: e instanceof Error ? e.message : String(e) })
    }
    onProgreso?.(i + 1, total)
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  return { blob, emitidos, fallidos }
}

// Nombre del zip: recibos-<tipo>-<fecha_desde>[-<variante>].zip (mismo
// criterio de nombrado que descargarCsv en LiquidacionPage.jsx).
export function nombreArchivoZip(periodo, variante = 'empleador') {
  const base = `recibos-${periodo?.tipo || 'periodo'}-${periodo?.fecha_desde || ''}`
  return `${base}${variante === 'empleado' ? '-empleado' : '-empleador'}.zip`
}
