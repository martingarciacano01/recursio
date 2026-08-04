import { useEffect, useState } from 'react'
import { useFlujosStore, ROLES_PASO } from '../../store/flujosStore'

// Flujo default piloto (Recursio_Plan_Ejecucion_Sonnet5.md, Task 22):
// generación → revisión interna → aprobación dueño → pago.
const PASOS_DEFAULT = [
  { nombre: 'Revisión interna', rolRequerido: 'revisor_interno', esMasivo: true },
  { nombre: 'Aprobación del dueño', rolRequerido: 'admin', esMasivo: true },
  { nombre: 'Pago', rolRequerido: 'aprobador_pagos', esMasivo: true },
]

export default function TabFlujo({ empresaId }) {
  const { flujos, pasos, cargando, error, cargarFlujos, crearFlujo, guardarPasos } = useFlujosStore()
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [errorGuardado, setErrorGuardado] = useState(null)
  const [filasPorFlujo, setFilasPorFlujo] = useState({})

  useEffect(() => { if (empresaId) cargarFlujos(empresaId) }, [empresaId])

  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  // _key estable por fila (Task 3.4, M4): usa el id real del paso si ya
  // existe en la base, o uno generado client-side para filas nuevas —
  // sin esto React reusaba el mismo nodo DOM al reordenar/quitar filas
  // por índice, pisando el foco/valor del input equivocado a mitad de edición.
  const filasDe = (flujoId) => filasPorFlujo[flujoId] ?? pasos.filter((p) => p.flujoId === flujoId)
    .map((p) => ({ _key: p.id, nombre: p.nombre, rolRequerido: p.rolRequerido, esMasivo: p.esMasivo }))

  const setFilas = (flujoId, filas) => setFilasPorFlujo((s) => ({ ...s, [flujoId]: filas }))

  const nuevaKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `tmp-${Date.now()}-${Math.random()}`)

  const agregarPaso = (flujoId) => {
    setFilas(flujoId, [...filasDe(flujoId), { _key: nuevaKey(), nombre: '', rolRequerido: 'revisor_interno', esMasivo: true }])
  }

  const usarDefault = (flujoId) => setFilas(flujoId, PASOS_DEFAULT.map((p) => ({ ...p, _key: nuevaKey() })))

  const guardar = async (flujoId) => {
    const filas = filasDe(flujoId).filter((f) => f.nombre.trim())
    const r = await guardarPasos(flujoId, filas, empresaId)
    setErrorGuardado(r.ok ? null : r.error)
    if (r.ok) setFilasPorFlujo((s) => { const n = { ...s }; delete n[flujoId]; return n })
  }

  const crear = async () => {
    if (!nombreNuevo.trim()) return
    const r = await crearFlujo(nombreNuevo.trim(), empresaId)
    if (r.ok) setNombreNuevo(''); else setErrorGuardado(r.error)
  }

  return (
    <div>
      <p style={{ color: 'var(--text-secondary)' }}>
        Definí el circuito de aprobación por el que pasa cada período antes de pagarse. Cada paso requiere un rol
        (revisor interno, revisor externo, aprobador de pagos o dueño/admin) y puede ser masivo (aprueba todo el
        lote de una vez) o individual.
      </p>
      {errorGuardado && <div className="card" style={{ color: 'var(--danger)' }}>Error: {errorGuardado}</div>}

      {flujos.map((f) => {
        const filas = filasDe(f.id)
        return (
          <form key={f.id} className="card" style={{ marginBottom: '1rem' }} onSubmit={(e) => { e.preventDefault(); guardar(f.id) }}>
            <h3>{f.nombre} {!f.activo && <span className="badge badge-neutral">inactivo</span>}</h3>
            {filas.length === 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => usarDefault(f.id)}>Usar flujo piloto (revisión → aprobación → pago)</button>
            )}
            {filas.map((p, i) => (
              <div key={p._key ?? i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span className="badge badge-neutral">{i + 1}</span>
                <input className="input" placeholder="nombre del paso" aria-label={`Nombre del paso ${i + 1}`} style={{ flex: 1 }}
                  value={p.nombre} onChange={(e) => setFilas(f.id, filas.map((x, j) => j === i ? { ...x, nombre: e.target.value } : x))} />
                <select className="input" aria-label={`Rol requerido del paso ${i + 1}`} style={{ width: 220 }} value={p.rolRequerido}
                  onChange={(e) => setFilas(f.id, filas.map((x, j) => j === i ? { ...x, rolRequerido: e.target.value } : x))}>
                  {ROLES_PASO.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={p.esMasivo}
                    onChange={(e) => setFilas(f.id, filas.map((x, j) => j === i ? { ...x, esMasivo: e.target.checked } : x))} />
                  masivo
                </label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilas(f.id, filas.filter((_, j) => j !== i))}>quitar</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => agregarPaso(f.id)}>Agregar paso</button>
              <button type="submit" className="btn btn-primary btn-sm">Guardar pasos</button>
            </div>
          </form>
        )
      })}

      <form className="card" onSubmit={(e) => { e.preventDefault(); crear() }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" placeholder="nombre del flujo (ej: Flujo estándar)" aria-label="Nombre del flujo nuevo" value={nombreNuevo}
            onChange={(e) => setNombreNuevo(e.target.value)} />
          <button type="submit" className="btn btn-primary btn-sm">Nuevo flujo</button>
        </div>
      </form>
    </div>
  )
}
