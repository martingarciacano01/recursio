import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePaginado } from '../usePaginado'

describe('usePaginado', () => {
  it('arranca en la pagina 0 con el tamano de pagina pedido', () => {
    const { result } = renderHook(() => usePaginado(50))
    expect(result.current.pagina).toBe(0)
    expect(result.current.rango).toEqual([0, 49])
  })

  it('siguientePagina avanza el rango un tamano de pagina', () => {
    const { result } = renderHook(() => usePaginado(50))
    act(() => result.current.siguientePagina())
    expect(result.current.pagina).toBe(1)
    expect(result.current.rango).toEqual([50, 99])
  })

  it('reset vuelve a la pagina 0 (para cuando cambia un filtro)', () => {
    const { result } = renderHook(() => usePaginado(50))
    act(() => result.current.siguientePagina())
    act(() => result.current.reset())
    expect(result.current.pagina).toBe(0)
  })

  it('hayMasPaginas es true si el total supera lo cargado hasta ahora', () => {
    const { result } = renderHook(() => usePaginado(50))
    expect(result.current.hayMasPaginas(120)).toBe(true)
    act(() => result.current.siguientePagina())
    act(() => result.current.siguientePagina())
    expect(result.current.hayMasPaginas(120)).toBe(false) // ya cubrio 0-149
  })
})
