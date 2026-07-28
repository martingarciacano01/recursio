import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LiquidacionPage from '../LiquidacionPage'

function chain(data, error = null) {
  const obj = {
    select: () => obj, eq: () => obj, order: () => obj, in: () => obj, or: () => obj,
    insert: () => obj, single: () => Promise.resolve({ data, error }),
    then: (resolve) => resolve({ data, error }),
  }
  return obj
}

vi.mock('../../store/authStore', () => ({
  useAuthStore: (sel) => sel({ empresa: { id: 'e1' }, empresaVista: null }),
}))
vi.mock('../../store/liquidacionStore', () => ({
  useLiquidacionStore: () => ({
    liquidaciones: [], calculando: false, error: null, omitidos: [], advertencias: [],
    calcularPeriodo: vi.fn(), cargarLiquidaciones: vi.fn(), emitirRecibo: vi.fn(),
  }),
}))
vi.mock('../../store/flujosStore', () => ({
  useFlujosStore: () => ({ flujos: [], cargarFlujos: vi.fn(), iniciarFlujo: vi.fn() }),
}))
vi.mock('../../store/conveniosStore', () => ({
  useConveniosStore: () => ({
    convenios: [
      { id: 'conv-uocra', empresaId: 'e1', nombre: 'UOCRA', modalidad: 'quincenal',
        corteQ1Desde: 1, corteQ1Hasta: 15, corteQ2Desde: 16, corteQ2Hasta: null,
        corteMensualDesde: 1, corteMensualHasta: null },
    ],
    cargarConvenios: vi.fn(),
  }),
}))

let insertPayload = null
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabla) => {
      if (tabla === 'nom_periodos') {
        return {
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
          insert: (payload) => { insertPayload = payload; return { select: () => ({ single: () => Promise.resolve({ data: { id: 'p1', ...payload }, error: null }) }) } },
        }
      }
      return chain([])
    }),
  },
}))

describe('LiquidacionPage — Nuevo período', () => {
  beforeEach(() => { insertPayload = null })

  it('crear un período mensual/quincenal calcula las fechas y las manda con convenio_id', async () => {
    render(<LiquidacionPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo período' }))
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'quincena_1' } })
    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Convenio'), { target: { value: 'conv-uocra' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear período' }))
    await waitFor(() => {
      expect(insertPayload).toMatchObject({
        tipo: 'quincena_1', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-15', convenio_id: 'conv-uocra',
      })
    })
  })

  it('crear un SAC sigue usando fechas manuales (sin convenio)', async () => {
    render(<LiquidacionPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo período' }))
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'sac_1' } })
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear período' }))
    await waitFor(() => {
      expect(insertPayload).toMatchObject({ tipo: 'sac_1', fecha_desde: '2026-01-01', fecha_hasta: '2026-06-30' })
      expect(insertPayload.convenio_id).toBeUndefined()
    })
  })

  it('cambiar de tipo resetea el convenio elegido', () => {
    render(<LiquidacionPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo período' }))
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'quincena_1' } })
    fireEvent.change(screen.getByLabelText('Convenio'), { target: { value: 'conv-uocra' } })
    expect(screen.getByLabelText('Convenio').value).toBe('conv-uocra')
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'mensual' } })
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'quincena_1' } })
    expect(screen.getByLabelText('Convenio').value).toBe('')
  })

  it('sin convenio disponible para la modalidad, Crear período muestra el error y no llama a insert', async () => {
    render(<LiquidacionPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo período' }))
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'mensual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear período' }))
    await waitFor(() => {
      expect(screen.getByText('No hay ningún convenio con modalidad "mensual" configurado.')).toBeInTheDocument()
    })
    expect(insertPayload).toBeNull()
  })
})
