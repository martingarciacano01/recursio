// packages/motor/src/lotes.test.ts
import { describe, it, expect } from 'vitest'
import { partirEnLotes, agruparPorPersonalId } from './lotes'

describe('partirEnLotes', () => {
  it('parte un array en lotes del tamaño pedido', () => {
    expect(partirEnLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
  it('un array vacio da un array de lotes vacio', () => {
    expect(partirEnLotes([], 50)).toEqual([])
  })
  it('un array mas chico que el lote da un solo lote', () => {
    expect(partirEnLotes([1, 2], 50)).toEqual([[1, 2]])
  })
})

describe('agruparPorPersonalId', () => {
  it('agrupa filas por personal_id en un Map de arrays', () => {
    const filas = [
      { personal_id: 'a', tipo: 'entrada' },
      { personal_id: 'b', tipo: 'entrada' },
      { personal_id: 'a', tipo: 'salida' },
    ]
    const r = agruparPorPersonalId(filas)
    expect(r.get('a')).toEqual([{ personal_id: 'a', tipo: 'entrada' }, { personal_id: 'a', tipo: 'salida' }])
    expect(r.get('b')).toEqual([{ personal_id: 'b', tipo: 'entrada' }])
  })
  it('personal_id sin filas devuelve array vacio al hacer .get(...) ?? []', () => {
    const r = agruparPorPersonalId([])
    expect(r.get('inexistente') ?? []).toEqual([])
  })
})
