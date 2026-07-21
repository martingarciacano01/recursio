import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SeccionColapsable from '../SeccionColapsable'

describe('SeccionColapsable', () => {
  it('arranca expandida por defecto y muestra el contenido', () => {
    render(<SeccionColapsable titulo="Datos"><p>contenido</p></SeccionColapsable>)
    expect(screen.getByText('contenido')).toBeInTheDocument()
  })

  it('al hacer click en el título colapsa el contenido', () => {
    render(<SeccionColapsable titulo="Datos"><p>contenido</p></SeccionColapsable>)
    fireEvent.click(screen.getByText('Datos'))
    expect(screen.queryByText('contenido')).not.toBeInTheDocument()
  })
})
