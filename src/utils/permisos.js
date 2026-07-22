// Matriz de acciones por rol de Nómina. Único punto de verdad del lado del
// cliente para gating de UI (Sidebar, ProtectedRoute, botones) — el
// gating real de datos vive en RLS (migración 0026); esto es SOLO para no
// mostrar botones/rutas que igual fallarían en el servidor.
const MATRIZ = {
  ver_legajos: ['admin', 'rrhh', 'consulta', 'supervisor'],
  editar_legajos: ['admin', 'rrhh'],
  ver_liquidacion: ['admin', 'rrhh', 'consulta', 'supervisor'],
  calcular_liquidacion: ['admin', 'rrhh'],
  enviar_a_aprobacion: ['admin', 'rrhh'],
  aprobar: ['admin', 'revisor_interno', 'revisor_externo'],
  aprobar_pago: ['admin', 'aprobador_pagos'],
  emitir_recibos: ['admin', 'rrhh'],
  exportar: ['admin', 'rrhh'],
  ver_configuracion: ['admin', 'rrhh'],
  editar_configuracion: ['admin'],
  gestionar_usuarios: ['admin'],
  ver_reportes: ['admin', 'rrhh', 'aprobador_pagos'],
  ver_dashboard: ['admin', 'rrhh', 'aprobador_pagos', 'supervisor', 'consulta'],
}

// rolesNomina: array de filas { rol, alcance_tipo?, alcance_id? } (la
// forma que devuelve whoami_nomina()). Un usuario puede tener más de un
// rol: el resultado es la union de lo que cada rol individual permite.
export function puede(rolesNomina, accion) {
  const permitidos = MATRIZ[accion]
  if (!permitidos || !Array.isArray(rolesNomina)) return false
  return rolesNomina.some((r) => permitidos.includes(r.rol))
}
