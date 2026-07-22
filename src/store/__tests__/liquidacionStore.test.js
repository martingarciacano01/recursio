import { describe, it, expect } from 'vitest'
import { liquidacionFromDB, itemFromDB } from '../liquidacionStore'

describe('mappers de liquidacion', () => {
  it('liquidacionFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'l1', empresa_id: 'e1', periodo_id: 'p1', personal_id: 'per1', bruto: 1000, neto: 800, estado: 'preliminar' }
    expect(liquidacionFromDB(row)).toEqual({
      id: 'l1', empresaId: 'e1', periodoId: 'p1', personalId: 'per1', bruto: 1000, neto: 800, estado: 'preliminar',
      totalAportes: 0, totalContribuciones: 0, detalleHoras: null,
      numeroRecibo: null, hashPdf: null, version: 1, anulado: false, motivoAnulacion: null,
    })
  })

  it('itemFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'i1', liquidacion_id: 'l1', concepto_codigo: 'basico', concepto_nombre: 'Básico', tipo: 'remunerativo', monto: 500, regla_aplicada: 'base' }
    expect(itemFromDB(row)).toEqual({
      id: 'i1', liquidacionId: 'l1', conceptoCodigo: 'basico', conceptoNombre: 'Básico', tipo: 'remunerativo', monto: 500, reglaAplicada: 'base',
    })
  })
})
