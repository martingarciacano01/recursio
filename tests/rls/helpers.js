// Helpers compartidos por la suite RLS (tests/rls/*.test.js). Ver
// tests/rls/README.md para la advertencia de seguridad y setup.md para
// cómo se crean los usuarios/empresas de prueba fijos que usa esto.
import { createClient } from '@supabase/supabase-js'

export const SUPABASE_TEST_URL = process.env.SUPABASE_TEST_URL
export const SUPABASE_TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY
export const SUPABASE_TEST_SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY
export const RLS_TEST_USER_A_EMAIL = process.env.RLS_TEST_USER_A_EMAIL
export const RLS_TEST_USER_A_PASSWORD = process.env.RLS_TEST_USER_A_PASSWORD
export const RLS_TEST_USER_B_EMAIL = process.env.RLS_TEST_USER_B_EMAIL
export const RLS_TEST_USER_B_PASSWORD = process.env.RLS_TEST_USER_B_PASSWORD
export const RLS_TEST_USER_CONSULTA_EMAIL = process.env.RLS_TEST_USER_CONSULTA_EMAIL
export const RLS_TEST_USER_CONSULTA_PASSWORD = process.env.RLS_TEST_USER_CONSULTA_PASSWORD

export const tieneCredenciales = Boolean(
  SUPABASE_TEST_URL && SUPABASE_TEST_ANON_KEY && SUPABASE_TEST_SERVICE_KEY &&
  RLS_TEST_USER_A_EMAIL && RLS_TEST_USER_A_PASSWORD &&
  RLS_TEST_USER_B_EMAIL && RLS_TEST_USER_B_PASSWORD
)

// Cliente admin (service_role): SOLO para setup/lookup/cleanup en
// beforeAll/afterAll — nunca para las aserciones de RLS en sí (bypasea
// todo, así que "probar" algo con él no prueba nada).
export function clienteAdmin() {
  return createClient(SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY)
}

// Cliente anon logueado como el usuario dado — sujeto a RLS de verdad,
// a diferencia de loguear con la service_role key (bug de la versión
// anterior de esta suite).
async function clienteLogueado(email, password) {
  const cliente = createClient(SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY)
  const { error } = await cliente.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`no se pudo loguear ${email}: ${error.message}`)
  return cliente
}

export async function clienteA() {
  return clienteLogueado(RLS_TEST_USER_A_EMAIL, RLS_TEST_USER_A_PASSWORD)
}
export async function clienteB() {
  return clienteLogueado(RLS_TEST_USER_B_EMAIL, RLS_TEST_USER_B_PASSWORD)
}
export async function clienteConsulta() {
  if (!RLS_TEST_USER_CONSULTA_EMAIL) return null
  return clienteLogueado(RLS_TEST_USER_CONSULTA_EMAIL, RLS_TEST_USER_CONSULTA_PASSWORD)
}

// Busca las empresas de prueba fijas por su nombre (ver setup.md) — no
// las crea; si no existen, el test falla con un mensaje claro en vez de
// un error de RLS confuso.
export async function empresasDePrueba(admin) {
  const { data: empresaA, error: errA } = await admin.from('empresas')
    .select('id').ilike('nombre', 'ZZ-TEST-A%').limit(1).maybeSingle()
  const { data: empresaB, error: errB } = await admin.from('empresas')
    .select('id').ilike('nombre', 'ZZ-TEST-B%').limit(1).maybeSingle()
  if (errA || errB || !empresaA || !empresaB) {
    throw new Error('faltan las empresas de prueba ZZ-TEST-A/ZZ-TEST-B — ver tests/rls/setup.md')
  }
  return { empresaAId: empresaA.id, empresaBId: empresaB.id }
}
