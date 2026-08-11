import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
      getUser: vi.fn(),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(),
        listFactors: vi.fn(),
        challenge: vi.fn(),
        verify: vi.fn(),
      },
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
  // Default: cuenta sin MFA enrolado (comportamiento previo a este flujo).
  supabase.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } })
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

  it('si whoami() falla, resuelve un perfil restrictivo en vez del fallback de user_metadata (Task 3.4, M6)', async () => {
    // user_metadata viaja en el JWT pero es editable por el propio cliente
    // (mismo problema que appStore.js de Presencio) — si whoami() no
    // responde, el fallback NO puede ser "lo que dijo el cliente que es su
    // rol", porque eso deja abierta una escalada de privilegios trivial.
    // El perfil restrictivo (rol null, sin roles) hace que el gating cierre.
    supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: userFake, session: { access_token: 'tok' } }, error: null })
    supabase.rpc.mockReturnValue({ single: () => Promise.reject(new Error('sin red')) })

    await useAuthStore.getState().login('ana@empresa.com', 'secreta')

    const state = useAuthStore.getState()
    expect(state.rol).toBeNull()
    expect(state.empresa).toBeNull()
    expect(state.rolesNomina).toEqual([])
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

  it('entrarEnEmpresa fija empresaVista con id, nombre y colores de marca', () => {
    useAuthStore.getState().entrarEnEmpresa({ id: 'e1', nombre: 'Asset Construcciones', color_primario: '#111', color_secundario: '#222' })
    expect(useAuthStore.getState().empresaVista).toEqual({ id: 'e1', nombre: 'Asset Construcciones', colorPrimario: '#111', colorSecundario: '#222' })
  })

  it('entrarEnEmpresa sin colores de marca deja colorPrimario/colorSecundario en null', () => {
    useAuthStore.getState().entrarEnEmpresa({ id: 'e1', nombre: 'Asset Construcciones' })
    expect(useAuthStore.getState().empresaVista).toEqual({ id: 'e1', nombre: 'Asset Construcciones', colorPrimario: null, colorSecundario: null })
  })

  it('cargarSesion resuelve rolesNomina via whoami_nomina()', async () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', email: 'a@a.com', user_metadata: {} } } },
    })
    supabase.rpc.mockImplementation((fn) => {
      if (fn === 'whoami') return { single: () => Promise.resolve({ data: { rol: 'admin', empresa_id: 'e1' } }) }
      if (fn === 'whoami_nomina') return Promise.resolve({ data: [{ rol: 'rrhh', alcance_tipo: 'empresa', alcance_id: null, empresa_id: 'e1' }], error: null })
      return { single: () => Promise.resolve({ data: null }) }
    })
    await useAuthStore.getState().cargarSesion()
    expect(useAuthStore.getState().rolesNomina).toEqual([{ rol: 'rrhh', alcance_tipo: 'empresa', alcance_id: null, empresa_id: 'e1' }])
  })

  it('salirDeEmpresa limpia empresaVista', () => {
    useAuthStore.setState({ empresaVista: { id: 'e1', nombre: 'Asset' } })
    useAuthStore.getState().salirDeEmpresa()
    expect(useAuthStore.getState().empresaVista).toBeNull()
  })

  it('logout limpia también empresaVista', async () => {
    useAuthStore.setState({ empresaVista: { id: 'e1', nombre: 'Asset' } })
    supabase.auth.signOut.mockResolvedValue({ error: null })

    await useAuthStore.getState().logout()

    expect(useAuthStore.getState().empresaVista).toBeNull()
  })

  it('login: no queda trabado si signInWithPassword rechaza (caída de red, Task 3.3)', async () => {
    supabase.auth.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await useAuthStore.getState().login('ana@empresa.com', 'secreta')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('no se pudo contactar el servidor')
  })

  it('cargarSesion: no deja "cargando" trabado si getSession rechaza (caída de red, Task 3.3)', async () => {
    supabase.auth.getSession.mockRejectedValue(new TypeError('Failed to fetch'))

    await useAuthStore.getState().cargarSesion()

    const state = useAuthStore.getState()
    expect(state.cargando).toBe(false)
    expect(state.usuario).toBeNull()
  })

  describe('MFA (segundo factor, superadmin — mismo flujo que Presencio)', () => {
    it('login con cuenta que tiene MFA enrolado y sesión en aal1 devuelve mfaRequired, sin resolver perfil todavía', async () => {
      supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: userFake, session: { access_token: 'tok' } }, error: null })
      supabase.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' } })

      const result = await useAuthStore.getState().login('ana@empresa.com', 'secreta')

      expect(result.ok).toBe(true)
      expect(result.mfaRequired).toBe(true)
      expect(supabase.rpc).not.toHaveBeenCalled()
      expect(useAuthStore.getState().rol).toBeNull()
    })

    it('login con cuenta ya en aal2 (MFA ya completado, sesión compartida con Presencio) no pide MFA', async () => {
      supabase.auth.signInWithPassword.mockResolvedValue({ data: { user: userFake, session: { access_token: 'tok' } }, error: null })
      supabase.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' } })
      supabase.rpc.mockReturnValue({ single: () => Promise.resolve({ data: { rol: 'superadmin', empresa_id: null } }) })

      const result = await useAuthStore.getState().login('ana@empresa.com', 'secreta')

      expect(result.mfaRequired).toBeUndefined()
      expect(useAuthStore.getState().rol).toBe('superadmin')
    })

    it('verifyMfa exitoso completa el challenge y resuelve el perfil', async () => {
      supabase.auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'factor-1' }] }, error: null })
      supabase.auth.mfa.challenge.mockResolvedValue({ data: { id: 'challenge-1' }, error: null })
      supabase.auth.mfa.verify.mockResolvedValue({ error: null })
      supabase.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'tok-aal2' } } })
      supabase.auth.getUser.mockResolvedValue({ data: { user: userFake } })
      supabase.rpc.mockReturnValue({ single: () => Promise.resolve({ data: { rol: 'superadmin', empresa_id: null } }) })

      const result = await useAuthStore.getState().verifyMfa('123456')

      expect(result.ok).toBe(true)
      expect(supabase.auth.mfa.challenge).toHaveBeenCalledWith({ factorId: 'factor-1' })
      expect(supabase.auth.mfa.verify).toHaveBeenCalledWith({ factorId: 'factor-1', challengeId: 'challenge-1', code: '123456' })
      expect(useAuthStore.getState().rol).toBe('superadmin')
    })

    it('verifyMfa con código incorrecto propaga el error sin mutar la sesión', async () => {
      supabase.auth.mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'factor-1' }] }, error: null })
      supabase.auth.mfa.challenge.mockResolvedValue({ data: { id: 'challenge-1' }, error: null })
      supabase.auth.mfa.verify.mockResolvedValue({ error: { message: 'Código inválido' } })

      const result = await useAuthStore.getState().verifyMfa('000000')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('Código inválido')
      expect(useAuthStore.getState().session).toBeNull()
    })

    it('verifyMfa sin factor TOTP configurado devuelve error claro', async () => {
      supabase.auth.mfa.listFactors.mockResolvedValue({ data: { totp: [] }, error: null })

      const result = await useAuthStore.getState().verifyMfa('123456')

      expect(result.ok).toBe(false)
      expect(result.error).toBe('No se encontró un factor MFA configurado.')
    })
  })
})
