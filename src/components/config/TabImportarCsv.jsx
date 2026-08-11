import { useState } from 'react'
import { parseCsvConvenios, generarPlantillaCsv } from '../../utils/csvConvenios'
import { useConveniosStore } from '../../store/conveniosStore'
import { useToastStore } from '../../store/toastStore'
import { supabase } from '../../lib/supabase'
import { Download, Upload, AlertCircle } from 'lucide-react'

// Importación manual de vigencias por CSV (Fase 5, plan 2026-08-11) con
// plantilla descargable y revisión previa: se parsea el texto, se muestran
// las filas con su validez y contra la base (duplicados por nombre +
// vigencia_desde), y recién al confirmar se inserta vía importarVigencias
// del store (que nunca pisa; agrega vigencia nueva).
export default function TabImportarCsv({ convenioId }) {
  const { importarVigencias } = useConveniosStore()
  const push = useToastStore((s) => s.push)

  const [texto, setTexto] = useState('')
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [parseo, setParseo] = useState(null)   // { ok, errores, filas }
  const [existentes, setExistentes] = useState(null) // Set de claves "fecha|nombre"
  const [importando, setImportando] = useState(false)
  const [resumen, setResumen] = useState(null) // { insertados, omitidos }
  const [errorBase, setErrorBase] = useState('')

  const sinConvenio = !convenioId

  const cargarExistentes = async () => {
    if (!convenioId) return new Set()
    const [resCats, resNrs] = await Promise.all([
      supabase.from('nom_categorias').select('nombre, vigencia_desde').eq('convenio_id', convenioId),
      supabase.from('nom_no_remunerativos').select('categoria_nombre, vigencia_desde').eq('convenio_id', convenioId),
    ])
    const set = new Set()
    for (const r of resCats?.data || []) set.add(`${r.vigencia_desde}|${r.nombre}`)
    for (const r of resNrs?.data || []) set.add(`${r.vigencia_desde}|${r.categoria_nombre}`)
    return set
  }

  const analizar = async (nuevoTexto) => {
    setTexto(nuevoTexto)
    if (!nuevoTexto.trim()) { setParseo(null); setResumen(null); setExistentes(null); return }
    setResumen(null)
    const resultado = parseCsvConvenios(nuevoTexto)
    setParseo(resultado)
    if (resultado.filas.length > 0 && !sinConvenio) {
      const hoy = await cargarExistentes()
      setExistentes(hoy)
    } else {
      setExistentes(null)
    }
  }

  const alSubirArchivo = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setNombreArchivo(file.name)
    const lector = new FileReader()
    lector.onload = () => analizar(String(lector.result || ''))
    lector.readAsText(file, 'utf-8')
    e.target.value = '' // permite re-subir el mismo archivo
  }

  const descargarPlantilla = async () => {
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

  const confirmar = async () => {
    if (!parseo || parseo.filas.length === 0 || sinConvenio) return
    setImportando(true)
    setErrorBase('')
    const r = await importarVigencias(convenioId, parseo.filas)
    setImportando(false)
    if (!r.ok) {
      setErrorBase(r.error || 'no se pudo importar')
      push('No se pudo importar el CSV', 'error')
      return
    }
    setResumen({ insertados: r.insertados, omitidos: r.omitidos })
    push(`CSV importado: ${r.insertados} filas nuevas, ${r.omitidos} omitidas`, r.omitidos > 0 ? 'info' : 'success')
  }

  // Fila parseada → estado para el diff: válida, duplicada contra la base,
  // o descartada por error.
  const estadoFila = (fila) => {
    if (existentes?.has(`${fila.vigenciaDesde}|${fila.nombre}`)) return 'duplicado'
    return 'nuevo'
  }

  return (
    <div className="lista-fichas">
      <div className="card card-compacta max-900" style={{ fontSize: '0.86rem' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: 8 }}>Importar vigencias desde CSV</h3>
        <p className="texto-secundario" style={{ marginBottom: 14, fontSize: '0.83rem' }}>
          Cargá básicos y/o sumas no remunerativas con su vigencia. Las filas que ya existan para la misma
          fecha se omiten; nada se sobrescribe.
        </p>

        <div className="acciones" style={{ marginBottom: 12 }}>
          <label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>
            <Upload size={14} /> Elegir archivo
            <input type="file" accept=".csv,text/csv" onChange={alSubirArchivo} style={{ display: 'none' }} />
          </label>
          <button className="btn btn-ghost btn-sm" onClick={descargarPlantilla}>
            <Download size={14} /> Descargar plantilla
          </button>
        </div>
        {nombreArchivo && <p className="texto-muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>Archivo: {nombreArchivo}</p>}

        <div className="input-group" style={{ marginBottom: 12 }}>
          <label className="input-label" htmlFor="csv-texto">…o pegá el contenido acá</label>
          <textarea
            id="csv-texto"
            className="input"
            rows={6}
            placeholder="concepto;nombre;valor;modalidad;vigencia_desde&#10;basico;Operario;1284,50;hora;01/08/2026"
            value={texto}
            onChange={(e) => analizar(e.target.value)}
            style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
          />
        </div>

        {sinConvenio && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Seleccioná un convenio para importar.</p>
        )}

        {parseo && parseo.errores.length > 0 && (
          <div className="card-compacta" style={{ marginBottom: 10, borderLeft: '3px solid var(--warning)', paddingLeft: 12 }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--warning)', marginBottom: 4 }}>
              <AlertCircle size={14} style={{ verticalAlign: -2 }} /> Se descartaron {parseo.errores.length} fila(s) con errores:
            </p>
            <ul style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: '1rem' }}>
              {parseo.errores.slice(0, 6).map((e, i) => (
                <li key={i} style={{ marginBottom: 2 }}>Línea {e.fila}: {e.mensaje}</li>
              ))}
            </ul>
          </div>
        )}

        {parseo && parseo.filas.length > 0 && (
          <table className="tabla-csv" style={{ width: '100%', fontSize: '0.8rem', marginBottom: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Tipo</th>
                <th style={{ textAlign: 'left' }}>Nombre</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th style={{ textAlign: 'left' }}>Modalidad</th>
                <th style={{ textAlign: 'left' }}>Vigencia</th>
                <th style={{ textAlign: 'left' }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {parseo.filas.map((f, i) => {
                const estado = estadoFila(f)
                return (
                  <tr key={i}>
                    <td>{f.concepto === 'basico' ? 'Básico' : 'No rem.'}</td>
                    <td>{f.nombre}</td>
                    <td style={{ textAlign: 'right' }}>{f.valor.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}</td>
                    <td>{f.modalidad ?? '—'}</td>
                    <td>{f.vigenciaDesde}</td>
                    <td>
                      {estado === 'duplicado'
                        ? <span className="badge badge-neutral">ya existe</span>
                        : <span className="badge badge-success">nuevo</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {errorBase && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 8 }}>⚠ {errorBase}</p>}
        {resumen && (
          <p style={{ color: 'var(--brand)', fontSize: '0.85rem', marginBottom: 8 }}>
            {resumen.insertados > 0 ? `Importadas ${resumen.insertados} fila(s) nuevas.` : 'No había filas nuevas para importar.'}
            {resumen.omitidos > 0 && ` Omitidas ${resumen.omitidos} duplicada(s).`} Podés recargar la pestaña Escalas para verlas.
          </p>
        )}

        {parseo && parseo.filas.length > 0 && !sinConvenio && !resumen && (
          <div className="acciones">
            <button className="btn btn-primary btn-sm" onClick={confirmar} disabled={importando}>
              {importando ? 'Importando…' : `Importar ${parseo.filas.length} fila(s)`}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setTexto(''); setParseo(null); setResumen(null); setNombreArchivo('') }}>
              Limpiar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}