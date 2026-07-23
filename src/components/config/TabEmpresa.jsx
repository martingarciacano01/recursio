import { useEffect, useState } from 'react'
import { useEmpresaConfigStore } from '../../store/empresaConfigStore'

export default function TabEmpresa({ empresaId }) {
  const { cuit, domicilio, nombre, logoUrl, cargando, error, cargar, guardar } = useEmpresaConfigStore()
  const [form, setForm] = useState({ cuit: '', domicilio: '' })
  const [errorGuardado, setErrorGuardado] = useState(null)

  useEffect(() => { if (empresaId) cargar(empresaId) }, [empresaId])
  useEffect(() => { setForm({ cuit, domicilio }) }, [cuit, domicilio])

  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const handleGuardar = async () => {
    const r = await guardar(empresaId, { cuit: form.cuit.trim(), domicilio: form.domicilio.trim() })
    setErrorGuardado(r.ok ? null : r.error)
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
        {logoUrl ? (
          <img src={logoUrl} alt={`Logo de ${nombre}`} style={{ width: 80, height: 80, objectFit: 'contain', border: '1px solid var(--border)' }} />
        ) : (
          <div style={{ width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--border)', color: 'var(--text-secondary)', fontSize: 12, textAlign: 'center' }}>
            Sin logo
          </div>
        )}
        <div>
          <p style={{ margin: 0, fontWeight: 'bold' }}>{nombre}</p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>El logo se administra desde Superadmin/Presencio.</p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" placeholder="CUIT" style={{ width: 180 }} value={form.cuit}
          onChange={(e) => setForm((f) => ({ ...f, cuit: e.target.value }))} />
        <input className="input" placeholder="Domicilio" style={{ width: 280 }} value={form.domicilio}
          onChange={(e) => setForm((f) => ({ ...f, domicilio: e.target.value }))} />
        <button className="btn btn-primary btn-sm" onClick={handleGuardar}>Guardar</button>
      </div>
      {errorGuardado && <p style={{ color: 'var(--danger)' }}>{errorGuardado}</p>}
    </div>
  )
}
