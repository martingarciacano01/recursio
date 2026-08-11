// Test end-to-end del branch 'final' de liquidar-periodo (Fase 5E): la
// liquidación final se genera desde la pestaña "Liquidaciones individuales"
// (crearPeriodoFinal en liquidacionStore.js), que crea un nom_periodos tipo
// 'final' acotado a UNA persona y llama la Edge Function con personalIds:
// [id]. Este test mockea el cliente supabase-js con datos realistas y
// ejercita el handler completo para cubrir el branch (no había cobertura
// end-to-end del final — feedback 2026-08-09 "liquidación final no funciona").
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

type Fila = Record<string, any>
type Handler = (hist: string[][]) => { data: any; error: any }

let mockGetUser: () => Promise<{ data: { user: any }; error: any }>
let mockIsSuperadmin: () => Promise<{ data: boolean; error: any }>
// dataPorTabla[tabla] = Handler(historiaDeLaChain) => resultado. La historia
// es el array de [método, arg] registrado por el Proxy, para poder distinguir
// single vs lista vs update/upsert/delete sobre la misma tabla.
let dataPorTabla: Record<string, Handler>

// helpers para no repetir el shape de respuesta en cada tabla
const lista = (items: Fila[]): Handler => () => ({ data: items, error: null })
const single = (row: Fila | null): Handler => () => ({ data: row, error: null })
const enHistoria = (hist: string[][], metodo: string) => hist.some(([m]) => m === metodo)

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => {
  return {
    createClient: (_url: string, key: string) => {
      const esAuth = key === 'anon-key-test'
      return {
        auth: { getUser: () => mockGetUser() },
        rpc: (fn: string) => {
          if (fn === 'is_superadmin') return mockIsSuperadmin()
          return Promise.resolve({ data: null, error: null })
        },
        from: (tabla: string) => {
          const hist: string[][] = []
          const resolver = () => {
            if (!(tabla in dataPorTabla)) return Promise.resolve({ data: [], error: null })
            return Promise.resolve(dataPorTabla[tabla](hist))
          }
          const chain: any = new Proxy({}, {
            get(_target, prop) {
              if (prop === 'single' || prop === 'maybeSingle') {
                return () => { hist.push([String(prop)]); return resolver() }
              }
              if (prop === 'then') return (resolve: any, reject: any) => resolver().then(resolve, reject)
              if (prop === 'catch') return () => chain
              return (...args: unknown[]) => { hist.push([String(prop), ...args]); return chain }
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
  dataPorTabla = {}

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

function req(body: any) {
  return new Request('https://test.local/liquidar-periodo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    body: JSON.stringify(body),
  })
}

const PERIODO_FINAL = {
  id: 'pf1', empresa_id: 'e1', tipo: 'final', estado: 'abierto',
  fecha_desde: '2026-07-31', fecha_hasta: '2026-07-31', convenio_id: null,
}

const LEGAJO = {
  id: 'l1', personal_id: 'p1', empresa_id: 'e1', cuil: '20-30111222-3', cbu: '0000003100011122334455',
  convenio_id: 'conv1', categoria_id: 'cat1', fuera_convenio: false,
  fecha_ingreso: '2020-01-15', fecha_baja: '2026-07-31', motivo_baja: 'despido_sin_causa',
  jornada: 'completa', sueldo_convenido: null,
}

function setupDatosPorFinal() {
  mockGetUser = () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null })
  mockIsSuperadmin = () => Promise.resolve({ data: false, error: null })
  dataPorTabla = {
    nom_usuarios_empresas: lista([{ rol: 'rrhh' }]),
    // nom_periodos: por id con .single() devuelve el período final; las
    // consultas de listado (semestre) devuelven []; los updates no devuelven.
    nom_periodos: (hist) => {
      if (enHistoria(hist, 'single')) return { data: PERIODO_FINAL, error: null }
      if (enHistoria(hist, 'update')) return { data: null, error: null }
      return { data: [], error: null }
    },
    nom_liquidaciones: (hist) => {
      if (enHistoria(hist, 'upsert')) return { data: [{ id: 'li1', personal_id: 'p1' }], error: null }
      return { data: [], error: null }
    },
    nom_conceptos: lista([]),
    nom_empresa_features: lista([]),
    nom_v_personal: lista([{ id: 'p1', nombre: 'Juan Pérez', fecha_ingreso: '2020-01-15' }]),
    nom_legajo: (hist) => {
      if (enHistoria(hist, 'update')) return { data: null, error: null }
      return { data: [LEGAJO], error: null }
    },
    nom_categorias: (hist) => {
      if (enHistoria(hist, 'maybeSingle')) return { data: { id: 'cat1', convenio_id: 'conv1', nombre: 'Oficial' }, error: null }
      return { data: [{ id: 'cat1', convenio_id: 'conv1', nombre: 'Oficial', basico: 1000000, modalidad: 'mensual' }], error: null }
    },
    nom_convenios: single({ id: 'conv1', regimen: 'lct' }),
    nom_parametros: lista([{ valor: 2000000 }]),
    nom_v_horas_dia: lista([]),
    nom_v_ausencias: lista([]),
    nom_liquidacion_items: (hist) => {
      if (enHistoria(hist, 'insert')) return { data: null, error: null }
      if (enHistoria(hist, 'delete')) return { data: null, error: null }
      return { data: [], error: null }
    },
  }
}

describe('liquidar-periodo: branch final (Liquidaciones individuales)', () => {
  it('una persona con baja y motivo liquida el final y devuelve liquidadas: 1', async () => {
    setupDatosPorFinal()
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'pf1', personalIds: ['p1'] }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.liquidadas).toBe(1)
    expect(json.omitidos).toEqual([])
  })

  it('sin motivo_baja o fecha_baja: omite a la persona con el motivo claro', async () => {
    setupDatosPorFinal()
    dataPorTabla.nom_legajo = (hist) => {
      if (enHistoria(hist, 'update')) return { data: null, error: null }
      return { data: [{ ...LEGAJO, fecha_baja: null, motivo_baja: null }], error: null }
    }
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'pf1', personalIds: ['p1'] }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.liquidadas).toBe(0)
    expect(json.omitidos[0].motivo).toContain('fecha_baja o motivo_baja')
  })

  it('legajo sin convenio o categoría: omite con motivo en vez de 500', async () => {
    setupDatosPorFinal()
    dataPorTabla.nom_legajo = (hist) => {
      if (enHistoria(hist, 'update')) return { data: null, error: null }
      return { data: [{ ...LEGAJO, convenio_id: null, categoria_id: null }], error: null }
    }
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'pf1', personalIds: ['p1'] }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.liquidadas).toBe(0)
    expect(json.omitidos[0].motivo).toContain('convenio o categoría')
  })
})
