import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Users, AlertTriangle } from 'lucide-react'
import { legajoIncompleto } from '../utils/legajoCompletitud'
import { useAuthStore } from '../store/authStore'

// Dashboard mínimo real (Task 5, Step 3): cantidad de personal activo
// (desde nom_v_personal) y legajos incompletos (personal activo sin
// CUIL, CBU, convenio o categoría en nom_legajo). "Incompleto para
// liquidar" es el mismo criterio que se reutiliza después en el
// semáforo de la página de Legajos (Fase 1, Task 9).
export default function DashboardPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un Superadmin tiene bypass de RLS (0008_superadmin_bypass.sql) y por
  // lo tanto vería personal/legajos de TODAS las empresas mezclados si no
  // filtramos acá a mano por la empresa que eligió en /superadmin.
  const empresaActiva = empresa || empresaVista
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [totalActivo, setTotalActivo] = useState(0)
  const [incompletos, setIncompletos] = useState(0)

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      setError('')
      let qPersonal = supabase.from('nom_v_personal').select('id, estado').eq('estado', 'activo')
      let qLegajos = supabase.from('nom_legajo').select('personal_id, cuil, cbu, convenio_id, categoria_id')
      if (empresaActiva?.id) {
        qPersonal = qPersonal.eq('empresa_id', empresaActiva.id)
        qLegajos = qLegajos.eq('empresa_id', empresaActiva.id)
      }
      const [{ data: personal, error: errPersonal }, { data: legajos, error: errLegajos }] = await Promise.all([
        qPersonal,
        qLegajos,
      ])
      if (cancelado) return
      if (errPersonal || errLegajos) {
        setError((errPersonal || errLegajos).message)
        setCargando(false)
        return
      }
      const legajoPorPersonal = new Map((legajos || []).map((l) => [l.personal_id, {
        cuil: l.cuil, cbu: l.cbu, convenioId: l.convenio_id, categoriaId: l.categoria_id,
      }]))
      const faltantes = (personal || []).filter((p) => legajoIncompleto(legajoPorPersonal.get(p.id))).length

      setTotalActivo((personal || []).length)
      setIncompletos(faltantes)
      setCargando(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [empresaActiva?.id])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Resumen de nómina</p>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'rgba(218,54,51,0.4)', color: 'var(--danger)', marginBottom: '1rem' }}>
          Error al cargar datos: {error}
        </div>
      )}

      {!error && (
        <div className="stats-grid">
          <div className="stat-card">
            <Users size={18} color="var(--brand-secondary)" style={{ marginBottom: 8 }} />
            <div className="stat-value">{cargando ? '—' : totalActivo}</div>
            <div className="stat-label">Personal activo</div>
          </div>
          <div className="stat-card">
            <AlertTriangle size={18} color="var(--warning)" style={{ marginBottom: 8 }} />
            <div className="stat-value">{cargando ? '—' : incompletos}</div>
            <div className="stat-label">Legajos incompletos</div>
          </div>
        </div>
      )}
    </div>
  )
}
