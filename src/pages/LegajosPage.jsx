import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SemaforoLegajo from '../components/legajo/SemaforoLegajo'
import { useAuthStore } from '../store/authStore'
import { usePaginado } from '../hooks/usePaginado'
import { filtrarLegajos } from '../utils/filtrarLegajos'

export default function LegajosPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un Superadmin tiene bypass de RLS (0008_superadmin_bypass.sql): sin
  // este filtro explícito vería el personal de TODAS las empresas
  // mezclado, no solo el de la empresa que eligió en /superadmin.
  const empresaActiva = empresa || empresaVista
  const [filas, setFilas] = useState([])
  const [obrasPorId, setObrasPorId] = useState(new Map())
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  // Task 6.5 (plan 2026-08-11): count del estado filtrado (opcional). Efecto
  // por separado: la query principal sigue trayendo todos los estados (el
  // filtro es client-side), pero el paginado debe saber cuántos hay del
  // estado elegido para no ofrecer "Cargar más" que no cambia la tabla.
  const [totalEstado, setTotalEstado] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('activo')
  const { rango, siguientePagina, reset, hayMasPaginas } = usePaginado(100)

  // Al cambiar de empresa hay que volver a la página 0: si no, se
  // arrastraría el offset de paginación de la empresa anterior.
  useEffect(() => {
    reset()
  }, [empresaActiva?.id])

  // Task 6.5: count server-side del estado elegido (head query, sin data).
  // Se usa para decidir "Cargar más"/aviso: con mayoría inactivos y filtro
  // "Activo", la query principal trae filas de todos los estados por rango, y
  // sin este count "Cargar más" seguía ofreciéndose sin cambiar la tabla.
  useEffect(() => {
    if (!empresaActiva?.id || filtroEstado === 'todos') return
    let cancelado = false
    supabase.from('nom_v_personal')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaActiva.id)
      .eq('estado', filtroEstado)
      .then(({ count }) => { if (!cancelado) setTotalEstado(typeof count === 'number' ? count : null) })
    return () => { cancelado = true }
  }, [empresaActiva?.id, filtroEstado])

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      setError('')
      // El filtro de estado (activo/inactivo/todos) ahora es client-side
      // (filtrarLegajos, Task 44/Fase 5D), así que acá NO filtramos por
      // estado: traemos todos los estados. El count/range de usePaginado
      // (Fase 5I) sigue aplicándose sobre esta query sin filtro de
      // estado, o sea que la paginación es server-side sobre el total
      // real de personal (todos los estados); el filtro de estado se
      // aplica después, en memoria, solo sobre lo ya cargado en `filas`.
      let qPersonal = supabase
        .from('nom_v_personal')
        .select('id, nombre, dni, puesto, estado, obra_id', { count: 'estimated' })
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
      supabase.from('nom_v_obras').select('id, nombre').eq('empresa_id', empresaActiva.id).order('nombre')
        .then(({ data: obras }) => { if (!cancelado) setObrasPorId(new Map((obras || []).map((o) => [o.id, o.nombre]))) })
      setCargando(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [empresaActiva?.id, rango[1]])

  // El filtro de estado y la búsqueda se aplican en memoria sobre lo ya
  // paginado (`filas`), no sobre el total de la empresa. Si hay más páginas
  // sin cargar, el resultado puede estar incompleto: se comunica en la UI.
  const visibles = filtrarLegajos(filas, busqueda, filtroEstado)
  const buscando = busqueda.trim() !== ''
  // Task 6.5: cuando el filtro es de estado, el botón "Cargar más" y el aviso
  // se calculan contra el count del estado elegido (no el total de todos los
  // estados). Si ya cargamos todos los del estado, no hay más que buscar.
  const cargadosDelEstado = filtroEstado === 'todos' ? filas.length : filas.filter((f) => f.estado === filtroEstado).length
  const totalEstadoValido = filtroEstado === 'todos' ? total : (totalEstado ?? total)
  const quedanDelEstado = filtroEstado === 'todos'
    ? hayMasPaginas(total)
    : cargadosDelEstado < totalEstadoValido
  const puedeHaberMasCoincidencias = buscando
    ? hayMasPaginas(total)
    : filtroEstado !== 'activo' && filtroEstado !== 'todos' && quedanDelEstado

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
          <div className="filtros-legajos" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type="text"
              placeholder="Buscar por nombre o DNI…"
              aria-label="Buscar por nombre o DNI"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="input"
            />
            <select
              aria-label="Filtrar por estado"
              value={filtroEstado}
              onChange={(e) => setFiltroEstado(e.target.value)}
              className="input"
            >
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          {puedeHaberMasCoincidencias && (
            <p className="texto-secundario" style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
              El filtro se aplica sobre lo ya cargado (resultados en {cargadosDelEstado} de {totalEstadoValido} personas del estado) — usá "Cargar más" para incluir el resto.
            </p>
          )}
          <table className="table">
            <thead>
              <tr><th>Nombre</th><th>DNI</th><th>Puesto</th><th>Obra</th><th>Legajo</th><th aria-label="Acciones"></th></tr>
            </thead>
            <tbody>
              {cargando && <tr><td colSpan={6}>Cargando…</td></tr>}
              {!cargando && visibles.length === 0 && (
                <tr><td colSpan={6}>{puedeHaberMasCoincidencias ? 'Sin coincidencias en lo cargado hasta ahora — cargá más o ajustá el filtro.' : 'No hay personal para mostrar.'}</td></tr>
              )}
              {visibles.map((f) => (
                <tr key={f.id}>
                  <td>{f.nombre}</td>
                  <td>{f.dni || '—'}</td>
                  <td>{f.puesto || '—'}</td>
                  <td>{f.obra_id ? (obrasPorId.get(f.obra_id) || '—') : '—'}</td>
                  <td><SemaforoLegajo legajo={f.legajo} /></td>
                  <td><Link to={`/legajos/${f.id}`} className="btn btn-ghost btn-sm">Ver ficha</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Task 6.5: "Cargar más" respeta el estado filtrado — no se ofrece
              cuando ya cargamos todos los del estado aunque queden de otro. */}
          {quedanDelEstado && (
            <button className="btn btn-ghost btn-sm" onClick={siguientePagina}>Cargar más</button>
          )}
        </div>
      )}
    </div>
  )
}
