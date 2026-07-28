# Handoff — Liquidación devolvía $0 (28/07/2026)

Estado: **causa raíz diagnosticada, fix escrito, migración SIN aplicar todavía.**

---

## 1. El síntoma

Empresa **Asset Construcciones** (`8007e464-efe2-4929-a977-f8aade8ee450`), período
quincenal `2026-06-15 → 2026-07-01`.

Legajo Juan Martín García Cano (`personal_id f4fdb0c8-c5c0-4aa7-b2ea-f734174ccad0`),
convenio UOCRA, categoría Ayudante, escala $1.000/h vigente 2026-06-01.
Asistencia calculada OK: 23,87 h · HE 50 % 2,02 h · 7 tardanzas · 6 faltas inj.

Resultado: **bruto $0, aportes $0, contribuciones $0, neto $0** — y **0 advertencias**.

## 2. Causa raíz (confirmada contra la base, no inferida)

**No existe el concepto `basico` en ningún convenio.**

`liquidar-periodo/index.ts` resuelve la escala vigente y la deja en la variable
`basico_periodo` (ver `packages/motor/src/basico.ts`). Pero es un **concepto** el
que tiene que consumir esa variable para que el monto entre a
`remunerativo_acumulado`. Sin concepto `basico`:

```
remunerativo_acumulado = 0
  → bruto = 0
  → jubilación / obra social / contribuciones (todas % del acumulado) = 0
```

Y no hay advertencia porque la escala **sí** se resolvió bien — el chequeo de
`basico === null || basico.basico === 0` (index.ts ~línea 300) nunca dispara.

### Evidencia recogida vía PostgREST con la sesión del navegador

Conceptos existentes en toda la base:

| convenio | empresa | codigo | tipo | formula |
|---|---|---|---|---|
| `2a04ba84` LCT global | GLOBAL | `suma_no_rem` | no_remunerativo | `no_rem_convenio` |
| `a43e311a` UOCRA global | GLOBAL | `suma_no_rem` | no_remunerativo | `no_rem_convenio` |
| `172f8ca7` LCT empresa | 8007 | `suma_no_rem` | no_remunerativo | `no_rem_convenio` |
| `172f8ca7` | 8007 | `jubilacion` | descuento | `remunerativo_acumulado * 0.1` |
| `172f8ca7` | 8007 | `obra_social` | descuento | `(rem + no_rem) * 0.05` |
| `172f8ca7` | 8007 | `trabajo_en_altura` | remunerativo | `remunerativo_acumulado * 0.1` |
| **`c6d3e208` UOCRA empresa** | 8007 | `suma_no_rem` | no_remunerativo | `no_rem_convenio` |
| **`c6d3e208`** | 8007 | `jubilacion` | descuento | `remunerativo_acumulado * 0.05` |
| **`c6d3e208`** | 8007 | `obra_social` | descuento | `remunerativo_acumulado * 0.03` |

Ningún `basico`, en ningún lado. `nom_no_remunerativos` está vacía (por eso
`suma_no_rem` también da 0) y `nom_parametros` está vacía (sin `tope_sipa`).

Categoría del legajo = `7056b4ba` → *Ayudante, $1.000, modalidad `hora`,
vigencia_desde 2026-06-01*. Se resuelve correctamente.

### Por qué falta

**Ninguna migración crea nunca el concepto `basico`.** El único concepto sembrado
en todo el repo es `suma_no_rem` (0012). Las migraciones posteriores lo dan por
existente:

- `0019` hace `UPDATE ... WHERE codigo = 'basico'` → no matchea nada.
- `0020` hace `UPDATE ... WHERE convenio_id IS NULL` → **`convenio_id` es NOT NULL
  desde 0005**, así que ningún `codigo_recibo` se asignó jamás.
- `0029` arranca con `SELECT ... WHERE codigo = 'basico' LIMIT 1` y aborta con
  `RAISE NOTICE 'no se encontró el concepto "basico"; revisar seed de conceptos'`.

Es decir: el seed faltante estaba señalado en el propio código desde 0029.

## 3. Lo que ya se hizo

### `supabase/migrations/0031_seed_conceptos_base.sql` (NUEVO — sin aplicar)

Idempotente y no destructiva (todo `INSERT ... WHERE NOT EXISTS`; no pisa
conceptos ya editados por la empresa). Hace cuatro cosas:

1. **Siembra los conceptos base en TODOS los convenios** (globales y de empresa —
   no solo globales, porque las empresas que ya clonaron no vuelven a pasar por
   `clonar_convenio`):
   - `basico` remunerativo, `formula = basico_periodo`, orden 10
   - `jubilacion` 11 % con tope SIPA · `ley_19032` 3 % con tope · `obra_social`
     3 % sobre ambos · `retencion_sindical` 2 % sobre ambos
   - contribuciones patronales: `c_sipa`, `c_inssjp_pat`, `c_asig`, `c_fne`,
     `c_os_pat`, `c_art`
2. **Reemplaza a 0020** con el filtro correcto (`empresa_id IS NULL`) para que los
   `codigo_recibo` se asignen de verdad.
3. **Corrige `clonar_convenio`**: ahora copia `nom_categorias.modalidad` (antes
   todo clon quedaba en `'hora'` por el DEFAULT de 0018, aunque el origen fuera
   mensual — silencioso) y `nom_conceptos.codigo_recibo`.
4. Reemplaza el anclaje roto de 0029, que ponía las contribuciones patronales en
   **un solo** convenio (`ORDER BY created_at LIMIT 1`).

Deliberadamente **NO** siembra `presentismo` ni horas extra: su base de cálculo es
convenio-dependiente y sembrarlas con un valor inventado pagaría montos
incorrectos.

### `src/store/liquidacionStore.js` (MODIFICADO)

Dos arreglos al error `invalid input syntax for type uuid: ""` que quedaba pegado
en la pantalla de Liquidación:

- `cargarLiquidaciones` ahora corta temprano si `periodoId` viene vacío.
- Al cargar bien, limpia `error: null` (antes se seteaba pero nunca se limpiaba,
  así que un error viejo se mostraba encima de resultados correctos).

## 4. Próximos pasos

1. **Aplicar `0031`** en Supabase → SQL Editor. No se aplicó desde la sesión: solo
   había anon key, no service role.
2. **Verificar**: Liquidación → período Junio → Calcular. Esperado para Juan
   Martín: **bruto $23.870** (1.000 × 23,87 h), jubilación $1.193,50 (5 %, el
   valor que el usuario cargó a mano), obra social $716,10 (3 %), más las
   contribuciones patronales nuevas (~24 %).
3. **Cargar `tope_sipa`** en Configuración → Parámetros. Sin él, `liquidar-periodo`
   cae al default `999999999` y los aportes con tope se calculan sobre el bruto
   completo.
4. **Definir fórmulas de horas extra y presentismo** para UOCRA. Hoy las columnas
   HE 50 % / HE 100 % de la tabla de liquidación se calculan en asistencia pero no
   se pagan, porque ningún concepto las consume. Ojo: `basico_convenio` es el valor
   de escala, así que `basico_convenio * horas_extra_50 * 1.5` solo es correcto en
   modalidad `hora` — para mensual/quincenal hace falta derivar un valor hora.
5. **Revisar los porcentajes cargados a mano** en el convenio UOCRA de la empresa:
   jubilación al 5 % y obra social 3 % solo sobre remunerativo parecen valores de
   prueba (los de ley son 11 % y 3 % sobre remunerativo + no remunerativo).

## 5. Cosas que NO son bugs

- **"15 persona(s) no liquidada(s)"**: hay 16 personas activas en la empresa y un
  solo `nom_legajo` cargado. El motivo real es *"legajo incompleto"* / sin legajo.
  Comportamiento correcto.

## 6. Notas de entorno

- Los tests no se pudieron correr en el sandbox: `node_modules` está compilado para
  darwin y `rolldown`/vitest fallan con `MODULE_NOT_FOUND` en Linux. Correr
  `npx vitest run` localmente antes de dar por buena la modificación del store.
- La inspección de datos se hizo importando `/src/lib/supabase.js` dentro de la
  página en `localhost:5173` y consultando con la sesión ya autenticada del
  usuario. Útil para repetir el diagnóstico.
