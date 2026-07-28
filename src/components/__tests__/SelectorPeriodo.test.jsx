import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SelectorPeriodo from '../SelectorPeriodo'

const periodos = [
  { id: 'p1', tipo: 'mensual', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-30', estado: 'cerrado' },
  { id: 'p2', tipo: 'quincena_1', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-15', estado: 'abierto' },
  { id: 'p3', tipo: 'quincena_2', fecha_desde: '2026-07-16', fecha_hasta: '2026-07-31', estado: 'en_flujo' },
]

describe('SelectorPeriodo', () => {
  it('agrupa por año y mes, y muestra el badge de estado de cada periodo', () => {
    render(<SelectorPeriodo periodos={periodos} value="" onChange={vi.fn()} />)
    expect(screen.getByText('2026')).toBeInTheDocument()
    expect(screen.getByText('Julio')).toBeInTheDocument()
    expect(screen.getByText('Junio')).toBeInTheDocument()
    expect(screen.getAllByText(/cerrado|abierto|en_flujo/)).toHaveLength(3)
  })

  it('llama a onChange con el id del periodo elegido', () => {
    const onChange = vi.fn()
    render(<SelectorPeriodo periodos={periodos} value="" onChange={onChange} />)
    fireEvent.click(screen.getByText(/1ra quincena/i))
    expect(onChange).toHaveBeenCalledWith('p2')
  })
})
