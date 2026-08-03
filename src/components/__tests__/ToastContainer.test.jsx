import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ToastContainer from '../ToastContainer'
import { useToastStore } from '../../store/toastStore'

describe('ToastContainer', () => {
  beforeEach(() => { useToastStore.setState({ toasts: [] }) })

  it('no renderiza nada sin toasts', () => {
    const { container } = render(<ToastContainer />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renderiza cada toast de la cola con role status y aria-live polite', () => {
    useToastStore.setState({ toasts: [{ id: 1, mensaje: 'Guardado', tipo: 'success' }, { id: 2, mensaje: 'Ups', tipo: 'error' }] })
    render(<ToastContainer />)
    expect(screen.getByText('Guardado')).toBeInTheDocument()
    expect(screen.getByText('Ups')).toBeInTheDocument()
    const regiones = screen.getAllByRole('status')
    expect(regiones).toHaveLength(2)
    regiones.forEach((r) => expect(r).toHaveAttribute('aria-live', 'polite'))
  })
})
