// Qué tipos de período se pueden crear según el convenio elegido.
//
// El orden correcto es convenio → tipo, no al revés: la modalidad del
// convenio (mensual o quincenal) es la que determina si corresponde liquidar
// por quincenas o por mes. Antes se elegía el tipo primero y el selector de
// convenio quedaba vacío o inconsistente (elegir "Mensual" cuando el único
// convenio es quincenal dejaba "Elegir convenio…" sin opciones).
//
// Valor centinela para "personal fuera de convenio": no es una fila de
// nom_convenios, es el tipo de período `mensual_fc` (migración 0033).
export const FUERA_DE_CONVENIO = '__fuera_de_convenio__'

// SAC: fechas manuales y no dependen del convenio (migración 0030).
export const TIPOS_MANUALES = ['sac_1', 'sac_2']

// El convenio "Fuera de convenio (LCT)" es una plantilla que existe para
// poder colgarle escalas y conceptos al personal sin convenio, pero NO es un
// convenio con el que se cree un período: para eso está la opción explícita
// "Personal fuera de convenio" (tipo mensual_fc). Se filtra solo del alta de
// período; en Configuración se sigue viendo y editando con normalidad.
export function esConvenioFueraDeConvenio(convenio) {
  const nombre = (convenio?.nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return nombre.startsWith('fuera de convenio')
}

// Convenios que se ofrecen al crear un período.
export function conveniosParaPeriodo(convenios, empresaId) {
  return (convenios || []).filter((c) => c.empresaId === empresaId && !esConvenioFueraDeConvenio(c))
}

const ETIQUETAS = {
  quincena_1: '1ra quincena',
  quincena_2: '2da quincena',
  mensual: 'Mensual',
  mensual_fc: 'Mensual (fuera de convenio)',
  sac_1: '1er SAC',
  sac_2: '2do SAC',
}

export function etiquetaTipo(tipo) {
  return ETIQUETAS[tipo] || tipo
}

// `seleccion` es el id de un convenio propio, FUERA_DE_CONVENIO, o '' si
// todavía no eligieron nada.
export function tiposDisponibles(seleccion, convenios) {
  if (!seleccion) return []
  if (seleccion === FUERA_DE_CONVENIO) return ['mensual_fc', ...TIPOS_MANUALES]

  const convenio = (convenios || []).find((c) => c.id === seleccion)
  if (!convenio) return []

  const porModalidad = convenio.modalidad === 'mensual'
    ? ['mensual']
    : ['quincena_1', 'quincena_2']

  return [...porModalidad, ...TIPOS_MANUALES]
}

// El convenio que se persiste en nom_periodos.convenio_id: null tanto para
// "fuera de convenio" como para los SAC de fechas manuales.
export function convenioDelPeriodo(seleccion, tipo, convenios) {
  if (!seleccion || seleccion === FUERA_DE_CONVENIO) return null
  if (TIPOS_MANUALES.includes(tipo)) return null
  return (convenios || []).find((c) => c.id === seleccion) || null
}
