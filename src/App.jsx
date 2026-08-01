import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { useTemaStore } from './store/temaStore'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import LegajosPage from './pages/LegajosPage'
import FichaLegajoPage from './pages/FichaLegajoPage'
import ProximamentePage from './pages/ProximamentePage'
import ConfiguracionPage from './pages/ConfiguracionPage'
import LiquidacionPage from './pages/LiquidacionPage'
import AprobacionesPage from './pages/AprobacionesPage'
import ReportesPage from './pages/ReportesPage'
import SuperAdminPage from './pages/SuperAdminPage'
import UsuariosPage from './pages/UsuariosPage'

// Rutas del diseño (Recursio_Diseno.md): todas protegidas salvo /login.
// Las que no están implementadas todavía muestran "Próximamente" con el
// shell completo (Layout + Sidebar), no una página en blanco.
function App() {
  const cargarSesion = useAuthStore((s) => s.cargarSesion)
  const initTema = useTemaStore((s) => s.init)

  useEffect(() => {
    cargarSesion()
  }, [cargarSesion])

  // Aplica el tema guardado y queda escuchando cambios del sistema
  // mientras la preferencia sea "automático".
  useEffect(() => initTema(), [initTema])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="legajos" element={<ProtectedRoute accion="ver_legajos"><LegajosPage /></ProtectedRoute>} />
          <Route path="legajos/:personalId" element={<ProtectedRoute accion="ver_legajos"><FichaLegajoPage /></ProtectedRoute>} />
          <Route path="liquidacion" element={<ProtectedRoute accion="ver_liquidacion"><LiquidacionPage /></ProtectedRoute>} />
          <Route path="aprobaciones" element={<ProtectedRoute accion="aprobar"><AprobacionesPage /></ProtectedRoute>} />
          <Route path="reportes" element={<ProtectedRoute accion="ver_reportes"><ReportesPage /></ProtectedRoute>} />
          <Route path="usuarios" element={<ProtectedRoute accion="gestionar_usuarios"><UsuariosPage /></ProtectedRoute>} />
          <Route path="configuracion" element={<ProtectedRoute accion="ver_configuracion"><ConfiguracionPage /></ProtectedRoute>} />
          <Route path="superadmin" element={<SuperAdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
