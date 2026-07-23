import { describe, it, expect } from 'vitest'
import { filtrarLegajos } from '../filtrarLegajos'

const FILAS = [
  { id: '1', nombre: 'Juan Pérez', dni: '30111222', estado: 'activo' },
  { id: '2', nombre: 'María López', dni: '28999888', estado: 'activo' },
  { id: '3', nombre: 'Carlos Ruiz', dni: '35-444-555', estado: 'inactivo' },
]

describe('filtrarLegajos', () => {
  it('sin busqueda ni filtro de estado devuelve todo', () => {
    expect(filtrarLegajos(FILAS, '', 'todos')).toHaveLength(3)
  })
  it('busca por nombre parcial, sin importar mayusculas', () => {
    expect(filtrarLegajos(FILAS, 'lópez', 'todos').map((f) => f.id)).toEqual(['2'])
  })
  it('busca por documento ignorando guiones', () => {
    expect(filtrarLegajos(FILAS, '35444555', 'todos').map((f) => f.id)).toEqual(['3'])
  })
  it('filtra por estado activo', () => {
    expect(filtrarLegajos(FILAS, '', 'activo').map((f) => f.id).sort()).toEqual(['1', '2'])
  })
  it('combina busqueda y estado', () => {
    expect(filtrarLegajos(FILAS, 'ruiz', 'inactivo').map((f) => f.id)).toEqual(['3'])
  })
})
