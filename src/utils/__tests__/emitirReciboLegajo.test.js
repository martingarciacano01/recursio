import { describe, it, expect, vi, beforeEach } from 'vitest'
import { datosReciboDesdeSupabase } from '../emitirReciboLegajo'

const from = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { from: (t) => from(t) } }))

function tabla(data) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

describe('datosReciboDesdeSupabase', () => {
  beforeEach(() => {
    from.mockImplementation((t) => {
      if (t === 'empresas') return tabla({ nombre: 'Asset Construcciones', logo_url: null })
      if (t === 'nom_empresa_config') return tabla({ cuit: '30-1111-9', domicilio: 'Av. Siempreviva 742' })
      if (t === 'nom_legajo') return tabla({ cuil: '20-33901676-4', categoria_id: 'cat-1', fecha_ingreso: '2024-03-01', banco: 'Santander', antiguedad_reconocida: 0 })
      if (t === 'nom_categorias') return tabla({ nombre: 'Ayudante' })
      return tabla(null)
    })
  })

  it('arma empresa, persona y categoria resueltas', async () => {
    const r = await datosReciboDesdeSupabase({ empresaId: 'e1', personalId: 'p1', nombrePersona: 'Juan Martín García Cano' })
    expect(r.empresa).toEqual({ nombre: 'Asset Construcciones', cuit: '30-1111-9', domicilio: 'Av. Siempreviva 742' })
    expect(r.persona.cuil).toBe('20-33901676-4')
    expect(r.persona.categoria).toBe('Ayudante')
    expect(r.persona.nombre).toBe('Juan Martín García Cano')
  })

  it('usa guiones cuando faltan los datos fiscales', async () => {
    from.mockImplementation((t) => {
      if (t === 'empresas') return tabla({ nombre: 'X', logo_url: null })
      return tabla(null)
    })
    const r = await datosReciboDesdeSupabase({ empresaId: 'e1', personalId: 'p1', nombrePersona: 'Sin Legajo' })
    expect(r.empresa.cuit).toBe('—')
    expect(r.persona.categoria).toBe('—')
  })
})
