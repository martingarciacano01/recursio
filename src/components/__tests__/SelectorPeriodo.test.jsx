import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SelectorPeriodo from '../SelectorPeriodo'

const periodos = [
  { id: 'p1', tipo: 'mensual', fecha_desde: '2026-06-01', fecha_hasta: '2026-06-30', estado: 'cerrado' },
  { id: 'p2', tipo: 'quincena_1', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-15', estado: 'abierto' },
  { id: 'p3', tipo: 'quincena_2', fecha_desde: '2026-07-16', fecha_hasta: '2026-07-31', estado: 'en_flujo' },
]

describe('SelectorPeriodo', () => {
  it('muestra los años disponibles como chips y el seleccionado primero resalta el mes', () => {
    render(<SelectorPeriodo periodos={periodos} value="" onChange={vi.fn()} />)
    // Chips de año: 2026 es el único año presente.
    expect(screen.getByRole('button', { name: 'Año 2026' })).toBeInTheDocument()
    // Meses y sus períodos se dibujan como tarjetitas, no como <select>.
    expect(screen.getByText('Junio')).toBeInTheDocument()
    expect(screen.getByText('Julio')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('mostrar períodos agrupados por tipo dentro de cada mes', () => {
    render(<SelectorPeriodo periodos={periodos} value="" onChange={vi.fn()} />)
    expect(screen.getByText('1ra quincena')).toBeInTheDocument()
    expect(screen.getByText('2da quincena')).toBeInTheDocument()
    expect(screen.getByText('Mensual')).toBeInTheDocument()
  })

  it('llama a onChange con el id del período elegido', () => {
    const onChange = vi.fn()
    render(<SelectorPeriodo periodos={periodos} value="" onChange={onChange} />)
    // "1ra quincena" aparece una sola vez (Julio); el botón padre la contiene.
    fireEvent.click(screen.getByText('1ra quincena').closest('button'))
    expect(onChange).toHaveBeenCalledWith('p2')
  })

  it('cuando no hay períodos muestra un aviso y no rompe', () => {
    render(<SelectorPeriodo periodos={[]} value="" onChange={vi.fn()} />)
    expect(screen.getByText(/Todavía no hay períodos cargados/)).toBeInTheDocument()
  })
})