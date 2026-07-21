import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import EditorReglas from '../EditorReglas'

describe('EditorReglas', () => {
  it('muestra "aplica en el ejemplo" cuando la condición es verdadera para los valores de ejemplo', () => {
    render(<EditorReglas reglas={[{ orden: 1, condicion: 'tardanzas > 1', formula: '0' }]} onChange={vi.fn()} />)
    expect(screen.getByText('aplica en el ejemplo')).toBeInTheDocument()
  })

  it('muestra "no aplica en el ejemplo" cuando la condición es falsa', () => {
    render(<EditorReglas reglas={[{ orden: 1, condicion: 'tardanzas > 100', formula: '0' }]} onChange={vi.fn()} />)
    expect(screen.getByText('no aplica en el ejemplo')).toBeInTheDocument()
  })
})
