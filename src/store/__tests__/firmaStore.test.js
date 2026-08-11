// src/store/__tests__/firmaStore.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'

const uploadMock = vi.fn()
const getPublicUrlMock = vi.fn()
const upsertMock = vi.fn()
const maybeSingleMock = vi.fn()

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    storage: {
      from: vi.fn(() => ({
        upload: uploadMock,
        getPublicUrl: getPublicUrlMock,
      })),
    },
    from: vi.fn((tabla) => {
      if (tabla === 'nom_firma_empresa') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: maybeSingleMock,
          upsert: upsertMock,
        }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    }),
  },
}))

import { useFirmaStore, TAMANIO_MAX_FIRMA } from '../firmaStore'

describe('useFirmaStore', () => {
  beforeEach(() => {
    uploadMock.mockReset()
    getPublicUrlMock.mockReset()
    upsertMock.mockReset()
    maybeSingleMock.mockReset()
    useFirmaStore.setState({ firmaUrl: null, nombreCompleto: '', puesto: '', cargando: false, subiendoFirma: false, error: null })
  })

  it('cargarFirma trae firma/nombre/puesto desde nom_firma_empresa', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { firma_url: 'https://x/firma.png', nombre_completo: 'María López', puesto: 'Contadora' },
      error: null,
    })
    await useFirmaStore.getState().cargarFirma('e1')
    const s = useFirmaStore.getState()
    expect(s.firmaUrl).toBe('https://x/firma.png')
    expect(s.nombreCompleto).toBe('María López')
    expect(s.puesto).toBe('Contadora')
  })

  it('subirFirma valida el tipo de archivo', async () => {
    const r = await useFirmaStore.getState().subirFirma({ empresaId: 'e1', file: { type: 'text/plain', size: 100, name: 'f.txt' }, nombreCompleto: 'A', puesto: 'B' })
    expect(r.ok).toBe(false)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('subirFirma valida el tamaño máximo', async () => {
    const r = await useFirmaStore.getState().subirFirma({ empresaId: 'e1', file: { type: 'image/png', size: TAMANIO_MAX_FIRMA + 1, name: 'f.png' }, nombreCompleto: 'A', puesto: 'B' })
    expect(r.ok).toBe(false)
  })

  it('subirFirma sube al bucket nom-firmas, toma la URL pública y hace upsert', async () => {
    uploadMock.mockResolvedValue({ error: null })
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: 'https://x/firma-123.png' } })
    upsertMock.mockResolvedValue({ error: null })
    const archivo = { type: 'image/png', size: 1000, name: 'firma.png' }
    const r = await useFirmaStore.getState().subirFirma({ empresaId: 'e1', file: archivo, nombreCompleto: 'María', puesto: 'Contadora' })
    expect(r.ok).toBe(true)
    expect(uploadMock).toHaveBeenCalled()
    expect(getPublicUrlMock).toHaveBeenCalled()
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ empresa_id: 'e1', firma_url: 'https://x/firma-123.png', nombre_completo: 'María', puesto: 'Contadora' }),
      { onConflict: 'empresa_id' }
    )
  })

  it('subirFirma sin nombreCompleto ni puesto rechaza la guardada', async () => {
    const r = await useFirmaStore.getState().subirFirma({ empresaId: 'e1', file: { type: 'image/png', size: 100, name: 'f.png' }, nombreCompleto: '', puesto: '' })
    expect(r.ok).toBe(false)
    expect(uploadMock).not.toHaveBeenCalled()
  })
})