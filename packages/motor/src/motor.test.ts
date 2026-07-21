import { describe, it, expect } from 'vitest'
import { liquidarConceptos } from './motor'

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
