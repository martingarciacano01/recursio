import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import EditorDatosLegajo from '../EditorDatosLegajo'

vi.mock('../../../store/legajoStore', () => ({
  useLegajoStore: (selector) => selector({ guardarLegajo: vi.fn() }),
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
})
