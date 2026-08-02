// Auditoría de accesos a datos sensibles (Fase 1, Task 1.6; migración
// 0046_accesos_log.sql). El INSERT real lo hace la RPC registrar_acceso
// (SECURITY DEFINER): el cliente nunca puede falsear `usuario_id` ni
// escribir directo en nom_accesos_log.
//
// `detalle` es deliberadamente solo CONTEXTO ("período 2026-07
// quincena_1"), nunca datos salariales — un log de auditoría que él
// mismo filtra sueldos sería parte del problema, no de la solución. Se
// valida acá con una heurística simple (no es un parser de PII
// exhaustivo, es una red de seguridad contra un `detalle` armado a mano
// sin pensar en un punto de llamada nuevo).
const PATRON_MONTO = /\$\s?[\d.,]+/
const PATRON_CUIL = /\b\d{2}-?\d{7,8}-?\d\b/

export function detalleSeguro(detalle) {
  if (PATRON_MONTO.test(detalle) || PATRON_CUIL.test(detalle)) {
    throw new Error('detalle de auditoría con pinta de monto o CUIL — no se registra')
  }
  return detalle
}

// Se llama fire-and-forget desde la UI (`.catch(() => {})`, ver
// LiquidacionPage.jsx/ReportesPage.jsx): un fallo de log nunca debe
// romper la descarga del recibo o el export en sí.
export async function registrarAcceso(supabase, recurso, recursoId, detalle) {
  detalleSeguro(detalle)
  await supabase.rpc('registrar_acceso', {
    p_recurso: recurso, p_recurso_id: recursoId, p_detalle: detalle,
  })
}
