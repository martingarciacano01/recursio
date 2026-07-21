import { useEffect, useState } from 'react'
import { useParametrosStore } from '../../store/parametrosStore'

export default function TabParametros({ empresaId }) {
  const { parametros, cargando, error, cargarParametros, guardarParametro } = useParametrosStore()
  const [form, setForm] = useState({ codigo: 'tope_sipa', valor: '', vigenciaDesde: '', vigenciaHasta: '' })
  const [errorGuardado, setErrorGuardado] = useState(null)

  useEffect(() => { if (empresaId) cargarParametros(empresaId) }, [empresaId])

  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const guardar = async () => {
    if (!form.codigo.trim() || form.valor === '' || !form.vigenciaDesde) {
      setErrorGuardado('Completá código, valor y vigencia desde'); return
    }
    const r = await guardarParametro({
      codigo: form.codigo.trim(), valor: Number(form.valor),
      vigenciaDesde: form.vigenciaDesde, vigenciaHasta: form.vigenciaHasta || null,
    }, empresaId)
    setErrorGuardado(r.ok ? null : r.error)
    if (r.ok) setForm({ codigo: 'tope_sipa', valor: '', vigenciaDesde: '', vigenciaHasta: '' })
  }

  return (
    <div className="card">
      <p style={{ color: 'var(--text-secondary)' }}>
        Valores versionados por vigencia (ej. <code>tope_sipa</code>). Nunca se pisan: se agrega una vigencia nueva.
      </p>
      <table style={{ width: '100%' }}>
        <thead><tr><th style={{ textAlign: 'left' }}>Código</th><th style={{ textAlign: 'right' }}>Valor</th><th>Desde</th><th>Hasta</th></tr></thead>
        <tbody>
          {parametros.map((p) => (
            <tr key={p.id}>
              <td><code>{p.codigo}</code></td>
              <td style={{ textAlign: 'right' }}>$ {p.valor.toLocaleString('es-AR')}</td>
              <td style={{ textAlign: 'center' }}>{p.vigenciaDesde}</td>
              <td style={{ textAlign: 'center' }}>{p.vigenciaHasta ?? '—'}</td>
            </tr>
          ))}
          {parametros.length === 0 && <tr><td colSpan={4}>Sin parámetros cargados.</td></tr>}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input className="input" placeholder="código" style={{ width: 160 }} value={form.codigo}
          onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))} />
        <input className="input" type="number" placeholder="valor" style={{ width: 140 }} value={form.valor}
          onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} />
        <input className="input" type="date" title="vigencia desde" value={form.vigenciaDesde}
          onChange={(e) => setForm((f) => ({ ...f, vigenciaDesde: e.target.value }))} />
        <input className="input" type="date" title="vigencia hasta (opcional)" value={form.vigenciaHasta}
          onChange={(e) => setForm((f) => ({ ...f, vigenciaHasta: e.target.value }))} />
        <button className="btn btn-primary btn-sm" onClick={guardar}>Agregar vigencia</button>
      </div>
      {errorGuardado && <p style={{ color: 'var(--danger)' }}>{errorGuardado}</p>}
    </div>
  )
}
