import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SemaforoLegajo from '../SemaforoLegajo'

describe('SemaforoLegajo', () => {
  it('muestra badge verde "Completo" cuando el legajo tiene todo', () => {
    render(<SemaforoLegajo legajo={{ cuil: '20-1-9', cbu: '000', convenioId: 'c1', categoriaId: 'cat1' }} />)
    expect(screen.getByText('Completo')).toBeInTheDocument()
  })

  it('muestra badge de alerta "Incompleto" cuando falta un dato', () => {
    render(<SemaforoLegajo legajo={{ cuil: '20-1-9', cbu: null, convenioId: 'c1', categoriaId: 'cat1' }} />)
    expect(screen.getByText('Incompleto')).toBeInTheDocument()
  })

  it('muestra "Incompleto" cuando no hay legajo todavía', () => {
    render(<SemaforoLegajo legajo={null} />)
    expect(screen.getByText('Incompleto')).toBeInTheDocument()
  })
})
