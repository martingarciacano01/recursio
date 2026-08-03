import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ErrorBoundary from '../ErrorBoundary'

function Bomba() {
  throw new Error('boom')
}

describe('ErrorBoundary (Task 3.2)', () => {
  it('muestra el fallback en vez de pantalla en blanco cuando un hijo lanza en render', () => {
    // React loguea el error a console.error igual; silenciarlo evita ruido
    // en la salida del test sin ocultar el assert.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomba />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/algo salió mal/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /recargar/i })).toBeInTheDocument()
    spy.mockRestore()
  })

  it('renderiza a los hijos normalmente cuando no hay error', () => {
    render(
      <ErrorBoundary>
        <p>todo bien</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('todo bien')).toBeInTheDocument()
  })

  it('el botón Recargar llama a window.location.reload', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reloadMock = vi.fn()
    const originalLocation = window.location
    delete window.location
    window.location = { ...originalLocation, reload: reloadMock }
    render(
      <ErrorBoundary>
        <Bomba />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: /recargar/i }))
    expect(reloadMock).toHaveBeenCalled()
    window.location = originalLocation
    spy.mockRestore()
  })
})
