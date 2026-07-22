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
})
