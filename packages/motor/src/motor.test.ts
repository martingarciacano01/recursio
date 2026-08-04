import { describe, it, expect } from 'vitest'
import { liquidarConceptos, filtrarPorCategoria, filtrarAsignados, excluirHorasExtra, type Concepto } from './motor'
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

describe('filtrarAsignados — adicionales por legajo (migración 0040)', () => {
  const conceptos = [
    { codigo: 'presentismo', categorias: ['Oficial'] }, // asignacion 'categoria' (default, no especificada)
    { codigo: 'altura', categorias: null, asignacion: 'legajo' as const }, // solo por asignación al legajo
    { codigo: 'zona_desfavorable', categorias: ['Ayudante'], asignacion: 'legajo' as const },
  ]

  it('un concepto asignacion=legajo NO entra por categoría: solo si está en el set de asignados', () => {
    // "altura" tiene categorias:null (aplicaría a TODAS por filtrarPorCategoria normal)
    // pero al ser asignacion:'legajo' eso se ignora — solo cuenta el set.
    expect(filtrarAsignados(conceptos, 'Oficial', new Set()).map((c) => c.codigo)).toEqual(['presentismo'])
  })

  it('con el legajo asignado, el concepto asignacion=legajo entra sin importar la categoría', () => {
    // zona_desfavorable está listado para 'Ayudante' pero el legajo es 'Oficial':
    // igual entra porque lo que manda es la asignación explícita, no `categorias`.
    const r = filtrarAsignados(conceptos, 'Oficial', new Set(['altura', 'zona_desfavorable']))
    expect(r.map((c) => c.codigo).sort()).toEqual(['altura', 'presentismo', 'zona_desfavorable'])
  })

  it('los conceptos asignacion=categoria (default) siguen la lógica de siempre, ignoran el set de asignados', () => {
    const r = filtrarAsignados(conceptos, 'Ayudante', new Set(['altura']))
    // presentismo (categorias:['Oficial']) NO pasa para categoria 'Ayudante'; altura sí por estar asignado
    expect(r.map((c) => c.codigo)).toEqual(['altura'])
  })
})

describe('override de adicional por legajo vía generarFormula (Edge Function)', () => {
  it('override porcentual usa % del básico, no el % configurado en el convenio', () => {
    // Simula lo que hace aplicarOverridesAdicionales en liquidar-periodo/index.ts:
    // el concepto trae una fórmula "de fábrica" del convenio, pero el override
    // del legajo la pisa por completo antes de liquidar.
    const alturaConvenio: Concepto = {
      codigo: 'altura', nombre: 'Adicional altura', tipo: 'remunerativo', orden: 20,
      formula: generarFormula({ modo: 'porcentaje', porcentaje: 5, base: 'remunerativo' }), // valor "de fábrica"
      imprimible: true, asignacion: 'legajo',
    }
    const overridePisado: Concepto = {
      ...alturaConvenio,
      formula: generarFormula({ modo: 'porcentaje', porcentaje: 10, base: 'basico' }), // override del legajo: 10% del básico
    }
    const basicoConcepto: Concepto = { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', orden: 1, formula: 'basico_periodo', imprimible: true }
    const r = liquidarConceptos([basicoConcepto, overridePisado], { basico_periodo: 200000 })
    const item = r.items.find((i) => i.codigo === 'altura')!
    expect(item.monto).toBeCloseTo(20000, 2) // 10% de 200000, no 5% de remunerativo_acumulado
  })

  it('override nominal fija un monto propio, independiente del básico', () => {
    const overrideNominal: Concepto = {
      codigo: 'altura', nombre: 'Adicional altura', tipo: 'remunerativo', orden: 20,
      formula: generarFormula({ modo: 'nominal', monto: 45000 }), imprimible: true, asignacion: 'legajo',
    }
    const r = liquidarConceptos([overrideNominal], {})
    expect(r.items[0].monto).toBe(45000)
  })

  // Task 2.13: valida que los adicionales UOCRA del artículo e-sueldos
  // sembrados en 0051 (asignacion:'legajo', formula por defecto '0') se
  // comportan como cualquier otro adicional por legajo — sin override no
  // aplican a nadie (filtrarAsignados), y con override porcentual pagan el
  // % del básico que carga la empresa por esa persona puntual.
  it('zona_desfavorable (0051): sin asignación no entra; con override porcentual paga % del básico', () => {
    const zonaDesfavorableConvenio: Concepto = {
      codigo: 'zona_desfavorable', nombre: 'Zona desfavorable', tipo: 'remunerativo', orden: 19,
      formula: '0', imprimible: true, asignacion: 'legajo',
    }
    const basicoConcepto: Concepto = { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', orden: 1, formula: 'basico_periodo', imprimible: true }

    // Legajo SIN el adicional asignado: filtrarAsignados ya lo saca del set (probado en su propio describe) — acá solo se valida el override cuando SÍ está asignado.
    const overrideZona: Concepto = {
      ...zonaDesfavorableConvenio,
      formula: generarFormula({ modo: 'porcentaje', porcentaje: 15, base: 'basico' }), // 15% cargado para esta persona
    }
    const r = liquidarConceptos([basicoConcepto, overrideZona], { basico_periodo: 900000 })
    const item = r.items.find((i) => i.codigo === 'zona_desfavorable')!
    expect(item.monto).toBeCloseTo(135000, 2) // 15% de 900000
  })
})

describe('base de cálculo sobre el remunerativo TOTAL (Task 2.11)', () => {
  it('un adicional con orden posterior a los descuentos entra igual en la base de jubilación', () => {
    const conceptos: Concepto[] = [
      { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', orden: 10, formula: '1000000', imprimible: true },
      { codigo: 'jubilacion', nombre: 'Jubilación', tipo: 'descuento', orden: 100,
        formula: 'min(remunerativo_acumulado, tope_sipa) * 0.11', imprimible: true },
      { codigo: 'adicional', nombre: 'Adicional nuevo', tipo: 'remunerativo', orden: 206, formula: '50000', imprimible: true },
    ]
    const r = liquidarConceptos(conceptos, { tope_sipa: 999999999 })
    const jub = r.items.find((i) => i.codigo === 'jubilacion')!
    expect(jub.monto).toBeCloseTo(1050000 * 0.11, 2) // hoy: 110000 (solo básico)
  })

  it('la base de las contribuciones patronales también usa el total', () => {
    const conceptos: Concepto[] = [
      { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', orden: 10, formula: '1000000', imprimible: true },
      { codigo: 'adicional', nombre: 'Adicional', tipo: 'remunerativo', orden: 206, formula: '50000', imprimible: true },
      { codigo: 'c_sipa', nombre: 'SIPA', tipo: 'aporte_patronal', orden: 200,
        formula: 'remunerativo_acumulado * 0.1077', imprimible: true },
    ]
    const r = liquidarConceptos(conceptos, {})
    expect(r.items.find((i) => i.codigo === 'c_sipa')!.monto).toBeCloseTo(1050000 * 0.1077, 2)
  })
})

describe('base y unidad de horas extra/feriado UOCRA (bug reportado en recibo real)', () => {
  it('hora_extra_50: BASE = valor de una hora al 50%, UNIDAD = horas extra redondeadas hacia arriba', () => {
    const he50: Concepto = {
      codigo: 'hora_extra_50', nombre: 'Hora extra 50%', tipo: 'remunerativo', orden: 16,
      formula: 'basico_convenio * 1.5 * horas_extra_50', imprimible: true,
      config: {
        modo: 'porcentaje', porcentaje: 150, base: 'basico',
        recibo: { grupo: 'remunerativo', detalle: null, baseFormula: 'basico_convenio * 1.5', unidadFormula: 'ceil(horas_extra_50)' },
      },
    }
    // basico_convenio para una categoría con modalidad 'hora' ya ES el
    // valor de una hora (ej. $4.948 en el recibo real reportado) — NO un
    // sueldo mensual a dividir por 200. El bug original dividía por 200 y
    // pagaba centavos de hora extra.
    const r = liquidarConceptos([he50], { basico_convenio: 5000, horas_extra_50: 4.2 })
    const item = r.items[0]
    expect(item.baseCalculo).toBeCloseTo(5000 * 1.5, 2) // valor de UNA hora extra 50%, no el básico/200
    expect(item.unidadTexto).toBe('5') // ceil(4.2) — antes mostraba "150,00 %"
    expect(item.monto).toBeCloseTo(5000 * 1.5 * 4.2, 2)
  })
})

describe('redondeo a centavos (Task 2.4)', () => {
  it('250519.17329999997 se guarda como 250519.17', () => {
    const r = liquidarConceptos([{ codigo: 'x', nombre: 'X', tipo: 'remunerativo', orden: 1,
      formula: '250519.17329999997', imprimible: true }], {})
    expect(r.items[0].monto).toBe(250519.17)
  })
})

describe('base acumulado_mensual (Task 2.3, tope SIPA consolidado por mes)', () => {
  it('base acumulado_mensual = remunerativo_acumulado + remunerativo_quincena1', () => {
    const j: Concepto = { codigo: 'jubilacion', nombre: 'J', tipo: 'descuento', orden: 5,
      formula: 'min(remunerativo_acumulado + remunerativo_quincena1, tope_sipa) * 0.11', imprimible: true }
    const b: Concepto = { codigo: 'basico', nombre: 'B', tipo: 'remunerativo', orden: 1, formula: '600000', imprimible: true }
    const r = liquidarConceptos([b, j], { tope_sipa: 800000, remunerativo_quincena1: 600000 })
    expect(r.items.find((i) => i.codigo === 'jubilacion')!.monto).toBeCloseTo(800000 * 0.11, 2)
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

  it('grupoRecibo no puede contradecir tipo para remunerativo/no_remunerativo/descuento (bug real: Jubilación tipo=descuento pero mal configurada con grupo=remunerativo inflaba el bruto y el neto del PDF)', () => {
    const jubMalConfigurada: Concepto = {
      codigo: 'JUB', nombre: 'Jubilación', tipo: 'descuento', orden: 10,
      formula: '1917', imprimible: true,
      config: { modo: 'porcentaje', porcentaje: 5, base: 'remunerativo', recibo: { grupo: 'remunerativo', detalle: 'seguridad_social' } },
    }
    const r = liquidarConceptos([jubMalConfigurada], {})
    const item = r.items[0]
    expect(item.grupoRecibo).toBe('descuento')
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

describe('excluirHorasExtra — flag contabilizar_horas_extras=false (Task 2.12)', () => {
  const conceptos = [
    { codigo: 'basico', nombre: 'Básico' },
    { codigo: 'hs_feriado', nombre: 'Recargo feriado' },
    { codigo: 'hora_extra_50', nombre: 'Hora extra 50%' },
    { codigo: 'hora_extra_100', nombre: 'Hora extra 100%' },
    { codigo: 'presentismo', nombre: 'Presentismo' },
    { codigo: 'jubilacion', nombre: 'Jubilación' },
  ]

  it('con contabilizarHorasExtras=false quita hora_extra_50/100 y conserva el resto', () => {
    const r = excluirHorasExtra(conceptos, false)
    expect(r.map((c) => c.codigo)).toEqual(['basico', 'hs_feriado', 'presentismo', 'jubilacion'])
  })

  it('con contabilizarHorasExtras=true (default) no toca nada', () => {
    const r = excluirHorasExtra(conceptos, true)
    expect(r.map((c) => c.codigo)).toEqual(conceptos.map((c) => c.codigo))
  })
})
