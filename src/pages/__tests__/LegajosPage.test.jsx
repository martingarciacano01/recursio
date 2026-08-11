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
// Task 6.5: counts configurables — la head query del estado y el count de la
// query principal son independientes (el bug era justamente que "Cargar más"
// se calculaba contra el total de TODOS los estados).
let personalCount = 0
let estadoCount = 0

function chainPersonal() {
  const obj = {
    // select({ count, head }) → head query del estado: solo cuenta.
    select: (cols, opts) => {
      if (opts?.head) {
        return { eq: () => ({ eq: () => Promise.resolve({ data: null, error: null, count: estadoCount }) }) }
      }
      return obj
    },
    eq: () => obj,
    order: () => obj,
    range: () => obj,
    then: (resolve) => resolve({ data: personal, error: null, count: personalCount }),
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
    personalCount = personal.length
    estadoCount = 1
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

  // Task 6.5: "Cargar más" respeta el count del estado elegido. Con filtro
  // "Activo" (default), si ya cargamos todos los activos pero el total de la
  // empresa (todos los estados) es mayor, NO debe ofrecer "Cargar más".
  it('no ofrece "Cargar más" cuando ya están todos los del estado filtrado', async () => {
    personal = [
      { id: 'p1', nombre: 'Juan Pérez', dni: '111', puesto: 'Oficial', estado: 'activo', obra_id: null },
      { id: 'p2', nombre: 'Ana Gómez', dni: '222', puesto: 'Oficial', estado: 'inactivo', obra_id: null },
    ]
    personalCount = 150 // la empresa tiene más personal (de otros estados)
    estadoCount = 1     // pero solo 1 activo, que ya está en la página 0
    render(<MemoryRouter><LegajosPage /></MemoryRouter>)
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument()
  })

  it('ofrece "Cargar más" si aún quedan personas del estado elegido', async () => {
    personal = [{ id: 'p1', nombre: 'Juan Pérez', dni: '111', puesto: 'Oficial', estado: 'activo', obra_id: null }]
    personalCount = 150
    estadoCount = 150 // quedan más activos en páginas posteriores
    render(<MemoryRouter><LegajosPage /></MemoryRouter>)
    expect(await screen.findByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cargar más' })).toBeInTheDocument()
  })
})