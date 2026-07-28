import { useEffect, useState } from 'react'
import { useParametrosStore } from '../../store/parametrosStore'
import { valorAlerta, DEFAULTS_ALERTAS } from '../../utils/alertasDashboard'

const ALERTAS = [
  {
    codigo: 'alerta_liq_dia',
    label: 'Día del mes a partir del cual una liquidación pendiente es urgente',
    porDefecto: DEFAULTS_ALERTAS.alertaLiqDia,
    ayuda: 'El Dashboard marca en rojo "Liquidaciones a realizar" desde este día.',
  },
  {
    codigo: 'alerta_doc_dias',
    label: 'Días de anticipación para avisar documentación por vencer',
    porDefecto: DEFAULTS_ALERTAS.alertaDocDias,
    ayuda: 'Se usa en el semáforo de la ficha del legajo y en el conteo del Dashboard.',
  },
]

// Umbrales de las alertas del Dashboard. Se guardan en nom_parametros —
// la misma tabla versionada por vigencia que usa tope_sipa — así que no
// hace falta esquema nuevo (Fase 6 Task 9).
export default function TabAlertas({ empresaId }) {
  const { parametros, cargarParametros, guardarParametro } = useParametrosStore()
  const [valores, setValores] = useState({})
  const [guardando, setGuardando] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { if (empresaId) cargarParametros(empresaId) }, [empresaId])

  useEffect(() => {
    setValores(Object.fromEntries(
      ALERTAS.map((a) => [a.codigo, String(valorAlerta(parametros, a.codigo, a.porDefecto))])
    ))
  }, [parametros])

  const guardar = async (alerta) => {
    setError('')
    const valor = Number(valores[alerta.codigo])
    if (!Number.isFinite(valor) || valor <= 0) { setError('El valor tiene que ser un número mayor a cero.'); return }
    setGuardando(alerta.codigo)
    const r = await guardarParametro({
      codigo: alerta.codigo, valor,
      vigenciaDesde: new Date().toISOString().slice(0, 10), vigenciaHasta: null,
    }, empresaId)
    setGuardando(null)
    if (!r.ok) setError(r.error)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
        Umbrales de las alertas del Dashboard. Se guardan como parámetros versionados: cada cambio agrega una vigencia nueva, no pisa la anterior.
      </p>
      {ALERTAS.map((a) => (
        <div key={a.codigo} style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 520 }}>
          <label htmlFor={`alerta-${a.codigo}`} style={{ fontSize: '0.85rem' }}>{a.label}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id={`alerta-${a.codigo}`}
              className="input"
              type="number"
              min="1"
              style={{ width: 120 }}
              value={valores[a.codigo] ?? ''}
              onChange={(e) => setValores((v) => ({ ...v, [a.codigo]: e.target.value }))}
            />
            <button className="btn btn-primary btn-sm" onClick={() => guardar(a)} disabled={guardando === a.codigo}>
              {guardando === a.codigo ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{a.ayuda}</span>
        </div>
      ))}
      {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}
    </div>
  )
}
