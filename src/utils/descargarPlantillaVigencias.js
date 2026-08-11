// Descarga la plantilla CSV de vigencias para un convenio (Task 6.9,
// plan 2026-08-11): CTA del estado vacío de TablaVigencias. Reusa la misma
// lógica de consulta/descarga que TabImportarCsv.descargarPlantilla, para
// no duplicarla en TabEscalas/TabNoRemunerativos.
import { supabase } from '../lib/supabase'
import { generarPlantillaCsv } from './csvConvenios'

export async function descargarPlantillaVigencias(convenioId) {
  let nombres = ['Operario', 'Adicional']
  if (convenioId) {
    const [{ data: cats }, { data: nrs }] = await Promise.all([
      supabase.from('nom_categorias').select('nombre').eq('convenio_id', convenioId).order('nombre'),
      supabase.from('nom_no_remunerativos').select('categoria_nombre').eq('convenio_id', convenioId).order('categoria_nombre'),
    ])
    const nombresCats = [...new Set((cats || []).map((c) => c.nombre))]
    const nombresNrs = [...new Set((nrs || []).map((n) => n.categoria_nombre))]
    nombres = [nombresCats[0] ?? 'Operario', nombresNrs[0] ?? nombresCats[1] ?? 'Adicional']
  }
  const contenido = generarPlantillaCsv(nombres)
  // BOM para que Excel detecte UTF-8 (mismo patrón que exportCsv.js).
  const blob = new Blob([`\uFEFF${contenido}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'plantilla-convenio.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}