// Lógica pura de los gráficos del Dashboard — sin red y sin React, para poder
// testearla sola (mismo criterio que src/utils/alertasDashboard.js).

// Reparte al personal activo en tres grupos EXCLUYENTES, para que el anillo
// sume exactamente el total y no cuente dos veces a la misma persona:
//   incompletos  -> le faltan datos duros del legajo (CUIL, CBU, categoría…)
//   docPendiente -> el legajo está completo pero falta o vence documentación
//   alDia        -> el resto
export function repartoLegajos(personal, esIncompleto, tieneDocPendiente) {
  const salida = { alDia: 0, incompletos: 0, docPendiente: 0, total: 0 }
  for (const p of personal || []) {
    salida.total += 1
    if (esIncompleto(p)) salida.incompletos += 1
    else if (tieneDocPendiente(p)) salida.docPendiente += 1
    else salida.alDia += 1
  }
  return salida
}

// Personal activo agrupado por convenio, ordenado de mayor a menor.
// El personal fuera de convenio (o sin convenio asignado) se agrupa aparte.
export function personalPorConvenio(personal, legajos, convenios) {
  const nombrePorId = new Map((convenios || []).map((c) => [c.id, c.nombre]))
  const legajoPorPersonal = new Map((legajos || []).map((l) => [l.personal_id, l]))
  const cuenta = new Map()

  for (const p of personal || []) {
    const l = legajoPorPersonal.get(p.id)
    const nombre = !l || l.fuera_convenio || !l.convenio_id
      ? 'Fuera de convenio'
      : nombrePorId.get(l.convenio_id) || 'Sin convenio'
    cuenta.set(nombre, (cuenta.get(nombre) || 0) + 1)
  }

  return [...cuenta.entries()]
    .map(([nombre, cantidad]) => ({ nombre, cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad)
}

// Últimos N períodos ordenados del más nuevo al más viejo, con el estado ya
// normalizado a algo que la UI pueda pintar directamente.
export function periodosRecientes(periodos, n = 6) {
  return [...(periodos || [])]
    .sort((a, b) => String(b.fecha_desde).localeCompare(String(a.fecha_desde)))
    .slice(0, n)
    .map((p) => ({
      ...p,
      calculado: p.calculo_estado === 'completo',
      cerrado: p.estado === 'cerrado',
    }))
}

// Porcentaje entero y acotado a 0-100 (evita NaN cuando no hay personal).
export function porcentaje(parte, total) {
  if (!total) return 0
  return Math.max(0, Math.min(100, Math.round((parte / total) * 100)))
}
