import { describe, it, expect, vi } from 'vitest'
import { registrarAcceso } from '../auditoria'

describe('registrarAcceso', () => {
  it('llama a supabase.rpc(registrar_acceso, ...) con los parámetros correctos', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const supabase = { rpc }
    await registrarAcceso(supabase, 'recibo_pdf', 'liq-1', 'período 2026-07 quincena_1')
    expect(rpc).toHaveBeenCalledWith('registrar_acceso', {
      p_recurso: 'recibo_pdf', p_recurso_id: 'liq-1', p_detalle: 'período 2026-07 quincena_1',
    })
  })

  it('el detalle nunca incluye montos ni CUIL — valida el formato antes de mandarlo', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const supabase = { rpc }
    // Un detalle con pinta de monto ($) o de CUIL (11 dígitos con guiones)
    // se rechaza ANTES de llamar al RPC: el log de auditoría es
    // deliberadamente solo contexto ("qué período", no "cuánto cobra
    // quién"), y un `detalle` armado a mano en un punto de llamada nuevo
    // podría filtrar datos salariales sin que nadie lo note en code review.
    await expect(registrarAcceso(supabase, 'export_csv', null, 'neto $150.000')).rejects.toThrow()
    await expect(registrarAcceso(supabase, 'export_csv', null, 'CUIL 20-12345678-9')).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('no propaga el error si el RPC falla (fire-and-forget)', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
    const supabase = { rpc }
    await expect(registrarAcceso(supabase, 'recibo_pdf', 'liq-1', 'ok')).resolves.toBeUndefined()
  })
})
