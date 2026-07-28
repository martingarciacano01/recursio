// Ausencias tipo 'vacaciones' aprobadas en Presencio (nom_v_ausencias) que
// todavía no tienen una liquidación asociada en nom_vacaciones_liquidadas.
// Función pura para poder testearla sin mockear Supabase (Liquidaciones
// individuales, Fase 6b).
export function ausenciasVacacionesElegibles(ausencias, idsYaLiquidados) {
  const yaLiquidados = new Set(idsYaLiquidados || [])
  return (ausencias || []).filter(
    (a) => a.tipo === 'vacaciones' && a.estado === 'aprobada' && !yaLiquidados.has(a.id)
  )
}
