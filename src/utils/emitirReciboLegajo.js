import { supabase } from '../lib/supabase'
import { generarReciboPdf } from './reciboPdf'
import { calcularHashPdf } from './reciboHash'
import { etiquetaPeriodo } from './etiquetaPeriodo'
import { cargarLogoRecibo } from './cargarLogoRecibo'

// Datos de EMPRESA del recibo (nombre, CUIT, domicilio, logo) — extraído por
// separado de datosReciboDesdeSupabase para poder cachearlo por empresaId
// (Fase de mejoras 2026-07-29 §1: emitir el ZIP de 30 recibos hacía antes 3
// queries + 1 descarga de logo POR PERSONA, cuando la empresa es la misma
// para las 30. reciboZip.js llama esto una sola vez y lo reusa).
export async function cargarDatosEmpresa(empresaId) {
  const [{ data: empresaRow }, { data: configRow }] = await Promise.all([
    // `empresas` es compartida con Presencio: solo tiene nombre y logo_url.
    // El CUIT y el domicilio viven en nom_empresa_config (migración 0021).
    supabase.from('empresas').select('nombre, logo_url').eq('id', empresaId).single(),
    supabase.from('nom_empresa_config').select('cuit, domicilio, logo_url').eq('empresa_id', empresaId).maybeSingle(),
  ])
  // Logo del recibo: primero el cargado desde Configuración → Empresa
  // (nom_empresa_config.logo_url, migración 0036); si no hay, el que ya
  // administraba Presencio en `empresas`.
  const logo = await cargarLogoRecibo(configRow?.logo_url || empresaRow?.logo_url || null)
  return {
    nombre: empresaRow?.nombre || '—',
    cuit: configRow?.cuit || '—',
    domicilio: configRow?.domicilio || '—',
    logo,
  }
}

// Datos de cabecera del recibo (empresa + persona) resueltos contra
// Supabase. Extraído de LiquidacionPage.handleEmitirRecibo (Fase 6 Task 7)
// para poder emitir el mismo recibo desde la ficha del legajo sin duplicar
// 75 líneas de fetching. `empresaCacheada`, si se pasa, evita repetir las
// queries de empresa/logo (ver cargarDatosEmpresa arriba) — lo usa
// reciboZip.js al emitir varios recibos de la misma empresa en lote.
export async function datosReciboDesdeSupabase({ empresaId, personalId, nombrePersona, empresaCacheada }) {
  const [empresa, { data: legajoRow }] = await Promise.all([
    empresaCacheada ? Promise.resolve(empresaCacheada) : cargarDatosEmpresa(empresaId),
    supabase.from('nom_legajo').select('cuil, categoria_id, fecha_ingreso, banco, antiguedad_reconocida')
      .eq('personal_id', personalId).eq('empresa_id', empresaId).maybeSingle(),
  ])

  let categoriaNombre = '—'
  if (legajoRow?.categoria_id) {
    const { data: cat } = await supabase.from('nom_categorias').select('nombre').eq('id', legajoRow.categoria_id).single()
    categoriaNombre = cat?.nombre || '—'
  }

  return {
    empresa,
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
export async function generarYDescargarRecibo({ empresaId, personalId, nombrePersona, periodo, filasItems, numeroRecibo, empresaCacheada }) {
  const { empresa, persona } = await datosReciboDesdeSupabase({ empresaId, personalId, nombrePersona, empresaCacheada })
  const desde = periodo?.fecha_desde || periodo?.fechaDesde || ''
  const doc = await generarReciboPdf({
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
