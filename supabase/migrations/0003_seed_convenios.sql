-- 0003_seed_convenios.sql — convenios plantilla (Fase 0, Task 6)
--
-- Seed de estructura, NO de valores de escala salarial: basico = 0 en
-- todas las categorías. Publicar montos reales desactualizados sería peor
-- que no publicar nada — el usuario carga los valores vigentes en Fase 4
-- (nom_categorias con vigencia_desde real, ver scripts/seed-convenios.md).
-- empresa_id NULL = plantilla global, visible para todas las empresas
-- vía la policy nom_convenios_select (0002_nomina_core.sql).

INSERT INTO nom_convenios (id, empresa_id, nombre, regimen, descripcion)
SELECT gen_random_uuid(), NULL, 'Fuera de convenio (LCT)', 'lct',
       'Empleados no comprendidos en convenio colectivo — Ley de Contrato de Trabajo.'
WHERE NOT EXISTS (
  SELECT 1 FROM nom_convenios WHERE empresa_id IS NULL AND nombre = 'Fuera de convenio (LCT)'
);

INSERT INTO nom_convenios (id, empresa_id, nombre, regimen, descripcion)
SELECT gen_random_uuid(), NULL, 'UOCRA (Ley 22.250)', 'ley_22250',
       'Convenio de la construcción — Unión Obrera de la Construcción de la República Argentina.'
WHERE NOT EXISTS (
  SELECT 1 FROM nom_convenios WHERE empresa_id IS NULL AND nombre = 'UOCRA (Ley 22.250)'
);

-- Categorías genéricas para "Fuera de convenio (LCT)"
INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde)
SELECT c.id, cat.nombre, 0, DATE '1900-01-01'
FROM nom_convenios c
CROSS JOIN (VALUES ('Administrativo'), ('Técnico'), ('Jefatura')) AS cat(nombre)
WHERE c.empresa_id IS NULL AND c.nombre = 'Fuera de convenio (LCT)'
  AND NOT EXISTS (
    SELECT 1 FROM nom_categorias WHERE convenio_id = c.id AND nombre = cat.nombre AND vigencia_desde = DATE '1900-01-01'
  );

-- Categorías UOCRA (Recursio_Diseno.md, Task 6)
INSERT INTO nom_categorias (convenio_id, nombre, basico, vigencia_desde)
SELECT c.id, cat.nombre, 0, DATE '1900-01-01'
FROM nom_convenios c
CROSS JOIN (VALUES
  ('Oficial especializado'), ('Oficial'), ('Medio oficial'), ('Ayudante'), ('Sereno')
) AS cat(nombre)
WHERE c.empresa_id IS NULL AND c.nombre = 'UOCRA (Ley 22.250)'
  AND NOT EXISTS (
    SELECT 1 FROM nom_categorias WHERE convenio_id = c.id AND nombre = cat.nombre AND vigencia_desde = DATE '1900-01-01'
  );
