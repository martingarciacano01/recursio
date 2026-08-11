-- 0064_obra_en_liquidaciones_bono_tipo_monto.sql
-- Ajustes de los 10 ítems del plan convenios-por-obra (2026-08-07):
--   · nom_liquidaciones.obra_id — la obra del personal al momento de la
--     liquidación queda persistida en la fila, para mostrarla en la grilla
--     y el CSV aun si la persona se reasigna de obra después.
--   · nom_bono_aplicaciones.tipo_monto — el bono se paga con monto FIJO o
--     VARIABLE por hora trabajada ('fijo' | 'por_horas').

ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS obra_id UUID;

COMMENT ON COLUMN nom_liquidaciones.obra_id IS
  'Obra a la que estaba asignada la persona al momento de liquidar (Presencio, via nom_v_personal.obra_id). NULL si no tenia obra o es una liquidacion previa a la migracion 0064.';

ALTER TABLE nom_bono_aplicaciones ADD COLUMN IF NOT EXISTS tipo_monto TEXT NOT NULL DEFAULT 'fijo';
ALTER TABLE nom_bono_aplicaciones DROP CONSTRAINT IF EXISTS nom_bono_aplicaciones_tipo_monto_check;
ALTER TABLE nom_bono_aplicaciones ADD CONSTRAINT nom_bono_aplicaciones_tipo_monto_check
  CHECK (tipo_monto IN ('fijo', 'por_horas'));

COMMENT ON COLUMN nom_bono_aplicaciones.tipo_monto IS
  'fijo: el monto se paga tal cual. por_horas: el monto es el valor por HORA trabajada y se multiplica por horas del período. Historicamente ''fijo'' (default de la migracion 0062).';