import { describe, it, expect } from 'vitest'
import { liquidarConceptos, filtrarPorCategoria, type Concepto } from './motor'
import { generarFormula } from './formulas'

const presentismoEscalonado = {
  codigo: 'presentismo',
  nombre: 'Presentismo',
  tipo: 'remunerativo' as const,
  orden: 2,
  formula: 'remunerativo_acumulado * 0.0833',
  reglas: [
    { orden: 1, condicion: 'tardanzas > 3 or faltas_injustificadas > 0', formula: '0' },
    { orden: 2, condicion: 'tardanzas > 1', formula: 'remunerativo_acumulado * 0.0833 * 0.5' },
  ],
  imprimible: true,
}

const basico = {
  codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo' as const, orden: 1,
  formula: 'basico_convenio', imprimible: true,
}

describe('liquidarConceptos — presentismo escalonado', () => {
  it('con 0 tardanzas y 0 faltas paga presentismo 100%', () => {
    const r = liquidarConceptos([basico, presentismoEscalonado], {
      basico_convenio: 1000, tardanzas: 0, faltas_injustificadas: 0,
    })
    const item = r.items.find((i) => i.codigo === 'presentismo')!
    expect(item.monto).toBeCloseTo(83.3, 1)
    expect(item.reglaAplicada).toBe('base')
  })

  it('con 2 tardanzas paga presentismo al 50% (regla de orden 2)', () => {
    const r = liquidarConceptos([basico, presentismoEscalonado], {
      basico_convenio: 1000, tardanzas: 2, faltas_injustificadas: 0,
    })
    const item = r.items.find((i) => i.codigo === 'presentismo')!
    expect(item.monto).toBeCloseTo(41.65, 1)
    expect(item.reglaAplicada).toBe(1)
  })

  it('con más de 3 tardanzas pierde presentismo (regla de orden 1, primera que aplica)', () => {
    const r = liquidarConceptos([basico, presentismoEscalonado], {
      basico_convenio: 1000, tardanzas: 5, faltas_injustificadas: 0,
    })
    const item = r.items.find((i) => i.codigo === 'presentismo')!
    expect(item.monto).toBe(0)
    expect(item.reglaAplicada).toBe(0)
  })

  it('con 1 falta injustificada pierde presentismo aunque no haya tardanzas', () => {
    const r = liquidarConceptos([basico, presentismoEscalonado], {
      basico_convenio: 1000, tardanzas: 0, faltas_injustificadas: 1,
    })
    const item = r.items.find((i) => i.codigo === 'presentismo')!
    expect(item.monto).toBe(0)
  })

  it('acumula remunerativo_acumulado en orden: básico entra antes de presentismo', () => {
    const r = liquidarConceptos([basico, presentismoEscalonado], {
      basico_convenio: 1000, tardanzas: 0, faltas_injustificadas: 0,
    })
    expect(r.remunerativoAcumulado).toBeCloseTo(1083.3, 1)
  })

  it('conceptos fuera de orden se evalúan en el orden numérico, no en el orden del array', () => {
    const r = liquidarConceptos([presentismoEscalonado, basico], {
      basico_convenio: 1000, tardanzas: 0, faltas_injustificadas: 0,
    })
    expect(r.items[0].codigo).toBe('basico')
    expect(r.items[1].codigo).toBe('presentismo')
  })
})

describe('no_remunerativo_acumulado', () => {
  it('acumula los no remunerativos ya liquidados y los expone como variable', () => {
    const conceptos: Concepto[] = [
      { codigo: 'nr1', nombre: 'Suma no rem', tipo: 'no_remunerativo', orden: 1, formula: '10000', imprimible: true },
      { codigo: 'os_nr', nombre: 'OS sobre no rem', tipo: 'descuento', orden: 2, formula: 'no_remunerativo_acumulado * 0.03', imprimible: true },
    ]
    const r = liquidarConceptos(conceptos, {})
    expect(r.items[1].monto).toBe(300)
  })

  it('arranca en 0 si no hubo no remunerativos previos', () => {
    const conceptos: Concepto[] = [
      { codigo: 'x', nombre: 'X', tipo: 'informativo', orden: 1, formula: 'no_remunerativo_acumulado', imprimible: true },
    ]
    expect(liquidarConceptos(conceptos, {}).items[0].monto).toBe(0)
  })
})

describe('liquidarConceptos — contribucion sobre base "ambos"', () => {
  it('18% sobre remunerativo + no remunerativo acumulados', () => {
    const basico = { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo' as const, orden: 1, formula: 'basico_periodo', imprimible: true }
    const sumaNoRem = { codigo: 'suma_no_rem', nombre: 'Suma no remunerativa', tipo: 'no_remunerativo' as const, orden: 2, formula: 'no_rem_convenio', imprimible: true }
    const contribucion = {
      codigo: 'contrib_18', nombre: 'Contribución 18%', tipo: 'aporte_patronal' as const, orden: 3,
      formula: generarFormula({ modo: 'porcentaje', porcentaje: 18, base: 'ambos' }), imprimible: true,
    }
    const r = liquidarConceptos([basico, sumaNoRem, contribucion], { basico_periodo: 100000, no_rem_convenio: 50000 })
    const item = r.items.find((i) => i.codigo === 'contrib_18')!
    expect(item.monto).toBeCloseTo((100000 + 50000) * 0.18, 2) // 27000
  })
})

describe('filtrarPorCategoria', () => {
  const conceptos = [
    { codigo: 'a', categorias: null },
    { codigo: 'b', categorias: ['Oficial', 'Medio Oficial'] },
    { codigo: 'c', categorias: ['Ayudante'] },
    { codigo: 'd' },
  ]
  it('deja pasar los que no tienen categorias (null/undefined) y los que incluyen la categoría', () => {
    expect(filtrarPorCategoria(conceptos, 'Oficial').map((c) => c.codigo)).toEqual(['a', 'b', 'd'])
  })
  it('array vacío equivale a todas las categorías', () => {
    expect(filtrarPorCategoria([{ codigo: 'e', categorias: [] }], 'Oficial').map((c) => c.codigo)).toEqual(['e'])
  })
})

describe('unidad y base en ítems (recibo costo laboral)', () => {
  it('porcentaje: unidadTexto = "<pct> %" y baseCalculo = base evaluada', () => {
    const basico: Concepto = {
      codigo: 'BAS', nombre: 'Básico', tipo: 'remunerativo', orden: 1, formula: '1000', imprimible: true,
    }
    const jub: Concepto = {
      codigo: 'JUB', nombre: 'Jubilación', tipo: 'descuento', orden: 10,
      formula: 'remunerativo_acumulado * 0.11', imprimible: true,
      config: { modo: 'porcentaje', porcentaje: 11, base: 'remunerativo', recibo: { grupo: 'descuento', detalle: 'seguridad_social' } },
    }
    const r = liquidarConceptos([basico, jub], {})
    const item = r.items.find((i) => i.codigo === 'JUB')!
    expect(item.unidadTexto).toBe('11,00 %')
    expect(item.baseCalculo).toBe(1000)
    expect(item.grupoRecibo).toBe('descuento')
    expect(item.detalleRecibo).toBe('seguridad_social')
    expect(item.monto).toBeCloseTo(110)
  })

  it('nominal: unidadTexto = "1" y baseCalculo = monto', () => {
    const inacap: Concepto = {
      codigo: 'INA', nombre: 'INACAP', tipo: 'aporte_patronal', orden: 5, formula: '5481.25', imprimible: true,
      config: { modo: 'nominal', monto: 5481.25, recibo: { grupo: 'cct', detalle: null } },
    }
    const r = liquidarConceptos([inacap], {})
    const item = r.items[0]
    expect(item.unidadTexto).toBe('1')
    expect(item.baseCalculo).toBeCloseTo(5481.25)
    expect(item.grupoRecibo).toBe('cct')
    expect(item.detalleRecibo).toBeNull()
  })

  it('sin config: unidad/base/grupos quedan nulos', () => {
    const z: Concepto = { codigo: 'Z', nombre: 'Z', tipo: 'descuento', orden: 1, formula: '50', imprimible: true }
    const r = liquidarConceptos([z], {})
    expect(r.items[0].unidadTexto).toBeNull()
    expect(r.items[0].baseCalculo).toBeNull()
    expect(r.items[0].grupoRecibo).toBeNull()
    expect(r.items[0].detalleRecibo).toBeNull()
  })

  it('override: config.recibo.baseFormula/unidadFormula tienen prioridad', () => {
    const bas: Concepto = {
      codigo: 'BAS', nombre: 'Básico', tipo: 'remunerativo', orden: 1, formula: '36541.60 * 30', imprimible: true,
      config: { modo: 'nominal', recibo: { grupo: 'remunerativo', detalle: null, unidadFormula: '30', baseFormula: '36541.60' } },
    }
    const r = liquidarConceptos([bas], {})
    const item = r.items[0]
    expect(item.unidadTexto).toBe('30')
    expect(item.baseCalculo).toBeCloseTo(36541.6)
  })
})
