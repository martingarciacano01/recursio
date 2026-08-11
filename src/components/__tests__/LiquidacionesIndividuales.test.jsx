import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LiquidacionesIndividuales from '../LiquidacionesIndividuales'

function chain(data, error = null, onUpdate = null) {
  const obj = {
    select: () => obj, eq: () => obj, order: () => obj, in: () => obj,
    update: (payload) => { if (onUpdate) onUpdate(payload); return obj },
    maybeSingle: () => Promise.resolve({ data, error }),
    single: () => Promise.resolve({ data, error }),
    then: (resolve) => resolve({ data, error }),
  }
  return obj
}

let legajoData = { fecha_baja: null, liquidacion_final_id: null }
let ausenciasData = [
  { id: 'aus-1', tipo: 'vacaciones', estado: 'aprobada', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-10' },
]
let vacacionesLiquidadasData = []
const updateConvenioMock = vi.fn()

const crearPeriodoVacacionesMock = vi.fn().mockResolvedValue({ ok: true })
const crearPeriodoFinalMock = vi.fn().mockResolvedValue({ ok: true })

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabla) => {
      if (tabla === 'nom_v_personal') return chain([{ id: 'p1', nombre: 'Juan Pérez', obra_id: null }])
      if (tabla === 'nom_legajo') return chain(legajoData, null, updateConvenioMock)
      if (tabla === 'nom_v_ausencias') return chain(ausenciasData)
      if (tabla === 'nom_vacaciones_liquidadas') return chain(vacacionesLiquidadasData)
      if (tabla === 'nom_convenios') return chain([
        { id: 'c1', nombre: 'UOCRA', empresa_id: 'e1', obra_id: null },
        { id: 'c2', nombre: 'LCT', empresa_id: null, obra_id: null },
        { id: 'c3', nombre: 'UOCRA', empresa_id: 'e1', obra_id: 'ob-1' },
      ])
      if (tabla === 'nom_v_obras') return chain([{ id: 'ob-1', nombre: 'Obra Norte' }])
      if (tabla === 'nom_categorias') return chain([
        { id: 'cat-1', nombre: 'Oficial', vigencia_desde: '2026-01-01' },
        { id: 'cat-2', nombre: 'Oficial especializado', vigencia_desde: '2026-01-01' },
      ])
      if (tabla === 'nom_liquidaciones') return chain([])
      return chain([])
    }),
  },
}))

vi.mock('../../store/liquidacionStore', () => ({
  useLiquidacionStore: () => ({
    crearPeriodoVacaciones: crearPeriodoVacacionesMock,
    crearPeriodoFinal: crearPeriodoFinalMock,
    emitirRecibo: vi.fn(),
  }),
}))

describe('LiquidacionesIndividuales', () => {
  beforeEach(() => {
    crearPeriodoVacacionesMock.mockClear()
    crearPeriodoFinalMock.mockClear()
    updateConvenioMock.mockClear()
    legajoData = { fecha_baja: null, liquidacion_final_id: null }
    ausenciasData = [
      { id: 'aus-1', tipo: 'vacaciones', estado: 'aprobada', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-10' },
    ]
    vacacionesLiquidadasData = []
  })

  it('al elegir una persona lista sus ausencias de vacaciones elegibles', async () => {
    render(<LiquidacionesIndividuales empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'p1' } })
    await waitFor(() => {
      expect(screen.getByText('2026-07-01 a 2026-07-10')).toBeInTheDocument()
    })
  })

  it('generar vacaciones desde una ausencia elegida llama a crearPeriodoVacaciones con el ausenciaId', async () => {
    render(<LiquidacionesIndividuales empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'p1' } })
    await waitFor(() => screen.getByText('2026-07-01 a 2026-07-10'))
    fireEvent.click(screen.getByRole('radio'))
    fireEvent.click(screen.getByRole('button', { name: 'Generar vacaciones' }))
    await waitFor(() => {
      expect(crearPeriodoVacacionesMock).toHaveBeenCalledWith('p1', '2026-07-01', '2026-07-10', 'e1', 'aus-1')
    })
  })

  it('sin ausencias elegibles, el toggle manual habilita fechas y genera con ausenciaId null', async () => {
    ausenciasData = []
    render(<LiquidacionesIndividuales empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'p1' } })
    await waitFor(() => {
      expect(screen.getByText(/Sin ausencias de vacaciones aprobadas/)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByLabelText('Cargar manualmente (sin ausencia en Presencio)'))
    fireEvent.change(screen.getByLabelText('Fecha desde'), { target: { value: '2026-07-01' } })
    fireEvent.change(screen.getByLabelText('Fecha hasta'), { target: { value: '2026-07-05' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generar vacaciones' }))
    await waitFor(() => {
      expect(crearPeriodoVacacionesMock).toHaveBeenCalledWith('p1', '2026-07-01', '2026-07-05', 'e1', null)
    })
  })

  it('muestra "Generar liquidación final" solo si hay baja sin liquidacion final', async () => {
    legajoData = { fecha_baja: '2026-06-30', motivo_baja: 'renuncia', liquidacion_final_id: null }
    render(<LiquidacionesIndividuales empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'p1' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generar liquidación final' })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generar liquidación final' }))
    await waitFor(() => {
      expect(crearPeriodoFinalMock).toHaveBeenCalledWith('p1', '2026-06-30', 'e1')
    })
  })

  it('no muestra "Generar liquidación final" si ya tiene liquidacion final', async () => {
    legajoData = { fecha_baja: '2026-06-30', motivo_baja: 'renuncia', liquidacion_final_id: 'liq-1' }
    render(<LiquidacionesIndividuales empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'p1' } })
    await waitFor(() => screen.getByText('2026-07-01 a 2026-07-10'))
    expect(screen.queryByRole('button', { name: 'Generar liquidación final' })).not.toBeInTheDocument()
  })

  it('muestra el convenio del legajo (Item 8)', async () => {
    legajoData = { id: 'l1', convenio_id: 'c1', categoria_id: 'cat-1', fecha_baja: null, liquidacion_final_id: null }
    render(<LiquidacionesIndividuales empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'p1' } })
    await waitFor(() => {
      expect(screen.getByText('Convenio del legajo')).toBeInTheDocument()
      expect(screen.getByText('UOCRA')).toBeInTheDocument()
    })
  })

  it('cambiar de convenio persiste convenio_id y categoria_id en el legajo (Item 8)', async () => {
    legajoData = { id: 'l1', convenio_id: 'c1', categoria_id: 'cat1', fecha_baja: null, liquidacion_final_id: null }
    render(<LiquidacionesIndividuales empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'p1' } })
    await waitFor(() => screen.getByText('Convenio del legajo'))
    fireEvent.click(screen.getByText('Cambiar'))
    fireEvent.change(screen.getByLabelText('Convenio'), { target: { value: 'c2' } })
    await waitFor(() => expect(screen.getByLabelText('Categoría')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'cat-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => {
      expect(updateConvenioMock).toHaveBeenCalledWith({ convenio_id: 'c2', categoria_id: 'cat-2' })
    })
  })

  it('ofrece dar de baja a una persona sin baja y al confirmar persiste en el legajo (Item 3)', async () => {
    legajoData = { id: 'l1', convenio_id: null, categoria_id: null, fecha_baja: null, liquidacion_final_id: null }
    render(<LiquidacionesIndividuales empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'p1' } })
    await waitFor(() => screen.getByRole('button', { name: 'Dar de baja' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }))
    fireEvent.change(screen.getByLabelText('Fecha de baja'), { target: { value: '2026-08-05' } })
    fireEvent.change(screen.getByLabelText('Motivo de baja'), { target: { value: 'renuncia' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar baja' }))
    await waitFor(() => {
      expect(updateConvenioMock).toHaveBeenCalledWith({ fecha_baja: '2026-08-05', motivo_baja: 'renuncia' })
    })
  })

  it('después de la baja la persona queda en condiciones de liquidar el final (Item 3)', async () => {
    legajoData = { id: 'l1', convenio_id: null, categoria_id: null, fecha_baja: '2026-06-30', motivo_baja: 'renuncia', liquidacion_final_id: null }
    render(<LiquidacionesIndividuales empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Persona'), { target: { value: 'p1' } })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Generar liquidación final' })).toBeInTheDocument()
    })
  })
})
