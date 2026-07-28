import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TabFamiliares from '../TabFamiliares'

const guardarFamiliarMock = vi.fn().mockResolvedValue({ ok: true })
const eliminarFamiliarMock = vi.fn().mockResolvedValue({ ok: true })
const estado = {
  familiares: [{ id: 'f1', vinculo: 'hijo', nombre: 'Ana Pérez', cuil: '27-11-1', fechaNacimiento: '2015-03-10' }],
  guardarFamiliar: guardarFamiliarMock,
  eliminarFamiliar: eliminarFamiliarMock,
}
vi.mock('../../../store/legajoStore', () => ({
  useLegajoStore: (selector) => selector(estado),
}))

describe('TabFamiliares — edición', () => {
  beforeEach(() => { guardarFamiliarMock.mockClear() })

  it('el boton Editar precarga el formulario con los datos del familiar', () => {
    render(<TabFamiliares personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.getByLabelText('Nombre')).toHaveValue('Ana Pérez')
    expect(screen.getByLabelText('CUIL (opcional)')).toHaveValue('27-11-1')
  })

  it('guardar en modo edicion llama a guardarFamiliar con el id existente', async () => {
    render(<TabFamiliares personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana María Pérez' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => {
      expect(guardarFamiliarMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'f1', nombre: 'Ana María Pérez' }),
        'p1', 'emp-1'
      )
    })
  })

  it('cancelar la edicion vuelve al formulario de alta vacio', () => {
    render(<TabFamiliares personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByLabelText('Nombre')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Agregar' })).toBeInTheDocument()
  })
})
