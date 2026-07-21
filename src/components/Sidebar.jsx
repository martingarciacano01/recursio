import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import {
  LayoutDashboard, FileText, Settings, Calculator,
  CheckSquare, BarChart3, UserCog, LogOut, Landmark, ShieldAlert, LogIn,
} from 'lucide-react'

// Estructura de navegación de Recursio (Recursio_Diseno.md, rutas del
// plan de ejecución Task 5). Simplificada respecto al Sidebar de
// Presencio (fichaobra/src/components/layout/Sidebar.jsx): sin roles
// custom por config todavía (llega con el flujo de aprobación, Fase 3).
const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/legajos', icon: FileText, label: 'Legajos' },
  { to: '/liquidacion', icon: Calculator, label: 'Liquidación' },
  { to: '/aprobaciones', icon: CheckSquare, label: 'Aprobaciones' },
  { to: '/reportes', icon: BarChart3, label: 'Reportes' },
  { to: '/usuarios', icon: UserCog, label: 'Usuarios' },
  { to: '/configuracion', icon: Settings, label: 'Configuración' },
]

const navLinkStyle = (isActive) => ({
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '0.6rem 0.75rem', borderRadius: 'var(--radius)',
  textDecoration: 'none', transition: 'all 0.12s',
  color: isActive ? 'var(--brand-secondary)' : 'var(--text-secondary)',
  background: isActive ? 'rgba(200,168,75,0.1)' : 'transparent',
  fontWeight: isActive ? 600 : 400, fontSize: '0.875rem',
  whiteSpace: 'nowrap', overflow: 'hidden',
})

export default function Sidebar() {
  const { usuario, rol, empresa, empresaVista, logout, salirDeEmpresa } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handleSalirDeEmpresa = () => {
    salirDeEmpresa()
    navigate('/superadmin')
  }

  const navItems = rol === 'superadmin'
    ? [...NAV_ITEMS, { to: '/superadmin', icon: ShieldAlert, label: 'Superadmin' }]
    : NAV_ITEMS

  return (
    <aside style={{
      width: 220, height: '100vh', background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)', display: 'flex',
      flexDirection: 'column', position: 'sticky', top: 0, flexShrink: 0,
    }}>
      <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Landmark size={16} color="var(--brand-secondary)" />
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1.1rem' }}>
          Recurs<span style={{ color: 'var(--brand-secondary)' }}>io</span>
        </div>
      </div>

      <nav style={{ flex: 1, padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => navLinkStyle(isActive)}>
            <Icon size={17} style={{ flexShrink: 0 }} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)' }}>
        {empresaVista && (
          <div style={{
            padding: '0.5rem 0.75rem', marginBottom: 8, borderRadius: 'var(--radius)',
            background: 'rgba(200,168,75,0.1)', border: '1px solid rgba(200,168,75,0.3)',
          }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Viendo como</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>{empresaVista.nombre}</div>
            <button onClick={handleSalirDeEmpresa} className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', gap: 6, fontSize: '0.72rem' }}>
              <LogIn size={13} /> Salir de la empresa
            </button>
          </div>
        )}
        {usuario && (
          <div style={{ padding: '0.4rem 0.75rem', marginBottom: 6 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{usuario.email}</div>
            {rol && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>{rol}{empresa ? ` · ${empresa.id.slice(0, 8)}` : ''}</div>}
          </div>
        )}
        <button onClick={handleLogout} className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}>
          <LogOut size={15} /> Salir
        </button>
      </div>
    </aside>
  )
}
