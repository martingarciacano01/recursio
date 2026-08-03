import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AprobacionesPage from '../AprobacionesPage'
import { useAprobacionesStore } from '../../store/aprobacionesStore'
import { useAuthStore } from '../../store/authStore'

vi.mock('../../store/aprobacionesStore')
vi.mock('../../store/authStore')

function setupStore({ revisarLiquidacion = vi.fn().mockResolvedValue({ ok: true }) } = {}) {
  const instancias = [{ id: 'i1', periodoId: 'p1', estado: 'en_progreso', periodo: { tipo: 'mensual', fechaDesde: '2026-07-01', fechaHasta: '2026-07-31' }, pasoActual: { orden: 1, nombre: 'Revisión' } }]
  const recibosPorPeriodo = { p1: [
    { id: 'l1', periodoId: 'p1', personalId: 'per1', bruto: 100000, totalAportes: 17000, neto: 83000, detalleHoras: { horasNormales: 176 }, estadoRevision: 'pendiente', motivoRechazo: null },
    { id: 'l2', periodoId: 'p1', personalId: 'per2', bruto: 50000, totalAportes: 8500, neto: 41500, detalleHoras: { horasNormales: 88 }, estadoRevision: 'pendiente', motivoRechazo: null },
  ] }
  const agregadosPorPeriodo = { p1: { bruto: 150000, totalAportes: 25500, neto: 124500, cantidad: 2 } }
  const personalPorId = { per1: 'Juan Pérez', per2: 'Ana Gómez' }
  useAprobacionesStore.mockReturnValue({
    instancias, recibosPorPeriodo, agregadosPorPeriodo, personalPorId,
    cargando: false, error: null,
    cargarInstancias: vi.fn(), actuar: vi.fn().mockResolvedValue({ ok: true }), revisarLiquidacion,
  })
  useAuthStore.mockImplementation((sel) => sel({ empresa: { id: 'e1' }, empresaVista: null }))
  return { revisarLiquidacion }
}

describe('AprobacionesPage — detalle de recibos y rechazo individual', () => {
  beforeEach(() => vi.clearAllMocks())

  it('muestra el detalle de cada recibo (bruto, descuentos, neto, horas)', () => {
    setupStore()
    render(<MemoryRouter><AprobacionesPage /></MemoryRouter>)
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.getByText('Ana Gómez')).toBeInTheDocument()
    expect(screen.getAllByText(/100\.000,00/).length).toBeGreaterThan(0)
  })

  it('rechazar es de dos pasos: clickear Rechazar abre el panel de motivo, y Confirmar está deshabilitado sin texto', () => {
    setupStore()
    render(<MemoryRouter><AprobacionesPage /></MemoryRouter>)
    // Antes de abrir el panel no hay ningún textarea de motivo en pantalla
    // (Task 4.1 revisión de diseño: evitar 3 textareas vacíos siempre visibles).
    expect(screen.queryByPlaceholderText('motivo del rechazo')).not.toBeInTheDocument()

    const [botonRechazar] = screen.getAllByRole('button', { name: 'Rechazar' })
    fireEvent.click(botonRechazar)

    expect(screen.getByPlaceholderText('motivo del rechazo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })

  it('rechazo individual llama a revisarLiquidacion con el motivo cargado', async () => {
    const { revisarLiquidacion } = setupStore()
    render(<MemoryRouter><AprobacionesPage /></MemoryRouter>)
    const [botonRechazar] = screen.getAllByRole('button', { name: 'Rechazar' })
    fireEvent.click(botonRechazar)
    fireEvent.change(screen.getByPlaceholderText('motivo del rechazo'), { target: { value: 'legajo incompleto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(revisarLiquidacion).toHaveBeenCalledWith('l1', 'rechazado', 'legajo incompleto')
  })

  it('aprobar seleccionados llama a revisarLiquidacion para cada recibo tildado', async () => {
    const { revisarLiquidacion } = setupStore()
    render(<MemoryRouter><AprobacionesPage /></MemoryRouter>)
    const checkboxes = screen.getAllByRole('checkbox', { name: /seleccionar recibo/i })
    fireEvent.click(checkboxes[0])
    fireEvent.click(checkboxes[1])
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar seleccionados' }))
    await waitFor(() => expect(revisarLiquidacion).toHaveBeenCalledTimes(2))
    expect(revisarLiquidacion).toHaveBeenCalledWith('l1', 'aprobado', null)
    expect(revisarLiquidacion).toHaveBeenCalledWith('l2', 'aprobado', null)
  })

  it('el link Ver detalle apunta a /liquidacion?periodo=<id>', () => {
    setupStore()
    render(<MemoryRouter><AprobacionesPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Ver detalle' })).toHaveAttribute('href', '/liquidacion?periodo=p1')
  })
})
