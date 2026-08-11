import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TabBonos from '../TabBonos'

const eliminarAplicacionMock = vi.fn().mockResolvedValue({ ok: true })
const eliminarExcepcionMock = vi.fn().mockResolvedValue({ ok: true })
const pushMock = vi.fn()

vi.mock('../../../store/bonosStore', () => ({
  useBonosStore: () => ({
    bonos: [
      { id: 'b1', nombre: 'Presentismo', montoBase: 0, descripcion: null, activo: true },
      { id: 'b2', nombre: 'Vianda', montoBase: 0, descripcion: null, activo: true },
    ],
    aplicaciones: [
      { id: 'a1', bonoId: 'b1', obraId: null, monto: 10000, tipoMonto: 'fijo' },
    ],
    excepciones: [
      { id: 'e1', bonoId: 'b2', personalId: 'p1', personalNombre: 'Juan Pérez', monto: null },
    ],
    cargando: false,
    error: null,
    cargarBonos: vi.fn(),
    crearBonoGlobal: vi.fn(),
    aplicarBono: vi.fn(),
    eliminarAplicacion: eliminarAplicacionMock,
    setExcepcion: vi.fn(),
    eliminarExcepcion: eliminarExcepcionMock,
  }),
}))

vi.mock('../../../store/authStore', () => ({
  useAuthStore: (sel) => sel({ rol: 'empresa' }),
}))

vi.mock('../../../store/toastStore', () => ({
  useToastStore: (sel) => sel({ push: pushMock }),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    })),
  },
}))

describe('TabBonos', () => {
  beforeEach(() => {
    eliminarAplicacionMock.mockClear()
    eliminarExcepcionMock.mockClear()
    pushMock.mockClear()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })
  afterEach(() => vi.restoreAllMocks())

  it('quitar una aplicación pide confirmación y avisa por toast', async () => {
    render(<TabBonos empresaId="e1" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0])
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Presentismo'))
    expect(eliminarAplicacionMock).toHaveBeenCalledWith('a1')
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('Bono quitado de la aplicación.', 'success')
    })
  })

  it('quitar una excepción pide confirmación y avisa por toast', async () => {
    render(<TabBonos empresaId="e1" />)
    const quitares = screen.getAllByRole('button', { name: 'Quitar' })
    fireEvent.click(quitares[1])
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Juan Pérez'))
    expect(eliminarExcepcionMock).toHaveBeenCalledWith('e1')
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('Excepción quitada.', 'success')
    })
  })

  it('si la confirmación se cancela no se quita nada', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<TabBonos empresaId="e1" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0])
    expect(eliminarAplicacionMock).not.toHaveBeenCalled()
  })

  it('si el store devuelve { ok: false } se avisa el error por toast', async () => {
    eliminarAplicacionMock.mockResolvedValueOnce({ ok: false, error: 'boom' })
    render(<TabBonos empresaId="e1" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0])
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('No se pudo quitar la aplicación del bono', 'error')
    })
  })
})