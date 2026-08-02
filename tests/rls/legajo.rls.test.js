// Test de integración de RLS para nom_familiares / nom_sanciones_personal
// (0004 + 0026 RLS por rol). Ver tests/rls/README.md y setup.md.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { tieneCredenciales, clienteAdmin, clienteA, clienteB, empresasDePrueba } from './helpers.js'

describe.skipIf(!tieneCredenciales)('RLS nom_familiares / nom_sanciones_personal', () => {
  let admin, empresaAId, a, b, personalIdFake
  let familiarId, sancionId

  beforeAll(async () => {
    admin = clienteAdmin()
    ;({ empresaAId } = await empresasDePrueba(admin))
    a = await clienteA()
    b = await clienteB()
    personalIdFake = crypto.randomUUID()
  })

  afterAll(async () => {
    if (familiarId) await admin.from('nom_familiares').delete().eq('id', familiarId)
    if (sancionId) await admin.from('nom_sanciones_personal').delete().eq('id', sancionId)
  })

  it('usuario B no ve familiares de la empresa A', async () => {
    const { data: ins, error: errIns } = await a
      .from('nom_familiares')
      .insert({ empresa_id: empresaAId, personal_id: personalIdFake, vinculo: 'hijo', nombre: 'ZZ-TEST Hijo' })
      .select().single()
    expect(errIns).toBeNull()
    familiarId = ins.id

    const { data, error } = await b.from('nom_familiares').select('*').eq('personal_id', personalIdFake)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('usuario B no ve sanciones de la empresa A', async () => {
    const { data: ins, error: errIns } = await a
      .from('nom_sanciones_personal')
      .insert({ empresa_id: empresaAId, personal_id: personalIdFake, tipo: 'llamado_atencion', motivo: 'ZZ-TEST', fecha: '2026-01-01' })
      .select().single()
    expect(errIns).toBeNull()
    sancionId = ins.id

    const { data, error } = await b.from('nom_sanciones_personal').select('*').eq('personal_id', personalIdFake)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('usuario B no puede insertar un familiar con empresa_id ajeno', async () => {
    const { error } = await b.from('nom_familiares')
      .insert({ empresa_id: empresaAId, personal_id: crypto.randomUUID(), vinculo: 'hijo', nombre: 'ZZ-TEST Ajeno' })
    expect(error).not.toBeNull()
  })

  it('usuario B no puede insertar una sanción con empresa_id ajeno', async () => {
    const { error } = await b.from('nom_sanciones_personal')
      .insert({ empresa_id: empresaAId, personal_id: crypto.randomUUID(), tipo: 'apercibimiento', motivo: 'ZZ-TEST ajeno', fecha: '2026-01-01' })
    expect(error).not.toBeNull()
  })
})
