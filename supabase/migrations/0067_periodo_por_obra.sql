-- 0067_periodo_por_obra.sql
--
-- Revisión de Liquidaciones (2026-08-09): permite crear un período asociado
-- a una obra/sitio puntual. `nom_periodos.obra_id` opcional: si está cargado,
-- la Edge Function `liquidar-periodo` procesa SOLO el personal activo de esa
-- obra (filtro sobre nom_v_personal.obra_id); si es NULL, se liquida como
-- siempre (todo el personal activo de la empresa).
--
-- Mismo patrón que nom_liquidaciones.obra_id (0064): columna UUID simple con
-- comentario, sin FK — la obra viene de Presencio (vía nom_v_obras) y no
-- queremos constraints que bloqueen el alta de períodos si la obra se baja.

ALTER TABLE nom_periodos ADD COLUMN IF NOT EXISTS obra_id UUID;

COMMENT ON COLUMN nom_periodos.obra_id IS
  'Obra de Presencio (vía nom_v_obras) a la que se acota este período. NULL = período de toda la empresa. Al calcular, solo se procesa el personal activo de esa obra.';
