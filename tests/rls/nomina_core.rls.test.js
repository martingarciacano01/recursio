// Test de integración de RLS para 0002_nomina_core.sql.
//
// Requiere credenciales reales de un proyecto Supabase de TEST (nunca
// producción): SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY. Sin ellas,
// se saltea (test.skipIf) para no romper CI ni exigir acceso a Supabase
// para correr el resto de la suite (Recursio_Plan_Ejecucion_Sonnet5.md,
// Task 4, Step 2).
//
// Qué verifica:
//  1. Usuario A (empresa X) inserta un legajo → lo puede leer.
//  2. Usuario B (empresa Y) hace SELECT sobre esa fila → 0 resultados.
//  3. Usuario B intenta INSERT con empresa_id de la empresa X → falla
//     (WITH CHECK empresa_id = auth_empresa_id() lo bloquea).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_TEST_URL = process.env.SUPABASE_TEST_URL
const SUPABASE_TEST_SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY
const tieneCredenciales = Boolean(SUPABASE_TEST_URL && SUPABASE_TEST_SERVICE_KEY)

describe.skipIf(!tieneCredenciales)('RLS nom_legajo — aislamiento entre empresas', () => {
  let admin
  let empresaX, empresaY
  let clienteA, clienteB
  let personalIdFake

  beforeAll(async () => {
    admin = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY)

    const { data: eX } = await admin.from('empresas').insert({ nombre: 'Empresa Test X (Recursio RLS)' }).select().single()
    const { data: eY } = await admin.from('empresas').insert({ nombre: 'Empresa Test Y (Recursio RLS)' }).select().single()
    empresaX = eX
    empresaY = eY
    personalIdFake = crypto.randomUUID()

    const { data: userA } = await admin.auth.admin.createUser({
      email: `rls-a-${Date.now()}@recursio.test`, password: 'testpass123', email_confirm: true,
      user_metadata: { empresa_id: empresaX.id, rol: 'admin' },
    })
    const { data: userB } = await admin.auth.admin.createUser({
      email: `rls-b-${Date.now()}@recursio.test`, password: 'testpass123', email_confirm: true,
      user_metadata: { empresa_id: empresaY.id, rol: 'admin' },
    })

    clienteA = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY)
    await clienteA.auth.signInWithPassword({ email: userA.user.email, password: 'testpass123' })
    clienteB = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY)
    await clienteB.auth.signInWithPassword({ email: userB.user.email, password: 'testpass123' })
  })

  afterAll(async () => {
    await admin.from('nom_legajo').delete().in('empresa_id', [empresaX?.id, empresaY?.id].filter(Boolean))
    await admin.from('empresas').delete().in('id', [empresaX?.id, empresaY?.id].filter(Boolean))
  })

  it('usuario A puede insertar y leer su propio legajo', async () => {
    const { data, error } = await clienteA
      .from('nom_legajo')
      .insert({ empresa_id: empresaX.id, personal_id: personalIdFake, cuil: '20-12345678-9' })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data.empresa_id).toBe(empresaX.id)
  })

  it('usuario B no ve el legajo de la empresa X (aislamiento SELECT)', async () => {
    const { data, error } = await clienteB.from('nom_legajo').select('*').eq('personal_id', personalIdFake)

    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('usuario B no puede insertar un legajo con empresa_id ajeno', async () => {
    const { error } = await clienteB
      .from('nom_legajo')
      .insert({ empresa_id: empresaX.id, personal_id: crypto.randomUUID(), cuil: '20-99999999-9' })

    expect(error).not.toBeNull()
  })
})
