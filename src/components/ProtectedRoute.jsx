import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'

// Redirige a /login si no hay sesión activa. Mientras se resuelve la sesión
// inicial (cargarSesion en App.jsx) no redirige para evitar un parpadeo al
// login en cada recarga de página.
export default function ProtectedRoute({ children }) {
  const { session, cargando } = useAuthStore()

  if (cargando) return null
  if (!session) return <Navigate to="/login" replace />

  return children
}
