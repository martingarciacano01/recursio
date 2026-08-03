import { describe, it, expect } from 'vitest'
import { progresoOnboarding } from '../progresoOnboarding'

const vacio = {
  empresa: null, convenios: [], categorias: [], documentos: [], flujos: [], legajos: [], periodos: [],
}

describe('progresoOnboarding', () => {
  it('con todo vacío, ningún hito está hecho', () => {
    const hitos = progresoOnboarding(vacio)
    expect(hitos).toHaveLength(7)
    expect(hitos.every((h) => h.hecho === false)).toBe(true)
  })

  it('cada hito tiene id, label y ruta', () => {
    const hitos = progresoOnboarding(vacio)
    hitos.forEach((h) => {
      expect(h).toHaveProperty('id')
      expect(h).toHaveProperty('label')
      expect(h).toHaveProperty('ruta')
      expect(h).toHaveProperty('hecho')
    })
  })

  it('empresa: hecho solo si tiene cuit y domicilio cargados', () => {
    const sinDatos = progresoOnboarding({ ...vacio, empresa: { cuit: '', domicilio: '' } })
    expect(sinDatos.find((h) => h.id === 'empresa').hecho).toBe(false)

    const conDatos = progresoOnboarding({ ...vacio, empresa: { cuit: '30-1-1', domicilio: 'Av. Siempre Viva 742' } })
    expect(conDatos.find((h) => h.id === 'empresa').hecho).toBe(true)
  })

  it('convenio: hecho si hay al menos un convenio propio de la empresa (clonado)', () => {
    const sinPropio = progresoOnboarding({ ...vacio, convenios: [{ id: 'c1', empresaId: null }] })
    expect(sinPropio.find((h) => h.id === 'convenio').hecho).toBe(false)

    const conPropio = progresoOnboarding({ ...vacio, convenios: [{ id: 'c1', empresaId: null }, { id: 'c2', empresaId: 'e1' }] })
    expect(conPropio.find((h) => h.id === 'convenio').hecho).toBe(true)
  })

  it('escalas: hecho si hay al menos una categoría cargada', () => {
    expect(progresoOnboarding({ ...vacio, categorias: [] }).find((h) => h.id === 'escalas').hecho).toBe(false)
    expect(progresoOnboarding({ ...vacio, categorias: [{ id: 'cat1' }] }).find((h) => h.id === 'escalas').hecho).toBe(true)
  })

  it('documentacion: hecho si hay al menos un documento requerido definido', () => {
    expect(progresoOnboarding({ ...vacio, documentos: [{ id: 'd1' }] }).find((h) => h.id === 'documentacion').hecho).toBe(true)
  })

  it('flujo: hecho si hay al menos un flujo de aprobación definido', () => {
    expect(progresoOnboarding({ ...vacio, flujos: [{ id: 'f1' }] }).find((h) => h.id === 'flujo').hecho).toBe(true)
  })

  it('legajos: hecho si hay al menos un legajo dado de alta', () => {
    expect(progresoOnboarding({ ...vacio, legajos: [{ id: 'l1' }] }).find((h) => h.id === 'legajos').hecho).toBe(true)
  })

  it('periodos: hecho si hay al menos un período creado', () => {
    expect(progresoOnboarding({ ...vacio, periodos: [{ id: 'p1' }] }).find((h) => h.id === 'periodos').hecho).toBe(true)
  })

  it('con todo cargado, los 7 hitos quedan hechos', () => {
    const hitos = progresoOnboarding({
      empresa: { cuit: '30-1-1', domicilio: 'x' },
      convenios: [{ id: 'c1', empresaId: 'e1' }],
      categorias: [{ id: 'cat1' }],
      documentos: [{ id: 'd1' }],
      flujos: [{ id: 'f1' }],
      legajos: [{ id: 'l1' }],
      periodos: [{ id: 'p1' }],
    })
    expect(hitos.every((h) => h.hecho)).toBe(true)
  })
})
