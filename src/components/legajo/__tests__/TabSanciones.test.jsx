import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TabSanciones from '../TabSanciones'

const guardarSancionMock = vi.fn().mockResolvedValue({ ok: true })
const eliminarSancionMock = vi.fn().mockResolvedValue({ ok: true })
const estado = {
  sanciones: [{ id: 's1', tipo: 'suspension', fecha: '2026-05-04', motivo: 'Ausencia sin aviso', diasSuspension: 2 }],
  guardarSancion: guardarSancionMock,
  eliminarSancion: eliminarSancionMock,
}
vi.mock('../../../store/legajoStore', () => ({
  useLegajoStore: (selector) => selector(estado),
}))

describe('TabSanciones — edición', () => {
  beforeEach(() => { guardarSancionMock.mockClear() })

  it('el boton Editar precarga el formulario con los datos de la sancion', () => {
    render(<TabSanciones personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Motivo / descripción')).toHaveValue('Ausencia sin aviso')
    expect(screen.getByLabelText('Días de suspensión')).toHaveValue(2)
  })

  it('guardar en modo edicion llama a guardarSancion con el id existente', async () => {
    render(<TabSanciones personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Motivo / descripción'), { target: { value: 'Ausencia sin aviso (corregido)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => {
      expect(guardarSancionMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 's1', motivo: 'Ausencia sin aviso (corregido)' }),
        'p1', 'emp-1'
      )
    })
  })

  it('cancelar la edicion vuelve al formulario de alta vacio', () => {
    render(<TabSanciones personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByLabelText('Motivo / descripción')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeInTheDocument()
  })
})
