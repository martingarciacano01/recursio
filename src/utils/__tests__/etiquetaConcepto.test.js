import { describe, it, expect } from 'vitest'
import { etiquetaConcepto } from '../etiquetaConcepto'

describe('etiquetaConcepto', () => {
  it('con codigo_recibo antepone el codigo', () => {
    expect(etiquetaConcepto({ codigo_recibo: '0015', concepto_nombre: 'Horas normales' })).toBe('0015 Horas normales')
  })
  it('sin codigo_recibo devuelve solo el nombre', () => {
    expect(etiquetaConcepto({ codigo_recibo: null, concepto_nombre: 'Horas normales' })).toBe('Horas normales')
  })
})
