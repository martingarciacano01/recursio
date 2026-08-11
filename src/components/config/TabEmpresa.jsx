import { useEffect, useRef, useState } from 'react'
import { Upload, Trash2 } from 'lucide-react'
import { useEmpresaConfigStore } from '../../store/empresaConfigStore'
import { useFirmaStore } from '../../store/firmaStore'
import { useAuthStore } from '../../store/authStore'
import { puede } from '../../utils/permisos'
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kickoff intencional del fetch inicial de config de horas.
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
  // mapa obraId -> { tope_horas_diarias, jornada_horas } (cargado para TODAS
  // las obras de una, como mapa en vez de a pedido por obra — ver Item 3).
  const [cfgPorObra, setCfgPorObra] = useState({})
  const [cargandoObras, setCargandoObras] = useState(true)
  const [errorObras, setErrorObras] = useState(null)

  useEffect(() => {
    if (!empresaId) return
    let activo = true
    Promise.all([
      supabase.from('nom_v_obras').select('id, nombre').eq('empresa_id', empresaId).order('nombre'),
      supabase.from('nom_config_obras').select('obra_id, tope_horas_diarias, jornada_horas').eq('empresa_id', empresaId),
    ]).then(([{ data: obras, error: errObra }, { data: cfgs, error: errCfg }]) => {
      if (!activo) return
      const err = errObra || errCfg
      if (err) { setErrorObras(err.message); setCargandoObras(false); return }
      setObras(obras || [])
      setCfgPorObra(Object.fromEntries((cfgs || []).map((c) => [c.obra_id, {
        tope_horas_diarias: c.tope_horas_diarias ?? '',
        jornada_horas: c.jornada_horas ?? 8,
      }])))
      setCargandoObras(false)
    })
    return () => { activo = false }
  }, [empresaId])

  const setCfgLocal = (obraId, valores) => {
    setCfgPorObra((prev) => ({ ...prev, [obraId]: valores }))
  }

  const guardarConfigObra = async (obraId, valores) => {
    const { error: err } = await supabase.from('nom_config_obras').upsert({
      empresa_id: empresaId,
      obra_id: obraId,
      tope_horas_diarias: valores.tope_horas_diarias === '' ? null : Number(valores.tope_horas_diarias),
      jornada_horas: Number(valores.jornada_horas) || 8,
    })
    if (err) return { ok: false, error: err.message }
    setCfgLocal(obraId, valores)
    return { ok: true }
  }

  return { obras, cfgPorObra, setCfgLocal, cargandoObras, errorObras, guardarConfigObra }
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
  const { obras, cfgPorObra, setCfgLocal, errorObras, guardarConfigObra } = useConfigObras(empresaId)
  const [guardadoObraId, setGuardadoObraId] = useState(null)
  const [errorGuardadoObra, setErrorGuardadoObra] = useState(null)
  const {
    firmaUrl, nombreCompleto, puesto, cargando: cargandoFirma, subiendoFirma, error: errorFirma,
    cargarFirma, subirFirma,
  } = useFirmaStore()
  const [formFirma, setFormFirma] = useState({ nombreCompleto: '', puesto: '' })
  const [errorGuardadoFirma, setErrorGuardadoFirma] = useState(null)
  const [guardadoFirma, setGuardadoFirma] = useState(false)
  const inputFirma = useRef(null)
  const rol = useAuthStore((s) => s.rol)
  const rolesNomina = useAuthStore((s) => s.rolesNomina)
  const puedeCargarFirma = rol === 'superadmin' || puede(rolesNomina, 'aprobar_pago')

  useEffect(() => { if (empresaId) cargar(empresaId) }, [empresaId])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resync intencional del form local cuando llegan los datos de la empresa.
  useEffect(() => { setForm({ cuit, domicilio }) }, [cuit, domicilio])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resync intencional del form local cuando llega la config de horas.
  useEffect(() => { setFormHoras(cfgHoras) }, [cfgHoras])
  useEffect(() => {
    if (empresaId && puedeCargarFirma && !cargandoFirma) cargarFirma(empresaId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kickoff intencional del fetch de firma al montar.
  }, [empresaId])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- resync intencional del form local cuando llega la firma.
  useEffect(() => { setFormFirma({ nombreCompleto, puesto }) }, [nombreCompleto, puesto])

  const handleGuardarObra = async (obraId) => {
    const valores = cfgPorObra[obraId]
    if (!valores) return
    const r = await guardarConfigObra(obraId, valores)
    setErrorGuardadoObra(r.ok ? null : r.error)
    if (r.ok) { setGuardadoObraId(obraId); setTimeout(() => setGuardadoObraId(null), 2500) }
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

  const handleArchivoFirma = async (e) => {
    const archivo = e.target.files?.[0]
    e.target.value = '' // permite volver a elegir el mismo archivo
    if (!archivo) return
    setErrorGuardadoFirma(null)
    const r = await subirFirma({
      empresaId, file: archivo,
      nombreCompleto: formFirma.nombreCompleto,
      puesto: formFirma.puesto,
    })
    if (!r.ok) setErrorGuardadoFirma(r.error)
  }

  const handleGuardarFirma = async () => {
    setErrorGuardadoFirma(null)
    if (!firmaUrl && !inputFirma.current?.files?.length) {
      setErrorGuardadoFirma('Elegí una imagen de la firma y completá nombre y puesto.')
      return
    }
    // Si ya hay archivo elegido, subirFirma usa el form; si no, solo faltaría
    // actualizar la aclaración sobre una firma ya cargada.
    if (!inputFirma.current?.files?.length) {
      const { error } = await supabase.from('nom_firma_empresa')
        .upsert({ empresa_id: empresaId, nombre_completo: formFirma.nombreCompleto.trim(), puesto: formFirma.puesto.trim() }, { onConflict: 'empresa_id' })
      if (error) { setErrorGuardadoFirma(error.message); return }
      setGuardadoFirma(true); setTimeout(() => setGuardadoFirma(false), 2500)
      return
    }
    const r = await subirFirma({
      empresaId, file: inputFirma.current.files[0],
      nombreCompleto: formFirma.nombreCompleto,
      puesto: formFirma.puesto,
    })
    if (r.ok) { setGuardadoFirma(true); setTimeout(() => setGuardadoFirma(false), 2500) }
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
        <form className="card" onSubmit={(e) => e.preventDefault()}>
          <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Horas por obra</h3>
          <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
            Tope de horas diarias y jornada de cada obra. Sin configurar una obra, se usa la de
            "Horas extra y jornada" de arriba.
          </p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr><th>Obra</th><th style={{ width: 130 }}>Jornada (horas/día)</th><th style={{ width: 150 }}>Tope diario</th><th style={{ width: 110 }} /></tr>
              </thead>
              <tbody>
                {obras.map((o) => {
                  const cfg = cfgPorObra[o.id] ?? DEFAULT_CFG_OBRA
                  return (
                    <tr key={o.id}>
                      <td>{o.nombre}</td>
                      <td>
                        <input
                          className="input input-sm"
                          type="number" min="1" step="0.5"
                          aria-label={`Jornada de ${o.nombre}`}
                          value={cfg.jornada_horas}
                          onChange={(e) => setCfgLocal(o.id, { ...cfg, jornada_horas: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input input-sm"
                          type="number" min="0" step="0.5" placeholder="Sin tope"
                          aria-label={`Tope diario de ${o.nombre}`}
                          value={cfg.tope_horas_diarias}
                          onChange={(e) => setCfgLocal(o.id, { ...cfg, tope_horas_diarias: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          type="button" className="btn btn-primary btn-sm"
                          onClick={() => handleGuardarObra(o.id)}
                        >
                          {guardadoObraId === o.id ? 'Guardado' : 'Guardar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {errorGuardadoObra && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorGuardadoObra}</p>}
          {errorObras && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorObras}</p>}
        </form>
      )}

      {puedeCargarFirma && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); handleGuardarFirma() }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Firma del aprobador de pago</h3>
          <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
            Se imprime en el recibo "para el Empleado", que se habilita cuando el período está aprobado.
            PNG o JPG de hasta 2 MB, idealmente con fondo transparente.
          </p>

          {cargandoFirma ? (
            <p className="texto-muted">Cargando…</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                <div className="logo-preview" style={{ minHeight: 48 }}>
                  {firmaUrl
                    ? <img src={firmaUrl} alt="Firma del aprobador" style={{ maxHeight: 48 }} />
                    : <span>Sin firma</span>}
                </div>
                <div className="acciones">
                  <input
                    ref={inputFirma}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={handleArchivoFirma}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => inputFirma.current?.click()}
                    disabled={subiendoFirma}
                  >
                    <Upload size={14} /> {subiendoFirma ? 'Subiendo…' : firmaUrl ? 'Cambiar firma' : 'Subir firma'}
                  </button>
                </div>
              </div>

              <div className="form-grid" style={{ marginBottom: 14 }}>
                <div className="input-group">
                  <label className="input-label" htmlFor="emp-firma-nombre">Nombre y Apellido</label>
                  <input id="emp-firma-nombre" className="input" placeholder="María López" value={formFirma.nombreCompleto}
                    onChange={(e) => setFormFirma((f) => ({ ...f, nombreCompleto: e.target.value }))} />
                </div>
                <div className="input-group">
                  <label className="input-label" htmlFor="emp-firma-puesto">Puesto en la compañía</label>
                  <input id="emp-firma-puesto" className="input" placeholder="Contadora" value={formFirma.puesto}
                    onChange={(e) => setFormFirma((f) => ({ ...f, puesto: e.target.value }))} />
                </div>
              </div>

              <div className="acciones">
                <button type="submit" className="btn btn-primary btn-sm" disabled={subiendoFirma}>Guardar firma</button>
                {guardadoFirma && <span className="badge badge-success">guardado</span>}
              </div>
              {errorGuardadoFirma && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorGuardadoFirma}</p>}
              {errorFirma && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorFirma}</p>}
            </>
          )}
        </form>
      )}
    </div>
  )
}
