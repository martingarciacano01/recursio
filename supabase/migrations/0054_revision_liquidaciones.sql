-- 0054_revision_liquidaciones.sql — Fase 4, Task 4.1: revisión de pago
-- por recibo individual, independiente del flujo de instancia de período
-- (nom_flujo_instancias/avanzar_flujo, migración 0015, que NO se toca).
--
-- Decisión (spec 2026-08-03-aprobaciones-detalle-rechazo-individual):
-- rechazar el pago de UNA persona no debe frenar el resto del período.
-- estado_revision vive en nom_liquidaciones, es el estado actual (no hay
-- tabla de auditoría histórica aparte — YAGNI, ver spec).
ALTER TABLE nom_liquidaciones
  ADD COLUMN IF NOT EXISTS estado_revision TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado_revision IN ('pendiente','aprobado','rechazado')),
  ADD COLUMN IF NOT EXISTS motivo_rechazo TEXT,
  ADD COLUMN IF NOT EXISTS revisado_por UUID,
  ADD COLUMN IF NOT EXISTS revisado_en TIMESTAMPTZ;

-- revisar_liquidacion(liquidacion_id, accion, comentario): única vía para
-- cambiar estado_revision. No se otorga UPDATE directo de estas columnas
-- a `authenticated` — mismo motivo que avanzar_flujo: si el cliente
-- pudiera hacer UPDATE directo, se saltearía la validación de rol+paso de
-- acá abajo.
CREATE OR REPLACE FUNCTION revisar_liquidacion(p_liquidacion_id UUID, p_accion TEXT, p_comentario TEXT DEFAULT NULL)
RETURNS TABLE(estado_revision TEXT, motivo_rechazo TEXT) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_liquidacion   nom_liquidaciones%ROWTYPE;
  v_empresa       UUID;
  v_instancia     nom_flujo_instancias%ROWTYPE;
  v_paso_actual   nom_flujo_pasos%ROWTYPE;
  v_autorizado    BOOLEAN := false;
BEGIN
  IF p_accion NOT IN ('aprobado', 'rechazado') THEN
    RAISE EXCEPTION 'accion invalida: %', p_accion;
  END IF;

  IF p_accion = 'rechazado' AND (p_comentario IS NULL OR btrim(p_comentario) = '') THEN
    RAISE EXCEPTION 'motivo de rechazo obligatorio';
  END IF;

  SELECT * INTO v_liquidacion FROM nom_liquidaciones WHERE id = p_liquidacion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'liquidacion no encontrada';
  END IF;
  v_empresa := v_liquidacion.empresa_id;

  SELECT * INTO v_instancia FROM nom_flujo_instancias WHERE periodo_id = v_liquidacion.periodo_id;

  IF FOUND AND v_instancia.paso_actual_id IS NOT NULL THEN
    SELECT * INTO v_paso_actual FROM nom_flujo_pasos WHERE id = v_instancia.paso_actual_id;
  END IF;

  -- Autorización: mismo criterio que avanzar_flujo. Si el período nunca
  -- entró a un circuito (sin instancia o sin paso actual), solo
  -- dueño/admin/superadmin puede revisar recibos individuales.
  IF is_superadmin() THEN
    v_autorizado := true;
  ELSIF v_empresa = auth_empresa_id() AND (v_paso_actual.rol_requerido IS NULL OR v_paso_actual.rol_requerido IN ('admin','revisor_interno')) THEN
    v_autorizado := true;
  ELSIF v_paso_actual.rol_requerido IS NOT NULL AND EXISTS (
    SELECT 1 FROM nom_usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid() AND ue.empresa_id = v_empresa AND ue.rol = v_paso_actual.rol_requerido
  ) THEN
    v_autorizado := true;
  END IF;

  IF NOT v_autorizado THEN
    RAISE EXCEPTION 'no autorizado para revisar esta liquidacion';
  END IF;

  UPDATE nom_liquidaciones
    SET estado_revision = p_accion, motivo_rechazo = p_comentario, revisado_por = auth.uid(), revisado_en = now()
    WHERE id = p_liquidacion_id;

  RETURN QUERY SELECT nl.estado_revision, nl.motivo_rechazo FROM nom_liquidaciones nl WHERE nl.id = p_liquidacion_id;
END $$;
REVOKE ALL ON FUNCTION revisar_liquidacion(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION revisar_liquidacion(UUID, TEXT, TEXT) TO authenticated;
