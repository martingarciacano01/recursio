# Plan de ejecución para Sonnet 5 (esfuerzo bajo) — Convenios por obra, ajustes de horas, topes por obra y bonos no remunerativos

> **Documento de ejecución** para implementar las mejoras pedidas por el cliente:
> 1. **Replicar convenios** a partir de una plantilla (ej. UOCRA) y crear convenios por **obra/sitio** (obras de Presencio). Configurado a nivel **superadmin**, usable por todas las empresas.
> 2. **Modificar las horas** de las personas para el período a calcular (ajuste **global por persona**, no día a día).
> 3. **Topear las horas diarias por obra** según configuración.
> 4. **Bono** que se paga pero **no aparece en el recibo de sueldo** (sí en Excel/reportes), **no integra base de aportes** (no remunerativo), configurado a nivel **superadmin** (definición del bono) y **empresa/obra** (aplicación) con **excepciones por persona**.
>
> **Reglas de este documento:**
> 1. TDD siempre: escribir el test que falla → verificar que falla → implementación mínima → verificar que pasa → commit.
> 2. Migraciones en `supabase/migrations/NNNN_nombre.sql`, numeradas e idempotentes. Nunca SQL suelto en la raíz. **La numeración arranca en `0058`** (la última existente es `0057`).
> 3. RLS habilitada en el mismo archivo que crea la tabla, con `empresa_id = auth_empresa_id()` **más** `is_superadmin()` (patrón de `0050_config_horas_extras.sql`). Las tablas globales de superadmin usan `empresa_id NULL`.
> 4. Zustand sin `persist` para datos salariales.
> 5. Español (Argentina) en UI, tablas y comentarios.
> 6. Commits frecuentes: `feat:`/`fix:`/`test:`/`chore:`.
>
> **Comandos de referencia (package.json):** tests `npm test` (= `npx vitest run`) · un archivo `npx vitest run <ruta>` · lint `npm run lint` · build `npm run build` · Node 22 antes de todo: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use`.
>
> **Decisiones ya tomadas con el usuario (NO re-abrir):**
> - Bono: se paga, suma a bruto/neto del período y a Excel, **NO se imprime en el recibo**, **NO integra base de ningún aporte** (tipo no remunerativo aislado), se exporta a SIRADIG/F931 como no base. Definición global por superadmin + aplicación por empresa/obra + excepción por persona.
> - Ajuste de horas: **global por persona y período** (un único delta), no edición día a día.
> - Convenio por obra: clona **estructura + valores de escala (básicos) + no remunerativos** de la plantilla.
> - El `grupoRecibo` del recibo se rige por `config.recibo.grupo` (reciboLayout.js); un ítem sin grupo NO se imprime — ver reciboLayout.js:19-23.

---

## Fase 0 — Preparación y baseline [⚙️ bajo]

### Task 0.1: Commitear el working tree en orden lógico

**Por qué:** el repo tiene que arrancar limpio para que cada task de este plan sea un diff pequeño y revisable.

- [ ] **Step 1:** `git status --short`. Verificar que `dist/`, `.env*` y `scripts/.dumps/` están en `.gitignore` (agregarlos si no):
  ```bash
  grep -nE "dist|\.env|\.dumps" .gitignore || echo "FALTAN entradas en .gitignore"
  ```
- [ ] **Step 2:** Commitear lo pendiente (documentos de plan que estén sin commitear) con `git add docs/ && git commit -m "docs(plan): convenios por obra, ajustes de horas, bonos no remunerativos"`.
- [ ] **Step 3:** `git push` a `origin/main` **solo si el usuario lo autoriza**.

**Criterio de aceptación:** `git status` limpio.

### Task 0.2: Baseline de lint y tests [⚙️ bajo]

- [ ] **Step 1:** `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm install && nvm use && node -v` → debe dar 22.x (según `.nvmrc`).
- [ ] **Step 2:** `npm run lint && npm test`. Guardar la salida como baseline.
- [ ] **Step 3:** Corregir errores (no warnings) o justificarlos. Commit `chore(ci): baseline de lint y tests en verde`.

**Criterio de aceptación:** lint y tests verdes antes de tocar nada.

---

## Fase 1 — Base de datos (5 migraciones) [⚙️ medio]

### Task 1.1: Migración `0058` — Vista de obras de Presencio [⚙️ bajo]

**Files:** Create `supabase/migrations/0058_vista_obras_presencio.sql`.

**Por qué:** las obras viven en Presencio (tabla `obras`, misma base Supabase). Recursio no debe tocarlas (contrato `0001_vistas_contrato.sql`): expone una vista contrato de solo lectura con `security_invoker = true`, igual que `nom_v_personal`/`nom_v_empresa_feriados`.

- [ ] **Step 1:** Verificar las columnas reales de la tabla `obras` en Presencio antes de escribir la vista:
  ```bash
  # en el SQL editor de Supabase:
  select column_name from information_schema.columns where table_name = 'obras' order by ordinal_position;
  ```
  **Importante:** confirmar si existe `nombre`/`name` y `empresa_id` (si el esquema difiere, adaptar la vista — el diseño asumió columnas que no existen una vez antes, ver `0001_vistas_contrato.sql:12-14`).
- [ ] **Step 2:** Migración (asumiendo `id`, `empresa_id`, `nombre`; ajustar a las columnas reales):
  ```sql
  -- 0058_vista_obras_presencio.sql — contrato de lectura Recursio → Presencio
  -- (obras). Mismo patrón que 0001: security_invoker=true para heredar la RLS
  -- de la tabla base `obras` con los permisos del usuario que consulta.
  CREATE OR REPLACE VIEW nom_v_obras
  WITH (security_invoker = true) AS
  SELECT id, empresa_id, nombre
  FROM obras;

  GRANT SELECT ON nom_v_obras TO authenticated;
  GRANT SELECT ON nom_v_obras TO service_role;
  ```
- [ ] **Step 3:** Verificar en dev:
  ```sql
  select count(*) from nom_v_obras;
  ```
  Debe devolver el total de obras de Presencio (≥ 0).
- [ ] **Step 4:** Commit `feat(db): vista contrato nom_v_obras (obras de Presencio)`.

**Criterio de aceptación:** `nom_v_obras` lista las obras de Presencio con su empresa.

### Task 1.2: Migración `0059` — `nom_convenios.obra_id` + `clonar_convenio` por obra [⚙️ medio-alto]

**Files:** Create `supabase/migrations/0059_convenio_por_obra.sql`.

**Por qué:** el clonado actual (`0038_clonar_convenio_cortes.sql`) copia estructura **sin** obra ni básicos re-apuntados por obra. El cliente quiere clonar plantilla UOCRA → convenio por obra, copiando escala y no remunerativos.

- [ ] **Step 1:** Verificar la firma actual de `clonar_convenio`:
  ```bash
  grep -n "CREATE OR REPLACE FUNCTION clonar_convenio" supabase/migrations/0038_clonar_convenio_cortes.sql
  ```
- [ ] **Step 2:** Migración — agregar `obra_id` a `nom_convenios` y re-crear `clonar_convenio` con parámetro `p_obra_id`:
  ```sql
  -- 0059_convenio_por_obra.sql
  ALTER TABLE nom_convenios ADD COLUMN IF NOT EXISTS obra_id UUID;
  COMMENT ON COLUMN nom_convenios.obra_id IS
    'Obra de Presencio a la que aplica este convenio (vía nom_v_obras). NULL = convenio genérico de empresa.';

  CREATE OR REPLACE FUNCTION clonar_convenio(
    convenio_global_id UUID,
    p_empresa_id UUID DEFAULT NULL,
    p_obra_id UUID DEFAULT NULL
  )
  RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
  DECLARE
    v_empresa UUID := auth_empresa_id();
    v_origen  nom_convenios%ROWTYPE;
    v_nuevo   UUID;
  BEGIN
    IF v_empresa IS NULL THEN
      IF NOT is_superadmin() OR p_empresa_id IS NULL THEN
        RAISE EXCEPTION 'usuario sin empresa asignada';
      END IF;
      v_empresa := p_empresa_id;
    END IF;

    SELECT * INTO v_origen FROM nom_convenios WHERE id = convenio_global_id AND empresa_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'convenio global no encontrado';
    END IF;

    -- Si el clon es "por obra", el nombre lleva la obra (evita colisiones y
    -- es lo que el usuario espera ver en el selector). Si es genérico, igual
    -- que antes.
    IF p_obra_id IS NOT NULL THEN
      SELECT id INTO v_nuevo FROM nom_convenios
        WHERE empresa_id = v_empresa AND obra_id = p_obra_id AND nombre = v_origen.nombre;
    ELSE
      SELECT id INTO v_nuevo FROM nom_convenios WHERE empresa_id = v_empresa AND nombre = v_origen.nombre;
    END IF;
    IF FOUND THEN
      RETURN v_nuevo;
    END IF;

    INSERT INTO nom_convenios (
      empresa_id, nombre, regimen, descripcion, obra_id,
      modalidad, corte_q1_desde, corte_q1_hasta,
      corte_q2_desde, corte_q2_hasta, corte_mensual_desde, corte_mensual_hasta
    )
    VALUES (
      v_empresa, v_origen.nombre, v_origen.regimen, v_origen.descripcion, p_obra_id,
      v_origen.modalidad, v_origen.corte_q1_desde, v_origen.corte_q1_hasta,
      v_origen.corte_q2_desde, v_origen.corte_q2_hasta,
      v_origen.corte_mensual_desde, v_origen.corte_mensual_hasta
    )
    RETURNING id INTO v_nuevo;

    -- Estructura + VALORES de escala (básicos) y no remunerativos (decisión
    -- del usuario): se copian con sus montos, no en cero.
    INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde, modalidad)
    SELECT v_nuevo, nombre, basico, vigencia_desde, modalidad
    FROM nom_categorias WHERE convenio_id = convenio_global_id;

    INSERT INTO nom_no_remunerativos (convenio_id, categoria_nombre, monto, vigencia_desde)
    SELECT v_nuevo, categoria_nombre, monto, vigencia_desde
    FROM nom_no_remunerativos WHERE convenio_id = convenio_global_id;

    INSERT INTO nom_conceptos (empresa_id, convenio_id, codigo, nombre, tipo, formula, orden, imprimible, categorias, config, codigo_recibo)
    SELECT v_empresa, v_nuevo, codigo, nombre, tipo, formula, orden, imprimible, categorias, config, codigo_recibo
    FROM nom_conceptos WHERE convenio_id = convenio_global_id AND empresa_id IS NULL;

    INSERT INTO nom_concepto_reglas (concepto_id, orden, condicion, formula)
    SELECT nc.id, r.orden, r.condicion, r.formula
    FROM nom_conceptos viejo
    JOIN nom_concepto_reglas r ON r.concepto_id = viejo.id
    JOIN nom_conceptos nc ON nc.convenio_id = v_nuevo AND nc.empresa_id = v_empresa AND nc.codigo = viejo.codigo
    WHERE viejo.convenio_id = convenio_global_id AND viejo.empresa_id IS NULL;

    -- Re-apunta legajos: TODOS si el clon es genérico, SOLO los de la obra
    -- si es por obra.
    UPDATE nom_legajo l SET
      convenio_id = v_nuevo,
      categoria_id = (
        SELECT nueva.id FROM nom_categorias vieja
        JOIN nom_categorias nueva
          ON nueva.convenio_id = v_nuevo
         AND nueva.nombre = vieja.nombre
         AND nueva.vigencia_desde = vieja.vigencia_desde
        WHERE vieja.id = l.categoria_id
      )
    WHERE l.empresa_id = v_empresa AND l.convenio_id = convenio_global_id
      AND (
        p_obra_id IS NULL
        OR l.personal_id IN (
          SELECT personal_id FROM nom_v_personal
          WHERE empresa_id = v_empresa AND obra_id = p_obra_id
        )
      );

    RETURN v_nuevo;
  END $$;
  REVOKE ALL ON FUNCTION clonar_convenio(UUID, UUID, UUID) FROM public;
  GRANT EXECUTE ON FUNCTION clonar_convenio(UUID, UUID, UUID) TO authenticated;
  ```
  **Verificar antes:** que `nom_v_personal` (0001) exponga `obra_id` (`grep -n "obra_id" supabase/migrations/0001_vistas_contrato.sql`) y que el nombre de columna de categoría sea `nombre` (`grep -n "nombre" supabase/migrations/0002_nomina_core.sql | head`). Ajustar si difiere.
- [ ] **Step 3:** Test de smoke en dev (SQL editor):
  ```sql
  -- elegir un convenio global y una obra real
  select clonar_convenio('<id_convenio_global>', '<empresa_id>', '<obra_id>');
  select id, nombre, obra_id, modalidad from nom_convenios where empresa_id = '<empresa_id>' and obra_id is not null;
  select count(*) from nom_categorias c join nom_convenios cv on cv.id = c.convenio_id where cv.obra_id = '<obra_id>';
  select count(*) from nom_legajo l join nom_v_personal p on p.id = l.personal_id where p.empresa_id = '<empresa_id>' and p.obra_id = '<obra_id>' and l.convenio_id is not null;
  ```
  Verificar: el clon existe con `obra_id`, las categorías se copiaron con básicos ≠ 0 (si la plantilla los tenía), y los legajos de esa obra apuntan al clon.
- [ ] **Step 4:** Commit `feat(db): convenio por obra — obra_id en nom_convenios y clonar_convenio con p_obra_id`.

**Criterio de aceptación:** clonar con `p_obra_id` crea un convenio de empresa con `obra_id` set, copia escala/no-rem/conceptos con valores, y re-apunta solo los legajos de esa obra.

### Task 1.3: Migración `0060` — Configuración de horas por obra (tope diario) [⚙️ medio]

**Files:** Create `supabase/migrations/0060_config_horas_obra.sql`.

**Por qué:** el tope de horas diarias hoy es por empresa (`nom_config_horas`, 0050). El cliente pide tope por obra. Se crea tabla satélite `nom_config_obras` con RLS (patrón de 0050); el motor resuelve obra → empresa → default.

- [ ] **Step 1:** Migración:
  ```sql
  -- 0060_config_horas_obra.sql — topes de horas y jornada POR OBRA.
  -- La resolución en liquidar-periodo es: obra → empresa (nom_config_horas) → default 8h.
  CREATE TABLE IF NOT EXISTS nom_config_obras (
    empresa_id           UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    obra_id              UUID NOT NULL,
    tope_horas_diarias   NUMERIC,
    tope_horas_semanales NUMERIC,
    tope_horas_quincena  NUMERIC,
    tope_horas_mes       NUMERIC,
    jornada_horas        NUMERIC NOT NULL DEFAULT 8,
    updated_at           TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (empresa_id, obra_id)
  );
  ALTER TABLE nom_config_obras ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS nom_config_obras_select ON nom_config_obras;
  CREATE POLICY nom_config_obras_select ON nom_config_obras FOR SELECT TO authenticated
    USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
  DROP POLICY IF EXISTS nom_config_obras_insert ON nom_config_obras;
  CREATE POLICY nom_config_obras_insert ON nom_config_obras FOR INSERT TO authenticated
    WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  DROP POLICY IF EXISTS nom_config_obras_update ON nom_config_obras;
  CREATE POLICY nom_config_obras_update ON nom_config_obras FOR UPDATE TO authenticated
    USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
    WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  DROP POLICY IF EXISTS nom_config_obras_delete ON nom_config_obras;
  CREATE POLICY nom_config_obras_delete ON nom_config_obras FOR DELETE TO authenticated
    USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  GRANT SELECT, INSERT, UPDATE, DELETE ON nom_config_obras TO authenticated;
  ```
- [ ] **Step 2:** Verificar en dev:
  ```sql
  select count(*) from nom_config_obras; -- 0 recién creada
  ```
- [ ] **Step 3:** Commit `feat(db): nom_config_obras — topes de horas y jornada por obra`.

**Criterio de aceptación:** la tabla existe con RLS por empresa y roles admin/rrhh para escribir.

### Task 1.4: Migración `0061` — Ajuste global de horas por persona y período [⚙️ medio]

**Files:** Create `supabase/migrations/0061_ajustes_horas_periodo.sql`.

**Por qué:** el cliente quiere poder modificar las horas que trae Presencio para el período a calcular, con un ajuste **global por persona** (no edición día a día). Tabla de deltas por `(periodo, personal)`.

- [ ] **Step 1:** Migración:
  ```sql
  -- 0061_ajustes_horas_periodo.sql — ajuste GLOBAL de horas trabajadas por
  -- persona para un período puntual (delta, puede ser negativo). No es una
  -- edición día a día: corrige el total del período antes de liquidar.
  CREATE TABLE IF NOT EXISTS nom_ajustes_horas (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    periodo_id      UUID NOT NULL REFERENCES nom_periodos(id) ON DELETE CASCADE,
    personal_id     UUID NOT NULL,
    horas_globales  NUMERIC NOT NULL,
    motivo          TEXT,
    creado_por      UUID,
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (empresa_id, periodo_id, personal_id)
  );
  ALTER TABLE nom_ajustes_horas ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS nom_ajustes_horas_select ON nom_ajustes_horas;
  CREATE POLICY nom_ajustes_horas_select ON nom_ajustes_horas FOR SELECT TO authenticated
    USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh','consulta','supervisor'])));
  DROP POLICY IF EXISTS nom_ajustes_horas_insert ON nom_ajustes_horas;
  CREATE POLICY nom_ajustes_horas_insert ON nom_ajustes_horas FOR INSERT TO authenticated
    WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  DROP POLICY IF EXISTS nom_ajustes_horas_update ON nom_ajustes_horas;
  CREATE POLICY nom_ajustes_horas_update ON nom_ajustes_horas FOR UPDATE TO authenticated
    USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
    WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  DROP POLICY IF EXISTS nom_ajustes_horas_delete ON nom_ajustes_horas;
  CREATE POLICY nom_ajustes_horas_delete ON nom_ajustes_horas FOR DELETE TO authenticated
    USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  GRANT SELECT, INSERT, UPDATE, DELETE ON nom_ajustes_horas TO authenticated;
  ```
- [ ] **Step 2:** Commit `feat(db): nom_ajustes_horas — delta de horas por persona y período`.

**Criterio de aceptación:** la tabla existe, UNIQUE por `(empresa, periodo, personal)`, RLS por roles.

### Task 1.5: Migración `0062` — Bonos no remunerativos (superadmin global + aplicación por empresa/obra + excepciones) [⚙️ medio]

**Files:** Create `supabase/migrations/0062_bonos_no_remunerativos.sql`.

**Por qué:** el cliente quiere un bono que se paga, no se muestra en el recibo, no integra base. Configurado a nivel **superadmin** (definición) y aplicable por **empresa/obra** con **excepción por persona**.

- [ ] **Step 1:** Migración (tres tablas):
  ```sql
  -- 0062_bonos_no_remunerativos.sql
  -- Catálogo de bonos globales, definidos por SUPERADMIN (empresa_id NULL) y
  -- visibles para todas las empresas. El monto base se define acá; cada
  -- empresa lo aplica a una obra (o a toda la empresa) con su propio monto.
  CREATE TABLE IF NOT EXISTS nom_bonos (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre        TEXT NOT NULL,
    monto_base    NUMERIC NOT NULL DEFAULT 0,
    descripcion   TEXT,
    activo        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (nombre)
  );
  ALTER TABLE nom_bonos ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS nom_bonos_select ON nom_bonos;
  CREATE POLICY nom_bonos_select ON nom_bonos FOR SELECT TO authenticated
    USING (true); -- catálogo global de lectura para todas las empresas
  DROP POLICY IF EXISTS nom_bonos_write ON nom_bonos;
  CREATE POLICY nom_bonos_write ON nom_bonos FOR INSERT TO authenticated
    WITH CHECK (is_superadmin());
  DROP POLICY IF EXISTS nom_bonos_update ON nom_bonos;
  CREATE POLICY nom_bonos_update ON nom_bonos FOR UPDATE TO authenticated
    USING (is_superadmin()) WITH CHECK (is_superadmin());
  DROP POLICY IF EXISTS nom_bonos_delete ON nom_bonos;
  CREATE POLICY nom_bonos_delete ON nom_bonos FOR DELETE TO authenticated
    USING (is_superadmin());
  GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bonos TO authenticated;

  -- Aplicación por EMPRESA + OBRA: qué bono se paga, en qué obra (obra_id
  -- NULL = toda la empresa) y con qué monto. Lo administra la empresa.
  CREATE TABLE IF NOT EXISTS nom_bono_aplicaciones (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    obra_id     UUID, -- NULL = toda la empresa
    bono_id     UUID NOT NULL REFERENCES nom_bonos(id) ON DELETE CASCADE,
    monto       NUMERIC NOT NULL DEFAULT 0,
    vigencia_desde DATE,
    vigencia_hasta DATE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (empresa_id, obra_id, bono_id)
  );
  ALTER TABLE nom_bono_aplicaciones ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS nom_bono_aplicaciones_select ON nom_bono_aplicaciones;
  CREATE POLICY nom_bono_aplicaciones_select ON nom_bono_aplicaciones FOR SELECT TO authenticated
    USING (is_superadmin() OR empresa_id = auth_empresa_id());
  DROP POLICY IF EXISTS nom_bono_aplicaciones_insert ON nom_bono_aplicaciones;
  CREATE POLICY nom_bono_aplicaciones_insert ON nom_bono_aplicaciones FOR INSERT TO authenticated
    WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  DROP POLICY IF EXISTS nom_bono_aplicaciones_update ON nom_bono_aplicaciones;
  CREATE POLICY nom_bono_aplicaciones_update ON nom_bono_aplicaciones FOR UPDATE TO authenticated
    USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
    WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  DROP POLICY IF EXISTS nom_bono_aplicaciones_delete ON nom_bono_aplicaciones;
  CREATE POLICY nom_bono_aplicaciones_delete ON nom_bono_aplicaciones FOR DELETE TO authenticated
    USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bono_aplicaciones TO authenticated;

  -- Excepción por PERSONA: monto distinto o desactivado (montos IS NULL).
  CREATE TABLE IF NOT EXISTS nom_bono_excepciones (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    personal_id UUID NOT NULL,
    bono_id     UUID NOT NULL REFERENCES nom_bonos(id) ON DELETE CASCADE,
    monto       NUMERIC, -- NULL = bono desactivado para esta persona
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (empresa_id, personal_id, bono_id)
  );
  ALTER TABLE nom_bono_excepciones ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS nom_bono_excepciones_select ON nom_bono_excepciones;
  CREATE POLICY nom_bono_excepciones_select ON nom_bono_excepciones FOR SELECT TO authenticated
    USING (is_superadmin() OR empresa_id = auth_empresa_id());
  DROP POLICY IF EXISTS nom_bono_excepciones_insert ON nom_bono_excepciones;
  CREATE POLICY nom_bono_excepciones_insert ON nom_bono_excepciones FOR INSERT TO authenticated
    WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  DROP POLICY IF EXISTS nom_bono_excepciones_update ON nom_bono_excepciones;
  CREATE POLICY nom_bono_excepciones_update ON nom_bono_excepciones FOR UPDATE TO authenticated
    USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])))
    WITH CHECK (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  DROP POLICY IF EXISTS nom_bono_excepciones_delete ON nom_bono_excepciones;
  CREATE POLICY nom_bono_excepciones_delete ON nom_bono_excepciones FOR DELETE TO authenticated
    USING (is_superadmin() OR (empresa_id = auth_empresa_id() AND has_rol_nomina(ARRAY['admin','rrhh'])));
  GRANT SELECT, INSERT, UPDATE, DELETE ON nom_bono_excepciones TO authenticated;
  ```
- [ ] **Step 2:** Verificar en dev:
  ```sql
  select count(*) from nom_bonos;            -- 0
  select count(*) from nom_bono_aplicaciones; -- 0
  select count(*) from nom_bono_excepciones;  -- 0
  ```
- [ ] **Step 3:** Commit `feat(db): bonos no remunerativos — catálogo superadmin + aplicación empresa/obra + excepción por persona`.

**Criterio de aceptación:** las tres tablas existen; solo superadmin escribe en `nom_bonos`; empresas admin/rrhh escriben en aplicaciones/excepciones.

---

## Fase 2 — Motor de liquidación [⚙️ alto]

### Task 2.1: Tipo `bono` en `liquidarConceptos` — suma a bruto/neto, NO a bases [⚙️ medio-alto]

**Files:** Modify `packages/motor/src/motor.ts`, `packages/motor/src/motor.test.ts`.

**Por qué:** hoy el motor solo tiene `remunerativo / no_remunerativo / descuento / aporte_patronal / informativo` y todo remunerativo/no-rem alimenta `remunerativo_acumulado` → base de jubilación/OS/contribuciones. El bono debe sumar a `bruto`/`neto` (se paga) pero **NO** a los acumulados (no integra base).

- [ ] **Step 1 (test que falla):** Agregar a `packages/motor/src/motor.test.ts`:
  ```ts
  describe('bono no remunerativo aislado (Task 2.1)', () => {
    it('el bono suma a bruto y neto pero NO alimenta remunerativo_acumulado', () => {
      const conceptos: Concepto[] = [
        { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', orden: 1, formula: '1000000', imprimible: true },
        { codigo: 'bono_x', nombre: 'Bono X', tipo: 'bono', orden: 50, formula: '50000', imprimible: false },
        { codigo: 'jubilacion', nombre: 'Jubilación', tipo: 'descuento', orden: 100,
          formula: 'min(remunerativo_acumulado, tope_sipa) * 0.11', imprimible: true },
      ]
      const r = liquidarConceptos(conceptos, { tope_sipa: 999999999 })
      expect(r.bruto).toBeCloseTo(1050000, 2)
      expect(r.neto).toBeCloseTo(1050000 - 110000, 2)
      // la jubilación se calcula SOLO sobre el básico (1.000.000), no sobre el bono
      const jub = r.items.find((i) => i.codigo === 'jubilacion')!
      expect(jub.monto).toBeCloseTo(110000, 2)
      expect(r.remunerativoAcumulado).toBeCloseTo(1000000, 2)
    })

    it('el bono no entra en ninguna base y lleva grupoRecibo null', () => {
      const conceptos: Concepto[] = [
        { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', orden: 1, formula: '1000000', imprimible: true },
        { codigo: 'bono_x', nombre: 'Bono X', tipo: 'bono', orden: 50, formula: '25000', imprimible: false },
        { codigo: 'os', nombre: 'Obra social', tipo: 'descuento', orden: 101,
          formula: '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03', imprimible: true },
      ]
      const r = liquidarConceptos(conceptos, {})
      const bono = r.items.find((i) => i.codigo === 'bono_x')!
      expect(bono.grupoRecibo).toBeNull()
      expect(bono.detalleRecibo).toBeNull()
      const os = r.items.find((i) => i.codigo === 'os')!
      expect(os.monto).toBeCloseTo(30000, 2) // 3% de 1.000.000, sin bono
    })
  })
  ```
  `npx vitest run packages/motor/src/motor.test.ts` → FAIL (hoy `tipo: 'bono'` no compila/tipea o no suma).
- [ ] **Step 2 (implementación):**
  - En `Concepto['tipo']` y `ItemLiquidado['tipo']` (`motor.ts:22,41`) agregar `| 'bono'`.
  - En la **pasada 1** (totales del período, `motor.ts:104-123`) **no** tocar: solo suma remunerativo/no_remunerativo — el bono no entra ahí (correcto).
  - En el loop principal (`motor.ts:131-230`):
    ```ts
    // al calcular `grupoRecibo`: el bono NUNCA se imprime en el recibo →
    // forzar null (reciboLayout.js filtra por grupoRecibo).
    let grupoRecibo = recibo?.grupo ?? null
    if (grupoRecibo != null && (concepto.tipo === 'remunerativo' || concepto.tipo === 'no_remunerativo' || concepto.tipo === 'descuento')) {
      grupoRecibo = concepto.tipo
    }
    if (concepto.tipo === 'bono') grupoRecibo = null
    ```
    Y en el `switch` (`motor.ts:214-229`) agregar:
    ```ts
    case 'bono':
      bruto += monto // se paga: suma a bruto/neto
      break
    ```
    (sin tocar `remunerativoAcumulado` ni `noRemunerativoAcumulado`).
- [ ] **Step 3:** `npx vitest run packages/motor/src/motor.test.ts` → PASS + `npm test` completo.
- [ ] **Step 4:** Commit `feat(motor): tipo bono — suma a bruto/neto, aislado de las bases, sin imprimir en recibo`.

**Criterio de aceptación:** el bono aparece en `items` con `grupoRecibo: null`, suma a bruto/neto, no altera acumulados ni bases de descuentos/contribuciones.

---

## Fase 3 — Edge Function `liquidar-periodo` [⚙️ alto]

### Task 3.1: Leer obra del personal + config por obra + ajustes + bonos [⚙️ alto]

**Files:** Modify `supabase/functions/liquidar-periodo/index.ts`.

**Por qué:** el cálculo necesita, por persona: (a) obra para resolver tope y convenio; (b) ajuste global de horas del período; (c) bonos aplicables (obra + excepción).

- [ ] **Step 1 (test que falla):** Crear/ampliar `supabase/functions/liquidar-periodo/__tests__/extras.test.ts`. El patrón de mock de `auth.test.ts` es la referencia. Casos:
  1. `obra_id` está presente en el personal seleccionado.
  2. con un ajuste de horas guardado en `nom_ajustes_horas`, `horas_trabajadas` del resultado lo incorpora (positivo y negativo).
  3. con `nom_config_obras` para la obra del legajo, el `topeHorasDiarias` pasado a `calcularAsistencia` es el de la obra (no el de empresa).
  4. con un bono aplicado a la obra + sin excepción → el ítem `bono` aparece en `resultado.items`; con excepción `monto NULL` (desactivado) → NO aparece; con excepción con monto → usa el monto de la excepción.
  Verificar que fallan (la función hoy no lee nada de esto).
- [ ] **Step 2 (implementación):**
  - **Personal con obra:** en la query de personal (`index.ts:194`), agregar `obra_id`:
    ```ts
    let queryPersonal = supabase.from('nom_v_personal')
      .select('id, nombre, fecha_ingreso, obra_id')
      .eq('empresa_id', periodo.empresa_id).eq('estado', 'activo')
    ```
  - **Ajustes de horas:** leer todos los ajustes del período (una sola consulta) y construir `ajusteHorasPorPersonal: Map<personalId, number>`:
    ```ts
    const { data: ajustes } = await supabase.from('nom_ajustes_horas')
      .select('personal_id, horas_globales').eq('periodo_id', periodoId)
    ```
  - **Config por obra:** leer `nom_config_obras` de la empresa y armar `configObraPorObraId`:
    ```ts
    const { data: cfgsObra } = await supabase.from('nom_config_obras').select('*').eq('empresa_id', periodo.empresa_id)
    ```
    En el loop de cada persona, resolver (en orden): obra del personal → `nom_config_obras` → `nom_config_horas` de empresa → default:
    ```ts
    const obraId = persona.obra_id
    const cfgObra = obraId ? configObraPorObraId.get(obraId) : null
    const topeDiario = cfgObra?.tope_horas_diarias != null ? Number(cfgObra.tope_horas_diarias)
      : (cfgHoras?.tope_horas_diarias != null ? Number(cfgHoras.tope_horas_diarias) : undefined)
    const jornadaHoras = cfgObra?.jornada_horas != null ? Number(cfgObra.jornada_horas) : jornadaHorasConfig ?? (legajo.jornada === 'parcial' ? 4 : 8)
    ```
    y pasarlo a `calcularAsistencia(..., { topeHorasDiarias: topeDiario })` (ya soportado en `asistencia.ts:89`).
  - **Ajuste global:** después de `calcularAsistencia`, aplicar el delta:
    ```ts
    const ajuste = ajusteHorasPorPersonal.get(persona.id) ?? 0
    if (ajuste !== 0) asistencia.horasTrabajadas = Math.max(0, asistencia.horasTrabajadas + ajuste)
    ```
    **Ojo:** `horasLiquidadas` se calcula con `Math.ceil(asistencia.horasTrabajadas)` en `resolverBasicoYConceptos` (que recibe `asistencia`); aplicar el ajuste ANTES de llamarla para que el básico por hora use las horas ajustadas.
  - **Bonos:** leer catálogo activo + aplicaciones de la empresa + excepciones de la empresa (tres consultas al inicio de la función):
    ```ts
    const { data: bonos } = await supabase.from('nom_bonos').select('*').eq('activo', true)
    const { data: aplicaciones } = await supabase.from('nom_bono_aplicaciones').select('*').eq('empresa_id', periodo.empresa_id)
    const { data: excepciones } = await supabase.from('nom_bono_excepciones').select('*').eq('empresa_id', periodo.empresa_id)
    ```
    En el loop, resolver bonos por persona:
    ```ts
    function resolverBonosPersona(obraId: string | null): { codigo: string; nombre: string; monto: number }[] {
      const porBono = new Map<string, { nombre: string; monto: number | null }>()
      for (const ap of aplicaciones || []) {
        if (ap.obra_id !== null && ap.obra_id !== obraId) continue // NULL = toda la empresa
        const prev = porBono.get(ap.bono_id)
        porBono.set(ap.bono_id, { nombre: bonos?.find((b) => b.id === ap.bono_id)?.nombre ?? 'Bono', monto: prev?.monto ?? Number(ap.monto) })
      }
      const result: { codigo: string; nombre: string; monto: number }[] = []
      for (const [bonoId, cfg] of porBono) {
        const ex = excepciones?.find((e) => e.bono_id === bonoId && e.personal_id === persona.id)
        if (ex && ex.monto == null) continue // desactivado para esta persona
        const monto = ex?.monto != null ? Number(ex.monto) : cfg.monto
        if (monto === 0) continue
        result.push({ codigo: `bono_${bonoId}`, nombre: cfg.nombre, monto })
      }
      return result
    }
    ```
    Y agregar cada bono como concepto sintético al set de conceptos del legajo (antes de `liquidarConceptos`):
    ```ts
    for (const b of resolverBonosPersona(obraId)) {
      conceptosLegajo.push({ codigo: b.codigo, nombre: b.nombre, tipo: 'bono', orden: 999 + idx, formula: String(b.monto), imprimible: false, config: null })
    }
    ```
    (orden 999+ para que queden después de los conceptos del convenio; no afectan bases por diseño).
- [ ] **Step 3:** `npx vitest run supabase/functions/liquidar-periodo/__tests__/extras.test.ts` → PASS + `npm test`.
- [ ] **Step 4:** `npm run build`.
- [ ] **Step 5:** Commit `feat(motor): liquidar-periodo aplica ajustes de horas, tope por obra y bonos por obra con excepción`.

**Criterio de aceptación:** el cálculo usa la obra del personal para tope/jornada, aplica el delta de horas del período, e incorpora los bonos aplicados (con excepción respetada) sin que integren bases.

---

## Fase 4 — Frontend [⚙️ medio-alto]

### Task 4.1: UI de bonos — superadmin define, empresa aplica [⚙️ medio-alto]

**Files:** Create `src/components/config/TabBonos.jsx` · Modify `src/pages/ConfiguracionPage.jsx` · Create `src/store/bonosStore.js` · Modify `src/pages/SuperAdminPage.jsx` (o sección de bonos globales).

- [ ] **Step 1:** `src/store/bonosStore.js` (Zustand, sin persist):
  - `cargarBonos()`: `nom_bonos` + `nom_bono_aplicaciones` + `nom_bono_excepciones` de la empresa activa.
  - `crearBonoGlobal(nombre, montoBase, descripcion)` → `nom_bonos` insert (solo superadmin).
  - `aplicarBono({ obraId, bonoId, monto })` → `nom_bono_aplicaciones` upsert.
  - `setExcepcion({ personalId, bonoId, monto|null })` → `nom_bono_excepciones` upsert.
- [ ] **Step 2:** `TabBonos.jsx`:
  - Selector de bono del catálogo global + monto + obra (o "toda la empresa") → "Aplicar".
  - Tabla de aplicaciones de la empresa (obra, bono, monto) con edición/borrado.
  - Por bono aplicado, sección "excepciones por persona": agregar persona + monto (o desactivar).
- [ ] **Step 3:** Agregar la pestaña "Bonos no remunerativos" a `ConfiguracionPage.jsx` (sección Empresa, `SECCIONES[1].tabs`), y el alta global en SuperAdminPage (solo si `rol === 'superadmin'`).
- [ ] **Step 4:** Test: `src/store/__tests__/bonosStore.test.js` y `src/components/config/__tests__/TabBonos.test.jsx` (mock de supabase). `npx vitest run` → PASS.
- [ ] **Step 5:** Commit `feat(ui): gestión de bonos no remunerativos — catálogo superadmin + aplicación empresa/obra + excepciones`.

**Criterio de aceptación:** el superadmin crea bonos; la empresa los aplica por obra y por persona.

### Task 4.2: UI de convenios por obra [⚙️ medio]

**Files:** Modify `src/pages/ConfiguracionPage.jsx`, `src/store/conveniosStore.js`, `src/utils/convenios.js`.

- [ ] **Step 1:** `conveniosStore.clonarConvenio` acepta `obraId` opcional:
  ```js
  clonarConvenio: async (convenioGlobalId, empresaId, obraId) => {
    const { data, error } = await supabase.rpc('clonar_convenio', {
      convenio_global_id: convenioGlobalId, p_empresa_id: empresaId ?? null, p_obra_id: obraId ?? null,
    })
    ...
  }
  ```
- [ ] **Step 2:** En `ConfiguracionPage.jsx`, el botón "Personalizar convenio" (línea 84-92) gana un selector de obra (cargado desde `nom_v_obras` por empresa) antes de clonar. Si se elige obra → `clonarConvenio(id, empresa, obraId)`.
- [ ] **Step 3:** `utils/convenios.js` `categoriasVigentes` y `filtrarConveniosVisibles` no cambian; el convenio por obra se muestra con su nombre igual que el genérico (si se quiere distinguir en UI, agregar sufijo con el nombre de obra en `ConfiguracionPage` al armar el `<option>`).
- [ ] **Step 4:** Test: ampliar `src/utils/__tests__/convenios.test.js` y `src/pages/__tests__/ConfiguracionPage.test.jsx` (mock del `select` de `nom_v_obras`). `npx vitest run` → PASS.
- [ ] **Step 5:** Commit `feat(ui): personalizar convenio por obra (plantilla → convenio de obra)`.

**Criterio de aceptación:** desde Configuración → Convenios se clona una plantilla hacia una obra puntual.

### Task 4.3: UI de ajuste global de horas por persona [⚙️ medio]

**Files:** Modify `src/pages/LiquidacionPage.jsx` (o `LiquidacionesIndividuales.jsx`) · Create `src/store/ajustesHorasStore.js` (o usar supabase directo, tabla chica).

- [ ] **Step 1:** En la vista del período, una columna/panel "Ajuste hs." editable por persona (input numérico con el delta, default 0). Al guardar → upsert en `nom_ajustes_horas` con `periodo_id` y `personal_id`.
- [ ] **Step 2:** Al cargar las liquidaciones del período, leer los ajustes existentes y pre-cargarlos.
- [ ] **Step 3:** Test: `src/pages/__tests__/LiquidacionPage.test.jsx` (mock de supabase; el upsert guarda `periodo_id`, `personal_id`, `horas_globales`).
- [ ] **Step 4:** Commit `feat(ui): ajuste global de horas por persona y período`.

**Criterio de aceptación:** se carga un delta de horas por persona; al recalcular el período, `horas_trabajadas` lo refleja.

### Task 4.4: UI de config de horas por obra [⚙️ medio]

**Files:** Modify `src/components/config/TabEmpresa.jsx` (o nueva `TabHorasObra.jsx`).

- [ ] **Step 1:** Agregar sección "Horas por obra": selector de obra (desde `nom_v_obras` por empresa) + campos `tope_horas_diarias`, `jornada_horas` → upsert en `nom_config_obras`.
- [ ] **Step 2:** Reusar el patrón de `useConfigHoras` (`TabEmpresa.jsx:11-47`), parametrizado por obra.
- [ ] **Step 3:** Commit `feat(ui): tope de horas diarias y jornada por obra`.

**Criterio de aceptación:** se configura el tope diario por obra; el cálculo lo respeta.

### Task 4.5: Recibo NO imprime el bono; Excel/reportes SÍ [⚙️ bajo]

**Files:** Modify `src/utils/reciboLayout.js` (si hiciera falta) · Modify `src/pages/ReportesPage.jsx` y `src/pages/LiquidacionPage.jsx` CSV.

**Por qué:** el bono se graba en `nom_liquidacion_items` con `grupo_recibo = NULL`. `reciboLayout.js:19-23` ya arma secciones filtrando por `grupoRecibo`, así que un ítem con `grupoRecibo` null **ya no se imprime** en el PDF — sin cambios. Verificar con el test de golden de recibo.

- [ ] **Step 1 (verificación):** correr `npx vitest run src/utils/__tests__/reciboLayout.test.js src/utils/__tests__/reciboPdf.test.js` — deben seguir verdes (el bono no altera layout existente).
- [ ] **Step 2 (test que falla):** Agregar un caso a `src/utils/__tests__/reciboLayout.test.js` con un ítem `{ codigo: 'bono_x', tipo: 'bono', monto: 50000, grupoRecibo: null }` → no debe aparecer en ninguna sección (`remunerativos`, `descuentos`, etc.) ni sumar a `sueldoBruto`.
- [ ] **Step 3:** En `ReportesPage.jsx`, agregar columnas de bonos al `reportePago`/`libroDeSueldos` (o al menos asegurar que `bruto`/`neto` de la liquidación ya lo incluyen — sí, porque el motor suma el bono a `bruto`/`neto`). Si se quiere el desglose, sumar los items `tipo === 'bono'` por persona. En `LiquidacionPage.jsx` CSV, agregar columna "Bono" leyendo los items.
- [ ] **Step 4:** `npx vitest run src/utils/__tests__/reciboLayout.test.js` → PASS. `npm test`.
- [ ] **Step 5:** Commit `feat(recibo): el bono no se imprime en el recibo y sí aparece en Excel/reportes`.

**Criterio de aceptación:** el PDF del recibo no muestra el bono; el CSV/Excel y el bruto/neto de la liquidación sí.

---

## Fase 5 — Cierre y verificación integral [⚙️ bajo]

### Task 5.1: Suite completa + build [⚙️ bajo]

- [ ] **Step 1:** `npm run lint && npm test && npm run build` → todo verde.
- [ ] **Step 2:** Revisar que no quedaron `console.log` ni código muerto.
- [ ] **Step 3:** Commit `chore: cierre de implementación — convenios por obra, ajustes de horas, topes por obra, bonos no remunerativos`.

### Task 5.2: Prueba funcional integral (usuario) [⚙️ bajo]

- [ ] **Step 1 (bonos):** superadmin crea "Bono X" (monto base). Empresa lo aplica a obra A con monto $50.000. Un legajo de la obra A con excepción "desactivado" no lo cobra; otro con excepción $30.000 cobra eso.
- [ ] **Step 2 (recibo vs excel):** liquidar el período. Verificar: en la grilla/CSV el bono suma a bruto/neto y figura como ítem; en el PDF del recibo **no** aparece ninguna línea del bono.
- [ ] **Step 3 (aportes):** verificar que jubilación/OS/contribuciones del período NO incluyen el bono en la base.
- [ ] **Step 4 (ajuste):** cargar un delta de horas a una persona y recalcular → las horas trabajadas y el básico por hora cambian.
- [ ] **Step 5 (tope por obra):** configurar tope diario 8h en obra A y 10h en obra B; liquidar personal de ambas y verificar el corte.
- [ ] **Step 6 (convenio por obra):** clonar UOCRA a obra A desde Configuración → el convenio nuevo aparece con obra y los legajos de la obra quedan bajo él.
- [ ] **Step 7:** actualizar `docs/RUNBOOK-DE-MIGRACIONES.md` con 0058-0062.

**Criterio de aceptación:** todos los flujos del cliente funcionan en dev; migraciones documentadas.

---

## Apéndice A — Decisiones de diseño (resumen)

| Tema | Decisión |
|---|---|
| Bono | Suma a bruto/neto y Excel; NO se imprime en recibo (`grupoRecibo = null`); NO integra base (`tipo 'bono'` aislado); definición global superadmin + aplicación empresa/obra + excepción por persona. |
| Ajuste de horas | Delta global por `(periodo, personal)`, puede ser negativo. |
| Tope horas | Por obra (`nom_config_obras`) con fallback empresa → default 8h. |
| Convenio por obra | `nom_convenios.obra_id`; clon copia estructura + valores de escala + no remunerativos; re-apunta solo legajos de la obra. |
| Superadmin | Define plantillas/convenios globales y catálogo de bonos; empresas los aplican. RLS: `is_superadmin()` OR `empresa_id = auth_empresa_id()` + roles. |

## Apéndice B — Mapa de archivos

- **DB:** `supabase/migrations/0058..0062` (5 migraciones nuevas).
- **Motor:** `packages/motor/src/motor.ts` (+ test), `packages/motor/src/motor.test.ts`.
- **Edge:** `supabase/functions/liquidar-periodo/index.ts` (+ test `extras.test.ts`).
- **Frontend:** `ConfiguracionPage.jsx`, `TabEmpresa.jsx`, `TabBonos.jsx` (nuevo), `LiquidacionPage.jsx`, `ReportesPage.jsx`, `SuperAdminPage.jsx`, stores (`bonosStore.js` nuevo, `conveniosStore.js`), `reciboLayout.js` (solo test).
