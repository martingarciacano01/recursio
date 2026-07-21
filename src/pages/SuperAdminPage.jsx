import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogIn, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'

// Panel mínimo de Superadmin: lista las empresas (vía la RPC
// get_empresas_superadmin(), ya existente y compartida con Presencio —
// mismo proyecto de Supabase, mismo esquema `empresas`) y permite
// "Entrar" para fijar `empresaVista` y así poder operar el resto de
// Recursio (Legajos, Liquidación, Configuración) como esa empresa.
//
// Alcance intencionalmente acotado respecto al panel equivalente de
// Presencio (fichaobra/src/pages/SuperAdminPage.jsx): ahí también se
// puede dar de alta empresas, editar plan/estado, invitar usuarios y
// configurar roles/menús — nada de eso aplica todavía a Recursio o no
// existe función RPC de escritura habilitada desde acá. Si hace falta
// alguna de esas capacidades, se agrega en una iteración posterior.
export default function SuperAdminPage() {
  const rol = useAuthStore((s) => s.rol)
  const entrarEnEmpresa = useAuthStore((s) => s.entrarEnEmpresa)
  const navigate = useNavigate()

  const [empresas, setEmpresas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [entrandoId, setEntrandoId] = useState(null)

  const cargarEmpresas = () => {
    setCargando(true)
    setError('')
    supabase.rpc('get_empresas_superadmin').then(({ data, error: err }) => {
      setCargando(false)
      if (err) { setError(err.message); return }
      setEmpresas(data || [])
    })
  }

  useEffect(() => {
    cargarEmpresas()
  }, [])

  const handleEntrar = (empresa) => {
    setEntrandoId(empresa.id)
    entrarEnEmpresa(empresa)
    navigate('/')
  }

  if (rol !== 'superadmin') {
    return (
      <div className="page">
        <div className="card" style={{ color: 'var(--danger)' }}>
          Esta sección es solo para usuarios Superadmin.
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Superadmin</h1>
        <p className="page-subtitle">Elegí una empresa para operar Recursio en su nombre</p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
        <button className="btn btn-ghost btn-sm" onClick={cargarEmpresas} title="Actualizar">
          <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {error && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error: {error}</div>}

      <div className="card table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Plan</th>
              <th>Personal activo</th>
              <th>Usuarios</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Cargando…</td></tr>
            )}
            {!cargando && empresas.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Sin empresas registradas.</td></tr>
            )}
            {empresas.map((e) => (
              <tr key={e.id}>
                <td>{e.nombre}{e.es_demo ? <span className="badge badge-warning" style={{ marginLeft: 6 }}>DEMO</span> : null}</td>
                <td>{e.plan || 'básico'}</td>
                <td>{e.total_personal ?? 0}</td>
                <td>{e.total_usuarios ?? 0}</td>
                <td>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleEntrar(e)}
                    disabled={entrandoId === e.id}
                  >
                    <LogIn size={13} /> Entrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
