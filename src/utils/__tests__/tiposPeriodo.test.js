import { describe, it, expect } from 'vitest'
import { FUERA_DE_CONVENIO, tiposDisponibles, convenioDelPeriodo, etiquetaTipo, conveniosParaPeriodo, esConvenioFueraDeConvenio } from '../tiposPeriodo'

const convenios = [
  { id: 'q', nombre: 'UOCRA', modalidad: 'quincenal' },
  { id: 'm', nombre: 'Mercantil', modalidad: 'mensual' },
]

describe('tiposDisponibles', () => {
  it('sin convenio elegido no ofrece ningún tipo', () => {
    expect(tiposDisponibles('', convenios)).toEqual([])
  })

  it('un convenio quincenal ofrece las dos quincenas, no el mensual', () => {
    const tipos = tiposDisponibles('q', convenios)
    expect(tipos).toContain('quincena_1')
    expect(tipos).toContain('quincena_2')
    expect(tipos).not.toContain('mensual')
  })

  it('un convenio mensual ofrece mensual, no las quincenas', () => {
    const tipos = tiposDisponibles('m', convenios)
    expect(tipos).toContain('mensual')
    expect(tipos).not.toContain('quincena_1')
    expect(tipos).not.toContain('quincena_2')
  })

  it('fuera de convenio ofrece el mensual_fc', () => {
    expect(tiposDisponibles(FUERA_DE_CONVENIO, convenios)).toContain('mensual_fc')
  })

  it('el SAC está disponible en cualquier caso porque va con fechas manuales', () => {
    for (const seleccion of ['q', 'm', FUERA_DE_CONVENIO]) {
      expect(tiposDisponibles(seleccion, convenios)).toEqual(expect.arrayContaining(['sac_1', 'sac_2']))
    }
  })

  it('un id de convenio inexistente no ofrece nada', () => {
    expect(tiposDisponibles('zzz', convenios)).toEqual([])
  })
})

describe('convenioDelPeriodo', () => {
  it('devuelve el convenio cuando el tipo depende de él', () => {
    expect(convenioDelPeriodo('q', 'quincena_1', convenios)).toMatchObject({ id: 'q' })
  })

  it('devuelve null para fuera de convenio', () => {
    expect(convenioDelPeriodo(FUERA_DE_CONVENIO, 'mensual_fc', convenios)).toBeNull()
  })

  it('devuelve null para los tipos de fechas manuales (SAC)', () => {
    expect(convenioDelPeriodo('q', 'sac_1', convenios)).toBeNull()
  })
})

describe('conveniosParaPeriodo', () => {
  const todos = [
    { id: 'fc', empresaId: 'e1', nombre: 'Fuera de convenio (LCT)', modalidad: 'quincenal' },
    { id: 'u', empresaId: 'e1', nombre: 'UOCRA (Ley 22.250)', modalidad: 'quincenal' },
    { id: 'global', empresaId: null, nombre: 'UOCRA (Ley 22.250)', modalidad: 'quincenal' },
  ]

  it('excluye el convenio "Fuera de convenio": para eso está la opción propia', () => {
    expect(conveniosParaPeriodo(todos, 'e1').map((c) => c.id)).toEqual(['u'])
  })

  it('excluye las plantillas globales', () => {
    expect(conveniosParaPeriodo(todos, 'e1').every((c) => c.empresaId === 'e1')).toBe(true)
  })

  it('detecta el convenio fuera de convenio sin importar mayúsculas ni acentos', () => {
    expect(esConvenioFueraDeConvenio({ nombre: 'FUERA DE CONVENIO (LCT)' })).toBe(true)
    expect(esConvenioFueraDeConvenio({ nombre: 'UOCRA' })).toBe(false)
    expect(esConvenioFueraDeConvenio(null)).toBe(false)
  })
})

describe('etiquetaTipo', () => {
  it('traduce los códigos a texto legible', () => {
    expect(etiquetaTipo('quincena_1')).toBe('1ra quincena')
    expect(etiquetaTipo('mensual_fc')).toBe('Mensual (fuera de convenio)')
  })

  it('devuelve el código tal cual si no lo conoce', () => {
    expect(etiquetaTipo('otro')).toBe('otro')
  })
})
