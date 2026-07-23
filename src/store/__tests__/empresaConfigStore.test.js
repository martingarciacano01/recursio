// src/store/__tests__/empresaConfigStore.test.js
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn((tabla) => {
      if (tabla === 'nom_empresa_config') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { empresa_id: 'e1', cuit: '30-12345678-9', domicilio: 'Av. Siempre Viva 123' }, error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      if (tabla === 'empresas') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { nombre: 'Asset', logo_url: 'https://x/logo.png' }, error: null }),
        }
      }
      throw new Error(`tabla inesperada: ${tabla}`)
    }),
  },
}))

import { useEmpresaConfigStore } from '../empresaConfigStore'

describe('useEmpresaConfigStore', () => {
  it('cargar trae cuit/domicilio de nom_empresa_config y nombre/logo de empresas', async () => {
    await useEmpresaConfigStore.getState().cargar('e1')
    const s = useEmpresaConfigStore.getState()
    expect(s.cuit).toBe('30-12345678-9')
    expect(s.domicilio).toBe('Av. Siempre Viva 123')
    expect(s.nombre).toBe('Asset')
    expect(s.logoUrl).toBe('https://x/logo.png')
  })

  it('guardar hace upsert en nom_empresa_config', async () => {
    const r = await useEmpresaConfigStore.getState().guardar('e1', { cuit: '30-1-9', domicilio: 'X 1' })
    expect(r.ok).toBe(true)
  })
})
