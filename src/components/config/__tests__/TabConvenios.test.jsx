import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TabConvenios from '../TabConvenios'

const crearConvenioMock = vi.fn().mockResolvedValue({ ok: true, convenioId: 'c2' })
const actualizarConvenioMock = vi.fn().mockResolvedValue({ ok: true })
const eliminarConvenioMock = vi.fn().mockResolvedValue({ ok: true })
const cargarConveniosMock = vi.fn()

let convenios = [
  { id: 'c1', empresaId: 'e1', nombre: 'UOCRA', regimen: '22250', modalidad: 'quincenal', corteQ1Desde: 1, corteQ1Hasta: 15, corteQ2Desde: 16, corteQ2Hasta: null, corteMensualDesde: 1, corteMensualHasta: null },
  { id: 'c2', empresaId: 'e1', nombre: 'Otro Convenio', regimen: 'lct', modalidad: 'mensual', corteQ1Desde: 1, corteQ1Hasta: 15, corteQ2Desde: 16, corteQ2Hasta: null, corteMensualDesde: 1, corteMensualHasta: null },
]

vi.mock('../../../store/conveniosStore', () => ({
  useConveniosStore: () => ({
    convenios, cargarConvenios: cargarConveniosMock,
    crearConvenio: crearConvenioMock, actualizarConvenio: actualizarConvenioMock,
    eliminarConvenio: eliminarConvenioMock,
  }),
}))

describe('TabConvenios', () => {
  beforeEach(() => {
    crearConvenioMock.mockClear()
    actualizarConvenioMock.mockClear()
    eliminarConvenioMock.mockClear()
  })

  it('lista los convenios propios con su modalidad', () => {
    render(<TabConvenios empresaId="e1" />)
    expect(screen.getByText('UOCRA')).toBeInTheDocument()
    expect(screen.getByText(/quincenal/i)).toBeInTheDocument()
  })

  it('alta de convenio nuevo llama a crearConvenio con los datos del formulario', async () => {
    render(<TabConvenios empresaId="e1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo convenio' }))
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Convenio B' } })
    fireEvent.change(screen.getByLabelText('Modalidad'), { target: { value: 'mensual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar convenio' }))
    await waitFor(() => {
      expect(crearConvenioMock).toHaveBeenCalledWith('e1', expect.objectContaining({ nombre: 'Convenio B', modalidad: 'mensual' }))
    })
  })

  it('editar fechas de corte de un convenio existente llama a actualizarConvenio', async () => {
    render(<TabConvenios empresaId="e1" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])
    fireEvent.change(screen.getByLabelText('1ra quincena — hasta'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => {
      expect(actualizarConvenioMock).toHaveBeenCalledWith('c1', expect.objectContaining({ corteQ1Hasta: 20 }))
    })
  })

  it('el error de edición de un convenio no persiste al abrir edición de otro', async () => {
    actualizarConvenioMock.mockResolvedValueOnce({ ok: false, error: 'boom' })
    render(<TabConvenios empresaId="e1" />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument()
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])

    expect(screen.queryByText('boom')).not.toBeInTheDocument()
  })

  it('eliminar un convenio pide confirmación antes de llamar a eliminarConvenio', async () => {
    render(<TabConvenios empresaId="e1" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0])
    // El primer click abre la confirmación, no borra todavía.
    expect(eliminarConvenioMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrar' }))
    await waitFor(() => {
      expect(eliminarConvenioMock).toHaveBeenCalledWith('c1', 'e1')
    })
  })

  it('si eliminarConvenio avisa que está en uso, muestra el aviso y no hace nada más', async () => {
    eliminarConvenioMock.mockResolvedValueOnce({
      ok: false,
      error: 'un convenio no se borra si hay personal o períodos creados con él',
    })
    render(<TabConvenios empresaId="e1" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Eliminar' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Sí, borrar' }))
    await waitFor(() => {
      expect(screen.getByText(/no se borra si hay personal o períodos/)).toBeInTheDocument()
    })
  })
})
