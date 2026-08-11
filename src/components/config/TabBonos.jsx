import { useEffect, useState } from 'react'
import { useBonosStore } from '../../store/bonosStore'
import { useAuthStore } from '../../store/authStore'
import { supabase } from '../../lib/supabase'

// Gestión de bonos especiales (plan convenios-por-obra 2026-08-07):
// el catálogo global lo define superadmin (nom_bonos); cada empresa aplica
// un bono a una obra (o a toda la empresa) con su propio monto
// (nom_bono_aplicaciones), y puede excepcionar personas puntuales
// (nom_bono_excepciones: monto propio, o desactivado con monto null).
export default function TabBonos({ empresaId }) {
  const rol = useAuthStore((s) => s.rol)
  const esSuperadmin = rol === 'superadmin'
  const {
    bonos, aplicaciones, excepciones, cargando, error,
    cargarBonos, crearBonoGlobal, aplicarBono, eliminarAplicacion, setExcepcion, eliminarExcepcion,
  } = useBonosStore()

  const [obras, setObras] = useState([])
  const [personal, setPersonal] = useState([])
  const [busquedaPersonal, setBusquedaPersonal] = useState('')
  useEffect(() => { if (empresaId) cargarBonos(empresaId) }, [empresaId])
  useEffect(() => {
    if (!empresaId) return
    supabase.from('nom_v_obras').select('id, nombre').eq('empresa_id', empresaId).order('nombre')
      .then(({ data }) => setObras(data || []))
    supabase.from('nom_v_personal').select('id, nombre').eq('empresa_id', empresaId)
      .order('nombre')
      .then(({ data }) => setPersonal(data || []))
  }, [empresaId])

  // Alta global (superadmin)
  const [nuevoBono, setNuevoBono] = useState({ nombre: '', montoBase: '', descripcion: '' })
  const [errorAlta, setErrorAlta] = useState(null)
  const handleCrearBono = async () => {
    setErrorAlta(null)
    const r = await crearBonoGlobal(nuevoBono.nombre.trim(), Number(nuevoBono.montoBase) || 0, nuevoBono.descripcion.trim() || null)
    if (!r.ok) { setErrorAlta(r.error); return }
    setNuevoBono({ nombre: '', montoBase: '', descripcion: '' })
  }

  // Aplicar bono a la empresa/obra
  const [aplicacion, setAplicacion] = useState({ bonoId: '', obraId: '', monto: '', tipoMonto: 'fijo' })
  const [errorAplicar, setErrorAplicar] = useState(null)
  const handleAplicar = async () => {
    setErrorAplicar(null)
    if (!aplicacion.bonoId || aplicacion.monto === '') { setErrorAplicar('Elegí un bono y un monto.'); return }
    const r = await aplicarBono({
      empresaId, obraId: aplicacion.obraId || null, bonoId: aplicacion.bonoId,
      monto: Number(aplicacion.monto), tipoMonto: aplicacion.tipoMonto,
    })
    if (!r.ok) { setErrorAplicar(r.error); return }
    setAplicacion({ bonoId: '', obraId: '', monto: '', tipoMonto: 'fijo' })
  }

  // Excepción por persona
  const [excepcion, setExcepcionForm] = useState({ bonoId: '', personalId: '', monto: '', desactivar: false })
  const [errorExcepcion, setErrorExcepcion] = useState(null)
  const handleExcepcion = async () => {
    setErrorExcepcion(null)
    if (!excepcion.bonoId) { setErrorExcepcion('Elegí un bono.'); return }
    if (!excepcion.personalId.trim()) {
      setErrorExcepcion('Elegí a la persona por nombre (desde la lista) — hace falta el match exacto.')
      return
    }
    if (!excepcion.desactivar && excepcion.monto === '') {
      setErrorExcepcion('Completá el monto para la persona (o marcá "Desactivar bono").')
      return
    }
    const r = await setExcepcion({
      empresaId, personalId: excepcion.personalId.trim(), bonoId: excepcion.bonoId,
      monto: excepcion.desactivar ? null : Number(excepcion.monto) || 0,
    })
    if (!r.ok) { setErrorExcepcion(r.error); return }
    setExcepcionForm({ bonoId: '', personalId: '', monto: '', desactivar: false })
    setBusquedaPersonal('')
  }

  const personalFiltrado = personal.filter((p) =>
    p.nombre.toLowerCase().includes(busquedaPersonal.toLowerCase())
  ).slice(0, 50)

  const nombreBono = (id) => bonos.find((b) => b.id === id)?.nombre ?? id
  const nombreObra = (id) => (id ? (obras.find((o) => o.id === id)?.nombre ?? id) : 'Toda la empresa')

  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  return (
    <div className="pila max-900">
      {esSuperadmin && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); handleCrearBono() }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Configuración de bono especial (superadmin)</h3>
          <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
            Definís el catálogo de bonos especiales; cada empresa decide dónde se aplica (por obra o
            toda la empresa) y qué monto paga. Suma a bruto/neto y a Excel, pero NO se imprime en el
            recibo ni integra base de aportes.
          </p>
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <div className="input-group">
              <label className="input-label" htmlFor="bono-nombre">Nombre</label>
              <input id="bono-nombre" className="input" value={nuevoBono.nombre}
                onChange={(e) => setNuevoBono((f) => ({ ...f, nombre: e.target.value }))} />
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="bono-monto-base">Monto base (referencia)</label>
              <input id="bono-monto-base" className="input" type="number" min="0" value={nuevoBono.montoBase}
                onChange={(e) => setNuevoBono((f) => ({ ...f, montoBase: e.target.value }))} />
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="bono-desc">Descripción</label>
              <input id="bono-desc" className="input" value={nuevoBono.descripcion}
                onChange={(e) => setNuevoBono((f) => ({ ...f, descripcion: e.target.value }))} />
            </div>
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!nuevoBono.nombre.trim()}>Crear bono</button>
          {errorAlta && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorAlta}</p>}
        </form>
      )}

      <form className="card" onSubmit={(e) => { e.preventDefault(); handleAplicar() }}>
        <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Aplicar bono</h3>
        <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
          Bono especial definido por empresa: elegí un bono del catálogo, una obra (o toda la
          empresa) y el monto que se paga — fijo por período o por hora trabajada.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
          <div className="input-group">
            <label className="input-label" htmlFor="ap-bono">Bono</label>
            <select id="ap-bono" className="input" value={aplicacion.bonoId}
              onChange={(e) => setAplicacion((f) => ({ ...f, bonoId: e.target.value }))}>
              <option value="">Elegí un bono…</option>
              {bonos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="ap-obra">Obra</label>
            <select id="ap-obra" className="input" value={aplicacion.obraId}
              onChange={(e) => setAplicacion((f) => ({ ...f, obraId: e.target.value }))}>
              <option value="">Toda la empresa</option>
              {obras.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="ap-monto">Monto</label>
            <input id="ap-monto" className="input" type="number" min="0" value={aplicacion.monto}
              onChange={(e) => setAplicacion((f) => ({ ...f, monto: e.target.value }))} />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="ap-tipo-monto">Tipo de monto</label>
            <select id="ap-tipo-monto" className="input" value={aplicacion.tipoMonto}
              onChange={(e) => setAplicacion((f) => ({ ...f, tipoMonto: e.target.value }))}>
              <option value="fijo">Fijo (monto por período)</option>
              <option value="por_horas">Por hora trabajada</option>
            </select>
          </div>
        </div>
        <button type="submit" className="btn btn-primary btn-sm">Aplicar</button>
        {errorAplicar && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorAplicar}</p>}

        {aplicaciones.length > 0 && (
          <table className="table" style={{ marginTop: 16 }}>
            <thead><tr><th>Bono</th><th>Obra</th><th>Monto</th><th>Tipo</th><th /></tr></thead>
            <tbody>
              {aplicaciones.map((a) => (
                <tr key={a.id}>
                  <td>{nombreBono(a.bonoId)}</td>
                  <td>{nombreObra(a.obraId)}</td>
                  <td>${a.monto.toLocaleString('es-AR')}</td>
                  <td>{a.tipoMonto === 'por_horas' ? 'por hora' : 'fijo'}</td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => eliminarAplicacion(a.id)}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </form>

      <form className="card" onSubmit={(e) => { e.preventDefault(); handleExcepcion() }}>
        <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Excepción por persona</h3>
        <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
          Un monto distinto para esta persona, o desactivar el bono para ella.
        </p>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <div className="input-group">
            <label className="input-label" htmlFor="ex-bono">Bono</label>
            <select id="ex-bono" className="input" value={excepcion.bonoId}
              onChange={(e) => setExcepcionForm((f) => ({ ...f, bonoId: e.target.value }))}>
              <option value="">Elegí un bono…</option>
              {bonos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </select>
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="ex-persona">Persona</label>
            <input
              id="ex-persona"
              className="input"
              placeholder="Buscá por nombre…"
              value={excepcion.desactivar || busquedaPersonal ? busquedaPersonal : (personal.find((p) => p.id === excepcion.personalId)?.nombre ?? busquedaPersonal)}
              onChange={(e) => {
                const q = e.target.value
                setBusquedaPersonal(q)
                const match = personal.find((p) => p.nombre.toLowerCase() === q.toLowerCase())
                setExcepcionForm((f) => ({ ...f, personalId: match?.id ?? '' }))
              }}
              list="lista-personal-bonos"
              autoComplete="off"
            />
            <datalist id="lista-personal-bonos">
              {personalFiltrado.map((p) => <option key={p.id} value={p.nombre}>{p.id}</option>)}
            </datalist>
            {excepcion.personalId && (
              <span className="texto-muted" style={{ fontSize: '0.8rem' }}>
                ID: {excepcion.personalId}
              </span>
            )}
          </div>
          <div className="input-group">
            <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={excepcion.desactivar}
                onChange={(e) => setExcepcionForm((f) => ({ ...f, desactivar: e.target.checked }))} />
              Desactivar bono para esta persona
            </label>
          </div>
          {!excepcion.desactivar && (
            <div className="input-group">
              <label className="input-label" htmlFor="ex-monto">Monto</label>
              <input id="ex-monto" className="input" type="number" min="0" value={excepcion.monto}
                onChange={(e) => setExcepcionForm((f) => ({ ...f, monto: e.target.value }))} />
            </div>
          )}
        </div>
        <button type="submit" className="btn btn-primary btn-sm">Guardar excepción</button>
        {errorExcepcion && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorExcepcion}</p>}

        {excepciones.length > 0 && (
          <table className="table" style={{ marginTop: 16 }}>
            <thead><tr><th>Bono</th><th>Persona</th><th>Monto</th><th /></tr></thead>
            <tbody>
              {excepciones.map((e) => (
                <tr key={e.id}>
                  <td>{nombreBono(e.bonoId)}</td>
                  <td>{e.personalNombre ?? personal.find((p) => p.id === e.personalId)?.nombre ?? e.personalId}</td>
                  <td>{e.monto === null ? 'Desactivado' : `$${e.monto.toLocaleString('es-AR')}`}</td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => eliminarExcepcion(e.id)}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </form>
    </div>
  )
}
