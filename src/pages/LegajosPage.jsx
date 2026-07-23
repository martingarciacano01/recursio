import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SemaforoLegajo from '../components/legajo/SemaforoLegajo'
import { useAuthStore } from '../store/authStore'
import { usePaginado } from '../hooks/usePaginado'

export default function LegajosPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un Superadmin tiene bypass de RLS (0008_superadmin_bypass.sql): sin
  // este filtro explícito vería el personal de TODAS las empresas
  // mezclado, no solo el de la empresa que eligió en /superadmin.
  const empresaActiva = empresa || empresaVista
  const [filas, setFilas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const { rango, siguientePagina, reset, hayMasPaginas } = usePaginado(100)

  // Al cambiar de empresa hay que volver a la página 0: si no, se
  // arrastraría el offset de paginación de la empresa anterior.
  useEffect(() => {
    reset()
  }, [empresaActiva?.id])

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      setError('')
      let qPersonal = supabase
        .from('nom_v_personal')
        .select('id, nombre, dni, puesto, estado', { count: 'estimated' })
        .eq('estado', 'activo')
        .order('nombre')
        .range(rango[0], rango[1])
      // nom_legajo NO se pagina: sigue trayendo TODOS los legajos de la
      // empresa en cada carga. Son filas livianas (pocos campos, una por
      // persona) y el Map de lookup por personal_id necesita cubrir a
      // todo el personal ya cargado en páginas anteriores, no solo a la
      // página actual — si se paginara, las filas de páginas previas
      // quedarían sin su legajo asociado.
      let qLegajos = supabase.from('nom_legajo').select('personal_id, cuil, cbu, convenio_id, categoria_id')
      if (empresaActiva?.id) {
        qPersonal = qPersonal.eq('empresa_id', empresaActiva.id)
        qLegajos = qLegajos.eq('empresa_id', empresaActiva.id)
      }
      const [{ data: personal, error: e1, count }, { data: legajos, error: e2 }] = await Promise.all([qPersonal, qLegajos])
      if (cancelado) return
      if (e1 || e2) { setError((e1 || e2).message); setCargando(false); return }
      if (typeof count === 'number') setTotal(count)
      const porPersonal = new Map((legajos || []).map((l) => [l.personal_id, {
        cuil: l.cuil, cbu: l.cbu, convenioId: l.convenio_id, categoriaId: l.categoria_id,
      }]))
      const nuevasFilas = (personal || []).map((p) => ({ ...p, legajo: porPersonal.get(p.id) || null }))
      setFilas((prev) => (rango[0] === 0 ? nuevasFilas : [...prev, ...nuevasFilas]))
      setCargando(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [empresaActiva?.id, rango[1]])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Legajos</h1>
        <p className="page-subtitle">Personal activo y estado del legajo</p>
      </div>
      {!empresaActiva && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          Elegí una empresa en Superadmin → "Entrar" para ver sus legajos.
        </div>
      )}
      {error && <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>}
      {!error && empresaActiva && (
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
          {hayMasPaginas(total) && (
            <button className="btn btn-ghost btn-sm" onClick={siguientePagina}>Cargar más</button>
          )}
        </div>
      )}
    </div>
  )
}
