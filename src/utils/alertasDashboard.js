// Lógica pura de las alertas del Dashboard — sin red, sin React, testeable
// sola. El Dashboard sólo hace las consultas y renderiza (Fase 6 Task 9).

export const DEFAULTS_ALERTAS = {
  // Día del mes a partir del cual una liquidación pendiente pasa a
  // "urgente" en el Dashboard. Configurable en Configuración → Alertas
  // con el código de parámetro `alerta_liq_dia`.
  alertaLiqDia: 25,
  // Días de anticipación con que se marca un documento como "por vencer".
  alertaDocDias: 30,
}

// Períodos del mes calendario en curso que todavía no están cerrados —
// es decir, trabajo de liquidación que queda por hacer.
export function periodosPendientesDelMes(periodos, hoy = new Date().toISOString().slice(0, 10)) {
  const mesActual = String(hoy).slice(0, 7)
  return (periodos || []).filter(
    (p) => String(p.fecha_desde).slice(0, 7) === mesActual && p.estado !== 'cerrado'
  )
}

// 'ok' sin pendientes · 'urgente' pasado el día umbral · 'normal' antes.
export function urgenciaLiquidacion(cantidadPendientes, hoy = new Date().toISOString().slice(0, 10), diaUmbral = DEFAULTS_ALERTAS.alertaLiqDia) {
  if (cantidadPendientes === 0) return 'ok'
  const dia = Number(String(hoy).slice(8, 10))
  return dia >= diaUmbral ? 'urgente' : 'normal'
}

// Personas dadas de baja a las que todavía no se les generó la
// liquidación final (nom_legajo.liquidacion_final_id, Fase 5E Task 33).
export function bajasSinFinal(legajos) {
  return (legajos || []).filter((l) => l.fecha_baja && !l.liquidacion_final_id)
}

// Lee un parámetro de alerta de la lista de nom_parametros, con default.
export function valorAlerta(parametros, codigo, porDefecto) {
  const fila = (parametros || []).find((p) => p.codigo === codigo)
  const valor = Number(fila?.valor)
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto
}
