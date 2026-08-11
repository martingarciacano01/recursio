// src/utils/__tests__/descargarPlantillaVigencias.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let catsData = []
let nrsData = []
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabla) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: tabla === 'nom_categorias' ? catsData : nrsData,
        error: null,
      }),
    })),
  },
}))

const clickMock = vi.fn()
const revokeMock = vi.fn()
beforeEach(() => {
  catsData = []
  nrsData = []
  vi.useFakeTimers()
  global.URL.createObjectURL = vi.fn(() => 'blob:url')
  global.URL.revokeObjectURL = revokeMock
  global.document.createElement = vi.fn(() => ({ click: clickMock, set href(v) {}, set download(v) {}, get href() { return 'x' } }))
})
afterEach(() => vi.useRealTimers())

import { descargarPlantillaVigencias } from '../descargarPlantillaVigencias'

describe('descargarPlantillaVigencias', () => {
  it('arma un blob CSV con la plantilla y dispara la descarga', async () => {
    await descargarPlantillaVigencias('conv-1')
    expect(clickMock).toHaveBeenCalled()
    vi.advanceTimersByTime(1100)
    expect(revokeMock).toHaveBeenCalledWith('blob:url')
  })

  it('sin convenio usa los nombres por defecto', async () => {
    await expect(descargarPlantillaVigencias(null)).resolves.toBeUndefined()
    expect(clickMock).toHaveBeenCalled()
  })

  it('consulta categorías y no remunerativos del convenio para prellenar nombres', async () => {
    catsData = [{ nombre: 'Operario' }, { nombre: 'Oficial' }]
    nrsData = [{ categoria_nombre: 'Presente' }]
    await descargarPlantillaVigencias('conv-1')
    expect(clickMock).toHaveBeenCalled()
  })
})