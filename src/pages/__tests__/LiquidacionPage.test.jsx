import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
const calcularPeriodoMock = vi.fn()
const cargarLiquidacionesMock = vi.fn()
vi.mock('../../store/liquidacionStore', () => ({
  useLiquidacionStore: () => ({
    liquidaciones: [], calculando: false, error: null, omitidos: [], advertencias: [], sinHoras: [],
    calcularPeriodo: calcularPeriodoMock, cargarLiquidaciones: cargarLiquidacionesMock, emitirRecibo: vi.fn(),
  }),
}))
const pushMock = vi.fn()
vi.mock('../../store/toastStore', () => ({
  useToastStore: (sel) => sel({ push: pushMock }),
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
let periodosMock = []
let updatePayload = null
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabla) => {
      if (tabla === 'nom_periodos') {
        return {
          select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: periodosMock, error: null }) }) }),
          insert: (payload) => { insertPayload = payload; return { select: () => ({ single: () => Promise.resolve({ data: { id: 'p1', ...payload }, error: null }) }) } },
          update: (payload) => { updatePayload = payload; return { eq: () => Promise.resolve({ error: null }) } },
        }
      }
      return chain([])
    }),
  },
}))

// El alta de período va convenio → tipo: primero se elige el convenio y su
// modalidad filtra los tipos posibles (src/utils/tiposPeriodo.js).
describe('LiquidacionPage — Nuevo período', () => {
  beforeEach(() => {
    insertPayload = null
    calcularPeriodoMock.mockReset().mockResolvedValue({ ok: true })
    pushMock.mockClear()
  })

  const abrirFormulario = () => {
    render(<MemoryRouter><LiquidacionPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo período' }))
  }

  it('crear un período de un convenio quincenal calcula las fechas y manda convenio_id', async () => {
    abrirFormulario()
    fireEvent.change(screen.getByLabelText('Convenio'), { target: { value: 'conv-uocra' } })
    fireEvent.change(screen.getByLabelText('Tipo de período'), { target: { value: 'quincena_1' } })
    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear período' }))
    await waitFor(() => {
      expect(insertPayload).toMatchObject({
        tipo: 'quincena_1', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-15', convenio_id: 'conv-uocra',
      })
    })
    // Task 6.7: tras crear, feedback (toast) + navegación a la pestaña Períodos.
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('Período 1ra quincena creado'), 'success')
  })

  it('un convenio quincenal no ofrece el tipo mensual', () => {
    abrirFormulario()
    fireEvent.change(screen.getByLabelText('Convenio'), { target: { value: 'conv-uocra' } })
    const opciones = [...screen.getByLabelText('Tipo de período').options].map((o) => o.value)
    expect(opciones).toContain('quincena_1')
    expect(opciones).toContain('quincena_2')
    expect(opciones).not.toContain('mensual')
  })

  it('fuera de convenio ofrece el mensual y no manda convenio_id', async () => {
    abrirFormulario()
    fireEvent.change(screen.getByLabelText('Convenio'), { target: { value: '__fuera_de_convenio__' } })
    const opciones = [...screen.getByLabelText('Tipo de período').options].map((o) => o.value)
    expect(opciones).toContain('mensual_fc')

    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '2026' } })
    fireEvent.change(screen.getByLabelText('Mes'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear período' }))
    await waitFor(() => {
      expect(insertPayload).toMatchObject({ tipo: 'mensual_fc', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-31' })
      expect(insertPayload.convenio_id).toBeUndefined()
    })
  })

  it('crear un SAC sigue usando fechas manuales (sin convenio)', async () => {
    abrirFormulario()
    fireEvent.change(screen.getByLabelText('Convenio'), { target: { value: 'conv-uocra' } })
    fireEvent.change(screen.getByLabelText('Tipo de período'), { target: { value: 'sac_1' } })
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-06-30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Crear período' }))
    await waitFor(() => {
      expect(insertPayload).toMatchObject({ tipo: 'sac_1', fecha_desde: '2026-01-01', fecha_hasta: '2026-06-30' })
      expect(insertPayload.convenio_id).toBeUndefined()
    })
  })

  it('sin convenio elegido no se puede crear el período', () => {
    abrirFormulario()
    expect(screen.getByLabelText('Tipo de período')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Crear período' })).toBeDisabled()
    expect(insertPayload).toBeNull()
  })
})

// Item 6 (sesión 2026-08-08): el selector de períodos filtra por estado con
// chips (Todos / Abiertos / En aprobación / Cerrados). El chip de la tarjeta
// "Período" recorta la lista que recibe SelectorPeriodo.
describe('LiquidacionPage — filtro de estado del selector de períodos', () => {
  const periodos = [
    { id: 'p-abierto', tipo: 'mensual', estado: 'abierto', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-31', convenio_id: null },
    { id: 'p-cerrado', tipo: 'quincena_1', estado: 'cerrado', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-15', convenio_id: null },
  ]

  beforeEach(() => { periodosMock = periodos })

  it('muestra el chip del período cerrado solo cuando el filtro es Cerrados', async () => {
    render(<MemoryRouter><LiquidacionPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Períodos' }))

    // Carga asíncrona de nom_periodos → SelectorPeriodo.
    const chipCerrado = await screen.findByRole('button', { name: /2026-07-01 a 2026-07-15/ })
    expect(chipCerrado).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2026-07-01 a 2026-07-31/ })).toBeInTheDocument()

    // Filtrar por Cerrados oculta el período abierto.
    fireEvent.click(screen.getByRole('button', { name: 'Cerrados' }))
    expect(screen.queryByRole('button', { name: /2026-07-01 a 2026-07-31/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2026-07-01 a 2026-07-15/ })).toBeInTheDocument()

    // Volver a Todos los muestra a ambos.
    fireEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.getByRole('button', { name: /2026-07-01 a 2026-07-31/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2026-07-01 a 2026-07-15/ })).toBeInTheDocument()
  })
})

// Critique 2026-08-09 (P1): cerrar el período es irreversible, así que pide
// confirmación explícita. El primer click en "Cerrar período" solo muestra
// el aviso; el `update` a nom_periodos recién corre con "Sí, cerrar período".
describe('LiquidacionPage — confirmación de cierre de período', () => {
  beforeEach(() => {
    updatePayload = null
    calcularPeriodoMock.mockReset().mockResolvedValue({ ok: true })
    pushMock.mockClear()
    periodosMock = [
      { id: 'p-abierto', tipo: 'mensual', estado: 'abierto', fecha_desde: '2026-07-01', fecha_hasta: '2026-07-31', convenio_id: null },
    ]
  })

  // Task 6.6: el error de cálculo ahora pasa por el toastStore global (en vez
  // del <Toast> legacy que se superponía en la misma esquina).
  it('si calcularPeriodo falla, avisa por el toast global y no recarga', async () => {
    calcularPeriodoMock.mockResolvedValueOnce({ ok: false, error: 'sin aportes cargados' })
    render(<MemoryRouter><LiquidacionPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Períodos' }))
    const chip = await screen.findByRole('button', { name: /2026-07-01 a 2026-07-31/ })
    fireEvent.click(chip)
    fireEvent.click(screen.getByRole('button', { name: 'Calcular' }))
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('sin aportes cargados', 'error')
    })
  })

  it('no cierra con el primer click y pide confirmar', async () => {
    render(<MemoryRouter><LiquidacionPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Períodos' }))

    // Seleccionar el período abierto para que aparezca la zona de acciones.
    const chip = await screen.findByRole('button', { name: /2026-07-01 a 2026-07-31/ })
    fireEvent.click(chip)

    const cerrar = screen.getByRole('button', { name: 'Cerrar período' })
    fireEvent.click(cerrar)

    // Aún no se ejecutó el update; está el aviso de confirmación.
    expect(updatePayload).toBeNull()
    await screen.findByText(/¿Cerrar el período\?/)

    fireEvent.click(screen.getByRole('button', { name: 'Sí, cerrar período' }))

    await waitFor(() => {
      expect(updatePayload).toEqual({ estado: 'cerrado' })
    })
  })

  it('cancelar descarta la confirmación sin cerrar', async () => {
    render(<MemoryRouter><LiquidacionPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('tab', { name: 'Períodos' }))

    const chip = await screen.findByRole('button', { name: /2026-07-01 a 2026-07-31/ })
    fireEvent.click(chip)

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar período' }))
    await screen.findByText(/¿Cerrar el período\?/)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(updatePayload).toBeNull()
    expect(screen.queryByText(/¿Cerrar el período\?/)).not.toBeInTheDocument()
  })
})
