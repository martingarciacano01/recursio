import { useEffect, useState } from 'react'
import { useBonosStore } from '../../store/bonosStore'
import { useAuthStore } from '../../store/authStore'
import { supabase } from '../../lib/supabase'

// Gestión de bonos no remunerativos (plan convenios-por-obra 2026-08-07):
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
  useEffect(() => { if (empresaId) cargarBonos(empresaId) }, [empresaId])
  useEffect(() => {
    if (!empresaId) return
    supabase.from('nom_v_obras').select('id, nombre').eq('empresa_id', empresaId).order('nombre')
      .then(({ data }) => setObras(data || []))
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
  const [aplicacion, setAplicacion] = useState({ bonoId: '', obraId: '', monto: '' })
  const [errorAplicar, setErrorAplicar] = useState(null)
  const handleAplicar = async () => {
    setErrorAplicar(null)
    if (!aplicacion.bonoId || aplicacion.monto === '') { setErrorAplicar('Elegí un bono y un monto.'); return }
    const r = await aplicarBono({
      empresaId, obraId: aplicacion.obraId || null, bonoId: aplicacion.bonoId, monto: Number(aplicacion.monto),
    })
    if (!r.ok) { setErrorAplicar(r.error); return }
    setAplicacion({ bonoId: '', obraId: '', monto: '' })
  }

  // Excepción por persona
  const [excepcion, setExcepcionForm] = useState({ bonoId: '', personalId: '', monto: '', desactivar: false })
  const [errorExcepcion, setErrorExcepcion] = useState(null)
  const handleExcepcion = async () => {
    setErrorExcepcion(null)
    if (!excepcion.bonoId || !excepcion.personalId.trim()) { setErrorExcepcion('Elegí un bono y una persona.'); return }
    const r = await setExcepcion({
      empresaId, personalId: excepcion.personalId.trim(), bonoId: excepcion.bonoId,
      monto: excepcion.desactivar ? null : Number(excepcion.monto) || 0,
    })
    if (!r.ok) { setErrorExcepcion(r.error); return }
    setExcepcionForm({ bonoId: '', personalId: '', monto: '', desactivar: false })
  }

  const nombreBono = (id) => bonos.find((b) => b.id === id)?.nombre ?? id
  const nombreObra = (id) => (id ? (obras.find((o) => o.id === id)?.nombre ?? id) : 'Toda la empresa')

  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  return (
    <div className="pila max-900">
      {esSuperadmin && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); handleCrearBono() }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Catálogo global de bonos (superadmin)</h3>
          <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
            El bono se paga, suma a bruto/neto y a Excel, pero NO se imprime en el recibo ni integra
            base de aportes. Cada empresa lo aplica por obra o por toda la empresa.
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
          Elegí un bono del catálogo, una obra (o toda la empresa) y el monto que se paga.
        </p>
        <div className="form-grid" style={{ marginBottom: 14 }}>
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
        </div>
        <button type="submit" className="btn btn-primary btn-sm">Aplicar</button>
        {errorAplicar && <p style={{ color: 'var(--danger)', marginTop: 10 }}>{errorAplicar}</p>}

        {aplicaciones.length > 0 && (
          <table className="tabla" style={{ marginTop: 16 }}>
            <thead><tr><th>Bono</th><th>Obra</th><th>Monto</th><th /></tr></thead>
            <tbody>
              {aplicaciones.map((a) => (
                <tr key={a.id}>
                  <td>{nombreBono(a.bonoId)}</td>
                  <td>{nombreObra(a.obraId)}</td>
                  <td>${a.monto.toLocaleString('es-AR')}</td>
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
            <label className="input-label" htmlFor="ex-persona">ID de personal</label>
            <input id="ex-persona" className="input" value={excepcion.personalId}
              onChange={(e) => setExcepcionForm((f) => ({ ...f, personalId: e.target.value }))} />
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
          <table className="tabla" style={{ marginTop: 16 }}>
            <thead><tr><th>Bono</th><th>Persona</th><th>Monto</th><th /></tr></thead>
            <tbody>
              {excepciones.map((e) => (
                <tr key={e.id}>
                  <td>{nombreBono(e.bonoId)}</td>
                  <td>{e.personalId}</td>
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
