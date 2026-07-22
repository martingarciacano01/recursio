import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UsuariosPage from '../UsuariosPage'

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector) => selector({ empresa: { id: 'e1' }, empresaVista: null }),
}))

const invitarUsuario = vi.fn().mockResolvedValue({ ok: true, usuarioId: 'u2' })
const cargarUsuarios = vi.fn()
vi.mock('../../store/usuariosStore', () => ({
  useUsuariosStore: () => ({
    usuarios: [{ id: 'v1', usuarioId: 'u1', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null }],
    cargando: false, error: null, cargarUsuarios, invitarUsuario, quitarRol: vi.fn(),
  }),
}))

describe('UsuariosPage', () => {
  it('lista los usuarios vinculados con su rol', () => {
    render(<UsuariosPage />)
    expect(screen.getByText('rrhh')).toBeInTheDocument()
  })

  it('invita un usuario nuevo por email con el rol elegido', async () => {
    render(<UsuariosPage />)
    fireEvent.change(screen.getByPlaceholderText('email@empresa.com'), { target: { value: 'nuevo@x.com' } })
    fireEvent.change(screen.getByLabelText('Rol'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByText('Invitar'))
    await waitFor(() => expect(invitarUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'nuevo@x.com', empresaId: 'e1', rol: 'admin' })
    ))
  })
})
