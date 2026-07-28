import { describe, it, expect } from 'vitest'
import { legajoIncompleto } from '../legajoCompletitud'

describe('legajoIncompleto', () => {
  it('sin legajo es incompleto', () => {
    expect(legajoIncompleto(null)).toBe(true)
  })

  it('legajo de convenio completo NO es incompleto', () => {
    expect(legajoIncompleto({ cuil: '20-1-4', cbu: '123', convenioId: 'c1', categoriaId: 'k1' })).toBe(false)
  })

  it('legajo de convenio sin categoria es incompleto', () => {
    expect(legajoIncompleto({ cuil: '20-1-4', cbu: '123', convenioId: 'c1', categoriaId: null })).toBe(true)
  })

  it('fuera de convenio con sueldo convenido NO es incompleto aunque no tenga convenio ni categoria', () => {
    expect(legajoIncompleto({ cuil: '20-1-4', cbu: '123', fueraConvenio: true, sueldoConvenido: 900000 })).toBe(false)
  })

  it('fuera de convenio SIN sueldo convenido es incompleto', () => {
    expect(legajoIncompleto({ cuil: '20-1-4', cbu: '123', fueraConvenio: true, sueldoConvenido: null })).toBe(true)
  })

  it('fuera de convenio sin CUIL sigue siendo incompleto', () => {
    expect(legajoIncompleto({ cuil: '', cbu: '123', fueraConvenio: true, sueldoConvenido: 900000 })).toBe(true)
  })
})
