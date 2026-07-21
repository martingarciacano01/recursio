// Test de integración de RLS para 0004_legajo_completo.sql.
//
// Requiere credenciales reales de un proyecto Supabase de TEST (nunca
// producción): SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY. Sin ellas,
// se saltea (describe.skipIf) para no romper CI ni exigir acceso a
// Supabase para correr el resto de la suite.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_TEST_URL = process.env.SUPABASE_TEST_URL
const SUPABASE_TEST_SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY
const tieneCredenciales = Boolean(SUPABASE_TEST_URL && SUPABASE_TEST_SERVICE_KEY)

describe.skipIf(!tieneCredenciales)('RLS nom_familiares / nom_sanciones_personal', () => {
  let admin, empresaX, empresaY, clienteA, clienteB, personalIdFake

  beforeAll(async () => {
    admin = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY)
    const { data: eX } = await admin.from('empresas').insert({ nombre: 'Legajo Test X' }).select().single()
    const { data: eY } = await admin.from('empresas').insert({ nombre: 'Legajo Test Y' }).select().single()
    empresaX = eX; empresaY = eY
    personalIdFake = crypto.randomUUID()

    const { data: userA } = await admin.auth.admin.createUser({
      email: `legajo-a-${Date.now()}@recursio.test`, password: 'testpass123', email_confirm: true,
      user_metadata: { empresa_id: empresaX.id, rol: 'admin' },
    })
    const { data: userB } = await admin.auth.admin.createUser({
      email: `legajo-b-${Date.now()}@recursio.test`, password: 'testpass123', email_confirm: true,
      user_metadata: { empresa_id: empresaY.id, rol: 'admin' },
    })
    clienteA = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY)
    await clienteA.auth.signInWithPassword({ email: userA.user.email, password: 'testpass123' })
    clienteB = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY)
    await clienteB.auth.signInWithPassword({ email: userB.user.email, password: 'testpass123' })
  })

  afterAll(async () => {
    await admin.from('nom_familiares').delete().in('empresa_id', [empresaX?.id, empresaY?.id].filter(Boolean))
    await admin.from('nom_sanciones_personal').delete().in('empresa_id', [empresaX?.id, empresaY?.id].filter(Boolean))
    await admin.from('empresas').delete().in('id', [empresaX?.id, empresaY?.id].filter(Boolean))
  })

  it('usuario B no ve familiares de la empresa X', async () => {
    await clienteA.from('nom_familiares').insert({ empresa_id: empresaX.id, personal_id: personalIdFake, vinculo: 'hijo', nombre: 'Test Hijo' })
    const { data, error } = await clienteB.from('nom_familiares').select('*').eq('personal_id', personalIdFake)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('usuario B no ve sanciones de la empresa X', async () => {
    await clienteA.from('nom_sanciones_personal').insert({ empresa_id: empresaX.id, personal_id: personalIdFake, tipo: 'llamado_atencion', motivo: 'test', fecha: '2026-01-01' })
    const { data, error } = await clienteB.from('nom_sanciones_personal').select('*').eq('personal_id', personalIdFake)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('usuario B no puede insertar un familiar con empresa_id ajeno', async () => {
    const { error } = await clienteB.from('nom_familiares').insert({ empresa_id: empresaX.id, personal_id: crypto.randomUUID(), vinculo: 'hijo', nombre: 'Ajeno' })
    expect(error).not.toBeNull()
  })

  it('usuario B no puede insertar una sanción con empresa_id ajeno', async () => {
    const { error } = await clienteB.from('nom_sanciones_personal').insert({ empresa_id: empresaX.id, personal_id: crypto.randomUUID(), tipo: 'apercibimiento', motivo: 'ajeno', fecha: '2026-01-01' })
    expect(error).not.toBeNull()
  })
})
