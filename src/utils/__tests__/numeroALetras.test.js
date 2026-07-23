import { describe, it, expect } from 'vitest'
import { numeroALetras } from '../numeroALetras'

describe('numeroALetras', () => {
  it('cero', () => expect(numeroALetras(0)).toBe('Cero Pesos con 00/100'))
  it('solo centavos', () => expect(numeroALetras(0.95)).toBe('Cero Pesos con 95/100'))
  it('miles con decimales', () => expect(numeroALetras(2393.95)).toBe('Dos mil trescientos noventa y tres Pesos con 95/100'))
  it('un millon exacto', () => expect(numeroALetras(1000000)).toBe('Un millón Pesos con 00/100'))
  it('mil uno (sin "un" antes de mil)', () => expect(numeroALetras(1001)).toBe('Mil uno Pesos con 00/100'))
  it('veintiuno', () => expect(numeroALetras(21)).toBe('Veintiuno Pesos con 00/100'))
  it('dieciseis', () => expect(numeroALetras(16)).toBe('Dieciséis Pesos con 00/100'))
  it('cien exacto (no "ciento")', () => expect(numeroALetras(100)).toBe('Cien Pesos con 00/100'))
  it('ciento uno', () => expect(numeroALetras(101)).toBe('Ciento uno Pesos con 00/100'))
})
