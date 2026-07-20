import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import ProtectedRoute from './components/ProtectedRoute'
import LoginPage from './pages/LoginPage'

// Router mínimo para verificar login + rutas protegidas (Task 2). El shell
// completo (Layout, Sidebar, Dashboard real y el resto de rutas del diseño)
// se construye en la Task 5.
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
              <div className="page">Sesión iniciada. Próximamente: dashboard.</div>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
