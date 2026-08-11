import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LegajosPage from '../LegajosPage'

let estadoAuth = { empresa: { id: 'e1' }, empresaVista: null }
vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel) => sel(estadoAuth),
}))

let personal = []
let legajos = []
let obras = []

function chainPersonal() {
  const obj = {
    select: () => obj, eq: () => obj, order: () => obj, range: () => obj,
    then: (resolve) => resolve({ data: personal, error: null, count: personal.length }),
  }
  return obj
}

function chainLegajos() {
  const obj = {
    select: () => obj, eq: () => obj,
    then: (resolve) => resolve({ data: legajos, error: null }),
  }
  return obj
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabla) => {
      if (tabla === 'nom_v_personal') return chainPersonal()
      if (tabla === 'nom_legajo') return chainLegajos()
      if (tabla === 'nom_v_obras') {
        return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: obras, error: null }) }) }) }
      }
      return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }
    }),
  },
}))

describe('LegajosPage', () => {
  beforeEach(() => {
    personal = [{ id: 'p1', nombre: 'Juan Pérez', dni: '111', puesto: 'Oficial', estado: 'activo', obra_id: 'ob-1' }]
    legajos = [{ personal_id: 'p1', cuil: null, cbu: null, convenio_id: null, categoria_id: null }]
    obras = [{ id: 'ob-1', nombre: 'Obra Norte' }]
  })

  it('muestra la columna Obra con el nombre resuelto de nom_v_obras', async () => {
    render(<MemoryRouter><LegajosPage /></MemoryRouter>)
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Obra Norte')).toBeInTheDocument()
  })

  it('muestra — cuando la persona no tiene obra', async () => {
    personal = [{ id: 'p1', nombre: 'Juan Pérez', dni: '111', puesto: 'Oficial', estado: 'activo', obra_id: null }]
    render(<MemoryRouter><LegajosPage /></MemoryRouter>)
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})