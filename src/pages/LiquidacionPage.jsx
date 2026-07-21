import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useLiquidacionStore } from '../store/liquidacionStore'

export default function LiquidacionPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const { liquidaciones, calculando, error, calcularPeriodo, cargarLiquidaciones } = useLiquidacionStore()
  const [periodos, setPeriodos] = useState([])
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState('')
  const [personalPorId, setPersonalPorId] = useState(new Map())

  useEffect(() => {
    if (!empresa?.id) return
    supabase.from('nom_periodos').select('*').eq('empresa_id', empresa.id).order('fecha_desde', { ascending: false })
      .then(({ data }) => setPeriodos(data || []))
    supabase.from('nom_v_personal').select('id, nombre')
      .then(({ data }) => setPersonalPorId(new Map((data || []).map((p) => [p.id, p.nombre]))))
  }, [empresa?.id])

  const handleCalcular = async () => {
    if (!periodoSeleccionado) return
    const r = await calcularPeriodo(periodoSeleccionado)
    if (r.ok) cargarLiquidaciones(periodoSeleccionado)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Liquidación</h1>
        <p className="page-subtitle">Calcular y revisar liquidaciones por período</p>
      </div>

      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 12, alignItems: 'center' }}>
        <select className="input" value={periodoSeleccionado} onChange={(e) => setPeriodoSeleccionado(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="">Elegir período…</option>
          {periodos.map((p) => (
            <option key={p.id} value={p.id}>{p.tipo} — {p.fecha_desde} a {p.fecha_hasta} ({p.estado})</option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" onClick={handleCalcular} disabled={!periodoSeleccionado || calculando}>
          {calculando ? 'Calculando…' : 'Calcular'}
        </button>
      </div>

      {error && <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>}

      {liquidaciones.length > 0 && (
        <div className="card table-scroll">
          <table className="table">
            <thead><tr><th>Persona</th><th>Bruto</th><th>Neto</th><th>Estado</th></tr></thead>
            <tbody>
              {liquidaciones.map((l) => (
                <tr key={l.id}>
                  <td>{personalPorId.get(l.personalId) || l.personalId}</td>
                  <td>${l.bruto.toLocaleString('es-AR')}</td>
                  <td>${l.neto.toLocaleString('es-AR')}</td>
                  <td><span className="badge badge-neutral">{l.estado}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
