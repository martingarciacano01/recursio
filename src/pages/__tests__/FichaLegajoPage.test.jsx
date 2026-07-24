import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FichaLegajoPage from '../FichaLegajoPage'

vi.mock('react-router-dom', () => ({
  useParams: () => ({ personalId: 'p1' }),
}))

vi.mock('../../store/authStore', () => ({
  useAuthStore: (selector) => selector({ empresa: { id: 'e1' }, empresaVista: null }),
}))

vi.mock('../../store/legajoStore', () => {
  const useLegajoStoreMock = () => ({
    legajos: [], familiares: [], sanciones: [], error: null,
    cargarLegajos: vi.fn(), cargarFamiliares: vi.fn(), cargarSanciones: vi.fn(),
  })
  useLegajoStoreMock.setState = vi.fn()
  return { useLegajoStore: useLegajoStoreMock }
})

vi.mock('../../lib/supabase', () => {
  const respuestas = {
    nom_v_personal: { data: { id: 'p1', nombre: 'Juan Pérez', dni: '30111222', puesto: 'Oficial' }, error: null },
    nom_v_ausencias: { data: [], error: null },
    nom_liquidaciones: { data: [], error: null },
  }
  const from = (tabla) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      single: () => builder,
      then: (resolve) => resolve(respuestas[tabla]),
    }
    return builder
  }
  return { supabase: { from } }
})

vi.mock('../../components/legajo/EditorDatosLegajo', () => ({
  default: () => <div>editor-datos</div>,
}))
vi.mock('../../components/legajo/DocumentosLegajo', () => ({
  default: () => <div>documentos-legajo</div>,
}))
vi.mock('../../components/legajo/SemaforoLegajo', () => ({
  default: () => <div>semaforo</div>,
}))

describe('FichaLegajoPage', () => {
  it('muestra los botones de las 6 pestañas', async () => {
    render(<FichaLegajoPage />)
    expect(await screen.findByText('editor-datos')).toBeInTheDocument()
    for (const p of ['Datos', 'Familiares', 'Documentación', 'Ausencias', 'Liquidaciones']) {
      expect(screen.getByRole('button', { name: p })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Sanciones (0)' })).toBeInTheDocument()
  })

  it('al clickear Liquidaciones muestra su contenido y oculta Datos', async () => {
    render(<FichaLegajoPage />)
    await screen.findByText('editor-datos')
    fireEvent.click(screen.getByRole('button', { name: 'Liquidaciones' }))
    expect(screen.getByText('Sin liquidaciones registradas.')).toBeInTheDocument()
    expect(screen.queryByText('editor-datos')).not.toBeInTheDocument()
  })
})
