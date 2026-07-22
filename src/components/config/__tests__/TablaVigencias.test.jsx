import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TablaVigencias from '../TablaVigencias'

const items = [
  { nombre: 'Ayudante', vigente: { valor: 80, vigenciaDesde: '2026-01-01' }, historial: [{ valor: 80, vigenciaDesde: '2026-01-01' }] },
  { nombre: 'Oficial', vigente: null, historial: [] },
]

describe('TablaVigencias', () => {
  it('muestra el valor vigente y "sin valor" cuando no hay vigencia', () => {
    render(<TablaVigencias items={items} etiquetaValor="Básico" soloLectura onGuardar={() => {}} />)
    expect(screen.getByText('Ayudante')).toBeInTheDocument()
    expect(screen.getByText('$ 80')).toBeInTheDocument()
    expect(screen.getByText('sin valor')).toBeInTheDocument()
  })

  it('en solo lectura no ofrece "Nueva vigencia"', () => {
    render(<TablaVigencias items={items} etiquetaValor="Básico" soloLectura onGuardar={() => {}} />)
    expect(screen.queryByText('Nueva vigencia')).toBeNull()
  })

  it('el formulario precarga los nombres y llama onGuardar con filas y fecha', () => {
    const onGuardar = vi.fn().mockResolvedValue({ ok: true })
    render(<TablaVigencias items={items} etiquetaValor="Básico" soloLectura={false} onGuardar={onGuardar} />)
    fireEvent.click(screen.getByText('Nueva vigencia'))
    const inputs = screen.getAllByPlaceholderText('monto')
    fireEvent.change(inputs[0], { target: { value: '100' } })
    fireEvent.change(inputs[1], { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText('vigencia desde'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByText('Guardar vigencia'))
    expect(onGuardar).toHaveBeenCalledWith(
      [{ nombre: 'Ayudante', valor: 100 }, { nombre: 'Oficial', valor: 150 }],
      '2026-08-01'
    )
  })

  it('sin conModalidad no muestra el selector de modalidad', () => {
    render(<TablaVigencias items={items} etiquetaValor="Básico" soloLectura={false} onGuardar={() => {}} />)
    fireEvent.click(screen.getByText('Nueva vigencia'))
    expect(screen.queryByLabelText('modalidad Ayudante')).toBeNull()
  })

  it('con conModalidad muestra el selector y lo incluye en las filas de onGuardar', () => {
    const onGuardar = vi.fn().mockResolvedValue({ ok: true })
    render(<TablaVigencias items={items} etiquetaValor="Básico" soloLectura={false} onGuardar={onGuardar} conModalidad />)
    fireEvent.click(screen.getByText('Nueva vigencia'))
    const inputs = screen.getAllByPlaceholderText('monto')
    fireEvent.change(inputs[0], { target: { value: '100' } })
    fireEvent.change(inputs[1], { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText('modalidad Ayudante'), { target: { value: 'mensual' } })
    fireEvent.change(screen.getByLabelText('vigencia desde'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByText('Guardar vigencia'))
    expect(onGuardar).toHaveBeenCalledWith(
      [
        { nombre: 'Ayudante', valor: 100, modalidad: 'mensual' },
        { nombre: 'Oficial', valor: 150, modalidad: 'hora' },
      ],
      '2026-08-01'
    )
  })
})
