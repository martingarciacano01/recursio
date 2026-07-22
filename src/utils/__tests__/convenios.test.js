import { describe, it, expect } from 'vitest'
import { filtrarConveniosVisibles, categoriasVigentes } from '../convenios'

describe('filtrarConveniosVisibles', () => {
  it('oculta el convenio global cuando existe clon de la empresa con el mismo nombre', () => {
    const convenios = [
      { id: 'g1', empresa_id: null, nombre: 'UOCRA' },
      { id: 'e1', empresa_id: 'emp-1', nombre: 'UOCRA' },
      { id: 'g2', empresa_id: null, nombre: 'Comercio' },
    ]
    expect(filtrarConveniosVisibles(convenios).map((c) => c.id)).toEqual(['e1', 'g2'])
  })
  it('sin clones devuelve los globales tal cual', () => {
    const convenios = [{ id: 'g1', empresa_id: null, nombre: 'UOCRA' }]
    expect(filtrarConveniosVisibles(convenios)).toHaveLength(1)
  })
})

describe('categoriasVigentes', () => {
  it('devuelve una sola fila por nombre: la vigente más reciente', () => {
    const cats = [
      { id: 'a', nombre: 'Oficial', vigencia_desde: '2026-01-01' },
      { id: 'b', nombre: 'Oficial', vigencia_desde: '2026-06-01' },
      { id: 'c', nombre: 'Ayudante', vigencia_desde: '2026-01-01' },
    ]
    const r = categoriasVigentes(cats, '2026-07-21')
    expect(r.map((c) => c.id).sort()).toEqual(['b', 'c'])
  })
  it('si todas las versiones son futuras, devuelve la más próxima', () => {
    const cats = [
      { id: 'x', nombre: 'Oficial', vigencia_desde: '2026-09-01' },
      { id: 'y', nombre: 'Oficial', vigencia_desde: '2026-08-01' },
    ]
    expect(categoriasVigentes(cats, '2026-07-21').map((c) => c.id)).toEqual(['y'])
  })
})
