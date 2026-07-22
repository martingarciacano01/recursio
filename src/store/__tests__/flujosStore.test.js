import { describe, it, expect } from 'vitest'
import { flujoFromDB, pasoFromDB } from '../flujosStore'

describe('mappers de flujos', () => {
  it('flujoFromDB mapea snake_case a camelCase', () => {
    expect(flujoFromDB({ id: 'f1', empresa_id: 'e1', nombre: 'Piloto', activo: true }))
      .toEqual({ id: 'f1', empresaId: 'e1', nombre: 'Piloto', activo: true })
  })
  it('pasoFromDB mapea snake_case a camelCase', () => {
    expect(pasoFromDB({ id: 'p1', flujo_id: 'f1', orden: 1, nombre: 'Revisión interna', rol_requerido: 'revisor_interno', es_masivo: true }))
      .toEqual({ id: 'p1', flujoId: 'f1', orden: 1, nombre: 'Revisión interna', rolRequerido: 'revisor_interno', esMasivo: true })
  })
})
