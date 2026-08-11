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

describe('clonarConvenio — convenio por obra (Task 4.2)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sin obraId manda p_obra_id null (comportamiento previo)', async () => {
    supabase.rpc.mockResolvedValue({ data: 'nuevo-id', error: null })
    const r = await useConveniosStore.getState().clonarConvenio('global-1', 'e1')
    expect(r.ok).toBe(true)
    expect(r.convenioId).toBe('nuevo-id')
    expect(supabase.rpc).toHaveBeenCalledWith('clonar_convenio', {
      convenio_global_id: 'global-1', p_empresa_id: 'e1', p_obra_id: null,
    })
  })

  it('con obraId lo manda como p_obra_id', async () => {
    supabase.rpc.mockResolvedValue({ data: 'nuevo-id-obra', error: null })
    const r = await useConveniosStore.getState().clonarConvenio('global-1', 'e1', 'obra-a')
    expect(r.ok).toBe(true)
    expect(supabase.rpc).toHaveBeenCalledWith('clonar_convenio', {
      convenio_global_id: 'global-1', p_empresa_id: 'e1', p_obra_id: 'obra-a',
    })
  })

  it('propaga el error de la RPC', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'sin permiso' } })
    const r = await useConveniosStore.getState().clonarConvenio('global-1', 'e1')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('sin permiso')
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

describe('eliminarConvenio — no se borra un convenio usado (sesión 2026-08-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConveniosStore.setState({ convenios: [], cargando: false, error: null, cargadoEmpresaId: null })
  })

  it('si hay legajos que usan el convenio NO borra y avisa', async () => {
    const deleteMock = vi.fn().mockReturnValue({ error: null })
    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_legajo') return { select: () => ({ eq: () => ({ then: (r) => r({ data: [{ id: 'l1' }], error: null }) }) }) }
      if (tabla === 'nom_periodos') return { select: () => ({ eq: () => ({ then: (r) => r({ data: [], error: null }) }) }) }
      return { delete: deleteMock }
    })
    const r = await useConveniosStore.getState().eliminarConvenio('c1', 'e1')
    expect(r.ok).toBe(false)
    expect(r.usos.legajos).toBe(1)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('si hay períodos que lo usan, tampoco borra', async () => {
    const deleteMock = vi.fn().mockReturnValue({ error: null })
    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_legajo') return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      if (tabla === 'nom_periodos') return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: 'p1' }], error: null }) }) }
      return { delete: deleteMock }
    })
    const r = await useConveniosStore.getState().eliminarConvenio('c1', 'e1')
    expect(r.ok).toBe(false)
    expect(r.usos.periodos).toBe(1)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('sin usos, borra y recarga la lista de convenios', async () => {
    const deleteMock = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ data: null, error: null }) })
    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_legajo') return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      if (tabla === 'nom_periodos') return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
      if (tabla === 'nom_convenios') return {
        delete: deleteMock,
        select: () => ({ or: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
      }
      return { select: () => ({ or: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }
    })
    const r = await useConveniosStore.getState().eliminarConvenio('c1', 'e1')
    expect(r.ok).toBe(true)
    expect(deleteMock).toHaveBeenCalledTimes(1)
  })
})

describe('replicarConvenio — copia el convenio con escalas (crítica 2026-08-09)', () => {
  const origen = {
    id: 'c1', empresa_id: 'e1', nombre: 'UOCRA', regimen: '22250', descripcion: null,
    obra_id: null, modalidad: 'quincenal',
    corte_q1_desde: 1, corte_q1_hasta: 15, corte_q2_desde: 16, corte_q2_hasta: null,
    corte_mensual_desde: 1, corte_mensual_hasta: null,
  }
  const nuevoConvenio = { ...origen, id: 'c-nuevo', nombre: 'UOCRA (copia)', obra_id: 'obra-a' }
  let insertCategorias
  let insertNoRem
  let insertConvenioPayload

  beforeEach(() => {
    vi.clearAllMocks()
    useConveniosStore.setState({ convenios: [], cargando: false, error: null, cargadoEmpresaId: null })
    insertCategorias = vi.fn((payload) => ({ then: (r) => r({ data: payload, error: null }) }))
    insertNoRem = vi.fn((payload) => ({ then: (r) => r({ data: payload, error: null }) }))
    insertConvenioPayload = null
    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_convenios') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: origen, error: null }) }),
            or: () => ({ order: () => Promise.resolve({ data: [origen, nuevoConvenio], error: null }) }),
          }),
          insert: (payload) => {
            insertConvenioPayload = payload
            return { select: () => ({ single: () => Promise.resolve({ data: nuevoConvenio, error: null }) }) }
          },
        }
      }
      if (tabla === 'nom_categorias') {
        return {
          select: () => ({ eq: () => ({ then: (r) => r({ data: [{ nombre: 'A', basico: 100, vigencia_desde: '2026-01-01', modalidad: 'hora' }], error: null }) }) }),
          insert: insertCategorias,
        }
      }
      if (tabla === 'nom_no_remunerativos') {
        return {
          select: () => ({ eq: () => ({ then: (r) => r({ data: [{ categoria_nombre: 'A', monto: 50, vigencia_desde: '2026-01-01' }], error: null }) }) }),
          insert: insertNoRem,
        }
      }
      if (tabla === 'nom_conceptos') {
        return {
          select: () => ({ eq: () => ({ then: (r) => r({ data: [], error: null }) }) }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'nc1' }, error: null }) }) }),
        }
      }
      if (tabla === 'nom_concepto_reglas') {
        return { insert: vi.fn((payload) => ({ then: (r) => r({ data: payload, error: null }) })) }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    })
  })

  it('manda convenio_id en cada categoría/no remunerativo (regresión del payload Promise)', async () => {
    const r = await useConveniosStore.getState().replicarConvenio('c1', 'e1', { obraId: 'obra-a' })
    expect(r.ok).toBe(true)
    expect(r.convenioId).toBe('c-nuevo')
    expect(insertCategorias).toHaveBeenCalledWith([
      { nombre: 'A', basico: 100, vigencia_desde: '2026-01-01', modalidad: 'hora', convenio_id: 'c-nuevo' },
    ])
    expect(insertNoRem).toHaveBeenCalledWith([
      { categoria_nombre: 'A', monto: 50, vigencia_desde: '2026-01-01', convenio_id: 'c-nuevo' },
    ])
  })

  it('con nombre de obra: el clon se llama "convenio + obra" (feedback 2026-08-09)', async () => {
    const r = await useConveniosStore.getState().replicarConvenio('c1', 'e1', { obraId: 'obra-a', nombreObra: 'Obra Centro' })
    expect(r.ok).toBe(true)
    expect(insertConvenioPayload.nombre).toBe('UOCRA Obra Centro')
  })

  it('sin nombre de obra: la copia se llama "(copia)"', async () => {
    const r = await useConveniosStore.getState().replicarConvenio('c1', 'e1', { obraId: 'obra-a' })
    expect(r.ok).toBe(true)
    expect(insertConvenioPayload.nombre).toBe('UOCRA (copia)')
  })

  it('sin escalas no inserta categorías ni no remunerativos', async () => {
    supabase.from.mockImplementation((tabla) => {
      if (tabla === 'nom_convenios') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: origen, error: null }) }),
            or: () => ({ order: () => Promise.resolve({ data: [origen, nuevoConvenio], error: null }) }),
          }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: nuevoConvenio, error: null }) }) }),
        }
      }
      if (tabla === 'nom_categorias') return { select: () => ({ eq: () => ({ then: (r) => r({ data: [], error: null }) }) }) }
      if (tabla === 'nom_no_remunerativos') return { select: () => ({ eq: () => ({ then: (r) => r({ data: [], error: null }) }) }) }
      if (tabla === 'nom_conceptos') return { select: () => ({ eq: () => ({ then: (r) => r({ data: [], error: null }) }) }) }
      if (tabla === 'nom_concepto_reglas') return { insert: vi.fn((payload) => ({ then: (r) => r({ data: payload, error: null }) })) }
      throw new Error(`tabla inesperada: ${tabla}`)
    })
    const r = await useConveniosStore.getState().replicarConvenio('c1', 'e1', { obraId: 'obra-a' })
    expect(r.ok).toBe(true)
    expect(insertCategorias).not.toHaveBeenCalled()
    expect(insertNoRem).not.toHaveBeenCalled()
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
