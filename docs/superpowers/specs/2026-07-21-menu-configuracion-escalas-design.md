# Menú de configuración: escalas, no remunerativos, aportes/contribuciones, adicionales y parámetros

Fecha: 2026-07-21 · Rama: `dev` · Estado: aprobado por el usuario (diseño conversado en sesión)

## Objetivo

Que el usuario de la app cargue desde la UI —sin tocar SQL— todo lo que hoy vive en seeds:
básicos por categoría (puesto), sumas no remunerativas mensuales por categoría, porcentajes de
aportes y contribuciones, conceptos adicionales por puesto (nominales o porcentuales sobre lo
remunerativo y/o no remunerativo) y parámetros versionados (ej. `tope_sipa`).

Decisiones tomadas con el usuario:

- "Puestos" = categorías del convenio (`nom_categorias`). No se crea entidad nueva.
- No remunerativos: monto por categoría, versionado por vigencia (patrón paritaria).
- Aportes/contribuciones: edición estructurada (porcentaje + base + tope), no fórmula libre.
- Adicionales: se asignan a una o varias categorías (o a todas).
- Se incluye CRUD de `nom_parametros` en el mismo menú.
- Enfoque elegido: extender el esquema existente (Enfoque A), con clonado de convenios globales.

## Sección 1 — Modelo de datos (migración 0012)

### 1.1 `nom_no_remunerativos` (tabla nueva)

```sql
CREATE TABLE nom_no_remunerativos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convenio_id      UUID NOT NULL REFERENCES nom_convenios(id) ON DELETE CASCADE,
  categoria_nombre TEXT NOT NULL,
  monto            NUMERIC NOT NULL,
  vigencia_desde   DATE NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (convenio_id, categoria_nombre, vigencia_desde)
);
```

- Versionado idéntico a `nom_categorias`: nunca se pisa un valor, se agrega una vigencia nueva.
  El valor de un período es el de la fila con mayor `vigencia_desde <= fecha_hasta` del período.
- RLS heredada del convenio vía EXISTS, calcada de la política de `nom_categorias`
  (SELECT si el convenio es global o de la empresa; escritura solo si es de la empresa).
- GRANT a `authenticated` y a `service_role` (la Edge Function la lee).

### 1.2 Columnas nuevas en `nom_conceptos`

```sql
ALTER TABLE nom_conceptos ADD COLUMN categorias TEXT[];  -- NULL = aplica a todas
ALTER TABLE nom_conceptos ADD COLUMN config JSONB;       -- NULL = concepto avanzado/legado
```

- `categorias`: lista de nombres de categoría a las que aplica el concepto. NULL = todas.
- `config`: metadata del formulario estructurado. Formas válidas:
  - `{"modo":"porcentaje","porcentaje":11,"base":"remunerativo","tope":"tope_sipa"}`
    (`base` ∈ `remunerativo` | `no_remunerativo` | `ambos`; `tope` es opcional y nombra un
    parámetro de `nom_parametros`)
  - `{"modo":"nominal","monto":15000}`
- La fórmula (`nom_conceptos.formula`) se **genera** desde `config` al guardar. El motor no
  cambia su contrato: sigue leyendo solo `formula`. Con `config` NULL la UI muestra la fórmula
  en solo lectura (no editable desde el formulario estructurado).

### 1.3 Función `clonar_convenio(convenio_global_id UUID)`

SQL, SECURITY DEFINER. En una transacción:

1. Valida que quien llama tenga `auth_empresa_id()` no nulo y que el convenio origen sea global
   (`empresa_id IS NULL`). Si no, aborta.
2. Copia el convenio con `empresa_id` = empresa del usuario.
3. Copia todas las filas de `nom_categorias` del convenio origen (todas las vigencias) al clon.
4. Copia los conceptos plantilla (`nom_conceptos` con `empresa_id IS NULL` de ese convenio) y sus
   `nom_concepto_reglas` al clon, con `empresa_id` de la empresa.
5. Re-apunta `nom_legajo.convenio_id` y `nom_legajo.categoria_id` de los legajos de la empresa
   que apuntaban al convenio global hacia el clon (el `categoria_id` se mapea por
   `(nombre, vigencia_desde)`).
6. Devuelve el id del convenio nuevo.

Idempotencia: si la empresa ya tiene un clon de ese convenio (mismo `nombre`), la función lo
devuelve sin duplicar.

## Sección 2 — Motor y Edge Function

### 2.1 Motor (`packages/motor`)

- `liquidarConceptos` expone la variable `no_remunerativo_acumulado` (hoy solo existe
  `remunerativo_acumulado`), acumulando los montos de conceptos tipo `no_remunerativo` ya
  liquidados según `orden`. Cambio puro + tests.

### 2.2 Edge Function `liquidar-periodo`

- Resuelve `no_rem_convenio` por categoría del legajo leyendo `nom_no_remunerativos` con la
  vigencia correcta (mismo patrón que `basico_convenio`). Si no hay fila vigente, 0.
- Filtra conceptos por legajo: se liquidan los que tienen `categorias IS NULL` o cuyo array
  contiene el nombre de la categoría del legajo.
- El concepto plantilla de suma no remunerativa usa la fórmula `no_rem_convenio`.

## Sección 3 — UI: página Configuración con pestañas

`ConfiguracionPage` se reorganiza en cinco pestañas. Si el convenio activo es global, todo se
muestra en solo lectura con botón "Personalizar convenio" (llama `clonar_convenio` y recarga).

1. **Escalas salariales**: tabla de categorías con básico vigente. "Nueva vigencia" abre un
   formulario que precarga las categorías actuales y permite cargar todos los montos nuevos con
   una `vigencia_desde` común (una paritaria entera de una vez). Historial expandible por
   categoría. Alta de categoría nueva desde la misma pantalla.
2. **No remunerativos**: misma mecánica que escalas, sobre `nom_no_remunerativos`.
3. **Aportes y contribuciones**: lista de conceptos tipo `descuento` y `aporte_patronal` con
   formulario estructurado: porcentaje, base, tope opcional. Al guardar se genera la fórmula y
   se persiste junto con `config`.
4. **Adicionales**: alta/edición de conceptos `remunerativo` o `no_remunerativo`: nombre, modo
   (nominal | porcentual), monto o porcentaje + base, selector múltiple de categorías (o
   "todas"). Mismo generador de fórmula. El `codigo` se genera slugificando el nombre; `orden`
   se asigna a continuación del último concepto del mismo tipo.
5. **Parámetros**: CRUD versionado de `nom_parametros` (código, valor, vigencia desde/hasta),
   precargado con `tope_sipa`.

Stores nuevos (zustand, patrón existente): `escalasStore`, `noRemunerativosStore`,
`parametrosStore`; `conceptosStore` se extiende con `categorias`/`config` y alta de conceptos.

## Sección 4 — Permisos

- Las políticas RLS existentes ya permiten a `authenticated` escribir datos de su empresa en
  `nom_conceptos`, `nom_categorias` (vía convenio) y `nom_parametros`. `nom_no_remunerativos`
  replica el patrón. No se tocan las migraciones 0007/0009/0010.
- `clonar_convenio` es el único privilegio especial (SECURITY DEFINER) y valida internamente
  empresa del llamador y que el origen sea global.

## Sección 5 — Generador de fórmulas, testing y errores

- `generarFormula(config)`: función pura en `packages/motor/src/formulas.ts`; la UI importa
  solo ese módulo (no arrastra el motor completo al bundle). El intérprete ya soporta
  `min`/`max`, necesarios para el tope. Salidas ejemplo:
  - porcentaje 11 sobre remunerativo con tope: `min(remunerativo_acumulado, tope_sipa) * 0.11`
  - porcentaje sobre ambos: `(remunerativo_acumulado + no_remunerativo_acumulado) * 0.09`
  - nominal: `15000`
- Validación al guardar: la fórmula generada se evalúa con el intérprete del motor sobre valores
  de ejemplo; si el intérprete falla, no se guarda y se muestra el error.
- Tests: `generarFormula` (todas las combinaciones), motor (`no_remunerativo_acumulado`,
  filtrado por categorías), mapeos from/toDB de los stores nuevos.
- La UI muestra los errores de guardado (hoy `guardarConcepto` devuelve el error y la página lo
  ignora — se corrige).

## Fuera de alcance

- Edición libre de fórmulas desde la UI (queda solo lectura para conceptos sin `config`).
- Asignación de adicionales por legajo individual.
- Migrar `basico` o parámetros a un modelo generalizado de valores versionados (Enfoque B).

## Verificación de punta a punta

Una vez implementado: cargar la escala real y la suma no remunerativa del convenio desde el
menú, recalcular el período desde la UI y contrastar contra el reporte de Presencio de la misma
quincena (Task 7 del plan anterior). Anotar discrepancias; no ajustar el motor para forzar
coincidencia sin entender la causa.
