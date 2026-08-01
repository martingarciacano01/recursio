import { describe, it, expect, vi, beforeEach } from 'vitest'
import { agruparVigencias, categoriaFromDB, useEscalasStore } from '../escalasStore'

vi.mock('../../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

describe('agruparVigencias', () => {
  it('agrupa por nombre con el valor vigente (mayor vigencia <= hoy) y el historial ordenado', () => {
    const filas = [
      { nombre: 'Oficial', valor: 100, vigenciaDesde: '2026-01-01' },
      { nombre: 'Oficial', valor: 120, vigenciaDesde: '2026-06-01' },
      { nombre: 'Oficial', valor: 990, vigenciaDesde: '2099-01-01' }, // futura: no es la vigente
      { nombre: 'Ayudante', valor: 80, vigenciaDesde: '2026-01-01' },
    ]
    const g = agruparVigencias(filas, '2026-07-21')
    expect(g).toEqual([
      {
        nombre: 'Ayudante', vigente: { valor: 80, vigenciaDesde: '2026-01-01' },
        historial: [{ valor: 80, vigenciaDesde: '2026-01-01' }],
      },
      {
        nombre: 'Oficial', vigente: { valor: 120, vigenciaDesde: '2026-06-01' },
        historial: [
          { valor: 990, vigenciaDesde: '2099-01-01' },
          { valor: 120, vigenciaDesde: '2026-06-01' },
          { valor: 100, vigenciaDesde: '2026-01-01' },
        ],
      },
    ])
  })

  it('sin vigencia aplicable, vigente es null', () => {
    const g = agruparVigencias([{ nombre: 'X', valor: 1, vigenciaDesde: '2099-01-01' }], '2026-07-21')
    expect(g[0].vigente).toBeNull()
  })
})

describe('categoriaFromDB', () => {
  it('mapea basico numérico', () => {
    expect(categoriaFromDB({ id: 'k1', convenio_id: 'cv1', nombre: 'Oficial', basico: '123.45', vigencia_desde: '2026-06-01' }))
      .toEqual({ id: 'k1', convenioId: 'cv1', nombre: 'Oficial', valor: 123.45, vigenciaDesde: '2026-06-01' })
  })

  it('categoriaFromDB incluye la modalidad', () => {
    const row = { id: 'c1', convenio_id: 'v1', nombre: 'Oficial', basico: 1000, vigencia_desde: '2026-01-01', modalidad: 'mensual' }
    expect(categoriaFromDB(row).modalidad).toBe('mensual')
  })
})

describe('cargarEscala — cache por convenio', () => {
  beforeEach(async () => {
    useEscalasStore.setState({ categorias: [], cargando: false, error: null, cargadoConvenioId: null })
    const { supabase } = await import('../../lib/supabase')
    supabase.from.mockReset()
    supabase.from.mockImplementation(() => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(function (...args) {
          // El segundo .order() (vigencia_desde) cierra la cadena.
          if (this._ordenados) return Promise.resolve({ data: [], error: null })
          this._ordenados = true
          return chain
        }),
      }
      return chain
    })
  })

  it('no vuelve a pedir si ya cargó para el mismo convenio', async () => {
    await useEscalasStore.getState().cargarEscala('conv-1')
    await useEscalasStore.getState().cargarEscala('conv-1')
    const { supabase } = await import('../../lib/supabase')
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('vuelve a pedir si cambia el convenio', async () => {
    await useEscalasStore.getState().cargarEscala('conv-1')
    await useEscalasStore.getState().cargarEscala('conv-2')
    const { supabase } = await import('../../lib/supabase')
    expect(supabase.from).toHaveBeenCalledTimes(2)
  })
})
