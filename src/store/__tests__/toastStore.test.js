import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useToastStore } from '../toastStore'

describe('useToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })
  afterEach(() => { vi.useRealTimers() })

  it('push agrega un toast con id, mensaje y tipo (default info)', () => {
    useToastStore.getState().push('Guardado con éxito')
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ mensaje: 'Guardado con éxito', tipo: 'info' })
    expect(toasts[0].id).toBeDefined()
  })

  it('push acepta un tipo explicito (error/success)', () => {
    useToastStore.getState().push('Algo falló', 'error')
    expect(useToastStore.getState().toasts[0].tipo).toBe('error')
  })

  it('se auto-elimina despues de 5s', () => {
    useToastStore.getState().push('temporal')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(5000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('remove saca un toast puntual por id', () => {
    const id = useToastStore.getState().push('uno')
    useToastStore.getState().push('dos')
    useToastStore.getState().remove(id)
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].mensaje).toBe('dos')
  })
})
