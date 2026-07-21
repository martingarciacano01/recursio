import { describe, it, expect } from 'vitest'
import { convenioFromDB } from '../conveniosStore'

describe('mappers de convenios', () => {
  it('convenioFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'cv1', empresa_id: null, nombre: 'UOCRA', regimen: 'ley_22250', descripcion: 'Construcción' }
    expect(convenioFromDB(row)).toEqual({ id: 'cv1', empresaId: null, nombre: 'UOCRA', regimen: 'ley_22250', descripcion: 'Construcción' })
  })
})
