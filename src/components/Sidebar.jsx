import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useTemaStore } from '../store/temaStore'
import { puede } from '../utils/permisos'
import Logo from './Logo'
import {
  LayoutDashboard, FileText, Settings, Calculator,
  CheckSquare, BarChart3, UserCog, LogOut, ShieldAlert, LogIn,
  Sun, Moon, MonitorSmartphone, X,
} from 'lucide-react'

// Estructura de navegación de Recursio (Recursio_Diseno.md, rutas del
// plan de ejecución Task 5).
//
// `accion` (Fase 5G Task 29): gating de UI por rol de nómina (ver
// src/utils/permisos.js). Dashboard no tiene `accion` = siempre visible
// para cualquier usuario logueado.
export const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/liquidacion', icon: Calculator, label: 'Liquidaciones', accion: 'ver_liquidacion' },
  { to: '/legajos', icon: FileText, label: 'Legajos', accion: 'ver_legajos' },
  { to: '/aprobaciones', icon: CheckSquare, label: 'Aprobaciones', accion: 'aprobar' },
  { to: '/usuarios', icon: UserCog, label: 'Usuarios', accion: 'gestionar_usuarios' },
  { to: '/reportes', icon: BarChart3, label: 'Reportes', accion: 'ver_reportes' },
  { to: '/configuracion', icon: Settings, label: 'Configuración', accion: 'ver_configuracion' },
]

const ICONO_TEMA = { claro: Sun, oscuro: Moon, auto: MonitorSmartphone }
const ROTULO_TEMA = { claro: 'Claro', oscuro: 'Oscuro', auto: 'Automático' }

export default function Sidebar({ onNavegar }) {
  const { usuario, rol, empresa, empresaVista, rolesNomina, logout, salirDeEmpresa } = useAuthStore()
  const preferencia = useTemaStore((s) => s.preferencia)
  const alternar = useTemaStore((s) => s.alternar)
  const navigate = useNavigate()
  const IconoTema = ICONO_TEMA[preferencia] || MonitorSmartphone

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handleSalirDeEmpresa = () => {
    salirDeEmpresa()
    navigate('/superadmin')
  }

  // Gating de UI por rol (Fase 5G Task 29, diseño §2.3): superadmin sigue
  // viendo todo; para usuarios de empresa se filtra cada item con `accion`
  // según lo que permite puede(rolesNomina, accion). Esto es SOLO gating de
  // UI — la RLS del backend es la que realmente protege los datos.
  const navItems = (rol === 'superadmin'
    ? [...NAV_ITEMS, { to: '/superadmin', icon: ShieldAlert, label: 'Superadmin', dividerBefore: true }]
    : NAV_ITEMS
  ).filter((item) => !item.accion || rol === 'superadmin' || puede(rolesNomina, item.accion))

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Logo alto={44} />
        <button type="button" className="sidebar-cerrar" onClick={onNavegar} aria-label="Cerrar menú">
          <X size={18} />
        </button>
      </div>

      <nav className="sidebar-nav">
        {navItems.map(({ to, icon: Icon, label, dividerBefore }) => (
          <div key={to}>
            {dividerBefore && <div className="sidebar-divider" />}
            <NavLink
              to={to}
              end={to === '/'}
              onClick={onNavegar}
              className={({ isActive }) => `nav-link${isActive ? ' nav-link-activo' : ''}`}
            >
              <Icon size={17} style={{ flexShrink: 0 }} />
              <span>{label}</span>
            </NavLink>
          </div>
        ))}
      </nav>

      <div className="sidebar-pie">
        {empresaVista && (
          <div className="sidebar-empresa">
            <div className="sidebar-empresa-rotulo">Viendo como</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {/* Avatar de iniciales, mismo patrón que TabEmpresas en Presencio */}
              <div
                className="sidebar-avatar"
                style={{ background: empresaVista.colorPrimario || 'var(--brand-primary)' }}
              >
                <span style={{ color: empresaVista.colorSecundario || 'var(--brand-secondary)' }}>
                  {(empresaVista.nombre || '?').slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="sidebar-empresa-nombre">{empresaVista.nombre}</div>
            </div>
            <button onClick={handleSalirDeEmpresa} className="btn btn-ghost btn-sm btn-bloque">
              <LogIn size={13} /> Salir de la empresa
            </button>
          </div>
        )}

        {usuario && (
          <div className="sidebar-usuario">
            <div className="sidebar-usuario-mail">{usuario.email}</div>
            {rol && (
              <div className="sidebar-usuario-rol">
                {rol}{empresa ? ` · ${empresa.id.slice(0, 8)}` : ''}
              </div>
            )}
          </div>
        )}

        <div className="sidebar-acciones">
          <button
            onClick={alternar}
            className="btn btn-ghost btn-sm btn-bloque"
            title={`Tema: ${ROTULO_TEMA[preferencia]}`}
            aria-label={`Cambiar tema (actual: ${ROTULO_TEMA[preferencia]})`}
          >
            <IconoTema size={15} /> {ROTULO_TEMA[preferencia]}
          </button>
          <button onClick={handleLogout} className="btn btn-ghost btn-sm btn-bloque">
            <LogOut size={15} /> Salir
          </button>
        </div>
      </div>
    </aside>
  )
}
