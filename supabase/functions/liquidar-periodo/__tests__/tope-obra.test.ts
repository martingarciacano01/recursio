// Test end-to-end de la RESOLUCIÓN del tope de horas por obra (Task 1.3,
// plan 2026-08-11): persona con obra → tope de la obra (nom_config_obras,
// 0060); persona sin obra → tope de la EMPRESA (nom_config_horas, 0050);
// persona sin obra y sin config → sin tope (se liquida 1:1 lo fichado).
//
// Es el eslabón que faltaba: el tope podía estar bien implementado en el
// motor (asistencia.ts) pero la resolución "obra → empresa → default" de
// liquidar-periodo no está cubierta de punta a punta. Un fallo ahí explica
// "configuro el tope pero la grilla sigue mostrando horas sin topar".
//
// Se mockea el cliente supabase-js con datos realistas (personal con obra_id,
// período mensual, fichajes de 8h por día) y se captura el payload del
// `upsert` a nom_liquidaciones para verificar las horas topadas guardadas.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

type Fila = Record<string, any>
type Handler = (hist: string[][]) => { data: any; error: any }

let mockGetUser: () => Promise<{ data: { user: any }; error: any }>
let mockIsSuperadmin: () => Promise<{ data: boolean; error: any }>
let dataPorTabla: Record<string, Handler>
let detalleHorasGuardadas: any[] = []

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
  mockGetUser = () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null })
  mockIsSuperadmin = () => Promise.resolve({ data: false, error: null })
  detalleHorasGuardadas = []
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

// Período mensual lunes a viernes (2026-02-02 .. 2026-02-06): 5 días laborables.
const PERIODO = {
  id: 'pt1', empresa_id: 'e1', tipo: 'mensual', estado: 'abierto',
  fecha_desde: '2026-02-02', fecha_hasta: '2026-02-06', convenio_id: null,
}

const LEGAJO = {
  id: 'l1', personal_id: 'p1', empresa_id: 'e1', cuil: '20-30111222-3', cbu: '0000003100011122334455',
  convenio_id: 'conv1', categoria_id: 'cat1', fuera_convenio: false,
  fecha_ingreso: '2020-01-15', fecha_baja: null, jornada: 'completa', sueldo_convenido: null,
}

// 8h por día laborable (entrada 08:00 AR = 11:00 UTC, salida 16:00 AR = 19:00 UTC).
const FICHAJES_8H = ['2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06']
  .flatMap((d) => [
    { tipo: 'entrada', timestamp: `${d}T11:00:00Z`, personal_id: 'p1' },
    { tipo: 'salida', timestamp: `${d}T19:00:00Z`, personal_id: 'p1' },
  ])

function setupBase(opciones: { obraId?: string | null; configObra?: Fila | null; configEmpresa?: Fila | null }) {
  mockGetUser = () => Promise.resolve({ data: { user: { id: 'u1' } }, error: null })
  dataPorTabla = {
    nom_usuarios_empresas: lista([{ rol: 'rrhh' }]),
    nom_periodos: (hist) => {
      if (enHistoria(hist, 'single')) return { data: PERIODO, error: null }
      if (enHistoria(hist, 'update')) return { data: null, error: null }
      return { data: [], error: null }
    },
    nom_liquidaciones: (hist) => {
      // captura el payload del upsert para verificar detalle_horas
      const upsert = hist.find(([m]) => m === 'upsert')
      if (upsert) {
        const filas = (upsert[1] as Fila[]) || []
        detalleHorasGuardadas = filas.map((f) => f.detalle_horas)
        return { data: filas.map((f, i) => ({ id: `li${i}`, personal_id: f.personal_id })), error: null }
      }
      return { data: [], error: null }
    },
    nom_liquidacion_items: (hist) => {
      if (enHistoria(hist, 'insert') || enHistoria(hist, 'delete')) return { data: null, error: null }
      return { data: [], error: null }
    },
    nom_conceptos: lista([]),
    nom_v_personal: lista([{ id: 'p1', nombre: 'Juan Pérez', fecha_ingreso: '2020-01-15', obra_id: opciones.obraId ?? null }]),
    nom_legajo: lista([LEGAJO]),
    nom_legajo_adicionales: lista([]),
    nom_parametros: lista([]),
    nom_pagos_adelantos: lista([]),
    nom_categorias: (hist) => {
      if (enHistoria(hist, 'in')) return { data: [{ id: 'cat1', convenio_id: 'conv1', nombre: 'Oficial' }], error: null }
      return { data: [{ basico: 1000000, modalidad: 'mensual', nombre: 'Oficial', id: 'cat1' }], error: null }
    },
    nom_no_remunerativos: lista([]),
    nom_v_horas_dia: lista(FICHAJES_8H),
    nom_v_ausencias: lista([]),
    nom_v_empresa_feriados: single({ feriados: [] }),
    nom_config_horas: single(opciones.configEmpresa ?? null),
    nom_empresa_features: lista([]),
    nom_config_obras: lista(opciones.configObra ? [opciones.configObra] : []),
    nom_bonos: lista([]),
    nom_bono_aplicaciones: lista([]),
    nom_bono_excepciones: lista([]),
  }
}

describe('liquidar-periodo: resolución del tope de horas obra → empresa → default (Task 1.3)', () => {
  it('persona con obra con tope_horas_diarias=6: 5 días de 8h liquidan 6h por día (30h)', async () => {
    setupBase({ obraId: 'obraA', configObra: { obra_id: 'obraA', tope_horas_diarias: 6, jornada_horas: 8 } })
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'pt1', personalIds: ['p1'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ liquidadas: 1 })
    expect(detalleHorasGuardadas).toHaveLength(1)
    expect(detalleHorasGuardadas[0].horasTrabajadas).toBe(30) // 6 h × 5 días, no 8 × 5 = 40
    expect(detalleHorasGuardadas[0].topeHorasDiarias).toBe(6)
  })

  it('persona SIN obra + config de empresa con tope=6: aplica el tope de la empresa', async () => {
    setupBase({ obraId: null, configEmpresa: { tope_horas_diarias: 6, jornada_horas: 8 } })
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'pt1', personalIds: ['p1'] }))
    expect(res.status).toBe(200)
    expect(detalleHorasGuardadas[0].horasTrabajadas).toBe(30)
    expect(detalleHorasGuardadas[0].topeHorasDiarias).toBe(6)
  })

  it('persona SIN obra y SIN config de ninguna: sin tope, liquida 1:1 las 40h fichadas', async () => {
    setupBase({ obraId: null })
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'pt1', personalIds: ['p1'] }))
    expect(res.status).toBe(200)
    expect(detalleHorasGuardadas[0].horasTrabajadas).toBe(40) // 8 h × 5 días
    expect(detalleHorasGuardadas[0].topeHorasDiarias).toBeNull()
  })

  it('persona SIN obra con tope de empresa NULL (fila presente, valor nulo): igual sin tope', async () => {
    // la fila de nom_config_horas existe pero tope_horas_diarias es NULL:
    // no se debe aplicar ningún Math.min
    setupBase({ obraId: null, configEmpresa: { tope_horas_diarias: null, jornada_horas: 8 } })
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'pt1', personalIds: ['p1'] }))
    expect(res.status).toBe(200)
    expect(detalleHorasGuardadas[0].horasTrabajadas).toBe(40)
    expect(detalleHorasGuardadas[0].topeHorasDiarias).toBeNull()
  })

  it('con tope por obra activo, horas_liquidadas refleja el tope (Math.ceil sobre horas topadas)', async () => {
    setupBase({ obraId: 'obraA', configObra: { obra_id: 'obraA', tope_horas_diarias: 6, jornada_horas: 8 } })
    const handler = await cargarHandler()
    const res = await handler(req({ periodoId: 'pt1', personalIds: ['p1'] }))
    expect(res.status).toBe(200)
    expect(detalleHorasGuardadas[0].horasLiquidadas).toBe(30) // ceil(30), no 40
  })
})