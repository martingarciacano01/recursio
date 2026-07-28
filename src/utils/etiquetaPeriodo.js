// Etiqueta única y legible de un período, compartida por el selector de
// Liquidación, la tabla de liquidaciones de la ficha del legajo y el
// recibo. Antes cada pantalla la armaba a mano y de forma distinta
// ("quincenal — 2026-06-15 a 2026-07-01").
//
// Formato pedido: "Mes Año · <tipo>".

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const ETIQUETA_TIPO = {
  mensual: 'Mensual',
  // 'quincenal' es el tipo viejo, previo a 0017: se conserva para no romper
  // los períodos ya creados.
  quincenal: 'Quincenal',
  quincena_1: '1ra quincena',
  quincena_2: '2da quincena',
  // mensual_fc: período mensual que liquida SOLO al personal fuera de
  // convenio (cobra mensual mientras UOCRA cobra por quincena) — 0033.
  mensual_fc: 'Fuera de convenio',
  sac: 'SAC',
  sac_1: '1er SAC',
  sac_2: '2do SAC',
  vacaciones: 'Vacaciones',
  final: 'Liquidación final',
}

export function etiquetaTipoPeriodo(tipo) {
  return ETIQUETA_TIPO[tipo] || tipo
}

export function etiquetaPeriodo(periodo) {
  if (!periodo) return '—'
  // Acepta snake_case (fila cruda de nom_periodos) y camelCase (filas ya
  // mapeadas por los stores).
  const desde = periodo.fecha_desde || periodo.fechaDesde
  if (!desde) return etiquetaTipoPeriodo(periodo.tipo)
  const anio = String(desde).slice(0, 4)
  const mes = MESES[Number(String(desde).slice(5, 7)) - 1] || ''
  return `${mes} ${anio} · ${etiquetaTipoPeriodo(periodo.tipo)}`
}
