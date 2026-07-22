import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { puede } from '../utils/permisos'

// Redirige a /login si no hay sesión activa. Mientras se resuelve la sesión
// inicial (cargarSesion en App.jsx) no redirige para evitar un parpadeo al
// login en cada recarga de página.
//
// Gating de UI por rol (Fase 5G Task 29, diseño §2.3): si se pasa `accion`,
// además exige que el usuario tenga algún rol de nómina que permita esa
// acción (ver src/utils/permisos.js) y, si no, redirige a "/". superadmin
// nunca se filtra por accion, igual que en Sidebar.jsx. Esto es SOLO
// gating de UI — la protección real de datos es la RLS del backend
// (migración 0026_rls_roles.sql, pendiente en una vuelta siguiente).
export default function ProtectedRoute({ accion, children }) {
  const { session, cargando, rol, rolesNomina } = useAuthStore()

  if (cargando) return null
  if (!session) return <Navigate to="/login" replace />
  if (accion && rol !== 'superadmin' && !puede(rolesNomina, accion)) {
    return <Navigate to="/" replace />
  }

  return children
}
