// src/utils/__tests__/csvConvenios.test.js
import { describe, it, expect } from 'vitest'
import { parseCsvConvenios, generarPlantillaCsv } from '../csvConvenios'

// Task 5.1 (plan 2026-08-11): parser es-AR con separador ';', comillas para
// escapar, decimal con coma y errores por fila.

describe('parseCsvConvenios — fila válida', () => {
  it('parsea básico con decimal coma y modalidad', () => {
    const r = parseCsvConvenios('concepto;nombre;valor;modalidad;vigencia_desde\nbasico;Operario;1284,50;hora;2026-08-01')
    expect(r.ok).toBe(true)
    expect(r.errores).toEqual([])
    expect(r.filas).toHaveLength(1)
    expect(r.filas[0]).toEqual({
      fila: 2,
      concepto: 'basico', nombre: 'Operario', valor: 1284.5, modalidad: 'hora', vigenciaDesde: '2026-08-01',
    })
  })

  it('acepta fecha DD/MM/YYYY y la normaliza a ISO', () => {
    const r = parseCsvConvenios('concepto;nombre;valor;vigencia_desde\nbasico;Ayudante;1000,00;01/08/2026')
    expect(r.filas[0].vigenciaDesde).toBe('2026-08-01')
    expect(r.filas[0].modalidad).toBe('hora')
  })

  it('no_remunerativo no usa modalidad (queda null)', () => {
    const r = parseCsvConvenios('concepto;nombre;valor;vigencia_desde\nno_remunerativo;Adicional;500;2026-08-01')
    expect(r.filas[0].modalidad).toBeNull()
    expect(r.filas[0].concepto).toBe('no_remunerativo')
  })

  it('valores con comillas y ; dentro se escapan', () => {
    const r = parseCsvConvenios('concepto;nombre;valor;vigencia_desde\nbasico;"Categoría A; oficial";2000;2026-08-01')
    expect(r.filas[0].nombre).toBe('Categoría A; oficial')
  })
})

describe('parseCsvConvenios — errores por fila', () => {
  it('detección de encabezado faltante', () => {
    const r = parseCsvConvenios('hola;mundo\nbasico;Operario;100;2026-08-01')
    expect(r.ok).toBe(false)
    expect(r.errores.some((e) => e.mensaje.includes('encabezado'))).toBe(true)
  })

  it('valor no numérico → error en esa fila', () => {
    const r = parseCsvConvenios('concepto;nombre;valor;vigencia_desde\nbasico;Operario;abc;2026-08-01')
    expect(r.ok).toBe(false)
    expect(r.errores[0].fila).toBe(2)
    expect(r.errores[0].mensaje.toLowerCase()).toContain('valor')
  })

  it('fecha inválida → error', () => {
    const r = parseCsvConvenios('concepto;nombre;valor;vigencia_desde\nbasico;Operario;100;32/13/2026')
    expect(r.errores.length).toBe(1)
  })

  it('modalidad inválida en básico → error', () => {
    const r = parseCsvConvenios('concepto;nombre;valor;modalidad;vigencia_desde\nbasico;Operario;100;diaria;2026-08-01')
    expect(r.errores.length).toBe(1)
    expect(r.errores[0].mensaje.toLowerCase()).toContain('modalidad')
  })

  it('concepto inválido → error', () => {
    const r = parseCsvConvenios('concepto;nombre;valor;vigencia_desde\nraro;Operario;100;2026-08-01')
    expect(r.errores.length).toBe(1)
  })

  it('mezcla filas válidas e inválidas: las inválidas se descartan del resultado', () => {
    const r = parseCsvConvenios(
      'concepto;nombre;valor;vigencia_desde\nbasico;Operario;1000;2026-08-01\nbasico;Media Oficial;muy caro;2026-08-01'
    )
    expect(r.filas).toHaveLength(1)
    expect(r.errores).toHaveLength(1)
  })
})

describe('generarPlantillaCsv', () => {
  it('genera encabezado + una fila de ejemplo por tipo', () => {
    const csv = generarPlantillaCsv(['Operario', 'Media Oficial'])
    expect(csv).toContain('concepto;nombre;valor;modalidad;vigencia_desde')
    expect(csv).toContain('basico;Operario;')
    expect(csv).toContain('no_remunerativo;Media Oficial;')
  })
})