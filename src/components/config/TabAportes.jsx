import { useEffect, useState } from 'react'
import { useConceptosStore } from '../../store/conceptosStore'
import EditorReglas from './EditorReglas'
import FormularioConcepto from './FormularioConcepto'

export default function TabAportes({ convenio, empresaId, soloLectura }) {
  const { conceptos, cargando, error, cargarConceptos, guardarConcepto } = useConceptosStore()
  const [errorGuardado, setErrorGuardado] = useState(null)

  useEffect(() => { if (empresaId) cargarConceptos(empresaId) }, [empresaId])

  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const lista = conceptos.filter((c) => c.convenioId === convenio?.id && (c.tipo === 'descuento' || c.tipo === 'aporte_patronal'))

  return (
    <div>
      {errorGuardado && <div className="card" style={{ color: 'var(--danger)' }}>Error al guardar: {errorGuardado}</div>}
      {lista.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: '1rem' }}>
          <h3>{c.orden}. {c.nombre} <span className="badge badge-neutral">{c.tipo === 'descuento' ? 'aporte del trabajador' : 'contribución patronal'}</span></h3>
          <p style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.formula}</p>
          {!soloLectura && (
            <FormularioConcepto concepto={c} categorias={null} conMonto={false}
              onGuardar={async ({ config, formula }) => {
                const r = await guardarConcepto({ ...c, config, formula }, empresaId)
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
      {lista.length === 0 && <div className="card">No hay aportes ni contribuciones para este convenio.</div>}
    </div>
  )
}
