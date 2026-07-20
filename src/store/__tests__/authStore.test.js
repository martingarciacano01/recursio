import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
    },
    rpc: vi.fn(),
  },
}))

import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../authStore'

const userFake = { id: 'u1', email: 'ana@empresa.com', user_metadata: { nombre: 'Ana', rol: 'admin', empresa_id: 'meta-empresa' } }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ session: null, usuario: null, empresa: null, rol: null, cargando: true })
})

describe('authStore', () => {
  it('login exitoso resuelve rol/empresa vía whoami() y no desde user_metadata', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: userFake, session: { access_token: 'tok' } }, error: null })
    supabase.rpc.mockReturnValue({ single: () => Promise.resolve({ data: { rol: 'operador', empresa_id: 'real-empresa' } }) })

    const result = await useAuthStore.getState().login('ana@empresa.com', 'secreta')

    expect(result.ok).toBe(true)
    const state = useAuthStore.getState()
    expect(state.rol).toBe('operador')
    expect(state.empresa).toEqual({ id: 'real-empresa' })
    expect(state.usuario.nombre).toBe('Ana')
  })

  it('login con credenciales inválidas devuelve error sin mutar sesión', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { message: 'Credenciales inválidas' } })

    const result = await useAuthStore.getState().login('ana@empresa.com', 'mala')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Credenciales inválidas')
    expect(useAuthStore.getState().session).toBeNull()
  })

  it('si whoami() falla, usa el fallback de user_metadata', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: userFake, session: { access_token: 'tok' } }, error: null })
    supabase.rpc.mockReturnValue({ single: () => Promise.reject(new Error('sin red')) })

    await useAuthStore.getState().login('ana@empresa.com', 'secreta')

    const state = useAuthStore.getState()
    expect(state.rol).toBe('admin')
    expect(state.empresa).toEqual({ id: 'meta-empresa' })
  })

  it('logout limpia el estado', async () => {
    useAuthStore.setState({ session: { access_token: 'tok' }, usuario: { id: 'u1' }, empresa: { id: 'e1' }, rol: 'admin' })
    supabase.auth.signOut.mockResolvedValue({ error: null })

    await useAuthStore.getState().logout()

    const state = useAuthStore.getState()
    expect(state.session).toBeNull()
    expect(state.usuario).toBeNull()
    expect(state.rol).toBeNull()
  })

  it('cargarSesion sin sesión existente deja cargando en false y usuario null', async () => {
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } })

    await useAuthStore.getState().cargarSesion()

    const state = useAuthStore.getState()
    expect(state.cargando).toBe(false)
    expect(state.usuario).toBeNull()
  })
})
