# Runbook — re-sembrar una base Recursio vacía

Fecha: 2026-07-29
Proyecto Supabase: `hlipootstxojwdxwkrwl`

## Síntoma

Configuración → Convenios queda en blanco: el selector "Convenio" no tiene
opciones y ninguna pestaña muestra nada. Las migraciones de seed corren
"sin error" pero no cambian nada.

## Diagnóstico

Consultando PostgREST con una sesión válida de superadmin:

| Tabla | Filas |
|---|---|
| `empresas` (compartida con Presencio) | 5 |
| `nom_convenios` | 0 |
| `nom_categorias` | 0 |
| `nom_conceptos` | 0 |
| `nom_no_remunerativos` | 0 |
| `nom_parametros` | 0 |
| `nom_legajo` | 0 |
| `nom_periodos`, `nom_liquidaciones` | 0 |

Las consultas devuelven **200, no 404 ni 401**: el esquema existe y la RLS
funciona. Simplemente no hay datos.

Esto explica que las migraciones no hagan nada: `0031` y `0037` insertan con
`FROM nom_convenios cv` y actualizan conceptos por código. Con
`nom_convenios` vacía, el `FROM` no produce filas y todo afecta 0 registros.
El SQL está bien; falta la precondición.

### Cómo verificarlo de nuevo

En la consola del navegador, con la app abierta y sesión iniciada:

```js
const url = import.meta.env.VITE_SUPABASE_URL
const k = `sb-${url.split('//')[1].split('.')[0]}-auth-token`
const t = JSON.parse(localStorage.getItem(k)).access_token
const h = { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + t }
await fetch(url + '/rest/v1/nom_convenios?select=id', { headers: h }).then(r => r.json())
```

Ojo: si en `localStorage` hay sesiones de más de un proyecto Supabase, hay
que tomar la clave `sb-<ref>-auth-token` que corresponde al `VITE_SUPABASE_URL`
actual. Buscar la primera que contenga `auth-token` puede devolver el token
de otro proyecto, y ahí PostgREST responde `401 PGRST301: No suitable key
was found to decode the JWT` — que parece un problema de credenciales pero
no lo es.

## Solución

Pegar en el SQL editor del proyecto, **en este orden**. Todas son
idempotentes (`IF NOT EXISTS` / `WHERE NOT EXISTS`), así que se pueden
correr de nuevo sin romper nada.

1. `supabase/migrations/0003_seed_convenios.sql`
   Crea los dos convenios plantilla ("Fuera de convenio (LCT)" y "UOCRA
   (Ley 22.250)") con sus categorías. **Los básicos quedan en 0** a
   propósito: los montos reales se cargan desde la app.

2. `supabase/migrations/0012_config_escalas.sql`
   Concepto plantilla `suma_no_rem` y la función `clonar_convenio`.

3. `supabase/migrations/0031_seed_conceptos_base.sql`
   Conceptos base: `basico` (sin él la liquidación da $0 en todo), aportes
   del trabajador y contribuciones patronales.

4. `supabase/migrations/0037_correccion_aportes_julio_2026.sql`
   Alícuotas vigentes a julio 2026 y conceptos del CCT 76/75.

No hace falta re-correr las migraciones de esquema (`0001`-`0002`, `0004`
en adelante): las tablas ya existen.

## Después del reseed

- [ ] Cargar los **básicos reales** por categoría en Configuración →
      Convenios → Escalas salariales, con su `vigencia_desde`.
- [ ] Cargar **`tope_sipa`** en Configuración → Empresa → Parámetros.
      `nom_parametros` está vacía: sin ese valor, `liquidar-periodo` usa un
      tope de 999.999.999 y los aportes con tope se calculan sobre el bruto
      completo.
- [ ] Revisar las **sumas no remunerativas** por categoría si el convenio
      las tiene.
- [ ] Borrar a mano el concepto `retencion_sindical` del convenio "Fuera de
      convenio (LCT)": `0031` lo siembra en todos los convenios, pero a un
      empleado fuera de convenio no se le retiene cuota sindical. Las
      migraciones no borran datos por diseño.
- [ ] Verificar con una liquidación de prueba antes de usarlo en serio.

## Prevención

`ConfiguracionPage.jsx` no leía `error` ni `cargando` del store de
convenios: una consulta fallida o una base vacía se veían igual que una
pantalla en blanco. Ahora muestra el error y un aviso de "no hay convenios
cargados", con cobertura en
`src/pages/__tests__/ConfiguracionPage.test.jsx`.
