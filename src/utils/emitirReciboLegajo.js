import { supabase } from '../lib/supabase'
import { generarReciboPdf } from './reciboPdf'
import { calcularHashPdf } from './reciboHash'
import { etiquetaPeriodo } from './etiquetaPeriodo'

// Datos de cabecera del recibo (empresa + persona) resueltos contra
// Supabase. Extraído de LiquidacionPage.handleEmitirRecibo (Fase 6 Task 7)
// para poder emitir el mismo recibo desde la ficha del legajo sin duplicar
// 75 líneas de fetching.
export async function datosReciboDesdeSupabase({ empresaId, personalId, nombrePersona }) {
  const [{ data: empresaRow }, { data: configRow }, { data: legajoRow }] = await Promise.all([
    // `empresas` es compartida con Presencio: solo tiene nombre y logo_url.
    // El CUIT y el domicilio viven en nom_empresa_config (migración 0021).
    supabase.from('empresas').select('nombre, logo_url').eq('id', empresaId).single(),
    supabase.from('nom_empresa_config').select('cuit, domicilio').eq('empresa_id', empresaId).maybeSingle(),
    supabase.from('nom_legajo').select('cuil, categoria_id, fecha_ingreso, banco, antiguedad_reconocida')
      .eq('personal_id', personalId).eq('empresa_id', empresaId).maybeSingle(),
  ])

  let categoriaNombre = '—'
  if (legajoRow?.categoria_id) {
    const { data: cat } = await supabase.from('nom_categorias').select('nombre').eq('id', legajoRow.categoria_id).single()
    categoriaNombre = cat?.nombre || '—'
  }

  return {
    empresa: {
      nombre: empresaRow?.nombre || '—',
      cuit: configRow?.cuit || '—',
      domicilio: configRow?.domicilio || '—',
    },
    persona: {
      nombre: nombrePersona || personalId,
      cuil: legajoRow?.cuil || '—',
      legajo: personalId.slice(0, 8),
      categoria: categoriaNombre,
      fechaIngreso: legajoRow?.fecha_ingreso || '—',
      antiguedadReconocida: legajoRow?.antiguedad_reconocida ?? 0,
      banco: legajoRow?.banco || '—',
    },
  }
}

// `nom_liquidacion_items` no persiste `codigo_recibo` (limitación conocida
// de la Fase 5B Task 9): se usa `concepto_codigo` como columna "Cod".
export function itemsRecibo(filas) {
  return (filas || []).map((i) => ({
    codigo: i.concepto_codigo, nombre: i.concepto_nombre, tipo: i.tipo, monto: Number(i.monto),
    unidadTexto: i.unidad_texto ?? null,
    baseCalculo: i.base_calculo != null ? Number(i.base_calculo) : null,
    grupoRecibo: i.grupo_recibo ?? null,
    detalleRecibo: i.detalle_recibo ?? null,
  }))
}

// Genera el PDF, calcula su hash y lo descarga. Devuelve { ok, hash, doc }
// — asignar el número de recibo (RPC emitir_recibo) queda del lado del
// caller, que es quien tiene el store a mano.
export async function generarYDescargarRecibo({ empresaId, personalId, nombrePersona, periodo, filasItems, numeroRecibo }) {
  const { empresa, persona } = await datosReciboDesdeSupabase({ empresaId, personalId, nombrePersona })
  const desde = periodo?.fecha_desde || periodo?.fechaDesde || ''
  const doc = generarReciboPdf({
    empresa,
    persona,
    periodo: {
      mes: desde ? String(desde).slice(5, 7) : '—',
      anio: desde ? String(desde).slice(0, 4) : '—',
      descripcion: etiquetaPeriodo(periodo),
      fechaPago: periodo?.fecha_pago || '—',
    },
    items: itemsRecibo(filasItems),
    codigoRecibo: numeroRecibo || null,
  })
  const hash = await calcularHashPdf(doc)
  return { doc, hash, nombreArchivo: `recibo-${(nombrePersona || personalId).replace(/[^\w.-]/g, '_')}` }
}
