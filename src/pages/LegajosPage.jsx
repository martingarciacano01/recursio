import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SemaforoLegajo from '../components/legajo/SemaforoLegajo'

export default function LegajosPage() {
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      setError('')
      const [{ data: personal, error: e1 }, { data: legajos, error: e2 }] = await Promise.all([
        supabase.from('nom_v_personal').select('id, nombre, dni, puesto, estado').eq('estado', 'activo').order('nombre'),
        supabase.from('nom_legajo').select('personal_id, cuil, cbu, convenio_id, categoria_id'),
      ])
      if (cancelado) return
      if (e1 || e2) { setError((e1 || e2).message); setCargando(false); return }
      const porPersonal = new Map((legajos || []).map((l) => [l.personal_id, {
        cuil: l.cuil, cbu: l.cbu, convenioId: l.convenio_id, categoriaId: l.categoria_id,
      }]))
      setFilas((personal || []).map((p) => ({ ...p, legajo: porPersonal.get(p.id) || null })))
      setCargando(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Legajos</h1>
        <p className="page-subtitle">Personal activo y estado del legajo</p>
      </div>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>}
      {!error && (
        <div className="card table-scroll">
          <table className="table">
            <thead>
              <tr><th>Nombre</th><th>DNI</th><th>Puesto</th><th>Legajo</th><th aria-label="Acciones"></th></tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={5}>Cargando…</td></tr>}
              {!cargando && filas.length === 0 && <tr><td colSpan={5}>No hay personal activo.</td></tr>}
              {filas.map((f) => (
                <tr key={f.id}>
                  <td>{f.nombre}</td>
                  <td>{f.dni || '—'}</td>
                  <td>{f.puesto || '—'}</td>
                  <td><SemaforoLegajo legajo={f.legajo} /></td>
                  <td><Link to={`/legajos/${f.id}`} className="btn btn-ghost btn-sm">Ver ficha</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
