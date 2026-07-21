import { describe, it, expect } from 'vitest'
import { conceptoFromDB, conceptoToDB } from '../conceptosStore'

describe('mappers de conceptos', () => {
  it('conceptoFromDB mapea snake_case a camelCase incluyendo reglas anidadas', () => {
    const row = {
      id: 'c1', empresa_id: null, convenio_id: 'cv1', codigo: 'presentismo', nombre: 'Presentismo',
      tipo: 'remunerativo', formula: 'remunerativo_acumulado * 0.0833', orden: 2, imprimible: true,
      nom_concepto_reglas: [{ id: 'r1', orden: 1, condicion: 'tardanzas > 3', formula: '0' }],
    }
    const r = conceptoFromDB(row)
    expect(r).toEqual({
      id: 'c1', empresaId: null, convenioId: 'cv1', codigo: 'presentismo', nombre: 'Presentismo',
      tipo: 'remunerativo', formula: 'remunerativo_acumulado * 0.0833', orden: 2, imprimible: true,
      categorias: null, config: null,
      reglas: [{ id: 'r1', orden: 1, condicion: 'tardanzas > 3', formula: '0' }],
    })
  })

  it('conceptoToDB mapea camelCase a snake_case con empresa_id explícito', () => {
    const concepto = { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', formula: 'basico_convenio', orden: 1, convenioId: 'cv1' }
    expect(conceptoToDB(concepto, 'e1')).toEqual({
      empresa_id: 'e1', convenio_id: 'cv1', codigo: 'basico', nombre: 'Básico',
      tipo: 'remunerativo', formula: 'basico_convenio', orden: 1, imprimible: true,
      categorias: null, config: null,
    })
  })

  it('conceptoFromDB incluye categorias y config', () => {
    const row = {
      id: 'c9', empresa_id: 'e1', convenio_id: 'cv1', codigo: 'adic_titulo', nombre: 'Adicional título',
      tipo: 'remunerativo', formula: 'remunerativo_acumulado * 0.05', orden: 10, imprimible: true,
      categorias: ['Oficial'], config: { modo: 'porcentaje', porcentaje: 5, base: 'remunerativo' },
      nom_concepto_reglas: [],
    }
    const r = conceptoFromDB(row)
    expect(r.categorias).toEqual(['Oficial'])
    expect(r.config).toEqual({ modo: 'porcentaje', porcentaje: 5, base: 'remunerativo' })
  })

  it('conceptoToDB serializa categorias y config (null si faltan)', () => {
    const c = { codigo: 'x', nombre: 'X', tipo: 'remunerativo', formula: '1', orden: 1, convenioId: 'cv1' }
    const row = conceptoToDB(c, 'e1')
    expect(row.categorias).toBeNull()
    expect(row.config).toBeNull()
  })
})
