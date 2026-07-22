import { useEffect, useState } from 'react'
import { useConceptosStore } from '../../store/conceptosStore'
import { useEscalasStore, agruparVigencias } from '../../store/escalasStore'
import FormularioConcepto from './FormularioConcepto'

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

export default function TabAdicionales({ convenio, empresaId, soloLectura }) {
  const { conceptos, cargarConceptos, guardarConcepto } = useConceptosStore()
  const { categorias, cargarEscala } = useEscalasStore()
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoTipo, setNuevoTipo] = useState('remunerativo')
  const [creando, setCreando] = useState(false)

  useEffect(() => { if (empresaId) cargarConceptos(empresaId) }, [empresaId])
  useEffect(() => { if (convenio?.id) cargarEscala(convenio.id) }, [convenio?.id])

  const hoy = new Date().toISOString().slice(0, 10)
  const nombresCategorias = agruparVigencias(categorias, hoy).map((g) => g.nombre)
  const delConvenio = conceptos.filter((c) => c.convenioId === convenio?.id)
  const adicionales = delConvenio.filter((c) => (c.tipo === 'remunerativo' || c.tipo === 'no_remunerativo') && c.config)

  const crear = async ({ config, formula, categorias: cats, codigoRecibo }) => {
    const orden = Math.max(0, ...delConvenio.map((c) => c.orden)) + 1
    const r = await guardarConcepto({
      convenioId: convenio.id, codigo: slug(nuevoNombre), nombre: nuevoNombre.trim(),
      tipo: nuevoTipo, formula, orden, imprimible: true, config, categorias: cats, codigoRecibo,
    }, empresaId)
    if (r.ok) { setNuevoNombre(''); setCreando(false) }
    return r
  }

  return (
    <div>
      {adicionales.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: '1rem' }}>
          <h3>{c.nombre} <span className="badge badge-neutral">{c.tipo}</span>
            {c.categorias?.length > 0 && <span className="badge badge-neutral">{c.categorias.join(', ')}</span>}</h3>
          <p style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.formula}</p>
          {!soloLectura && (
            <FormularioConcepto concepto={c} categorias={nombresCategorias} conMonto
              onGuardar={({ config, formula, categorias: cats, codigoRecibo }) =>
                guardarConcepto({ ...c, config, formula, categorias: cats, codigoRecibo }, empresaId)} />
          )}
        </div>
      ))}
      {adicionales.length === 0 && <div className="card" style={{ marginBottom: '1rem' }}>Todavía no hay adicionales para este convenio.</div>}

      {!soloLectura && !creando && (
        <button className="btn btn-primary btn-sm" onClick={() => setCreando(true)}>Nuevo adicional</button>
      )}
      {!soloLectura && creando && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input className="input" placeholder="nombre (ej: Adicional por título)" value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)} />
            <select className="input" style={{ width: 200 }} value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value)}>
              <option value="remunerativo">Remunerativo</option>
              <option value="no_remunerativo">No remunerativo</option>
            </select>
          </div>
          {nuevoNombre.trim()
            ? <FormularioConcepto concepto={null} categorias={nombresCategorias} conMonto onGuardar={crear} />
            : <p style={{ color: 'var(--text-secondary)' }}>Poné un nombre para continuar.</p>}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setCreando(false)}>Cancelar</button>
        </div>
      )}
    </div>
  )
}
