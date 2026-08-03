import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({
      data: [{ id: 'v1', usuario_id: 'u1', empresa_id: 'e1', rol: 'rrhh', alcance_tipo: 'empresa', alcance_id: null, email: 'user@x.com' }],
      error: null,
    }),
    functions: { invoke: vi.fn().mockResolvedValue({ data: { ok: true, usuarioId: 'u2' }, error: null }) },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  },
}))

import { supabase } from '../../lib/supabase'
import { useUsuariosStore, usuarioEmpresaFromDB } from '../usuariosStore'

describe('usuarioEmpresaFromDB', () => {
  it('mapea snake_case a camelCase, incluido el email', () => {
    const row = { id: 'v1', usuario_id: 'u1', empresa_id: 'e1', rol: 'rrhh', alcance_tipo: 'empresa', alcance_id: null, email: 'user@x.com' }
    expect(usuarioEmpresaFromDB(row)).toEqual({
      id: 'v1', usuarioId: 'u1', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null, email: 'user@x.com',
    })
  })
})

describe('useUsuariosStore', () => {
  it('cargarUsuarios llama al RPC listar_usuarios_empresa y mapea los vinculos con email', async () => {
    await useUsuariosStore.getState().cargarUsuarios('e1')
    expect(supabase.rpc).toHaveBeenCalledWith('listar_usuarios_empresa', { p_empresa_id: 'e1' })
    expect(useUsuariosStore.getState().usuarios).toEqual([
      { id: 'v1', usuarioId: 'u1', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null, email: 'user@x.com' },
    ])
  })

  it('invitarUsuario invoca la edge function y devuelve ok', async () => {
    const r = await useUsuariosStore.getState().invitarUsuario({
      email: 'nuevo@x.com', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null,
    })
    expect(r.ok).toBe(true)
  })
})
