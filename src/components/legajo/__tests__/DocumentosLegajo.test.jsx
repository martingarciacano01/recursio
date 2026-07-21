import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import DocumentosLegajo from '../DocumentosLegajo'

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'd1', nombre: 'DNI', fecha_vencimiento: '2099-01-01', archivo_url: 'x' }],
        error: null,
      }),
    })),
  },
}))

describe('DocumentosLegajo', () => {
  it('lista los documentos del personal y su badge de vigencia', async () => {
    render(<DocumentosLegajo personalId="p1" />)
    await waitFor(() => expect(screen.getByText('DNI')).toBeInTheDocument())
    expect(screen.getByText('Vigente')).toBeInTheDocument()
  })
})
