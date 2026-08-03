// Task 4.5: onboarding de primeros pasos. Función pura — recibe los datos
// ya cargados por DashboardPage (ninguna consulta acá) y devuelve la lista
// de hitos con su estado. El orden importa para la barra de progreso pero
// no bloquea: un hito posterior puede estar "hecho" sin que los previos lo
// estén (ej. alguien carga un legajo antes de terminar de configurar
// documentación) — no es un wizard forzado, es una checklist.
export function progresoOnboarding({ empresa, convenios, categorias, documentos, flujos, legajos, periodos } = {}) {
  return [
    {
      id: 'empresa',
      label: 'Completar los datos de la empresa (CUIT y domicilio)',
      ruta: '/configuracion',
      hecho: Boolean(empresa?.cuit?.trim() && empresa?.domicilio?.trim()),
    },
    {
      id: 'convenio',
      label: 'Clonar o dar de alta un convenio propio',
      ruta: '/configuracion',
      hecho: (convenios || []).some((c) => Boolean(c.empresaId)),
    },
    {
      id: 'escalas',
      label: 'Cargar las escalas salariales (categorías)',
      ruta: '/configuracion',
      hecho: (categorias || []).length > 0,
    },
    {
      id: 'documentacion',
      label: 'Definir la documentación requerida del legajo',
      ruta: '/configuracion',
      hecho: (documentos || []).length > 0,
    },
    {
      id: 'flujo',
      label: 'Armar el flujo de aprobación',
      ruta: '/configuracion',
      hecho: (flujos || []).length > 0,
    },
    {
      id: 'legajos',
      label: 'Dar de alta el primer legajo',
      ruta: '/legajos',
      hecho: (legajos || []).length > 0,
    },
    {
      id: 'periodos',
      label: 'Calcular el primer período',
      ruta: '/liquidacion',
      hecho: (periodos || []).length > 0,
    },
  ]
}
