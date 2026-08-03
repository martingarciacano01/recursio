import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import UsuariosPage from '../UsuariosPage'
import { useToastStore } from '../../store/toastStore'

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector) => selector({ empresa: { id: 'e1' }, empresaVista: null }),
}))

const invitarUsuario = vi.fn().mockResolvedValue({ ok: true, usuarioId: 'u2' })
const cargarUsuarios = vi.fn()
const quitarRol = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../store/usuariosStore', () => ({
  useUsuariosStore: () => ({
    usuarios: [{ id: 'v1', usuarioId: 'u1', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null, email: 'ana@empresa.com' }],
    cargando: false, error: null, cargarUsuarios, invitarUsuario, quitarRol,
  }),
}))

describe('UsuariosPage', () => {
  beforeEach(() => { useToastStore.setState({ toasts: [] }) })

  it('lista los usuarios vinculados con su email y rol (Task 4.2)', () => {
    render(<UsuariosPage />)
    expect(screen.getByText('ana@empresa.com')).toBeInTheDocument()
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
    await waitFor(() => expect(useToastStore.getState().toasts[0]).toMatchObject({ tipo: 'success' }))
  })

  it('pide confirmacion antes de quitar un usuario y no llama a quitarRol si se cancela', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<UsuariosPage />)
    fireEvent.click(screen.getByText('Quitar'))
    expect(confirmSpy).toHaveBeenCalled()
    expect(quitarRol).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('llama a quitarRol, muestra un toast y recarga si se confirma', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<UsuariosPage />)
    fireEvent.click(screen.getByText('Quitar'))
    await waitFor(() => expect(quitarRol).toHaveBeenCalledWith('v1'))
    await waitFor(() => expect(useToastStore.getState().toasts[0]).toMatchObject({ tipo: 'success' }))
    confirmSpy.mockRestore()
  })
})
