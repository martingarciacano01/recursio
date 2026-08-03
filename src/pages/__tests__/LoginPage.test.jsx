import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LoginPage from '../LoginPage'

const login = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector) => selector({ login }),
}))

const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { resetPasswordForEmail: (...args) => resetPasswordForEmail(...args) } },
}))

function renderLogin() {
  return render(<MemoryRouter><LoginPage /></MemoryRouter>)
}

describe('LoginPage — recuperación de contraseña (Task 4.4)', () => {
  beforeEach(() => { resetPasswordForEmail.mockClear() })

  it('muestra un link "¿Olvidaste tu contraseña?" que abre el formulario de recupero', () => {
    renderLogin()
    fireEvent.click(screen.getByText('¿Olvidaste tu contraseña?'))
    expect(screen.getByRole('button', { name: /Enviar instrucciones/i })).toBeInTheDocument()
  })

  it('llama a resetPasswordForEmail con el email y una respuesta generica', async () => {
    renderLogin()
    fireEvent.click(screen.getByText('¿Olvidaste tu contraseña?'))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@empresa.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Enviar instrucciones/i }))
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalledWith(
      'ana@empresa.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('/restablecer-password') })
    ))
    expect(await screen.findByText(/si la cuenta existe, vas a recibir un email/i)).toBeInTheDocument()
  })

  it('muestra la misma respuesta generica aunque la llamada falle (no revela si el email existe)', async () => {
    resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'algo raro' } })
    renderLogin()
    fireEvent.click(screen.getByText('¿Olvidaste tu contraseña?'))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@x.com' } })
    fireEvent.click(screen.getByRole('button', { name: /Enviar instrucciones/i }))
    expect(await screen.findByText(/si la cuenta existe, vas a recibir un email/i)).toBeInTheDocument()
  })
})
