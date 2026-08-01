import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useConveniosStore, convenioFromDB } from '../conveniosStore'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

import { supabase } from '../../lib/supabase'

describe('convenioFromDB', () => {
  it('mapea modalidad y fechas de corte', () => {
    const r = convenioFromDB({
      id: 'c1', empresa_id: 'e1', nombre: 'UOCRA', regimen: '22250', descripcion: null,
      modalidad: 'quincenal',
      corte_q1_desde: 1, corte_q1_hasta: 15, corte_q2_desde: 16, corte_q2_hasta: null,
      corte_mensual_desde: 1, corte_mensual_hasta: null,
    })
    expect(r.modalidad).toBe('quincenal')
    expect(r.corteQ1Desde).toBe(1)
    expect(r.corteQ1Hasta).toBe(15)
    expect(r.corteQ2Desde).toBe(16)
    expect(r.corteQ2Hasta).toBeNull()
    expect(r.corteMensualDesde).toBe(1)
    expect(r.corteMensualHasta).toBeNull()
  })
})

describe('crearConvenio', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('inserta el convenio con los campos de modalidad/corte (defaults incluidos) y recarga la lista', async () => {
    const insertado = {
      id: 'c2', empresa_id: 'e1', nombre: 'Nuevo', regimen: 'lct', descripcion: null,
      modalidad: 'mensual', corte_q1_desde: 1, corte_q1_hasta: 15, corte_q2_desde: 16, corte_q2_hasta: null,
      corte_mensual_desde: 1, corte_mensual_hasta: null,
    }
    const insertMock = vi.fn().mockReturnValue({ select: () => ({ single: () => Promise.resolve({ data: insertado, error: null }) }) })
    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_convenios') {
        return {
          insert: insertMock,
          select: () => ({ or: () => ({ order: () => Promise.resolve({ data: [insertado], error: null }) }) }),
        }
      }
      return { select: () => ({ or: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }
    })
    const r = await useConveniosStore.getState().crearConvenio('e1', {
      nombre: 'Nuevo', regimen: 'lct', modalidad: 'mensual',
    })
    expect(r.ok).toBe(true)
    expect(r.convenioId).toBe('c2')
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      empresa_id: 'e1', nombre: 'Nuevo', regimen: 'lct', modalidad: 'mensual',
      corte_q1_desde: 1, corte_q1_hasta: 15, corte_q2_desde: 16, corte_q2_hasta: null,
      corte_mensual_desde: 1, corte_mensual_hasta: null,
    }))
  })

  it('propaga el error si falla el insert', async () => {
    supabase.from.mockReturnValue({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }),
    })
    const r = await useConveniosStore.getState().crearConvenio('e1', { nombre: 'X', regimen: 'lct', modalidad: 'mensual' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('boom')
  })
})

describe('actualizarConvenio', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('manda solo las columnas enviadas (partial update) y actualiza el estado local', async () => {
    const updateMock = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
    supabase.from.mockReturnValue({ update: updateMock })
    useConveniosStore.setState({ convenios: [{ id: 'c1', nombre: 'UOCRA', modalidad: 'quincenal', corteMensualDesde: 1 }] })
    const r = await useConveniosStore.getState().actualizarConvenio('c1', { modalidad: 'mensual', corteMensualDesde: 5 })
    expect(r.ok).toBe(true)
    expect(updateMock).toHaveBeenCalledWith({ modalidad: 'mensual', corte_mensual_desde: 5 })
    const actualizado = useConveniosStore.getState().convenios.find((c) => c.id === 'c1')
    expect(actualizado.modalidad).toBe('mensual')
    expect(actualizado.corteMensualDesde).toBe(5)
    expect(actualizado.nombre).toBe('UOCRA')
  })
})

describe('cargarConvenios — cache por empresa', () => {
  beforeEach(() => {
    useConveniosStore.setState({ convenios: [], cargando: false, error: null, cargadoEmpresaId: null })
    supabase.from.mockReset()
    supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }))
  })

  it('no vuelve a pedir si ya cargó para la misma empresa', async () => {
    await useConveniosStore.getState().cargarConvenios('empresa-1')
    await useConveniosStore.getState().cargarConvenios('empresa-1')
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('vuelve a pedir si cambia la empresa', async () => {
    await useConveniosStore.getState().cargarConvenios('empresa-1')
    await useConveniosStore.getState().cargarConvenios('empresa-2')
    expect(supabase.from).toHaveBeenCalledTimes(2)
  })
})
