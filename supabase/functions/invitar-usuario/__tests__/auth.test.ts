// Test del fix de invitar-usuario (Fase 1, Task 1.4): antes validaba el
// rol del llamador con el cliente service_role, que no lleva JWT — 403
// SIEMPRE. Ahora usa un cliente anon con el Authorization del llamante
// (mismo patrón que liquidar-periodo/__tests__/auth.test.ts).
import { describe, it, expect, beforeEach, vi } from 'vitest'

let mockGetUser: () => Promise<{ data: { user: any }; error: any }>
let mockHasRolNomina: () => Promise<{ data: boolean; error: any }>
let mockIsSuperadmin: () => Promise<{ data: boolean; error: any }>
let mockAuthEmpresaId: () => Promise<{ data: string | null; error: any }>

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => {
  return {
    createClient: (_url: string, key: string) => {
      const esAuth = key === 'anon-key-test'
      return {
        auth: {
          getUser: () => mockGetUser(),
          admin: {
            listUsers: () => Promise.resolve({ data: { users: [] } }),
            inviteUserByEmail: () => Promise.resolve({ data: { user: { id: 'nuevo-user' } }, error: null }),
          },
        },
        rpc: (fn: string) => {
          if (!esAuth) return Promise.resolve({ data: null, error: null })
          if (fn === 'has_rol_nomina') return mockHasRolNomina()
          if (fn === 'is_superadmin') return mockIsSuperadmin()
          if (fn === 'auth_empresa_id') return mockAuthEmpresaId()
          return Promise.resolve({ data: null, error: null })
        },
        from: () => {
          const chain: any = new Proxy({}, {
            get(_t, prop) {
              if (prop === 'then') return (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve)
              return () => chain
            },
          })
          return chain
        },
      }
    },
  }
})

beforeEach(() => {
  vi.resetModules()
  mockGetUser = () => Promise.resolve({ data: { user: null }, error: { message: 'no autenticado' } })
  mockHasRolNomina = () => Promise.resolve({ data: false, error: null })
  mockIsSuperadmin = () => Promise.resolve({ data: false, error: null })
  mockAuthEmpresaId = () => Promise.resolve({ data: 'e1', error: null })

  ;(globalThis as any).Deno = {
    env: { get: (k: string) => (k === 'SUPABASE_ANON_KEY' ? 'anon-key-test' : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-key-test' : 'https://test.supabase.co') },
    serve: (handler: (req: Request) => Promise<Response>) => {
      ;(globalThis as any).__handler = handler
    },
  }
})

async function cargarHandler() {
  await import('../index.ts')
  return (globalThis as any).__handler as (req: Request) => Promise<Response>
}

function req(body: any, headers: Record<string, string> = {}) {
  return new Request('https://test.local/invitar-usuario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('invitar-usuario: valida con el JWT del llamante', () => {
  it('admin de la empresa E invita: no corta en 401/403 (llega al upsert)', async () => {
    mockGetUser = () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null })
    mockHasRolNomina = () => Promise.resolve({ data: true, error: null })
    mockIsSuperadmin = () => Promise.resolve({ data: false, error: null })
    mockAuthEmpresaId = () => Promise.resolve({ data: 'e1', error: null })
    const handler = await cargarHandler()
    const res = await handler(req(
      { email: 'nuevo@empresa.com', empresaId: 'e1', rol: 'rrhh' },
      { Authorization: 'Bearer token-valido' }
    ))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })

  it('usuario sin rol admin recibe 403', async () => {
    mockGetUser = () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null })
    mockHasRolNomina = () => Promise.resolve({ data: false, error: null })
    const handler = await cargarHandler()
    const res = await handler(req(
      { email: 'nuevo@empresa.com', empresaId: 'e1', rol: 'rrhh' },
      { Authorization: 'Bearer token-valido' }
    ))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('requiere rol admin')
  })

  it('email con formato inválido devuelve 400', async () => {
    const handler = await cargarHandler()
    const res = await handler(req(
      { email: 'no-es-un-email', empresaId: 'e1', rol: 'rrhh' },
      { Authorization: 'Bearer token-valido' }
    ))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('email inválido')
  })

  it('rol fuera de la lista permitida devuelve 400', async () => {
    const handler = await cargarHandler()
    const res = await handler(req(
      { email: 'nuevo@empresa.com', empresaId: 'e1', rol: 'superadmin' },
      { Authorization: 'Bearer token-valido' }
    ))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('rol inválido')
  })
})
