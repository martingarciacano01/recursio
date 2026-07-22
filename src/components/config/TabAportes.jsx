import { useEffect, useState } from 'react'
import { useConceptosStore } from '../../store/conceptosStore'
import EditorReglas from './EditorReglas'
import FormularioConcepto from './FormularioConcepto'

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

export default function TabAportes({ convenio, empresaId, soloLectura }) {
  const { conceptos, cargando, error, cargarConceptos, guardarConcepto } = useConceptosStore()
  const [errorGuardado, setErrorGuardado] = useState(null)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoTipo, setNuevoTipo] = useState('descuento')
  const [creando, setCreando] = useState(false)

  useEffect(() => { if (empresaId) cargarConceptos(empresaId) }, [empresaId])

  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const delConvenio = conceptos.filter((c) => c.convenioId === convenio?.id)
  const lista = delConvenio.filter((c) => c.tipo === 'descuento' || c.tipo === 'aporte_patronal')

  const crear = async ({ config, formula, codigoRecibo }) => {
    const orden = Math.max(0, ...delConvenio.map((c) => c.orden)) + 1
    const r = await guardarConcepto({
      convenioId: convenio.id, codigo: slug(nuevoNombre), nombre: nuevoNombre.trim(),
      tipo: nuevoTipo, formula, orden, imprimible: true, config, codigoRecibo,
    }, empresaId)
    if (r.ok) { setNuevoNombre(''); setCreando(false) } else { setErrorGuardado(r.error) }
    return r
  }

  return (
    <div>
      {errorGuardado && <div className="card" style={{ color: 'var(--danger)' }}>Error al guardar: {errorGuardado}</div>}
      {lista.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: '1rem' }}>
          <h3>{c.orden}. {c.nombre} <span className="badge badge-neutral">{c.tipo === 'descuento' ? 'aporte del trabajador' : 'contribución patronal'}</span></h3>
          <p style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.formula}</p>
          {!soloLectura && (
            <FormularioConcepto concepto={c} categorias={null} conMonto={false}
              onGuardar={async ({ config, formula, codigoRecibo }) => {
                const r = await guardarConcepto({ ...c, config, formula, codigoRecibo }, empresaId)
                setErrorGuardado(r.ok ? null : r.error)
                return r
              }} />
          )}
          {!soloLectura && (
            <EditorReglas reglas={c.reglas} onChange={async (reglas) => {
              const r = await guardarConcepto({ ...c, reglas }, empresaId)
              setErrorGuardado(r?.ok === false ? r.error : null)
            }} />
          )}
        </div>
      ))}
      {lista.length === 0 && <div className="card" style={{ marginBottom: '1rem' }}>Todavía no hay aportes ni contribuciones para este convenio.</div>}

      {!soloLectura && !creando && (
        <button className="btn btn-primary btn-sm" onClick={() => setCreando(true)}>Nuevo aporte o contribución</button>
      )}
      {!soloLectura && creando && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input className="input" placeholder="nombre (ej: Jubilación)" value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)} />
            <select className="input" style={{ width: 220 }} value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value)}>
              <option value="descuento">Aporte del trabajador</option>
              <option value="aporte_patronal">Contribución patronal</option>
            </select>
          </div>
          {nuevoNombre.trim()
            ? <FormularioConcepto concepto={null} categorias={null} conMonto={false} onGuardar={crear} />
            : <p style={{ color: 'var(--text-secondary)' }}>Poné un nombre para continuar.</p>}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setCreando(false)}>Cancelar</button>
        </div>
      )}
    </div>
  )
}
