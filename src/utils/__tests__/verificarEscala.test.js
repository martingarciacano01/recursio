import { describe, it, expect, vi } from 'vitest'
import { categoriasConEscalaVencida, verificarEscalaVigente } from '../verificarEscala'

describe('categoriasConEscalaVencida (pura)', () => {
  it('devuelve null si no hay categorías', () => {
    expect(categoriasConEscalaVencida([], '2026-06-30')).toBeNull()
  })

  it('devuelve null si no hay fechaHasta', () => {
    expect(categoriasConEscalaVencida([{ nombre: 'A', ultimaVigencia: '2026-01-01' }], null)).toBeNull()
  })

  it('marca vencida una categoría sin ninguna vigencia cargada', () => {
    const r = categoriasConEscalaVencida([{ nombre: 'Oficial', ultimaVigencia: null }], '2026-06-30')
    expect(r).toEqual(['Oficial'])
  })

  it('marca vencida si la última vigencia es más de 90 días antes del cierre', () => {
    const r = categoriasConEscalaVencida([{ nombre: 'Oficial', ultimaVigencia: '2026-01-01' }], '2026-06-30')
    expect(r).toEqual(['Oficial'])
  })

  it('no marca vencida si la última vigencia está dentro de los 90 días', () => {
    const r = categoriasConEscalaVencida([{ nombre: 'Oficial', ultimaVigencia: '2026-06-01' }], '2026-06-30')
    expect(r).toBeNull()
  })

  it('respeta un diasTope custom', () => {
    const r = categoriasConEscalaVencida([{ nombre: 'Oficial', ultimaVigencia: '2026-05-01' }], '2026-06-30', 30)
    expect(r).toEqual(['Oficial'])
  })

  it('devuelve solo las categorías vencidas, no todas', () => {
    const r = categoriasConEscalaVencida([
      { nombre: 'Al día', ultimaVigencia: '2026-06-15' },
      { nombre: 'Vencida', ultimaVigencia: '2025-01-01' },
    ], '2026-06-30')
    expect(r).toEqual(['Vencida'])
  })
})

describe('verificarEscalaVigente (wrapper async, mock de supabase)', () => {
  function crearSupabaseMock({ categorias, vigenciasPorCategoria }) {
    return {
      from: (tabla) => {
        if (tabla !== 'nom_categorias') throw new Error(`tabla inesperada: ${tabla}`)
        return {
          select: () => ({
            in: () => Promise.resolve({ data: categorias }),
            eq: (_col1, convenioId) => ({
              eq: (_col2, nombre) => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: vigenciasPorCategoria[`${convenioId}|${nombre}`] || [] }),
                }),
              }),
            }),
          }),
        }
      },
    }
  }

  it('sin categoriaIds, no consulta nada y devuelve null', async () => {
    const supabase = { from: vi.fn() }
    const r = await verificarEscalaVigente(supabase, { categoriaIds: [], fechaHasta: '2026-06-30' })
    expect(r).toBeNull()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('arma la lista de vencidas cruzando categorías y su última vigencia', async () => {
    const supabase = crearSupabaseMock({
      categorias: [{ id: 'cat1', convenio_id: 'conv1', nombre: 'Oficial' }],
      vigenciasPorCategoria: { 'conv1|Oficial': [{ vigencia_desde: '2025-01-01' }] },
    })
    const r = await verificarEscalaVigente(supabase, { categoriaIds: ['cat1'], fechaHasta: '2026-06-30' })
    expect(r).toEqual(['Oficial'])
  })
})
