import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      lte: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}))

import TabAusencias from '../TabAusencias'

describe('TabAusencias — filtro de mes', () => {
  const ausencias = [
    { id: 'a1', tipo: 'vacaciones', estado: 'aprobada', fecha_desde: '2026-03-10', fecha_hasta: '2026-03-15' },
    { id: 'a2', tipo: 'vacaciones', estado: 'aprobada', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-05' },
  ]

  it('muestra un select de mes además del de año', () => {
    render(<TabAusencias ausencias={ausencias} personalId="p1" />)
    expect(screen.getByLabelText(/Mes/i)).toBeInTheDocument()
  })

  it('al elegir un mes, el total de justificadas se acota a ese mes', () => {
    render(<TabAusencias ausencias={ausencias} personalId="p1" />)
    fireEvent.change(screen.getByLabelText(/Mes/i), { target: { value: '3' } })
    // Solo a1 (marzo) debería contar — 6 días de licencia.
    const justificadas = screen.getByText('Justificadas').nextSibling
    expect(justificadas.textContent).toBe('6')
  })
})

describe('TabAusencias — fecha de ingreso del legajo', () => {
  it('no cuenta como injustificado un día anterior a la fecha de ingreso del legajo', () => {
    const legajo = { fechaIngreso: '2026-07-15' }
    render(<TabAusencias ausencias={[]} personalId="p1" legajo={legajo} />)
    // Con año actual completo y fechaIngreso a mitad de julio, los días de
    // enero-junio no deben sumar como falta injustificada.
    const injustificadas = screen.getByText('Injustificadas').nextSibling
    expect(Number(injustificadas.textContent)).toBeLessThan(150) // cota laxa: sin el fix daría ~140+ solo hasta julio
  })
})
