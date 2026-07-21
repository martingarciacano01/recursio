import { describe, it, expect } from 'vitest'
import { parametroFromDB, parametroToDB } from '../parametrosStore'

describe('mappers de parametros', () => {
  it('parametroFromDB mapea snake_case y castea valor', () => {
    expect(parametroFromDB({ id: 'p1', empresa_id: 'e1', codigo: 'tope_sipa', valor: '123.4', vigencia_desde: '2026-01-01', vigencia_hasta: null }))
      .toEqual({ id: 'p1', empresaId: 'e1', codigo: 'tope_sipa', valor: 123.4, vigenciaDesde: '2026-01-01', vigenciaHasta: null })
  })
  it('parametroToDB arma la fila con empresa_id explícito', () => {
    expect(parametroToDB({ codigo: 'tope_sipa', valor: 100, vigenciaDesde: '2026-01-01', vigenciaHasta: null }, 'e1'))
      .toEqual({ empresa_id: 'e1', codigo: 'tope_sipa', valor: 100, vigencia_desde: '2026-01-01', vigencia_hasta: null })
  })
})
