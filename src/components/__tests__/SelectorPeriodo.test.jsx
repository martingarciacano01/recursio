import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SelectorPeriodo from '../SelectorPeriodo'

const periodos = [
  { id: 'p1', tipo: 'mensual', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-30', estado: 'cerrado' },
  { id: 'p2', tipo: 'quincena_1', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-15', estado: 'abierto' },
  { id: 'p3', tipo: 'quincena_2', fecha_desde: '2026-07-16', fecha_hasta: '2026-07-31', estado: 'en_flujo' },
]

describe('SelectorPeriodo', () => {
  it('agrupa las opciones por año en optgroups', () => {
    render(<SelectorPeriodo periodos={periodos} value="" onChange={vi.fn()} />)
    const select = screen.getByLabelText('Período')
    const grupos = select.querySelectorAll('optgroup')
    expect(grupos).toHaveLength(1)
    expect(grupos[0].label).toBe('2026')
    expect(select.querySelectorAll('option')).toHaveLength(4) // "Elegir período…" + 3
  })

  it('llama a onChange con el id del periodo elegido', () => {
    const onChange = vi.fn()
    render(<SelectorPeriodo periodos={periodos} value="" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Período'), { target: { value: 'p2' } })
    expect(onChange).toHaveBeenCalledWith('p2')
  })
})
