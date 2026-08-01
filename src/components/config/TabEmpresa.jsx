import { useEffect, useRef, useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'
import { useEmpresaConfigStore } from '../../store/empresaConfigStore'

export default function TabEmpresa({ empresaId }) {
  const {
    cuit, domicilio, nombre, logoUrl, logoPropio, subiendoLogo,
    cargando, error, cargar, guardar, subirLogo, quitarLogo,
  } = useEmpresaConfigStore()
  const [form, setForm] = useState({ cuit: '', domicilio: '' })
  const [errorGuardado, setErrorGuardado] = useState(null)
  const [errorLogo, setErrorLogo] = useState(null)
  const [guardado, setGuardado] = useState(false)
  const inputArchivo = useRef(null)

  useEffect(() => { if (empresaId) cargar(empresaId) }, [empresaId])
  useEffect(() => { setForm({ cuit, domicilio }) }, [cuit, domicilio])

  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const handleGuardar = async () => {
    const r = await guardar(empresaId, { cuit: form.cuit.trim(), domicilio: form.domicilio.trim() })
    setErrorGuardado(r.ok ? null : r.error)
    if (r.ok) { setGuardado(true); setTimeout(() => setGuardado(false), 2500) }
  }

  const handleArchivo = async (e) => {
    const archivo = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    if (!archivo) return
    setErrorLogo(null)
    const r = await subirLogo(empresaId, archivo)
    if (!r.ok) setErrorLogo(r.error)
  }

  const handleQuitar = async () => {
    setErrorLogo(null)
    const r = await quitarLogo(empresaId)
    if (!r.ok) setErrorLogo(r.error)
  }

  return (
    <div className="pila max-900">
      <div className="card">
        <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Logo del recibo</h3>
        <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
          Se imprime en el encabezado del recibo de sueldo. PNG, JPG o WebP de hasta 2 MB;
          idealmente con fondo transparente y apaisado.
        </p>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="logo-preview">
            {logoUrl
              ? <img src={logoUrl} alt={`Logo de ${nombre}`} />
              : <span>Sin logo</span>}
          </div>

          <div className="acciones">
            <input
              ref={inputArchivo}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleArchivo}
              style={{ display: 'none' }}
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => inputArchivo.current?.click()}
              disabled={subiendoLogo}
            >
              <Upload size={14} /> {subiendoLogo ? 'Subiendo…' : logoUrl ? 'Cambiar logo' : 'Subir logo'}
            </button>
            {logoPropio && (
              <button className="btn btn-ghost btn-sm" onClick={handleQuitar} disabled={subiendoLogo}>
                <Trash2 size={14} /> Quitar
              </button>
            )}
          </div>
        </div>

        {!logoPropio && logoUrl && (
          <p className="texto-muted" style={{ fontSize: '0.8rem', marginTop: 10 }}>
            Se está usando el logo cargado en Presencio. Si subís uno acá, ese pasa a usarse en los recibos.
          </p>
        )}
        {errorLogo && <p style={{ color: 'var(--danger)', marginTop: 10, fontSize: '0.85rem' }}>{errorLogo}</p>}
      </div>

      <div className="card">
        <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Datos fiscales</h3>
        <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
          {nombre} — aparecen en la cabecera del recibo.
        </p>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="input-group">
            <label className="input-label" htmlFor="emp-cuit">CUIT</label>
            <input id="emp-cuit" className="input" placeholder="30-99999999-9" value={form.cuit}
              onChange={(e) => setForm((f) => ({ ...f, cuit: e.target.value }))} />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="emp-domicilio">Domicilio</label>
            <input id="emp-domicilio" className="input" placeholder="Av. Siempreviva 742 (1080) — CABA" value={form.domicilio}
              onChange={(e) => setForm((f) => ({ ...f, domicilio: e.target.value }))} />
          </div>
        </div>
        <div className="acciones">
          <button className="btn btn-primary btn-sm" onClick={handleGuardar}>Guardar</button>
          {guardado && <span className="badge badge-success">guardado</span>}
        </div>
        {errorGuardado && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorGuardado}</p>}
      </div>
    </div>
  )
}
