import { describe, it, expect } from 'vitest'
import { requeridoFromDB, documentoFromDB, estadoDocumento, faltantes } from '../documentosStore'

describe('mappers de documentos', () => {
  it('requeridoFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'r1', empresa_id: 'e1', codigo: 'art', nombre: 'ART', obligatorio: true, vence: true, dias_aviso: 30, orden: 10 }
    expect(requeridoFromDB(row)).toEqual({
      id: 'r1', empresaId: 'e1', codigo: 'art', nombre: 'ART',
      obligatorio: true, vence: true, diasAviso: 30, orden: 10,
    })
  })

  it('documentoFromDB mapea snake_case a camelCase y marca el origen recursio', () => {
    const row = { id: 'd1', empresa_id: 'e1', personal_id: 'p1', requerido_id: 'r1', nombre: 'ART 2026', storage_path: 'e1/p1/art.pdf', fecha_emision: '2026-01-01', fecha_vencimiento: '2026-12-31', observaciones: null }
    expect(documentoFromDB(row)).toEqual({
      id: 'd1', empresaId: 'e1', personalId: 'p1', requeridoId: 'r1', nombre: 'ART 2026',
      storagePath: 'e1/p1/art.pdf', fechaEmision: '2026-01-01', fechaVencimiento: '2026-12-31',
      observaciones: null, origen: 'recursio',
    })
  })
})

describe('estadoDocumento', () => {
  const hoy = '2026-07-28'
  it('sin vencimiento es vigente', () => {
    expect(estadoDocumento({ fechaVencimiento: null }, 30, hoy).clave).toBe('sin_vencimiento')
  })
  it('vencido cuando la fecha ya pasó', () => {
    expect(estadoDocumento({ fechaVencimiento: '2026-07-27' }, 30, hoy).clave).toBe('vencido')
  })
  it('por vencer dentro de los dias de aviso', () => {
    expect(estadoDocumento({ fechaVencimiento: '2026-08-10' }, 30, hoy).clave).toBe('por_vencer')
  })
  it('vigente fuera de los dias de aviso', () => {
    expect(estadoDocumento({ fechaVencimiento: '2026-12-31' }, 30, hoy).clave).toBe('vigente')
  })
})

describe('faltantes', () => {
  const requeridos = [
    { id: 'r1', codigo: 'art', nombre: 'ART', obligatorio: true },
    { id: 'r2', codigo: 'dni', nombre: 'DNI', obligatorio: true },
    { id: 'r3', codigo: 'carnet', nombre: 'Carnet', obligatorio: false },
  ]
  it('devuelve solo los obligatorios sin documento cargado', () => {
    const docs = [{ requeridoId: 'r1', nombre: 'ART 2026' }]
    expect(faltantes(requeridos, docs).map((r) => r.codigo)).toEqual(['dni'])
  })
  it('no falta nada cuando todos los obligatorios estan cargados', () => {
    const docs = [{ requeridoId: 'r1' }, { requeridoId: 'r2' }]
    expect(faltantes(requeridos, docs)).toEqual([])
  })
})
