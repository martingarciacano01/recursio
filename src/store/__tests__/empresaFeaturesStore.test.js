import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEmpresaFeaturesStore, FEATURES } from '../empresaFeaturesStore'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

import { supabase } from '../../lib/supabase'

beforeEach(() => {
  vi.clearAllMocks()
  useEmpresaFeaturesStore.setState({ features: {}, cargando: false, error: null })
})

describe('cargarFeatures', () => {
  it('arma un mapa feature -> activo para la empresa', async () => {
    supabase.from.mockReturnValue({
      select: () => ({ eq: () => Promise.resolve({
        data: [{ feature: 'bonos_no_remunerativos', activo: true }, { feature: 'convenios_por_obra', activo: false }],
        error: null,
      }) }),
    })
    await useEmpresaFeaturesStore.getState().cargarFeatures('e1')
    const s = useEmpresaFeaturesStore.getState()
    expect(s.features.e1).toEqual({ bonos_no_remunerativos: true, convenios_por_obra: false })
    expect(s.error).toBeNull()
  })

  it('propaga el error', async () => {
    supabase.from.mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) })
    await useEmpresaFeaturesStore.getState().cargarFeatures('e1')
    expect(useEmpresaFeaturesStore.getState().error).toBe('boom')
  })
})

describe('tieneFeature', () => {
  it('true solo si la feature está cargada y activa', () => {
    useEmpresaFeaturesStore.setState({ features: { e1: { convenios_por_obra: true, bonos_no_remunerativos: false } } })
    expect(useEmpresaFeaturesStore.getState().tieneFeature('e1', FEATURES.CONVENIOS_POR_OBRA)).toBe(true)
    expect(useEmpresaFeaturesStore.getState().tieneFeature('e1', FEATURES.BONOS_NO_REMUNERATIVOS)).toBe(false)
  })

  it('sin datos cargados para la empresa devuelve false (default apagado)', () => {
    expect(useEmpresaFeaturesStore.getState().tieneFeature('e-desconocida', FEATURES.AJUSTE_HORAS_PERIODO)).toBe(false)
  })
})

describe('setFeature', () => {
  it('hace upsert y actualiza el estado local', async () => {
    supabase.from.mockReturnValue({ upsert: () => Promise.resolve({ error: null }) })
    const r = await useEmpresaFeaturesStore.getState().setFeature('e1', FEATURES.TOPES_HORAS_POR_OBRA, true)
    expect(r.ok).toBe(true)
    expect(useEmpresaFeaturesStore.getState().tieneFeature('e1', FEATURES.TOPES_HORAS_POR_OBRA)).toBe(true)
  })

  it('propaga el error sin tocar el estado', async () => {
    supabase.from.mockReturnValue({ upsert: () => Promise.resolve({ error: { message: 'sin permiso' } }) })
    const r = await useEmpresaFeaturesStore.getState().setFeature('e1', FEATURES.TOPES_HORAS_POR_OBRA, true)
    expect(r.ok).toBe(false)
    expect(useEmpresaFeaturesStore.getState().tieneFeature('e1', FEATURES.TOPES_HORAS_POR_OBRA)).toBe(false)
  })
})
