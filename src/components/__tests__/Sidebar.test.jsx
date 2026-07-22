import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Sidebar from '../Sidebar'

vi.mock('../../store/authStore', () => ({
  useAuthStore: () => ({
    usuario: { email: 'a@a.com' }, rol: null, empresa: { id: 'e1' }, empresaVista: null,
    rolesNomina: [{ rol: 'revisor_externo' }], logout: vi.fn(), salirDeEmpresa: vi.fn(),
  }),
}))

describe('Sidebar', () => {
  it('revisor_externo solo ve Aprobaciones (y Dashboard/logout, siempre visibles)', () => {
    render(<MemoryRouter><Sidebar /></MemoryRouter>)
    expect(screen.getByText('Aprobaciones')).toBeInTheDocument()
    expect(screen.queryByText('Legajos')).not.toBeInTheDocument()
    expect(screen.queryByText('Configuración')).not.toBeInTheDocument()
    expect(screen.queryByText('Usuarios')).not.toBeInTheDocument()
  })
})
