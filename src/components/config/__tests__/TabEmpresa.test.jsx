// src/components/config/__tests__/TabEmpresa.test.jsx — Sección de firma
// del aprobador (Fase 7 Task 7.2), gating por rol aprobar_pago.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import TabEmpresa from '../TabEmpresa'

let estadoAuth = { rol: 'admin', rolesNomina: [{ rol: 'admin' }] }
const cargarMock = vi.fn().mockResolvedValue()
const subirFirmaMock = vi.fn()
const cargarFirmaMock = vi.fn().mockResolvedValue()

vi.mock('../../../store/authStore', () => ({
  useAuthStore: (selector) => selector(estadoAuth),
}))

vi.mock('../../../store/empresaConfigStore', () => ({
  useEmpresaConfigStore: () => ({
    cuit: '', domicilio: '', nombre: 'Asset', logoUrl: null, logoPropio: null, subiendoLogo: false,
    cargando: false, error: null, cargar: cargarMock, guardar: vi.fn(), subirLogo: vi.fn(), quitarLogo: vi.fn(),
  }),
}))

vi.mock('../../../store/firmaStore', () => ({
  useFirmaStore: () => ({
    firmaUrl: null, nombreCompleto: '', puesto: '', cargando: false, subiendoFirma: false, error: null,
    cargarFirma: cargarFirmaMock, subirFirma: subirFirmaMock,
  }),
  TAMANIO_MAX_FIRMA: 2 * 1024 * 1024,
}))

vi.mock('../../../lib/supabase', () => {
  const chain = (data) => {
    const obj = {
      select: () => obj, eq: () => obj, order: () => obj, in: () => obj,
      maybeSingle: () => Promise.resolve({ data: data ?? null, error: null }),
      single: () => Promise.resolve({ data: data ?? null, error: null }),
      then: (resolve) => resolve({ data: data ?? [], error: null }),
    }
    return obj
  }
  return {
    supabase: {
      from: vi.fn(() => chain([])),
    },
  }
})

describe('TabEmpresa — firma del aprobador', () => {
  beforeEach(() => {
    estadoAuth = { rol: 'admin', rolesNomina: [{ rol: 'admin' }] }
    cargarMock.mockClear()
    subirFirmaMock.mockClear()
    cargarFirmaMock.mockClear()
  })

  it('con rol admin muestra la sección de firma', async () => {
    render(<TabEmpresa empresaId="e1" />)
    expect(await screen.findByText(/Firma del aprobador de pago/)).toBeInTheDocument()
  })

  it('con un rol sin aprobar_pago no muestra la sección', () => {
    estadoAuth = { rol: 'rrhh', rolesNomina: [{ rol: 'rrhh' }] }
    render(<TabEmpresa empresaId="e1" />)
    expect(screen.queryByText(/Firma del aprobador de pago/)).toBeNull()
  })

  it('guardar sin archivo y con nombre/puesto hace upsert de la aclaración', async () => {
    render(<TabEmpresa empresaId="e1" />)
    await screen.findByText(/Firma del aprobador de pago/)
    fireEvent.change(screen.getByLabelText('Nombre y Apellido'), { target: { value: 'María López' } })
    fireEvent.change(screen.getByLabelText('Puesto en la compañía'), { target: { value: 'Contadora' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar firma' }))
    await waitFor(() => {
      expect(subirFirmaMock).not.toHaveBeenCalled()
    })
  })

  it('solicita archivo + aclaración cuando no hay firma ni imagen', async () => {
    render(<TabEmpresa empresaId="e1" />)
    await screen.findByText(/Firma del aprobador de pago/)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar firma' }))
    expect(await screen.findByText(/Elegí una imagen de la firma/)).toBeInTheDocument()
  })
})