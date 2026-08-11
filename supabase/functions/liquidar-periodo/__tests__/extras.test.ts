// Tests de la resolución de bonos no remunerativos por obra + excepción
// (Task 3.1, plan convenios-por-obra 2026-08-07). `resolverBonosPersona` es
// una función pura exportada por index.ts — se testea directo, sin
// levantar todo el handler de la Edge Function (que auth.test.ts ya cubre
// con un mock de supabase-js). El resto de la Task 3.1 (obra del personal,
// tope por obra, ajuste de horas) se verifica por lectura de código y por
// el smoke test manual documentado en el plan (Fase 5, Task 5.2) — requiere
// datos reales de Presencio (obras) que no existen en este entorno de test.
import { describe, it, expect, vi, beforeAll } from 'vitest'

vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => ({}) }))

// index.ts corre `Deno.serve(...)` al importarse (igual que auth.test.ts);
// hace falta stubear Deno global ANTES del import dinámico.
let resolverBonosPersona: typeof import('../index.ts')['resolverBonosPersona']

beforeAll(async () => {
  ;(globalThis as any).Deno = {
    env: { get: () => 'https://test.supabase.co' },
    serve: () => {},
  }
  const mod = await import('../index.ts')
  resolverBonosPersona = mod.resolverBonosPersona
})

describe('resolverBonosPersona (Task 3.1 — bonos por obra + excepción)', () => {
  const bonos = [{ id: 'b1', nombre: 'Bono presentismo', activo: true }]

  it('bono aplicado a la obra sin excepción: aparece con el monto de la aplicación', () => {
    const r = resolverBonosPersona('p1', 'obraA', bonos,
      [{ bono_id: 'b1', obra_id: 'obraA', monto: 50000 }], [])
    expect(r).toEqual([{ codigo: 'bono_b1', nombre: 'Bono presentismo', monto: 50000 }])
  })

  it('bono aplicado a otra obra: no aparece', () => {
    const r = resolverBonosPersona('p1', 'obraB', bonos,
      [{ bono_id: 'b1', obra_id: 'obraA', monto: 50000 }], [])
    expect(r).toEqual([])
  })

  it('bono aplicado a toda la empresa (obra_id null): aplica a cualquier obra', () => {
    const r = resolverBonosPersona('p1', 'obraZ', bonos,
      [{ bono_id: 'b1', obra_id: null, monto: 30000 }], [])
    expect(r).toEqual([{ codigo: 'bono_b1', nombre: 'Bono presentismo', monto: 30000 }])
  })

  it('excepción con monto NULL desactiva el bono para esa persona', () => {
    const r = resolverBonosPersona('p1', 'obraA', bonos,
      [{ bono_id: 'b1', obra_id: 'obraA', monto: 50000 }],
      [{ bono_id: 'b1', personal_id: 'p1', monto: null }])
    expect(r).toEqual([])
  })

  it('excepción con monto propio reemplaza el monto de la aplicación, solo para esa persona', () => {
    const r = resolverBonosPersona('p1', 'obraA', bonos,
      [{ bono_id: 'b1', obra_id: 'obraA', monto: 50000 }],
      [{ bono_id: 'b1', personal_id: 'p1', monto: 30000 }])
    expect(r).toEqual([{ codigo: 'bono_b1', nombre: 'Bono presentismo', monto: 30000 }])

    // otra persona sin excepción sigue cobrando el monto de la aplicación
    const r2 = resolverBonosPersona('p2', 'obraA', bonos,
      [{ bono_id: 'b1', obra_id: 'obraA', monto: 50000 }],
      [{ bono_id: 'b1', personal_id: 'p1', monto: 30000 }])
    expect(r2).toEqual([{ codigo: 'bono_b1', nombre: 'Bono presentismo', monto: 50000 }])
  })

  it('bono tipo "por_horas" (0064): monto × horas trabajadas del período', () => {
    const r = resolverBonosPersona('p1', 'obraA', bonos,
      [{ bono_id: 'b1', obra_id: 'obraA', monto: 1000, tipo_monto: 'por_horas' }], [],
      120)
    expect(r).toEqual([{ codigo: 'bono_b1', nombre: 'Bono presentismo', monto: 120000 }])
  })

  it('bono "por_horas" con excepción de monto: usa el monto de la excepción como valor por hora', () => {
    const r = resolverBonosPersona('p1', 'obraA', bonos,
      [{ bono_id: 'b1', obra_id: 'obraA', monto: 1000, tipo_monto: 'por_horas' }],
      [{ bono_id: 'b1', personal_id: 'p1', monto: 1500 }],
      40)
    expect(r).toEqual([{ codigo: 'bono_b1', nombre: 'Bono presentismo', monto: 60000 }])
  })

  it('sin aplicaciones: no hay bonos', () => {
    expect(resolverBonosPersona('p1', 'obraA', bonos, [], [])).toEqual([])
  })
})
