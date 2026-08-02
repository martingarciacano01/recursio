// Test de integración de RLS para nom_legajo (0002 + 0026 RLS por rol).
//
// Requiere credenciales reales de un proyecto Supabase de TEST — ver
// tests/rls/README.md (advertencia de seguridad) y setup.md (usuarios
// de prueba fijos). Sin ellas, se saltea (describe.skipIf) para no
// romper `npm test` ni exigir acceso a Supabase para correr el resto de
// la suite.
//
// A diferencia de la versión anterior de este archivo, clienteA/clienteB
// están logueados con la ANON key + signInWithPassword (sujetos a RLS de
// verdad) — la versión vieja usaba la service_role key también para
// "loguear" al usuario, lo que bypasea RLS sin importar la sesión y hacía
// que estos tests pudieran pasar aunque la RLS estuviera rota.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  tieneCredenciales, clienteAdmin, clienteA, clienteB, empresasDePrueba,
} from './helpers.js'

describe.skipIf(!tieneCredenciales)('RLS nom_legajo — aislamiento entre empresas y por rol', () => {
  let admin, empresaAId, a, b
  let personalIdFake
  let legajoInsertadoId

  beforeAll(async () => {
    admin = clienteAdmin()
    ;({ empresaAId } = await empresasDePrueba(admin))
    a = await clienteA()
    b = await clienteB()
    personalIdFake = crypto.randomUUID()
  })

  afterAll(async () => {
    if (legajoInsertadoId) await admin.from('nom_legajo').delete().eq('id', legajoInsertadoId)
  })

  it('usuario A (rol admin) puede insertar y leer su propio legajo', async () => {
    const { data, error } = await a
      .from('nom_legajo')
      .insert({ empresa_id: empresaAId, personal_id: personalIdFake, cuil: '20-12345678-9' })
      .select()
      .single()

    expect(error).toBeNull()
    expect(data.empresa_id).toBe(empresaAId)
    legajoInsertadoId = data.id
  })

  it('usuario B no ve el legajo de la empresa A (aislamiento SELECT)', async () => {
    const { data, error } = await b.from('nom_legajo').select('*').eq('personal_id', personalIdFake)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('usuario B no puede insertar un legajo con empresa_id ajeno', async () => {
    const { error } = await b
      .from('nom_legajo')
      .insert({ empresa_id: empresaAId, personal_id: crypto.randomUUID(), cuil: '20-99999999-9' })
    expect(error).not.toBeNull()
  })

  it('anon (sin sesión) no lee nom_legajo', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const anonimo = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_ANON_KEY)
    const { data, error } = await anonimo.from('nom_legajo').select('*').limit(1)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })
})
