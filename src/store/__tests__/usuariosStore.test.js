import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'v1', usuario_id: 'u1', empresa_id: 'e1', rol: 'rrhh', alcance_tipo: 'empresa', alcance_id: null }],
        error: null,
      }),
      delete: vi.fn().mockReturnThis(),
    })),
    functions: { invoke: vi.fn().mockResolvedValue({ data: { ok: true, usuarioId: 'u2' }, error: null }) },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  },
}))

import { useUsuariosStore, usuarioEmpresaFromDB } from '../usuariosStore'

describe('usuarioEmpresaFromDB', () => {
  it('mapea snake_case a camelCase', () => {
    const row = { id: 'v1', usuario_id: 'u1', empresa_id: 'e1', rol: 'rrhh', alcance_tipo: 'empresa', alcance_id: null }
    expect(usuarioEmpresaFromDB(row)).toEqual({
      id: 'v1', usuarioId: 'u1', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null,
    })
  })
})

describe('useUsuariosStore', () => {
  it('cargarUsuarios trae y mapea los vinculos de la empresa', async () => {
    await useUsuariosStore.getState().cargarUsuarios('e1')
    expect(useUsuariosStore.getState().usuarios).toEqual([
      { id: 'v1', usuarioId: 'u1', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null },
    ])
  })

  it('invitarUsuario invoca la edge function y devuelve ok', async () => {
    const r = await useUsuariosStore.getState().invitarUsuario({
      email: 'nuevo@x.com', empresaId: 'e1', rol: 'rrhh', alcanceTipo: 'empresa', alcanceId: null,
    })
    expect(r.ok).toBe(true)
  })
})
