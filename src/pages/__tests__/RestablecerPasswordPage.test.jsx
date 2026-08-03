import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RestablecerPasswordPage from '../RestablecerPasswordPage'

const updateUser = vi.fn().mockResolvedValue({ error: null })
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { updateUser: (...args) => updateUser(...args) } },
}))

function render_() {
  return render(<MemoryRouter><RestablecerPasswordPage /></MemoryRouter>)
}

describe('RestablecerPasswordPage (Task 4.4)', () => {
  beforeEach(() => { updateUser.mockClear() })

  it('pide la nueva contraseña dos veces y no envia si no coinciden', async () => {
    render_()
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'abcdef12' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'distinta1' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }))
    expect(await screen.findByText(/no coinciden/i)).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('llama a supabase.auth.updateUser con la nueva contraseña cuando coinciden', async () => {
    render_()
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'abcdef12' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'abcdef12' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }))
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'abcdef12' }))
    expect(await screen.findByText(/contraseña actualizada/i)).toBeInTheDocument()
  })

  it('exige al menos 8 caracteres', async () => {
    render_()
    fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'corta' } })
    fireEvent.change(screen.getByLabelText('Confirmar contraseña'), { target: { value: 'corta' } })
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }))
    expect(await screen.findByText(/al menos 8 caracteres/i)).toBeInTheDocument()
    expect(updateUser).not.toHaveBeenCalled()
  })
})
