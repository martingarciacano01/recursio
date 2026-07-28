import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EditorDatosLegajo from '../EditorDatosLegajo'

const guardarLegajoMock = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../../store/legajoStore', () => ({
  useLegajoStore: (selector) => selector({ guardarLegajo: guardarLegajoMock }),
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabla) => {
      if (tabla === 'nom_convenios') {
        return {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              { id: 'g1', nombre: 'UOCRA', empresa_id: null },
              { id: 'e1', nombre: 'UOCRA', empresa_id: 'emp-1' },
              { id: 'g2', nombre: 'Comercio', empresa_id: null },
            ],
            error: null,
          }),
        }
      }
      if (tabla === 'nom_categorias') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [{ id: 'cat-1', nombre: 'Ayudante', vigencia_desde: '2026-06-01' }],
            error: null,
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
      }
    }),
  },
}))

describe('EditorDatosLegajo', () => {
  it('el select de convenio muestra una sola opcion "UOCRA" cuando hay global+clon homonimos', async () => {
    render(<EditorDatosLegajo legajo={{}} personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByText('Editar'))
    await waitFor(() => {
      expect(screen.getAllByText('UOCRA')).toHaveLength(1)
    })
    expect(screen.getByText('Comercio')).toBeInTheDocument()
  })

  it('tildar "Fuera de convenio" deshabilita los selects de convenio/categoria', async () => {
    render(<EditorDatosLegajo legajo={{}} personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByText('Editar'))
    fireEvent.click(screen.getByLabelText('Fuera de convenio'))
    expect(screen.getByLabelText('Convenio')).toBeDisabled()
    expect(screen.getByLabelText('Categoría')).toBeDisabled()
    expect(screen.getByPlaceholderText('Sueldo convenido mensual')).toBeInTheDocument()
  })

  it('destildar "Fuera de convenio" limpia el sueldo convenido cargado', async () => {
    render(<EditorDatosLegajo legajo={{}} personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByText('Editar'))
    fireEvent.click(screen.getByLabelText('Fuera de convenio'))
    fireEvent.change(screen.getByPlaceholderText('Sueldo convenido mensual'), { target: { value: '123456' } })
    expect(screen.getByPlaceholderText('Sueldo convenido mensual')).toHaveValue(123456)

    fireEvent.click(screen.getByLabelText('Fuera de convenio'))
    fireEvent.click(screen.getByLabelText('Fuera de convenio'))
    expect(screen.getByPlaceholderText('Sueldo convenido mensual')).toHaveValue(null)
  })

  it('sin baja registrada, muestra el boton "Dar de baja" que abre fecha + motivo', async () => {
    render(<EditorDatosLegajo legajo={{}} personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByText('Editar'))
    fireEvent.click(screen.getByText('Dar de baja'))
    expect(screen.getByLabelText('Fecha de baja')).toBeInTheDocument()
    expect(screen.getByLabelText('Motivo de baja')).toBeInTheDocument()
    expect(screen.getByText('Confirmar baja')).toBeInTheDocument()
  })

  it('confirmar baja llama a guardarLegajo con fechaBaja y motivoBaja', async () => {
    guardarLegajoMock.mockClear()
    render(<EditorDatosLegajo legajo={{}} personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByText('Editar'))
    fireEvent.click(screen.getByText('Dar de baja'))
    fireEvent.change(screen.getByLabelText('Fecha de baja'), { target: { value: '2026-06-30' } })
    fireEvent.change(screen.getByLabelText('Motivo de baja'), { target: { value: 'renuncia' } })
    fireEvent.click(screen.getByText('Confirmar baja'))
    await waitFor(() => {
      expect(guardarLegajoMock).toHaveBeenCalledWith(
        expect.objectContaining({ fechaBaja: '2026-06-30', motivoBaja: 'renuncia' }),
        'emp-1'
      )
    })
  })

  it('con baja ya registrada, muestra la leyenda de solo lectura y no el boton', async () => {
    render(<EditorDatosLegajo legajo={{ fechaBaja: '2026-06-30', motivoBaja: 'renuncia' }} personalId="p1" empresaId="emp-1" />)
    fireEvent.click(screen.getByText('Editar'))
    expect(screen.getByText('Baja: 2026-06-30 (renuncia)')).toBeInTheDocument()
    expect(screen.queryByText('Dar de baja')).not.toBeInTheDocument()
  })

  it('muestra el NOMBRE de la categoria cuando el legajo llega despues del primer render', async () => {
    const { rerender } = render(<EditorDatosLegajo legajo={null} personalId="p1" empresaId="emp-1" />)
    // segundo render: ya llegó el legajo desde cargarLegajos()
    rerender(<EditorDatosLegajo legajo={{ id: 'l1', convenioId: 'e1', categoriaId: 'cat-1' }} personalId="p1" empresaId="emp-1" />)
    await waitFor(() => {
      expect(screen.getByText('Categoría: Ayudante')).toBeInTheDocument()
    })
    expect(screen.queryByText(/cat-1/)).not.toBeInTheDocument()
  })

  it('la vista de solo lectura muestra el sueldo convenido de un legajo fuera de convenio', async () => {
    render(<EditorDatosLegajo legajo={{ id: 'l1', fueraConvenio: true, sueldoConvenido: 1250000 }} personalId="p1" empresaId="emp-1" />)
    await waitFor(() => {
      expect(screen.getByText('Convenio: Fuera de convenio')).toBeInTheDocument()
    })
    expect(screen.getByText('Sueldo convenido: $ 1.250.000')).toBeInTheDocument()
    expect(screen.queryByText(/^Categoría:/)).not.toBeInTheDocument()
  })
})
