-- 0015_avanzar_flujo.sql — Fase 3, Task 23: RPC de transición de flujo
--
-- avanzar_flujo(instancia_id, accion, comentario): única vía para mover
-- una instancia de paso. Valida en su cuerpo (no confía en el cliente):
--   1) que el usuario tenga el rol_requerido del paso ACTUAL (admin/dueño
--      vía auth_empresa_id() + rol de empresas.usuarios, o rol puente en
--      nom_usuarios_empresas para revisor_externo/aprobador_pagos),
--   2) que la instancia pertenezca a una empresa donde el usuario tiene
--      ese rol,
--   3) que la instancia siga 'en_progreso' (no reabre una ya cerrada).
-- 'aprobado' avanza al siguiente paso (u 'aprobado' si era el último);
-- 'rechazado' vuelve al paso anterior (o queda 'rechazado' si era el primero).

CREATE OR REPLACE FUNCTION avanzar_flujo(p_instancia_id UUID, p_accion TEXT, p_comentario TEXT DEFAULT NULL)
RETURNS TABLE(estado TEXT, paso_actual_id UUID) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_instancia   nom_flujo_instancias%ROWTYPE;
  v_paso_actual nom_flujo_pasos%ROWTYPE;
  v_paso_previo nom_flujo_pasos%ROWTYPE;
  v_paso_siguiente nom_flujo_pasos%ROWTYPE;
  v_autorizado  BOOLEAN := false;
BEGIN
  IF p_accion NOT IN ('aprobado', 'rechazado') THEN
    RAISE EXCEPTION 'accion invalida: %', p_accion;
  END IF;

  SELECT * INTO v_instancia FROM nom_flujo_instancias WHERE id = p_instancia_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'instancia no encontrada';
  END IF;
  IF v_instancia.estado <> 'en_progreso' THEN
    RAISE EXCEPTION 'la instancia ya esta cerrada (%)', v_instancia.estado;
  END IF;

  SELECT * INTO v_paso_actual FROM nom_flujo_pasos WHERE id = v_instancia.paso_actual_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'paso actual no encontrado';
  END IF;

  -- Autorización: superadmin, dueño/admin de la empresa (rol_requerido
  -- 'admin' cubierto por is_superadmin() OR auth_empresa_id() = empresa),
  -- o rol puente en nom_usuarios_empresas para revisor_externo/aprobador_pagos.
  IF is_superadmin() THEN
    v_autorizado := true;
  ELSIF v_instancia.empresa_id = auth_empresa_id() AND v_paso_actual.rol_requerido IN ('admin','revisor_interno') THEN
    v_autorizado := true;
  ELSIF EXISTS (
    SELECT 1 FROM nom_usuarios_empresas ue
    WHERE ue.usuario_id = auth.uid() AND ue.empresa_id = v_instancia.empresa_id AND ue.rol = v_paso_actual.rol_requerido
  ) THEN
    v_autorizado := true;
  END IF;

  IF NOT v_autorizado THEN
    RAISE EXCEPTION 'no autorizado para actuar en este paso';
  END IF;

  INSERT INTO nom_aprobaciones (instancia_id, paso_id, usuario_id, accion, comentario)
  VALUES (p_instancia_id, v_paso_actual.id, auth.uid(), p_accion, p_comentario);

  IF p_accion = 'aprobado' THEN
    SELECT * INTO v_paso_siguiente FROM nom_flujo_pasos
      WHERE flujo_id = v_instancia.flujo_id AND orden > v_paso_actual.orden
      ORDER BY orden ASC LIMIT 1;
    IF FOUND THEN
      UPDATE nom_flujo_instancias SET paso_actual_id = v_paso_siguiente.id WHERE id = p_instancia_id;
    ELSE
      UPDATE nom_flujo_instancias SET paso_actual_id = NULL, estado = 'aprobado' WHERE id = p_instancia_id;
    END IF;
  ELSE
    SELECT * INTO v_paso_previo FROM nom_flujo_pasos
      WHERE flujo_id = v_instancia.flujo_id AND orden < v_paso_actual.orden
      ORDER BY orden DESC LIMIT 1;
    IF FOUND THEN
      UPDATE nom_flujo_instancias SET paso_actual_id = v_paso_previo.id WHERE id = p_instancia_id;
    ELSE
      UPDATE nom_flujo_instancias SET paso_actual_id = NULL, estado = 'rechazado' WHERE id = p_instancia_id;
    END IF;
  END IF;

  RETURN QUERY SELECT nfi.estado, nfi.paso_actual_id FROM nom_flujo_instancias nfi WHERE nfi.id = p_instancia_id;
END $$;
REVOKE ALL ON FUNCTION avanzar_flujo(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION avanzar_flujo(UUID, TEXT, TEXT) TO authenticated;

-- iniciar_flujo(periodo_id, flujo_id): crea la instancia en el primer
-- paso (orden mínimo). Separado de avanzar_flujo porque no hay paso
-- actual todavía (nada que validar más allá de pertenencia a la empresa).
CREATE OR REPLACE FUNCTION iniciar_flujo(p_periodo_id UUID, p_flujo_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID;
  v_primer_paso UUID;
  v_instancia UUID;
BEGIN
  SELECT empresa_id INTO v_empresa FROM nom_periodos WHERE id = p_periodo_id;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'periodo no encontrado';
  END IF;
  IF NOT is_superadmin() AND v_empresa <> auth_empresa_id() THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;

  SELECT id INTO v_primer_paso FROM nom_flujo_pasos WHERE flujo_id = p_flujo_id ORDER BY orden ASC LIMIT 1;
  IF v_primer_paso IS NULL THEN
    RAISE EXCEPTION 'el flujo no tiene pasos configurados';
  END IF;

  INSERT INTO nom_flujo_instancias (empresa_id, periodo_id, flujo_id, paso_actual_id, estado)
  VALUES (v_empresa, p_periodo_id, p_flujo_id, v_primer_paso, 'en_progreso')
  ON CONFLICT (periodo_id) DO UPDATE SET flujo_id = EXCLUDED.flujo_id, paso_actual_id = EXCLUDED.paso_actual_id, estado = 'en_progreso'
  RETURNING id INTO v_instancia;

  UPDATE nom_periodos SET estado = 'en_flujo' WHERE id = p_periodo_id;
  RETURN v_instancia;
END $$;
REVOKE ALL ON FUNCTION iniciar_flujo(UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION iniciar_flujo(UUID, UUID) TO authenticated;
