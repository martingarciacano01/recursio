import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
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

// Rutas del diseño (Recursio_Diseno.md): todas protegidas salvo /login.
// Las que no están implementadas todavía muestran "Próximamente" con el
// shell completo (Layout + Sidebar), no una página en blanco.
function App() {
  const cargarSesion = useAuthStore((s) => s.cargarSesion)

  useEffect(() => {
    cargarSesion()
  }, [cargarSesion])

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
          <Route path="legajos" element={<LegajosPage />} />
          <Route path="legajos/:personalId" element={<FichaLegajoPage />} />
          <Route path="liquidacion" element={<LiquidacionPage />} />
          <Route path="aprobaciones" element={<AprobacionesPage />} />
          <Route path="reportes" element={<ReportesPage />} />
          <Route path="usuarios" element={<ProximamentePage titulo="Usuarios" />} />
          <Route path="configuracion" element={<ConfiguracionPage />} />
          <Route path="superadmin" element={<SuperAdminPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
