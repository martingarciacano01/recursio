-- 0055_rls_liquidaciones_acceso_puente.sql — Fase 4, Task 4.1 (fix de
-- seguridad encontrado durante revisión de diseño): un revisor_externo/
-- aprobador_pagos con acceso puente (nom_usuarios_empresas, migración
-- 0014) podía ver la lista de períodos pendientes en /aprobaciones
-- (nom_flujo_instancias_select YA contempla el puente), pero el detalle
-- de recibos por persona (nom_liquidaciones) que agregamos en esta misma
-- feature le devolvía vacío: la policy de SELECT de 0045 solo cubre
-- `empresa_id = auth_empresa_id()` (empresa "propia" del usuario), sin el
-- puente. Esta migración agrega una policy PERMISSIVE adicional — en
-- Postgres, múltiples policies FOR SELECT sobre la misma tabla se
-- combinan con OR, así que esto es estrictamente aditivo: no cambia nada
-- para admin/dueño/rrhh/consulta/supervisor, que ya podían ver todo lo de
-- su empresa vía la policy existente.
--
-- Alcance deliberadamente acotado: el puente NO da acceso a todas las
-- liquidaciones de la empresa todo el tiempo, solo a las del período que
-- está efectivamente en el paso del flujo que le corresponde a ese rol
-- (mismo criterio que ya usa nom_flujo_instancias_select) — igual que un
-- revisor_externo no puede aprobar un período que no está en su paso, no
-- puede ver los recibos de un período que no está en revisión por él.
CREATE POLICY nom_liquidaciones_select_puente ON nom_liquidaciones FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nom_flujo_instancias nfi
      JOIN nom_flujo_pasos p ON p.id = nfi.paso_actual_id
      JOIN nom_usuarios_empresas ue ON ue.empresa_id = nfi.empresa_id AND ue.rol = p.rol_requerido
      WHERE nfi.periodo_id = nom_liquidaciones.periodo_id
        AND ue.usuario_id = auth.uid()
    )
  );
