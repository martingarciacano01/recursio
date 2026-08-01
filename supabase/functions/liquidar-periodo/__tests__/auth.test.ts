// Test de la validación de identidad/empresa/rol agregada al handler de
// liquidar-periodo (Fase 1, Task 1.1 — docs/superpowers/plans/
// 2026-07-28-fase5h-seguridad.md Task 1). La Edge Function corre en Deno
// normalmente; para poder probarla con vitest (Node) se stubea `Deno` como
// global y se mockea el import de supabase-js por su URL de esm.sh — el
// resto del handler (motor, asistencia, etc.) son módulos TS locales que
// vitest/vite resuelven igual que cualquier otro import del repo.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Handlers configurables por test: cada uno decide qué devuelve getUser,
// rpc('is_superadmin') y la consulta a nom_usuarios_empresas.
let mockGetUser: () => Promise<{ data: { user: any }; error: any }>
let mockIsSuperadmin: () => Promise<{ data: boolean; error: any }>
let mockVinculos: () => Promise<{ data: { rol: string }[] | null; error: any }>
let mockPeriodo: () => Promise<{ data: any; error: any }>

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => {
  return {
    createClient: (_url: string, key: string) => {
      // El primer createClient() del handler es el cliente "auth" (anon +
      // header del llamante); el segundo es el service_role. Se distinguen
      // por la key pasada en los env vars mockeados más abajo.
      const esAuth = key === 'anon-key-test'
      return {
        auth: {
          getUser: () => mockGetUser(),
        },
        rpc: (fn: string) => {
          if (fn === 'is_superadmin') return mockIsSuperadmin()
          return Promise.resolve({ data: null, error: null })
        },
        from: (tabla: string) => {
          // Chain genérica: cualquier método encadenable (select/eq/order/
          // limit/gte/lte/in/or/update/upsert/delete/insert) devuelve la
          // misma chain; awaitear la chain (then/single) resuelve según la
          // tabla. Alcanza para que el resto del handler (que este test no
          // ejercita de verdad, solo necesita no explotar) no reviente con
          // "no es una función" en un método que no mockeamos a mano.
          const resolverPorTabla = () => {
            if (tabla === 'nom_periodos') return mockPeriodo()
            if (tabla === 'nom_usuarios_empresas' && !esAuth) return mockVinculos()
            return Promise.resolve({ data: [], error: null })
          }
          const chain: any = new Proxy({}, {
            get(_target, prop) {
              if (prop === 'single' || prop === 'maybeSingle') return () => resolverPorTabla()
              if (prop === 'then') return (resolve: any, reject: any) => resolverPorTabla().then(resolve, reject)
              if (prop === 'catch') return () => chain
              return () => chain
            },
          })
          return chain
        },
      }
    },
  }
})

const envOriginal = { ...(globalThis as any).Deno?.env }

beforeEach(() => {
  vi.resetModules()
  mockGetUser = () => Promise.resolve({ data: { user: null }, error: { message: 'no autenticado' } })
  mockIsSuperadmin = () => Promise.resolve({ data: false, error: null })
  mockVinculos = () => Promise.resolve({ data: [], error: null })
  mockPeriodo = () => Promise.resolve({ data: { id: 'p1', empresa_id: 'e1', estado: 'abierto', tipo: 'mensual' }, error: null })

  ;(globalThis as any).Deno = {
    env: { get: (k: string) => (k === 'SUPABASE_ANON_KEY' ? 'anon-key-test' : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-key-test' : 'https://test.supabase.co') },
    serve: (handler: (req: Request) => Promise<Response>) => {
      ;(globalThis as any).__handler = handler
    },
  }
})

afterAll(() => {
  ;(globalThis as any).Deno = envOriginal
})

async function cargarHandler() {
  await import('../index.ts')
  return (globalThis as any).__handler as (req: Request) => Promise<Response>
}

function req(body: any, headers: Record<string, string> = {}) {
  return new Request('https://test.local/liquidar-periodo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('liquidar-periodo: validación de identidad, empresa y rol', () => {
  it('sin header Authorization devuelve 401', async () => {
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'p1' }))
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error).toBe('falta header Authorization')
  })

  it('con token válido pero sin rol admin/rrhh en la empresa del período devuelve 403', async () => {
    mockGetUser = () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null })
    mockIsSuperadmin = () => Promise.resolve({ data: false, error: null })
    mockVinculos = () => Promise.resolve({ data: [{ rol: 'consulta' }], error: null })
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'p1' }, { Authorization: 'Bearer token-valido' }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toBe('sin permiso para liquidar este período')
  })

  it('con rol rrhh de la empresa correcta no corta en 401/403 (llega al resto del handler)', async () => {
    mockGetUser = () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null })
    mockIsSuperadmin = () => Promise.resolve({ data: false, error: null })
    mockVinculos = () => Promise.resolve({ data: [{ rol: 'rrhh' }], error: null })
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'p1' }, { Authorization: 'Bearer token-valido' }))
    expect(res.status).not.toBe(401)
    expect(res.status).not.toBe(403)
  })
})
