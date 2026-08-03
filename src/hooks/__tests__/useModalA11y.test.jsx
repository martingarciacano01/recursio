import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import { useModalA11y } from '../useModalA11y'

function ModalDePrueba({ onCerrar }) {
  const ref = useModalA11y(onCerrar)
  return (
    <div ref={ref} tabIndex={-1}>
      <button>Primero</button>
      <button>Segundo</button>
      <button>Último</button>
    </div>
  )
}

describe('useModalA11y (Task 4.7)', () => {
  it('pone el foco en el primer elemento enfocable al montar', () => {
    render(<ModalDePrueba onCerrar={() => {}} />)
    expect(screen.getByText('Primero')).toHaveFocus()
  })

  it('Escape llama a onCerrar', () => {
    const onCerrar = vi.fn()
    const { container } = render(<ModalDePrueba onCerrar={onCerrar} />)
    fireEvent.keyDown(container.firstChild, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalled()
  })

  it('Tab en el último elemento vuelve al primero (focus trap)', () => {
    const { container } = render(<ModalDePrueba onCerrar={() => {}} />)
    screen.getByText('Último').focus()
    fireEvent.keyDown(container.firstChild, { key: 'Tab' })
    expect(screen.getByText('Primero')).toHaveFocus()
  })

  it('Shift+Tab en el primer elemento va al último (focus trap)', () => {
    const { container } = render(<ModalDePrueba onCerrar={() => {}} />)
    screen.getByText('Primero').focus()
    fireEvent.keyDown(container.firstChild, { key: 'Tab', shiftKey: true })
    expect(screen.getByText('Último')).toHaveFocus()
  })
})
