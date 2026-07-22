import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProtectedRoute from '../ProtectedRoute'

// Nota: authStore no usa selector (se consume como `useAuthStore()` en
// todo el codebase, ver Sidebar.jsx), así que el mock devuelve el objeto
// completo directamente en vez de aceptar un selector como argumento.
vi.mock('../../store/authStore', () => ({
  useAuthStore: () => ({
    session: { user: { id: 'u1' } },
    cargando: false,
    rol: null,
    rolesNomina: [{ rol: 'rrhh' }],
  }),
}))

describe('ProtectedRoute', () => {
  it('renderiza los children si el usuario puede la accion', () => {
    render(
      <MemoryRouter>
        <ProtectedRoute accion="calcular_liquidacion"><div>Contenido</div></ProtectedRoute>
      </MemoryRouter>
    )
    expect(screen.getByText('Contenido')).toBeInTheDocument()
  })

  it('redirige (no renderiza children) si el usuario no puede', () => {
    render(
      <MemoryRouter>
        <ProtectedRoute accion="gestionar_usuarios"><div>Contenido</div></ProtectedRoute>
      </MemoryRouter>
    )
    expect(screen.queryByText('Contenido')).not.toBeInTheDocument()
  })

  it('sin accion (uso previo: gating solo por sesion) sigue renderizando children', () => {
    render(
      <MemoryRouter>
        <ProtectedRoute><div>Contenido</div></ProtectedRoute>
      </MemoryRouter>
    )
    expect(screen.getByText('Contenido')).toBeInTheDocument()
  })
})
