import { describe, it, expect } from 'vitest'
import { armarCsv } from '../exportCsv'

describe('armarCsv', () => {
  it('arma encabezado y filas separadas por ;', () => {
    const columnas = [
      { titulo: 'Nombre', valor: (f) => f.nombre },
      { titulo: 'Neto', valor: (f) => f.neto },
    ]
    const filas = [{ nombre: 'Juan Pérez', neto: 100000 }, { nombre: 'Ana Gómez', neto: 95000 }]
    expect(armarCsv(columnas, filas)).toBe('Nombre;Neto\nJuan Pérez;100000\nAna Gómez;95000')
  })

  it('escapa valores con ; " o salto de línea entre comillas', () => {
    const columnas = [{ titulo: 'Motivo', valor: (f) => f.motivo }]
    const filas = [{ motivo: 'contiene; punto y coma' }, { motivo: 'con "comillas"' }]
    expect(armarCsv(columnas, filas)).toBe('Motivo\n"contiene; punto y coma"\n"con ""comillas"""')
  })

  it('columnas tipo numero formatean con coma decimal es-AR y sin separador de miles', () => {
    const columnas = [{ titulo: 'Neto', valor: (f) => f.neto, tipo: 'numero' }]
    expect(armarCsv(columnas, [{ neto: 1234.5 }])).toBe('Neto\n1234,50')
  })

  it('columna numero con 0 da 0,00', () => {
    const columnas = [{ titulo: 'Aportes', valor: (f) => f.aportes, tipo: 'numero' }]
    expect(armarCsv(columnas, [{ aportes: 0 }])).toBe('Aportes\n0,00')
  })

  it('columna numero con negativos no agrega separador de miles', () => {
    const columnas = [{ titulo: 'Ajuste', valor: (f) => f.ajuste, tipo: 'numero' }]
    expect(armarCsv(columnas, [{ ajuste: -17976.345 }])).toBe('Ajuste\n-17976,35')
  })

  it('un texto con ; se sigue escapando bien aunque haya columnas numero en la misma fila', () => {
    const columnas = [
      { titulo: 'Nombre', valor: (f) => f.nombre },
      { titulo: 'Neto', valor: (f) => f.neto, tipo: 'numero' },
    ]
    const filas = [{ nombre: 'contiene; punto y coma', neto: 100 }]
    expect(armarCsv(columnas, filas)).toBe('Nombre;Neto\n"contiene; punto y coma";100,00')
  })
})
