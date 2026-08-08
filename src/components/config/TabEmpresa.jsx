import { useEffect, useRef, useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'
import { useEmpresaConfigStore } from '../../store/empresaConfigStore'
import { supabase } from '../../lib/supabase'

// Task 2.12: si contabilizar horas extras y con qué tope diario, por
// empresa. Config chica y de bajo tráfico — se lee/guarda directo contra
// nom_config_horas (migración 0050) sin sumar un store nuevo para esto.
const DEFAULT_CFG_HORAS = { contabilizar_horas_extras: true, tope_horas_diarias: '', jornada_horas: 8 }

function useConfigHoras(empresaId) {
  const [cfgHoras, setCfgHoras] = useState(DEFAULT_CFG_HORAS)
  const [cargandoHoras, setCargandoHoras] = useState(true)
  const [errorHoras, setErrorHoras] = useState(null)

  useEffect(() => {
    if (!empresaId) return
    let activo = true
    setCargandoHoras(true)
    supabase.from('nom_config_horas').select('*').eq('empresa_id', empresaId).maybeSingle()
      .then(({ data, error: err }) => {
        if (!activo) return
        if (err) { setErrorHoras(err.message); setCargandoHoras(false); return }
        setCfgHoras(data ? {
          contabilizar_horas_extras: data.contabilizar_horas_extras,
          tope_horas_diarias: data.tope_horas_diarias ?? '',
          jornada_horas: data.jornada_horas ?? 8,
        } : DEFAULT_CFG_HORAS)
        setCargandoHoras(false)
      })
    return () => { activo = false }
  }, [empresaId])

  const guardarHoras = async (valores) => {
    const { error: err } = await supabase.from('nom_config_horas').upsert({
      empresa_id: empresaId,
      contabilizar_horas_extras: valores.contabilizar_horas_extras,
      tope_horas_diarias: valores.tope_horas_diarias === '' ? null : Number(valores.tope_horas_diarias),
      jornada_horas: Number(valores.jornada_horas) || 8,
    })
    if (err) return { ok: false, error: err.message }
    setCfgHoras(valores)
    return { ok: true }
  }

  return { cfgHoras, cargandoHoras, errorHoras, guardarHoras }
}

// Task 4.4 (plan convenios-por-obra 2026-08-07): tope de horas diarias y
// jornada, pero por OBRA (nom_config_obras, migración 0060) en vez de por
// empresa. Mismo patrón que useConfigHoras de arriba, parametrizado por
// obra: se lee/guarda directo contra la tabla, sin store nuevo.
const DEFAULT_CFG_OBRA = { tope_horas_diarias: '', jornada_horas: 8 }

function useConfigObras(empresaId) {
  const [obras, setObras] = useState([])
  const [obraId, setObraId] = useState('')
  const [cfgObra, setCfgObra] = useState(DEFAULT_CFG_OBRA)
  const [cargandoObras, setCargandoObras] = useState(true)
  const [errorObras, setErrorObras] = useState(null)

  useEffect(() => {
    if (!empresaId) return
    let activo = true
    supabase.from('nom_v_obras').select('id, nombre').eq('empresa_id', empresaId).order('nombre')
      .then(({ data, error: err }) => {
        if (!activo) return
        if (err) { setErrorObras(err.message); setCargandoObras(false); return }
        setObras(data || [])
        setCargandoObras(false)
      })
    return () => { activo = false }
  }, [empresaId])

  useEffect(() => {
    if (!empresaId || !obraId) { setCfgObra(DEFAULT_CFG_OBRA); return }
    let activo = true
    supabase.from('nom_config_obras').select('*').eq('empresa_id', empresaId).eq('obra_id', obraId).maybeSingle()
      .then(({ data, error: err }) => {
        if (!activo) return
        if (err) { setErrorObras(err.message); return }
        setCfgObra(data ? {
          tope_horas_diarias: data.tope_horas_diarias ?? '',
          jornada_horas: data.jornada_horas ?? 8,
        } : DEFAULT_CFG_OBRA)
      })
    return () => { activo = false }
  }, [empresaId, obraId])

  const guardarConfigObra = async (valores) => {
    const { error: err } = await supabase.from('nom_config_obras').upsert({
      empresa_id: empresaId,
      obra_id: obraId,
      tope_horas_diarias: valores.tope_horas_diarias === '' ? null : Number(valores.tope_horas_diarias),
      jornada_horas: Number(valores.jornada_horas) || 8,
    })
    if (err) return { ok: false, error: err.message }
    setCfgObra(valores)
    return { ok: true }
  }

  return { obras, obraId, setObraId, cfgObra, cargandoObras, errorObras, guardarConfigObra }
}

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
  const { cfgHoras, cargandoHoras, errorHoras, guardarHoras } = useConfigHoras(empresaId)
  const [formHoras, setFormHoras] = useState(DEFAULT_CFG_HORAS)
  const [guardadoHoras, setGuardadoHoras] = useState(false)
  const [errorGuardadoHoras, setErrorGuardadoHoras] = useState(null)
  const { obras, obraId, setObraId, cfgObra, errorObras, guardarConfigObra } = useConfigObras(empresaId)
  const [formObra, setFormObra] = useState(DEFAULT_CFG_OBRA)
  const [guardadoObra, setGuardadoObra] = useState(false)
  const [errorGuardadoObra, setErrorGuardadoObra] = useState(null)

  useEffect(() => { if (empresaId) cargar(empresaId) }, [empresaId])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resync intencional del form local cuando llegan los datos de la empresa.
  useEffect(() => { setForm({ cuit, domicilio }) }, [cuit, domicilio])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resync intencional del form local cuando llega la config de horas.
  useEffect(() => { setFormHoras(cfgHoras) }, [cfgHoras])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resync intencional del form local cuando llega la config de la obra elegida.
  useEffect(() => { setFormObra(cfgObra) }, [cfgObra])

  const handleGuardarObra = async () => {
    const r = await guardarConfigObra(formObra)
    setErrorGuardadoObra(r.ok ? null : r.error)
    if (r.ok) { setGuardadoObra(true); setTimeout(() => setGuardadoObra(false), 2500) }
  }

  const handleGuardarHoras = async () => {
    const r = await guardarHoras(formHoras)
    setErrorGuardadoHoras(r.ok ? null : r.error)
    if (r.ok) { setGuardadoHoras(true); setTimeout(() => setGuardadoHoras(false), 2500) }
  }

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

      <form className="card" onSubmit={(e) => { e.preventDefault(); handleGuardar() }}>
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
          <button type="submit" className="btn btn-primary btn-sm">Guardar</button>
          {guardado && <span className="badge badge-success">guardado</span>}
        </div>
        {errorGuardado && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorGuardado}</p>}
      </form>

      <form className="card" onSubmit={(e) => { e.preventDefault(); handleGuardarHoras() }}>
        <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Horas extra y jornada</h3>
        <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
          Sin cambios acá, se liquida como siempre: horas extra pagadas, jornada de 8h (4h si es parcial).
        </p>
        {cargandoHoras ? (
          <p className="texto-muted">Cargando…</p>
        ) : (
          <>
            <div className="form-grid" style={{ marginBottom: 14 }}>
              <div className="input-group">
                <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={formHoras.contabilizar_horas_extras}
                    onChange={(e) => setFormHoras((f) => ({ ...f, contabilizar_horas_extras: e.target.checked }))}
                  />
                  Pagar horas extra con recargo
                </label>
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="emp-jornada">Jornada normal (horas/día)</label>
                <input id="emp-jornada" className="input" type="number" min="1" step="0.5" value={formHoras.jornada_horas}
                  onChange={(e) => setFormHoras((f) => ({ ...f, jornada_horas: e.target.value }))} />
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="emp-tope-diario">Tope de horas diarias (opcional)</label>
                <input id="emp-tope-diario" className="input" type="number" min="0" step="0.5" placeholder="Sin tope"
                  value={formHoras.tope_horas_diarias}
                  onChange={(e) => setFormHoras((f) => ({ ...f, tope_horas_diarias: e.target.value }))} />
              </div>
            </div>
            <div className="acciones">
              <button type="submit" className="btn btn-primary btn-sm">Guardar</button>
              {guardadoHoras && <span className="badge badge-success">guardado</span>}
            </div>
            {errorGuardadoHoras && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorGuardadoHoras}</p>}
            {errorHoras && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorHoras}</p>}
          </>
        )}
      </form>

      {obras.length > 0 && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); handleGuardarObra() }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Horas por obra</h3>
          <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
            Tope de horas diarias y jornada específicos de una obra. Sin configurar, se usa la de "Horas extra y jornada" de arriba.
          </p>
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <div className="input-group">
              <label className="input-label" htmlFor="obra-tope-select">Obra</label>
              <select id="obra-tope-select" className="input" value={obraId} onChange={(e) => setObraId(e.target.value)}>
                <option value="">Elegí una obra…</option>
                {obras.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </select>
            </div>
            {obraId && (
              <>
                <div className="input-group">
                  <label className="input-label" htmlFor="obra-jornada">Jornada normal (horas/día)</label>
                  <input id="obra-jornada" className="input" type="number" min="1" step="0.5" value={formObra.jornada_horas}
                    onChange={(e) => setFormObra((f) => ({ ...f, jornada_horas: e.target.value }))} />
                </div>
                <div className="input-group">
                  <label className="input-label" htmlFor="obra-tope-diario">Tope de horas diarias (opcional)</label>
                  <input id="obra-tope-diario" className="input" type="number" min="0" step="0.5" placeholder="Sin tope"
                    value={formObra.tope_horas_diarias}
                    onChange={(e) => setFormObra((f) => ({ ...f, tope_horas_diarias: e.target.value }))} />
                </div>
              </>
            )}
          </div>
          {obraId && (
            <div className="acciones">
              <button type="submit" className="btn btn-primary btn-sm">Guardar</button>
              {guardadoObra && <span className="badge badge-success">guardado</span>}
            </div>
          )}
          {errorGuardadoObra && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorGuardadoObra}</p>}
          {errorObras && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorObras}</p>}
        </form>
      )}
    </div>
  )
}
