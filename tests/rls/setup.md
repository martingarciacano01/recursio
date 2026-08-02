# Setup de usuarios de prueba para la suite RLS

Se hace UNA sola vez (o cuando haga falta rotar passwords). Los tests
asumen que estos usuarios ya existen — no los crean ni los borran.

## 1. Crear los usuarios en Supabase Auth

Dashboard → Authentication → Users → "Add user" (o `supabase.auth.admin.createUser`
desde el SQL Editor no aplica; usar la UI o la API de Admin):

| Email | Password | Uso |
|---|---|---|
| `rls-a@recursio.test` | (elegir uno fuerte, guardarlo en `.env.local`) | Usuario de la empresa de prueba A, rol `admin` |
| `rls-b@recursio.test` | ídem | Usuario de la empresa de prueba B, rol `admin` |
| `rls-consulta@recursio.test` | ídem | Usuario de la empresa A, rol `consulta` (para probar que no puede escribir) |

Marcar "Auto Confirm User" al crearlos (si no, quedan con el email sin
confirmar y `signInWithPassword` falla).

## 2. Crear las empresas de prueba y vincular los roles

Correr una sola vez en el SQL Editor (el prefijo `ZZ-TEST-` es el que
usa toda la suite para poder identificar estos datos a simple vista):

```sql
insert into empresas (nombre) values ('ZZ-TEST-A (Recursio RLS)') returning id;
insert into empresas (nombre) values ('ZZ-TEST-B (Recursio RLS)') returning id;
```

Anotar los dos `id` devueltos, y con ellos:

```sql
insert into nom_usuarios_empresas (usuario_id, empresa_id, rol)
select id, '<id-empresa-A>', 'admin' from auth.users where email = 'rls-a@recursio.test';

insert into nom_usuarios_empresas (usuario_id, empresa_id, rol)
select id, '<id-empresa-B>', 'admin' from auth.users where email = 'rls-b@recursio.test';

insert into nom_usuarios_empresas (usuario_id, empresa_id, rol)
select id, '<id-empresa-A>', 'consulta' from auth.users where email = 'rls-consulta@recursio.test';
```

## 3. Cargar `.env.local`

Ver el bloque de variables en `README.md`. `SUPABASE_TEST_URL` es la URL
del proyecto ("Presencio-dev"); `SUPABASE_TEST_ANON_KEY` y
`SUPABASE_TEST_SERVICE_KEY` están en Project Settings → API.

## Notas

- Las empresas A/B y los tres usuarios son PERMANENTES: no se recrean ni
  se borran en cada corrida. Si en algún momento hay que rotarlos, borrar
  a mano por email/nombre exacto (`ZZ-TEST-A`/`ZZ-TEST-B`), nunca con un
  `DELETE` amplio.
- Los tests SÍ crean y borran filas dentro de `nom_legajo`,
  `nom_familiares`, etc. usando estas dos empresas — eso es responsabilidad
  de cada test (`afterAll` filtrando por los IDs que insertó él mismo).
