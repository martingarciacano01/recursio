import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import DocumentosLegajo from '../DocumentosLegajo'

const subirDocumentoMock = vi.fn().mockResolvedValue({ ok: true })
const estado = {
  requeridos: [
    { id: 'r1', codigo: 'art', nombre: 'ART', obligatorio: true, vence: true, diasAviso: 30 },
    { id: 'r2', codigo: 'dni', nombre: 'Copia de DNI', obligatorio: true, vence: false, diasAviso: 30 },
  ],
  documentos: [
    { id: 'd1', requeridoId: 'r1', nombre: 'ART 2026', fechaVencimiento: '2026-12-31', storagePath: 'x/y.pdf', origen: 'recursio' },
    { id: 'presencio:z', requeridoId: null, nombre: 'Libreta sanitaria', fechaVencimiento: null, storagePath: null, origen: 'presencio' },
  ],
  cargando: false,
  error: null,
  cargarRequeridos: vi.fn(),
  cargarDocumentos: vi.fn(),
  subirDocumento: subirDocumentoMock,
  eliminarDocumento: vi.fn().mockResolvedValue({ ok: true }),
  urlFirmada: vi.fn().mockResolvedValue({ ok: true, url: 'https://x/y' }),
}
vi.mock('../../../store/documentosStore', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useDocumentosStore: (selector) => (selector ? selector(estado) : estado) }
})

describe('DocumentosLegajo', () => {
  beforeEach(() => { subirDocumentoMock.mockClear() })

  it('lista documentos de ambos origenes', () => {
    render(<DocumentosLegajo personalId="p1" empresaId="e1" />)
    expect(screen.getByText('ART 2026')).toBeInTheDocument()
    expect(screen.getByText('Libreta sanitaria')).toBeInTheDocument()
    expect(screen.getByText('Presencio')).toBeInTheDocument()
  })

  it('avisa cuales documentos obligatorios faltan', () => {
    render(<DocumentosLegajo personalId="p1" empresaId="e1" />)
    expect(screen.getByText(/Falta cargar: Copia de DNI/)).toBeInTheDocument()
  })

  it('cargar un documento llama a subirDocumento con los datos del formulario', async () => {
    render(<DocumentosLegajo personalId="p1" empresaId="e1" />)
    fireEvent.change(screen.getByLabelText('Nombre del documento'), { target: { value: 'DNI frente y dorso' } })
    fireEvent.change(screen.getByLabelText('Tipo requerido'), { target: { value: 'r2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cargar documento' }))
    await waitFor(() => {
      expect(subirDocumentoMock).toHaveBeenCalledWith(
        expect.objectContaining({ nombre: 'DNI frente y dorso', requeridoId: 'r2' }),
        'p1', 'e1'
      )
    })
  })
})
