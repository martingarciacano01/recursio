import { useState } from 'react'

const fmt = (n) => `$ ${Number(n).toLocaleString('es-AR')}`

// items: salida de agruparVigencias → [{ nombre, vigente, historial }]
// onGuardar(filas, vigenciaDesde) → { ok, error? }
// conModalidad: agrega el selector "Modalidad" (hora/mensual/quincenal) al
// alta de vigencia — solo tiene sentido para escalas de básico, no para
// no remunerativos (que no tienen modalidad de pago).
export default function TablaVigencias({ items, etiquetaValor, soloLectura, onGuardar, conModalidad = false, mensajeVacio = '' }) {
  const [abierto, setAbierto] = useState(false)
  const [valores, setValores] = useState({})       // nombre -> monto tipeado
  const [modalidades, setModalidades] = useState({}) // nombre -> modalidad elegida
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [vigenciaDesde, setVigenciaDesde] = useState('')
  const [expandido, setExpandido] = useState(null) // nombre con historial visible
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(false)

  const nombres = [...items.map((i) => i.nombre), ...(nuevoNombre.trim() ? [nuevoNombre.trim()] : [])]

  const guardar = async () => {
    const filas = nombres
      .filter((n) => valores[n] !== undefined && valores[n] !== '')
      .map((n) => ({ nombre: n, valor: Number(valores[n]), ...(conModalidad ? { modalidad: modalidades[n] || 'hora' } : {}) }))
    if (filas.length === 0 || !vigenciaDesde) { setError('Cargá al menos un monto y la fecha de vigencia'); return }
    if (filas.some((f) => !Number.isFinite(f.valor))) { setError('Hay montos inválidos'); return }
    setGuardando(true); setError(null)
    const r = await onGuardar(filas, vigenciaDesde)
    setGuardando(false)
    if (!r?.ok) { setError(r?.error || 'No se pudo guardar'); return }
    setAbierto(false); setValores({}); setModalidades({}); setNuevoNombre('')
  }

  return (
    <div>
      <table className="table" style={{ width: '100%' }}>
        <thead>
          <tr><th style={{ textAlign: 'left' }}>Categoría</th><th style={{ textAlign: 'right' }}>{etiquetaValor} vigente</th><th /></tr>
        </thead>
        <tbody>
          {items.length === 0 && mensajeVacio && (
            // Task 6.9 (plan 2026-08-11): antes un convenio sin categorías/no
            // remunerativos dejaba solo el encabezado, sin decir nada.
            <tr><td colSpan={3} style={{ color: 'var(--text-secondary)' }}>{mensajeVacio}</td></tr>
          )}
          {items.map((i) => (
            <FilaCategoria key={i.nombre} item={i} expandido={expandido === i.nombre}
              onToggle={() => setExpandido(expandido === i.nombre ? null : i.nombre)} />
          ))}
        </tbody>
      </table>

      {!soloLectura && !abierto && (
        <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => setAbierto(true)}>Nueva vigencia</button>
      )}
      {!soloLectura && abierto && (
        <div className="card" style={{ marginTop: 10 }}>
          {nombres.map((n) => (
            <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{n}</span>
              <input className="input" type="number" placeholder="monto" style={{ width: 140 }}
                value={valores[n] ?? ''} onChange={(e) => setValores((v) => ({ ...v, [n]: e.target.value }))} />
              {conModalidad && (
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  modalidad
                  <select aria-label={`modalidad ${n}`} className="input" style={{ width: 120 }}
                    value={modalidades[n] ?? 'hora'}
                    onChange={(e) => setModalidades((m) => ({ ...m, [n]: e.target.value }))}>
                    <option value="hora">hora</option>
                    <option value="mensual">mensual</option>
                    <option value="quincenal">quincenal</option>
                  </select>
                </label>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <input className="input" placeholder="agregar categoría nueva…" value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)} />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              vigencia desde
              <input className="input" type="date" aria-label="vigencia desde" value={vigenciaDesde}
                onChange={(e) => setVigenciaDesde(e.target.value)} />
            </label>
          </div>
          {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={guardar} disabled={guardando}>Guardar vigencia</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}

function FilaCategoria({ item, expandido, onToggle }) {
  return (
    <>
      <tr>
        <td>{item.nombre}</td>
        <td style={{ textAlign: 'right' }}>
          {item.vigente ? fmt(item.vigente.valor) : <span className="badge badge-warning">sin valor</span>}
        </td>
        <td style={{ textAlign: 'right' }}>
          {item.historial.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={onToggle}>{expandido ? 'ocultar' : 'historial'}</button>
          )}
        </td>
      </tr>
      {expandido && item.historial.map((h) => (
        <tr key={h.vigenciaDesde} style={{ color: 'var(--text-secondary)' }}>
          <td style={{ paddingLeft: 24 }}>desde {h.vigenciaDesde}</td>
          <td style={{ textAlign: 'right' }}>{fmt(h.valor)}</td>
          <td />
        </tr>
      ))}
    </>
  )
}
