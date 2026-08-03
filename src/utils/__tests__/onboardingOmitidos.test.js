import { describe, it, expect, beforeEach } from 'vitest'
import { leerOmitidos, marcarOmitido } from '../onboardingOmitidos'

describe('onboardingOmitidos', () => {
  beforeEach(() => { localStorage.clear() })

  it('sin nada guardado, no hay hitos omitidos', () => {
    expect(leerOmitidos('empresa-1')).toEqual([])
  })

  it('marcarOmitido agrega el hito a la lista de esa empresa', () => {
    marcarOmitido('empresa-1', 'documentacion')
    expect(leerOmitidos('empresa-1')).toEqual(['documentacion'])
  })

  it('no duplica si se omite el mismo hito dos veces', () => {
    marcarOmitido('empresa-1', 'documentacion')
    marcarOmitido('empresa-1', 'documentacion')
    expect(leerOmitidos('empresa-1')).toEqual(['documentacion'])
  })

  it('cada empresa tiene su propia lista', () => {
    marcarOmitido('empresa-1', 'documentacion')
    marcarOmitido('empresa-2', 'flujo')
    expect(leerOmitidos('empresa-1')).toEqual(['documentacion'])
    expect(leerOmitidos('empresa-2')).toEqual(['flujo'])
  })

  it('sin empresaId, no rompe: devuelve lista vacía y no guarda nada', () => {
    expect(leerOmitidos(null)).toEqual([])
    marcarOmitido(null, 'documentacion')
    expect(leerOmitidos(null)).toEqual([])
  })
})
