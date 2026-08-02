# Suite RLS de Recursio

> **ADVERTENCIA DE SEGURIDAD — leer antes de correr nada acá.**
>
> Estos tests corren contra la MISMA base que se usa para probar la app
> a mano (proyecto "Presencio-dev", compartido con Presencio). NO hay un
> proyecto de Supabase separado solo para tests. Consecuencias:
>
> - Todo dato que un test crea DEBE llevar un prefijo reconocible
>   (`ZZ-TEST-A-`, `ZZ-TEST-B-`) en `nombre`/`codigo`/campos de texto, para
>   poder identificarlo a simple vista si algo queda sin limpiar.
> - Cada test/`afterAll` limpia SOLO lo que él mismo creó, filtrando por
>   ID guardado en variables locales — nunca por rango de fechas ni por
>   "todo lo que empiece con ZZ-TEST", que podría alcanzar datos de otro
>   test corriendo en paralelo o de una corrida anterior que falló a
>   mitad de camino.
> - NUNCA se borra nada de `empresas`, `nom_usuarios_empresas` ni ninguna
>   tabla `nom_*` fuera de los IDs creados en el propio `beforeAll` del
>   archivo.
> - Si un test falla a mitad de camino y deja basura, limpiarla a mano
>   por el `id` específico (columna `nombre`/`codigo` con el prefijo
>   `ZZ-TEST-*` para encontrarla) — no correr un `DELETE` amplio.

## Qué verifica

- Aislamiento entre empresas: un usuario de la empresa A no lee ni
  escribe legajos/liquidaciones/familiares/sanciones de la empresa B.
- Gating por rol: `consulta` puede leer pero no puede escribir en
  ninguna tabla `nom_*`.
- `anon` (sin sesión) no lee nada de `nom_*`.
- Storage: usuario de A no obtiene URL firmada de un documento de B
  (solo si hay al menos un archivo de prueba cargado — si no, el caso
  queda con `it.skip` y un comentario explicando por qué).

No cubre: `revisor_externo` limitado a su paso de flujo ni `supervisor`
limitado a su sitio/región — quedan como pendiente explícito (ver nota al
pie de `roles.rls.test.js`), porque requieren datos de Presencio
(obras/fichajes) que esta suite no tiene forma de sembrar de forma
aislada todavía.

## Setup: usuarios de prueba

Los tests NO crean usuarios de Auth on-the-fly (crear/borrar usuarios de
Auth en cada corrida es lento y además efímero: si un test falla a mitad
de camino, puede dejar usuarios huérfanos en Auth sin ninguna forma fácil
de detectarlos). En cambio usan usuarios **fijos, creados una sola vez a
mano** — ver `setup.md` para el SQL/pasos exactos.

## Variables de entorno (`.env.local`, NUNCA commiteadas)

```
SUPABASE_TEST_URL=https://<proyecto>.supabase.co
SUPABASE_TEST_ANON_KEY=<anon key del mismo proyecto>
SUPABASE_TEST_SERVICE_KEY=<service_role key — solo para setup/cleanup en beforeAll/afterAll>
RLS_TEST_USER_A_EMAIL=rls-a@recursio.test
RLS_TEST_USER_A_PASSWORD=<password fijo del usuario A>
RLS_TEST_USER_B_EMAIL=rls-b@recursio.test
RLS_TEST_USER_B_PASSWORD=<password fijo del usuario B>
RLS_TEST_USER_CONSULTA_EMAIL=rls-consulta@recursio.test
RLS_TEST_USER_CONSULTA_PASSWORD=<password fijo>
```

Importante: `SUPABASE_TEST_ANON_KEY` es la clave `anon` real del
proyecto — con ella + `signInWithPassword` el cliente queda sujeto a RLS
de verdad (a diferencia de usar la `service_role key` para "loguear" un
usuario, que bypasea RLS sin importar la sesión — bug que tenía la
versión anterior de esta suite).

## Cómo correrlos

```bash
npx vitest run tests/rls
```

Sin las env vars cargadas, la suite entera se saltea (`describe.skipIf`)
para no romper `npm test` en un entorno sin credenciales de test. Con las
env vars cargadas y **antes** de aplicar las migraciones `0026`/`0043`,
se espera que varios casos FALLEN — es la señal de que el test sirve
(está probando algo real, no un tautología). Después de aplicar esas
migraciones, todo en verde.

## CI

No hay CI configurada en este repo todavía (Task 7.1 del plan de
producción). Cuando exista, agregar `npx vitest run tests/rls` como job
aparte con los secrets de arriba cargados como GitHub Secrets — no antes.
