import { describe, it, expect } from 'vitest'
import { evaluar } from './interprete'

describe('evaluar', () => {
  it('basico * 1.1 con basico=100 da 110', () => {
    expect(evaluar('basico * 1.1', { basico: 100 })).toBeCloseTo(110)
  })

  it('min(rem, tope) * 0.11 con rem=200 tope=150 da 16.5', () => {
    expect(evaluar('min(rem, tope) * 0.11', { rem: 200, tope: 150 })).toBeCloseTo(16.5)
  })

  it('tardanzas > 3 or faltas > 0 con tardanzas=2 faltas=1 da true', () => {
    expect(evaluar('tardanzas > 3 or faltas > 0', { tardanzas: 2, faltas: 1 })).toBe(true)
  })

  it('antiguedad < 1 ? 0.12 : 0.08 con antiguedad=3 da 0.08', () => {
    expect(evaluar('antiguedad < 1 ? 0.12 : 0.08', { antiguedad: 3 })).toBe(0.08)
  })

  it('(basico / 200) * 1.5 * he50 con basico=400 he50=10 da 30', () => {
    expect(evaluar('(basico / 200) * 1.5 * he50', { basico: 400, he50: 10 })).toBeCloseTo(30)
  })

  it('variable desconocida tira error claro', () => {
    expect(() => evaluar('foo + 1', {})).toThrow('variable desconocida: foo')
  })

  it('no usa eval ni Function del entorno', () => {
    const fuente = evaluar.toString()
    expect(fuente).not.toContain('eval(')
    expect(fuente).not.toContain('Function(')
  })

  it('división por cero tira error explícito', () => {
    expect(() => evaluar('10 / 0', {})).toThrow('división por cero')
  })

  it('min() sin argumentos tira error claro', () => {
    expect(() => evaluar('min()', {})).toThrow('min necesita al menos un argumento')
  })

  it('max() sin argumentos tira error claro', () => {
    expect(() => evaluar('max()', {})).toThrow('max necesita al menos un argumento')
  })

  it('round() sin argumentos tira error claro', () => {
    expect(() => evaluar('round()', {})).toThrow('round necesita exactamente un argumento numérico')
  })

  it('round() con dos argumentos tira error claro', () => {
    expect(() => evaluar('round(1.5, 2)', {})).toThrow('round necesita exactamente un argumento numérico')
  })

  it('paréntesis sin cerrar da mensaje legible con posición, sin nombres internos de token', () => {
    expect(() => evaluar('(1 + 2', {})).toThrow(/se esperaba "\)".*en la posición/)
  })

  it('ternario sin ":" da mensaje legible', () => {
    expect(() => evaluar('1 < 2 ? 1', {})).toThrow(/se esperaba ":".*en la posición/)
  })

  it('token inesperado incluye la posición', () => {
    expect(() => evaluar('1 + @', {})).toThrow(/en la posición 4/)
  })

  it('soporta decimales sin dígito antes del punto', () => {
    expect(evaluar('.5 + .25', {})).toBeCloseTo(0.75)
  })

  it('AND en mayúsculas sugiere la palabra clave en minúsculas', () => {
    // "AND" no matchea la palabra clave 'and' (case-sensitive), así que se interpreta
    // como variable; al evaluarla sin estar definida, el error sugiere la forma correcta.
    expect(() => evaluar('AND + 1', {})).toThrow(
      'variable desconocida: AND (¿quisiste decir "and" en minúsculas?)'
    )
  })

  it('Not en mayúscula sugiere la palabra clave en minúsculas', () => {
    expect(() => evaluar('Not + 1', {})).toThrow(
      'variable desconocida: Not (¿quisiste decir "not" en minúsculas?)'
    )
  })

  it('string vacío tira error claro', () => {
    expect(() => evaluar('', {})).toThrow('la fórmula está vacía')
    expect(() => evaluar('   ', {})).toThrow('la fórmula está vacía')
  })

  it('unario + es soportado', () => {
    expect(evaluar('+5', {})).toBe(5)
  })

  it('comparaciones encadenadas dan mensaje claro', () => {
    expect(() => evaluar('1 < 2 < 3', {})).toThrow(/no se pueden encadenar comparaciones/)
  })
})
