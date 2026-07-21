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
      reglas: [{ id: 'r1', orden: 1, condicion: 'tardanzas > 3', formula: '0' }],
    })
  })

  it('conceptoToDB mapea camelCase a snake_case con empresa_id explícito', () => {
    const concepto = { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', formula: 'basico_convenio', orden: 1, convenioId: 'cv1' }
    expect(conceptoToDB(concepto, 'e1')).toEqual({
      empresa_id: 'e1', convenio_id: 'cv1', codigo: 'basico', nombre: 'Básico',
      tipo: 'remunerativo', formula: 'basico_convenio', orden: 1, imprimible: true,
    })
  })
})
