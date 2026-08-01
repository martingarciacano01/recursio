# Importador de paritarias con IA — Fase 1

Fecha: 2026-07-29
Estado: aprobado, pendiente de plan de implementación

## Problema

Cada paritaria obliga a tipear a mano 15-20 básicos por categoría y sus
sumas no remunerativas en Configuración → Convenios. Es tedioso, se hace
2-4 veces al año por convenio, y un dígito mal copiado paga mal a toda la
nómina sin que nada lo advierta.

El acta paritaria llega como PDF (o Word) con los valores en una tabla.

## Objetivo

Subir el acta, que un modelo Haiku extraiga los valores, y que el usuario
revise un diff antes de que se guarde nada.

## Alcance

### Dentro (Fase 1)

- Extracción de **básicos por categoría** → `nom_categorias`
- Extracción de **sumas no remunerativas** → `nom_no_remunerativos`
- Revisión obligatoria con diff antes de guardar
- Historial de importaciones con el archivo original

Las dos tablas ya están versionadas por `vigencia_desde`: importar es
insertar una fila nueva. No se pisa ni se borra nada, y el motor de
liquidación no se toca.

### Fuera (Fase 2)

Aportes, contribuciones y adicionales viven en `nom_conceptos`, que tiene
`UNIQUE (convenio_id, empresa_id, codigo)` y **ninguna columna de
vigencia**. Importar ahí hoy significa pisar el valor y perder con qué
porcentaje se liquidó cada período anterior.

Fase 2 = agregar versionado a `nom_conceptos`, adaptar `liquidar-periodo`
para resolver el concepto vigente al período, y recién entonces sumar
aportes y adicionales al importador. Va en su propio spec.

### Fuera (permanente en este spec)

- Aplicar cambios sin revisión humana. Nunca.
- Crear categorías nuevas automáticamente.
- Importar actas de varios convenios en un mismo archivo.

## Arquitectura

Tres piezas con una frontera clara entre ellas: la que habla con la IA no
escribe en la base, la que escribe en la base no habla con la IA, y la
lógica de comparación no hace ninguna de las dos cosas.

```
TabImportarParitaria.jsx
   │  archivo + convenioId
   ▼
Edge Function `importar-paritaria`   ← ANTHROPIC_API_KEY vive solo acá
   │  propuesta JSON (no escribe en la base)
   ▼
utils/importarParitaria.js           ← lógica pura, testeable sin red
   │  filas de diff
   ▼
escalasStore / noRemunerativosStore  ← escritura, ya existentes
```

### Edge Function `importar-paritaria`

Runtime Deno, mismo patrón que `liquidar-periodo` e `invitar-usuario`.

**Entrada:** `{ archivo: base64, mime: string, convenio_id: uuid }`

**Procesamiento:**

- PDF → se manda tal cual como bloque `document` a la API de Anthropic. El
  modelo ve el layout de la tabla. Sin librería de parseo.
- DOCX → se descomprime (`unzip` de `word/document.xml`) y se manda el
  texto plano. No hay soporte nativo de DOCX en la API.
- Modelo: `claude-haiku-4-5-20251001`, con `tool_choice` forzado a una
  herramienta `cargar_paritaria` cuyo `input_schema` es:

```json
{
  "convenio_detectado": "string o null",
  "zonas_presentes": ["A", "B", "C", "D"],
  "tramos": [
    {
      "vigencia_desde": "YYYY-MM-DD",
      "porcentaje_declarado": 2.1,
      "categorias": [
        { "nombre_acta": "string", "zona": "string o null", "basico": 0,
          "modalidad": "hora|mensual|quincenal", "confianza": "alta|media|baja" }
      ],
      "no_remunerativos": [
        { "concepto_acta": "string", "categoria_acta": "string o null",
          "zona": "string o null", "monto": 0, "confianza": "alta|media|baja" }
      ]
    }
  ],
  "notas": "string"
}
```

Dos cosas que no son obvias y salieron de las actas reales:

- **`tramos` es una lista**: un acta suele otorgar aumentos escalonados
  (junio +2,1 %, julio +2 %, agosto +1,9 %, acumulativos). Una importación
  genera **varias vigencias**, no una.
- **`zona` va por fila, no global**: un anexo trae las cuatro zonas juntas.

El `tool_choice` forzado es lo que garantiza JSON válido: sin él el modelo
devuelve prosa y hay que parsearla.

**Salida:** la propuesta cruda + el `storage_path` del archivo guardado.
La función **no escribe en `nom_categorias` ni en `nom_no_remunerativos`**.

**Límites:** archivos hasta 10 MB, solo `application/pdf` y
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

### `src/utils/importarParitaria.js`

Funciones puras, sin Supabase ni fetch:

- `normalizarNombre(s)` — minúsculas, sin tildes, sin puntuación, espacios
  colapsados. Es lo que permite que "Oficial Especializado" del acta
  matchee "Oficial especializado" de la base.
- `ALIAS_CATEGORIAS` — mapa curado y explícito para las formas que la
  normalización no puede resolver sola. Las actas escriben "½ Oficial" y
  "1/2 Oficial" donde la base dice "Medio oficial": sin alias, esa fila
  cae como huérfana en todas las importaciones. El mapa se edita a mano y
  se testea; no se infiere.
- `emparejarCategorias(propuestas, existentes)` → `{ emparejadas, huerfanas }`.
  **Match exacto sobre el nombre normalizado, más el mapa de alias.** Nada
  de fuzzy ni de distancia de edición: un match aproximado errado paga el
  sueldo equivocado y nadie lo nota.
- `construirDiff(emparejadas, vigentes)` → filas
  `{ nombre, actual, propuesto, deltaPct, sospechoso, seleccionado }`
- `validarPropuesta(p)` → lista de advertencias

Acá va el grueso de los tests: es la lógica que puede pagar mal.

### `TabImportarParitaria.jsx`

Pestaña nueva en `SECCIONES[0].tabs` de `ConfiguracionPage.jsx`, dentro de
la sección Convenios (usa el selector de convenio que ya está ahí).

Cuatro estados:

1. **Vacío** — dropzone. Si el convenio es global (`esGlobal`), se muestra
   el mismo cartel de "personalizá el convenio" que el resto de las
   pestañas y el dropzone queda deshabilitado.
2. **Procesando** — spinner, típicamente 5-15 s.
3. **Revisión** — el diff. Cada fila con checkbox (todas tildadas por
   defecto), valor propuesto editable a mano, y `Δ%` respecto del vigente.
   Campo de `vigencia_desde` arriba, precargado con lo que detectó la IA y
   siempre editable. Las categorías huérfanas van en un bloque aparte de
   "no reconocidas", con un desplegable para asignarlas a una categoría
   existente o descartarlas.
4. **Aplicado** — resumen y link al historial.

### Migración `nom_importaciones`

```sql
CREATE TABLE nom_importaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  convenio_id    UUID NOT NULL REFERENCES nom_convenios(id) ON DELETE CASCADE,
  archivo_path   TEXT NOT NULL,
  archivo_nombre TEXT NOT NULL,
  propuesta      JSONB NOT NULL,
  aplicado       JSONB,
  vigencia_desde DATE,
  usuario_id     UUID,
  created_at     TIMESTAMPTZ DEFAULT now()
);
```

RLS por `empresa_id = auth_empresa_id()`, mismo patrón que
`nom_empresa_config`. Bucket privado `paritarias` en Storage.

`propuesta` guarda lo que dijo la IA; `aplicado` guarda lo que el usuario
efectivamente confirmó. La diferencia entre ambos es la evidencia de que
hubo revisión humana, y sirve para medir qué tan bien extrae el modelo.

## Errores

| Caso | Comportamiento |
|---|---|
| Archivo > 10 MB o tipo no soportado | Rechazo en el front, sin llamar a la API |
| La API falla o agota el tiempo | "No se pudo leer el acta", el archivo queda en Storage, se puede reintentar |
| El modelo no devuelve `tool_use` | Mismo mensaje que el anterior |
| `basico <= 0` | Fila marcada como sospechosa, destildada por defecto |
| Variación > 100 % contra el vigente | Fila marcada como sospechosa, sigue tildada |
| Ninguna categoría matchea | Se muestran todas como huérfanas; probablemente sea el convenio equivocado |
| `vigencia_desde` ausente | El campo queda vacío y es obligatorio antes de confirmar |
| Ya existe esa vigencia para el convenio | Se advierte y se pide confirmación extra (el `UNIQUE` de la tabla lo rechazaría igual) |

La escritura final va por una RPC `aplicar_paritaria(importacion_id, filas)`
para que las categorías y los no remunerativos entren en una sola
transacción. Una importación a medias es peor que ninguna.

## Permisos

Admin de empresa y RRHH, reusando `src/utils/permisos.js`. Superadmin
entra por el bypass que ya existe. La Edge Function verifica el rol del
lado del servidor: el chequeo del front es solo cosmético.

## Testing

- **Unitarios** (`src/utils/__tests__/importarParitaria.test.js`) —
  normalización, emparejamiento, diff, validaciones, casos límite. Sin red.
- **Componente** (`src/components/config/__tests__/`) — los cuatro estados,
  que destildar una fila la excluya, que la vigencia vacía bloquee el botón.
- **Edge Function** — fixture con el acta real (`acuerdo445.pdf`) y una
  aserción sobre los valores extraídos. Se corre a mano, no en CI, porque
  gasta tokens.

Los tests unitarios no mockean la API de Anthropic: toda la lógica que
puede equivocarse vive en funciones puras que reciben la propuesta ya
parseada.

## Costo

Un acta de 3 páginas ≈ 15k tokens de entrada con Haiku ≈ USD 0,01 por
importación. Irrelevante frente al tiempo que ahorra.

## Riesgos

- **El modelo extrae un número mal y el usuario aprueba sin mirar.** Es el
  riesgo real y no se elimina del todo. Se mitiga con el `Δ%` por fila (un
  aumento del 900 % salta a la vista), el marcado de sospechosos, y el
  hecho de que la vigencia nueva no borra la anterior: siempre se puede
  volver atrás.
- **Actas con formato inesperado.** Escalas por zona (A/B/C) en columnas
  paralelas son el caso difícil. Por eso el PDF va crudo al modelo en vez
  de aplanarse a texto, y por eso el campo `zona` está en el esquema.

## Calibración con actas reales

### Acta A — `99db1b_segundo_tramo_paritaria_76-75_y_577-10…pdf`

CCT 76/75 y 577/10, homologada el 02/06/2026. **Es el acta que le aplica a
Asset Construcciones**, y la más exigente de las dos.

**El texto está partido en dos naturalezas.** Páginas 1-2: texto real
(porcentajes, sumas no remunerativas, aporte solidario). Páginas 3-6:
**PNG puros, cero caracteres extraíbles** — ahí viven las tablas de
básicos. Medido con `pypdf`:

| Página | Texto | Imágenes |
|---|---|---|
| 1-2 | 3.105 / 2.393 chars | 0 |
| 3-4 | 7 / 8 chars ("ANEXO I") | 1 PNG c/u |
| 5-6 | **0 chars** | 1 PNG c/u |

Un pipeline de extracción de texto sobre este archivo devuelve el acuerdo
pero **ninguna escala salarial**. Mandar el PDF crudo como bloque
`document` no es la mejor opción: es la única que funciona.

**Tres tramos en un solo acta**, acumulativos: junio +2,1 %, julio +2 %,
agosto +1,9 %. De acá sale que `tramos` sea una lista.

**Sumas no remunerativas por categoría y por mes.** Junio: Sereno $50.300,
Ayudante $50.300, ½ Oficial $53.400, Oficial $58.300, Oficial Especializado
$63.300. Julio: $57.900 para Sereno y Ayudante, etc. Van a
`nom_no_remunerativos`, una fila por categoría y vigencia.

**"½ Oficial" ≠ "Medio oficial".** La normalización por sí sola no cierra
esa brecha: de ahí el mapa de alias.

**Dos reglas del acta que el importador NO automatiza** (quedan como nota
para el usuario, porque tocan el motor):
- La SNR se paga por mitades: 50 % con la 1ra quincena, 50 % con la 2da.
- La SNR está alcanzada por aportes y contribuciones de Obra Social — lo
  que confirma que `obra_social` y `c_os_pat` usen base `ambos`, como
  quedaron sembrados.
- El aporte solidario del 2 % lo absorbe la cuota sindical en afiliados.
  Sigue sin poder sembrarse: no existe `afiliado_sindicato` en el legajo.

### Acta B — `c1f404_acuerdo445.pdf`

CCT 445/06 (Hormigón
Elaborado, UOCRA/AAHE), firmada el 24/06/2026, incremento del 1,5 % para
junio 2026. Dos páginas: la primera es el texto del acuerdo, la segunda el
Anexo I con las tablas.

Cuatro hallazgos que condicionan el diseño:

**1. La capa de texto del PDF está rota.** Es un escaneo con OCR de mala
calidad. Extracto literal de `pypdf`:

| OCR | Real |
|---|---|
| `940,335,99` | 940.335,99 |
| `NIVEL 5`, `NIVEL 8`, `NIVEL 13` | NIVEL B |
| `NIVELO`, `NIVELA` | NIVEL D, NIVEL A |
| `1 264 689,87` | 1.264.689,87 |
| `13.072 17` | 13.072,17 |
| `1.288.449,67 NIVEL D` | columnas invertidas |

Esto **confirma la decisión de mandar el PDF crudo como bloque `document`**
en vez de extraer texto: el modelo lee la imagen de la tabla, no esta
basura. Cualquier pipeline basado en `pypdf`/`pdftotext` habría cargado
sueldos mal. También sube la prioridad de las validaciones numéricas.

**2. Un acta trae varias zonas.** Este anexo tiene básicos de Zona A, B, C
y D. `nom_categorias` no tiene columna de zona, y agregarla sería un cambio
de esquema que arrastra al motor. **Decisión: el usuario elige UNA zona al
importar y solo se proponen las filas de esa zona.** Es lo que refleja la
realidad — una empresa opera en una zona — y no toca el esquema.

**3. VIANDA es un concepto aparte.** Viene por zona, con el mismo monto
para los cuatro niveles. Va a `nom_no_remunerativos`, que es exactamente
para esto. Por eso el esquema de extracción tiene `concepto_acta`: un acta
puede traer más de un ítem no remunerativo.

**4. Las categorías del acta pueden no existir en la base.** Este acta usa
NIVEL A/B/C/D; el convenio UOCRA sembrado usa Oficial especializado /
Oficial / Medio oficial / Ayudante / Sereno. **El flujo de "categorías no
reconocidas" no es un caso borde: es el caso normal.** Tiene que ser
cómodo, no un cartel de error.

## Pendiente antes de implementar

Nada bloqueante. El acta de calibración ya está disponible y sirve de
fixture para el test de la Edge Function.
