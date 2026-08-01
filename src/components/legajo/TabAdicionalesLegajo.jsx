import { useEffect, useState } from 'react'
import { useLegajoStore } from '../../store/legajoStore'
import { useConceptosStore } from '../../store/conceptosStore'

const FORM_VACIO = { conceptoId: '', modo: 'heredado', porcentaje: '', monto: '', vigenciaDesde: '', vigenciaHasta: '' }

// Adicionales asignados a ESTE legajo puntual (migración 0040, plan
// 2026-07-29 §3): a diferencia de TabAdicionales.jsx (que edita los
// adicionales del CONVENIO), acá se elige, persona por persona, cuáles de
// los adicionales marcados `asignacion: 'legajo'` en el convenio del legajo
// aplican, con override opcional de valor.
export default function TabAdicionalesLegajo({ legajo, empresaId }) {
  const adicionalesLegajo = useLegajoStore((s) => s.adicionalesLegajo)
  const cargarAdicionalesLegajo = useLegajoStore((s) => s.cargarAdicionalesLegajo)
  const guardarAdicionalLegajo = useLegajoStore((s) => s.guardarAdicionalLegajo)
  const quitarAdicionalLegajo = useLegajoStore((s) => s.quitarAdicionalLegajo)
  const conceptos = useConceptosStore((s) => s.conceptos)
  const cargarConceptos = useConceptosStore((s) => s.cargarConceptos)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [quitandoId, setQuitandoId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { if (legajo?.id) cargarAdicionalesLegajo(legajo.id) }, [legajo?.id])
  useEffect(() => { if (empresaId) cargarConceptos(empresaId) }, [empresaId])

  if (!legajo) return <div className="card">Guardá primero los datos básicos del legajo (convenio y categoría) para poder asignar adicionales.</div>
  if (legajo.fueraConvenio) return <div className="card">Este legajo está fuera de convenio: no tiene adicionales de convenio para asignar.</div>

  // Solo adicionales `asignacion: 'legajo'` del convenio de ESTE legajo —
  // los de `asignacion: 'categoria'` (default) se siguen resolviendo solos
  // por categoría, no aparecen acá (ver filtrarAsignados en motor.ts).
  const disponibles = conceptos.filter((c) => c.convenioId === legajo.convenioId && c.asignacion === 'legajo')
  const conceptoPorId = new Map(conceptos.map((c) => [c.id, c]))
  const yaAsignados = new Set(adicionalesLegajo.map((a) => a.conceptoId))
  const paraAgregar = disponibles.filter((c) => !yaAsignados.has(c.id))

  const handleGuardar = async () => {
    setError('')
    if (!form.conceptoId) { setError('Elegí un adicional.'); return }
    if (!form.vigenciaDesde) { setError('La vigencia desde es obligatoria.'); return }
    if (form.modo === 'porcentaje' && form.porcentaje === '') { setError('Ingresá el porcentaje.'); return }
    if (form.modo === 'nominal' && form.monto === '') { setError('Ingresá el monto.'); return }
    setGuardando(true)
    const r = await guardarAdicionalLegajo(
      {
        conceptoId: form.conceptoId, modo: form.modo,
        porcentaje: form.modo === 'porcentaje' ? Number(form.porcentaje) : undefined,
        monto: form.modo === 'nominal' ? Number(form.monto) : undefined,
        vigenciaDesde: form.vigenciaDesde, vigenciaHasta: form.vigenciaHasta || null,
      },
      legajo.id, empresaId
    )
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  const handleQuitar = async (id) => {
    setError('')
    setQuitandoId(id)
    const r = await quitarAdicionalLegajo(id)
    setQuitandoId(null)
    if (!r.ok) setError(r.error)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h3 style={{ margin: 0 }}>Adicionales asignados ({adicionalesLegajo.length})</h3>

      {adicionalesLegajo.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin adicionales asignados a esta persona.</p>}
      {adicionalesLegajo.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {adicionalesLegajo.map((a) => {
            const concepto = conceptoPorId.get(a.conceptoId)
            const valor = a.modo === 'heredado' ? '(valor del convenio)'
              : a.modo === 'porcentaje' ? `${a.porcentaje}% del básico`
              : `$${a.monto}`
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>
                  {concepto?.nombre || a.conceptoId} — {valor}
                  {' '}({a.vigenciaDesde}{a.vigenciaHasta ? ` a ${a.vigenciaHasta}` : ' en adelante'})
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => handleQuitar(a.id)} disabled={quitandoId === a.id}>
                  {quitandoId === a.id ? 'Quitando…' : 'Quitar'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {paraAgregar.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          No hay más adicionales "por empleado" configurados en el convenio (o ya están todos asignados).
          Se configuran en Configuración → Convenios → Adicionales, con "Aplica a: empleados asignados".
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
          <strong style={{ fontSize: '0.9rem' }}>Asignar adicional</strong>
          <div>
            <label htmlFor="adic-concepto" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Adicional</label>
            <select id="adic-concepto" className="input" value={form.conceptoId}
              onChange={(e) => setForm((f) => ({ ...f, conceptoId: e.target.value }))}>
              <option value="">— elegir —</option>
              {paraAgregar.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="adic-modo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Valor</label>
            <select id="adic-modo" className="input" value={form.modo}
              onChange={(e) => setForm((f) => ({ ...f, modo: e.target.value }))}>
              <option value="heredado">Usar el % configurado en el convenio</option>
              <option value="porcentaje">Override: % del básico</option>
              <option value="nominal">Override: monto fijo</option>
            </select>
          </div>
          {form.modo === 'porcentaje' && (
            <div>
              <label htmlFor="adic-pct" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Porcentaje del básico</label>
              <input id="adic-pct" className="input" type="number" step="0.01" value={form.porcentaje}
                onChange={(e) => setForm((f) => ({ ...f, porcentaje: e.target.value }))} />
            </div>
          )}
          {form.modo === 'nominal' && (
            <div>
              <label htmlFor="adic-monto" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Monto fijo</label>
              <input id="adic-monto" className="input" type="number" step="0.01" value={form.monto}
                onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))} />
            </div>
          )}
          <div>
            <label htmlFor="adic-desde" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Vigencia desde</label>
            <input id="adic-desde" className="input" type="date" value={form.vigenciaDesde}
              onChange={(e) => setForm((f) => ({ ...f, vigenciaDesde: e.target.value }))} />
          </div>
          <div>
            <label htmlFor="adic-hasta" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Vigencia hasta (opcional)</label>
            <input id="adic-hasta" className="input" type="date" value={form.vigenciaHasta}
              onChange={(e) => setForm((f) => ({ ...f, vigenciaHasta: e.target.value }))} />
          </div>

          {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

          <button className="btn btn-primary btn-sm" onClick={handleGuardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Asignar'}
          </button>
        </div>
      )}
    </div>
  )
}
