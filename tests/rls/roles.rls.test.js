// Casos de gating por ROL (0026_rls_roles.sql), complementarios al
// aislamiento por empresa que ya cubren nomina_core.rls.test.js y
// legajo.rls.test.js. Ver tests/rls/README.md y setup.md.
//
// Pendiente explícito (no cubierto acá): revisor_externo limitado a su
// paso de flujo y supervisor limitado a su sitio/región — requieren
// sembrar datos de Presencio (obras, nom_regiones_obras) que esta suite
// no arma todavía. Ver docs/superpowers/plans/2026-07-28-fase5h-seguridad.md
// Task 3 Step 2 para el detalle de qué falta.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import {
  tieneCredenciales, clienteAdmin, clienteA, clienteConsulta, empresasDePrueba,
  RLS_TEST_USER_CONSULTA_EMAIL,
} from './helpers.js'

const tieneUsuarioConsulta = Boolean(RLS_TEST_USER_CONSULTA_EMAIL)

describe.skipIf(!tieneCredenciales)('RLS por rol', () => {
  let admin, empresaAId, a
  let periodoId

  beforeAll(async () => {
    admin = clienteAdmin()
    ;({ empresaAId } = await empresasDePrueba(admin))
    a = await clienteA()
  })

  afterAll(async () => {
    if (periodoId) await admin.from('nom_periodos').delete().eq('id', periodoId)
  })

  it.skipIf(!tieneUsuarioConsulta)('rol consulta puede leer pero no puede escribir en nom_periodos', async () => {
    const consulta = await clienteConsulta()

    const { data: ins, error: errIns } = await a.from('nom_periodos').insert({
      empresa_id: empresaAId, tipo: 'mensual', fecha_desde: '2026-01-01', fecha_hasta: '2026-01-31',
      estado: 'abierto',
    }).select().single()
    expect(errIns).toBeNull()
    periodoId = ins.id

    const { data: leido, error: errLeido } = await consulta.from('nom_periodos').select('*').eq('id', periodoId)
    expect(errLeido).toBeNull()
    expect(leido).toHaveLength(1)

    const { error: errEscritura } = await consulta.from('nom_periodos')
      .update({ estado: 'cerrado' }).eq('id', periodoId)
    expect(errEscritura).not.toBeNull()

    const { error: errInsertConsulta } = await consulta.from('nom_periodos').insert({
      empresa_id: empresaAId, tipo: 'mensual', fecha_desde: '2026-02-01', fecha_hasta: '2026-02-28', estado: 'abierto',
    })
    expect(errInsertConsulta).not.toBeNull()
  })

  it('anon (sin sesión) no lee nom_periodos ni nom_liquidaciones', async () => {
    const anonimo = createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_ANON_KEY)
    const { data: periodos, error: errP } = await anonimo.from('nom_periodos').select('*').limit(1)
    expect(errP).toBeNull()
    expect(periodos).toHaveLength(0)
    const { data: liqs, error: errL } = await anonimo.from('nom_liquidaciones').select('*').limit(1)
    expect(errL).toBeNull()
    expect(liqs).toHaveLength(0)
  })

  // Storage: si hay al menos un documento de prueba cargado bajo la
  // carpeta de empresaB, un usuario de A no debería poder pedir su URL
  // firmada (0043_storage_ruta_empresa.sql). Se deja explícitamente
  // skip: sembrar un archivo real en el bucket privado desde el setup de
  // tests es más costoso que el resto de esta suite y no hay todavía un
  // documento de prueba fijo — ver Task 1.3 (ya aplicada) para el detalle
  // de la policy que este caso probaría.
  it.skip('usuario A no obtiene URL firmada de un documento de la empresa B (pendiente: sembrar archivo de prueba)', () => {})
})
