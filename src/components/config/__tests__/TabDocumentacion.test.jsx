import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TabDocumentacion from '../TabDocumentacion'

const eliminarRequeridoMock = vi.fn().mockResolvedValue({ ok: true })
const pushMock = vi.fn()

vi.mock('../../../store/documentosStore', () => ({
  useDocumentosStore: (sel) => sel({
    requeridos: [
      { id: 'r1', codigo: 'art', nombre: 'Constancia de ART', obligatorio: true, vence: true, diasAviso: 30 },
    ],
    cargarRequeridos: vi.fn(),
    guardarRequerido: vi.fn().mockResolvedValue({ ok: true }),
    eliminarRequerido: eliminarRequeridoMock,
  }),
}))

vi.mock('../../../store/toastStore', () => ({
  useToastStore: (sel) => sel({ push: pushMock }),
}))

describe('TabDocumentacion', () => {
  beforeEach(() => {
    eliminarRequeridoMock.mockClear()
    pushMock.mockClear()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => vi.restoreAllMocks())

  it('eliminar un tipo de documento pide confirmación (avisa impacto) y avisa por toast', async () => {
    render(<TabDocumentacion empresaId="e1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Constancia de ART'))
    expect(eliminarRequeridoMock).toHaveBeenCalledWith('r1', 'e1')
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('Tipo de documento eliminado.', 'success')
    })
  })

  it('si el usuario cancela la confirmación no se elimina', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<TabDocumentacion empresaId="e1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    expect(eliminarRequeridoMock).not.toHaveBeenCalled()
  })

  it('si el store devuelve { ok: false } se avisa el error por toast', async () => {
    eliminarRequeridoMock.mockResolvedValueOnce({ ok: false, error: 'boom' })
    render(<TabDocumentacion empresaId="e1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }))
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('No se pudo eliminar el tipo de documento', 'error')
    })
  })
})