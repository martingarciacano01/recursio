import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useBonosStore, bonoFromDB, aplicacionFromDB, excepcionFromDB } from '../bonosStore'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

import { supabase } from '../../lib/supabase'

describe('mapeos', () => {
  it('bonoFromDB', () => {
    const r = bonoFromDB({ id: 'b1', nombre: 'Presentismo', monto_base: 10000, descripcion: 'x', activo: true })
    expect(r).toEqual({ id: 'b1', nombre: 'Presentismo', montoBase: 10000, descripcion: 'x', activo: true })
  })

  it('excepcionFromDB con monto null (bono desactivado)', () => {
    const r = excepcionFromDB({ id: 'e1', empresa_id: 'e1', personal_id: 'p1', bono_id: 'b1', monto: null })
    expect(r.monto).toBeNull()
  })

  it('aplicacionFromDB', () => {
    const r = aplicacionFromDB({ id: 'a1', empresa_id: 'e1', obra_id: 'o1', bono_id: 'b1', monto: '5000' })
    expect(r).toEqual({ id: 'a1', empresaId: 'e1', obraId: 'o1', bonoId: 'b1', monto: 5000, tipoMonto: 'fijo' })
  })

  it('aplicacionFromDB respeta tipo_monto por_horas (0064)', () => {
    const r = aplicacionFromDB({ id: 'a2', empresa_id: 'e1', obra_id: null, bono_id: 'b2', monto: '500', tipo_monto: 'por_horas' })
    expect(r.tipoMonto).toBe('por_horas')
  })
})

describe('cargarBonos', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('carga catálogo + aplicaciones + excepciones de la empresa', async () => {
    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_bonos') {
        return { select: () => ({ order: () => Promise.resolve({ data: [{ id: 'b1', nombre: 'X', monto_base: 0, descripcion: null, activo: true }], error: null }) }) }
      }
      if (tabla === 'nom_bono_aplicaciones') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: 'a1', empresa_id: 'e1', obra_id: null, bono_id: 'b1', monto: 1000 }], error: null }) }) }
      }
      if (tabla === 'nom_bono_excepciones') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
    })
    await useBonosStore.getState().cargarBonos('e1')
    const s = useBonosStore.getState()
    expect(s.bonos).toHaveLength(1)
    expect(s.aplicaciones).toHaveLength(1)
    expect(s.excepciones).toHaveLength(0)
    expect(s.error).toBeNull()
  })

  it('propaga el error si falla alguna consulta', async () => {
    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_bonos') return { select: () => ({ order: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
    })
    await useBonosStore.getState().cargarBonos('e1')
    expect(useBonosStore.getState().error).toBe('boom')
  })
})

describe('crearBonoGlobal', () => {
  beforeEach(() => { vi.clearAllMocks(); useBonosStore.setState({ bonos: [], aplicaciones: [], excepciones: [] }) })

  it('inserta en el catálogo global y actualiza el estado', async () => {
    supabase.from.mockReturnValue({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'b2', nombre: 'Nuevo', monto_base: 5000, descripcion: null, activo: true }, error: null }) }) }),
    })
    const r = await useBonosStore.getState().crearBonoGlobal('Nuevo', 5000, null)
    expect(r.ok).toBe(true)
    expect(useBonosStore.getState().bonos).toHaveLength(1)
  })
})

describe('aplicarBono / setExcepcion', () => {
  beforeEach(() => { vi.clearAllMocks(); useBonosStore.setState({ bonos: [], aplicaciones: [], excepciones: [] }) })

  it('aplicarBono hace upsert y guarda la aplicación', async () => {
    supabase.from.mockReturnValue({
      upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'a1', empresa_id: 'e1', obra_id: 'o1', bono_id: 'b1', monto: 20000, tipo_monto: 'fijo' }, error: null }) }) }),
    })
    const r = await useBonosStore.getState().aplicarBono({ empresaId: 'e1', obraId: 'o1', bonoId: 'b1', monto: 20000 })
    expect(r.ok).toBe(true)
    expect(useBonosStore.getState().aplicaciones).toHaveLength(1)
    expect(useBonosStore.getState().aplicaciones[0].tipoMonto).toBe('fijo')
  })

  it('aplicarBono mandado con tipoMonto por_horas (0064)', async () => {
    supabase.from.mockReturnValue({
      upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'a1', empresa_id: 'e1', obra_id: 'o1', bono_id: 'b1', monto: 1000, tipo_monto: 'por_horas' }, error: null }) }) }),
    })
    const r = await useBonosStore.getState().aplicarBono({ empresaId: 'e1', obraId: 'o1', bonoId: 'b1', monto: 1000, tipoMonto: 'por_horas' })
    expect(r.ok).toBe(true)
    expect(useBonosStore.getState().aplicaciones[0].tipoMonto).toBe('por_horas')
  })

  it('setExcepcion con monto null desactiva el bono para la persona', async () => {
    supabase.from.mockReturnValue({
      upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'e1', empresa_id: 'e1', personal_id: 'p1', bono_id: 'b1', monto: null }, error: null }) }) }),
    })
    const r = await useBonosStore.getState().setExcepcion({ empresaId: 'e1', personalId: 'p1', bonoId: 'b1', monto: null })
    expect(r.ok).toBe(true)
    expect(useBonosStore.getState().excepciones[0].monto).toBeNull()
  })
})
