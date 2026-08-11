-- 0069_firma_recibos.sql — Fase 7: recibo "para el Empleado" (firma del
-- aprobador de pago) y recibo "para el Empleador" (espacio de firma del
-- empleado, comportamiento actual).
--
-- Dos variantes del MISMO recibo, mismo numero_recibo por liquidación:
-- la numeración correlativa por empresa (nom_recibo_secuencia, 0016) queda
-- intacta; acá solo se agregan hashes y flags POR VARIANTE en
-- nom_liquidaciones. Se conservan hash_pdf/numero_recibo tal cual están
-- (compatibilidad con lo ya emitido).

-- ─── nom_firma_empresa ────────────────────────────────────────────
-- Una fila por empresa: imagen de la firma del aprobador de pago +
-- aclaración (nombre y puesto de la compañía). El almacenamiento es el
-- bucket público nom-firmas (abajo); firma_url guarda la ruta del objeto.
CREATE TABLE IF NOT EXISTS nom_firma_empresa (
  empresa_id       UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  firma_url        TEXT,
  nombre_completo  TEXT NOT NULL,
  puesto           TEXT NOT NULL,
  configurado_por  UUID,
  actualizado_en   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_firma_empresa ENABLE ROW LEVEL SECURITY;

-- SELECT: dueño/admin de la empresa, superadmin, o el aprobador de pago
-- externo (nom_usuarios_empresas, multi-empresa) que deba ver/cargar la
-- firma de la empresa que está aprobando. Mismo espíritu que el puente
-- de 0014 (rol aprobador_pagos vive fuera del JWT de empresa propia).
-- Columna empresa_id ↔ nom_firma_empresa.empresa_id para desambiguar el
-- EXISTS con el puente.
DROP POLICY IF EXISTS nom_firma_empresa_select ON nom_firma_empresa;
CREATE POLICY nom_firma_empresa_select ON nom_firma_empresa FOR SELECT TO authenticated
  USING (
    is_superadmin() OR empresa_id = auth_empresa_id() OR EXISTS (
      SELECT 1 FROM nom_usuarios_empresas ue
      WHERE ue.empresa_id = nom_firma_empresa.empresa_id
        AND ue.rol = 'aprobador_pagos'
        AND ue.usuario_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS nom_firma_empresa_insert ON nom_firma_empresa;
CREATE POLICY nom_firma_empresa_insert ON nom_firma_empresa FOR INSERT TO authenticated
  WITH CHECK (
    is_superadmin() OR empresa_id = auth_empresa_id() OR EXISTS (
      SELECT 1 FROM nom_usuarios_empresas ue
      WHERE ue.empresa_id = nom_firma_empresa.empresa_id
        AND ue.rol = 'aprobador_pagos'
        AND ue.usuario_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS nom_firma_empresa_update ON nom_firma_empresa;
CREATE POLICY nom_firma_empresa_update ON nom_firma_empresa FOR UPDATE TO authenticated
  USING (
    is_superadmin() OR empresa_id = auth_empresa_id() OR EXISTS (
      SELECT 1 FROM nom_usuarios_empresas ue
      WHERE ue.empresa_id = nom_firma_empresa.empresa_id
        AND ue.rol = 'aprobador_pagos'
        AND ue.usuario_id = auth.uid()
    )
  )
  WITH CHECK (
    is_superadmin() OR empresa_id = auth_empresa_id() OR EXISTS (
      SELECT 1 FROM nom_usuarios_empresas ue
      WHERE ue.empresa_id = nom_firma_empresa.empresa_id
        AND ue.rol = 'aprobador_pagos'
        AND ue.usuario_id = auth.uid()
    )
  );

-- DELETE: solo dueño/admin de la empresa o superadmin (un aprobador externo
-- puede re-subir su firma con UPSERT, pero no borrar la del resto).
DROP POLICY IF EXISTS nom_firma_empresa_delete ON nom_firma_empresa;
CREATE POLICY nom_firma_empresa_delete ON nom_firma_empresa FOR DELETE TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON nom_firma_empresa TO authenticated;

-- ─── Bucket de storage nom-firmas (público) ───────────────────────
-- La firma se imprime en el PDF como imagen directa, igual que el logo
-- (0036). Se separa de nom-documentos (privado) por la misma razón que
-- nom-logos: no volver público el legajo.
INSERT INTO storage.buckets (id, name, public)
SELECT 'nom-firmas', 'nom-firmas', true
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'nom-firmas');

DROP POLICY IF EXISTS nom_firmas_lectura ON storage.objects;
CREATE POLICY nom_firmas_lectura ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'nom-firmas');

DROP POLICY IF EXISTS nom_firmas_escritura ON storage.objects;
CREATE POLICY nom_firmas_escritura ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nom-firmas');

DROP POLICY IF EXISTS nom_firmas_actualizacion ON storage.objects;
CREATE POLICY nom_firmas_actualizacion ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'nom-firmas') WITH CHECK (bucket_id = 'nom-firmas');

DROP POLICY IF EXISTS nom_firmas_borrado ON storage.objects;
CREATE POLICY nom_firmas_borrado ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nom-firmas');

-- ─── Columnas por variante en nom_liquidaciones ──────────────────
ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS hash_pdf_empleado TEXT;
ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS hash_pdf_empleador TEXT;
ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS emitido_empleado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS emitido_empleador BOOLEAN NOT NULL DEFAULT false;

-- ─── emitir_recibo_variante ───────────────────────────────────────
-- Misma idempotencia que emitir_recibo (0016): si numero_recibo es NULL
-- asigna el siguiente de la secuencia por empresa; si ya tiene, reutiliza
-- el mismo número (ambas variantes comparten número). Guarda el hash y el
-- flag de la variante pedida.
--
-- Reglas de negocio:
--  * Se rechaza una liquidación anulada (igual que 0016).
--  * Se rechaza estado_revision = 'rechazado' (0054).
--  * Variante 'empleado' requiere: firma configurada (nom_firma_empresa)
--    para la empresa Y flujo del período aprobado
--    (nom_flujo_instancias con estado='aprobado').
CREATE OR REPLACE FUNCTION emitir_recibo_variante(p_liquidacion_id UUID, p_variante TEXT, p_hash TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_liq     nom_liquidaciones%ROWTYPE;
  v_numero  INTEGER;
BEGIN
  IF p_variante NOT IN ('empleado', 'empleador') THEN
    RAISE EXCEPTION 'variante invalida (empleado|empleador)';
  END IF;

  SELECT * INTO v_liq FROM nom_liquidaciones WHERE id = p_liquidacion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'liquidacion no encontrada';
  END IF;
  IF NOT is_superadmin() AND v_liq.empresa_id <> auth_empresa_id() THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;
  IF v_liq.anulado THEN
    RAISE EXCEPTION 'no se puede emitir recibo de una liquidacion anulada';
  END IF;
  IF v_liq.estado_revision = 'rechazado' THEN
    RAISE EXCEPTION 'no se puede emitir recibo de una liquidacion rechazada';
  END IF;

  IF p_variante = 'empleado' THEN
    IF NOT EXISTS (SELECT 1 FROM nom_firma_empresa WHERE empresa_id = v_liq.empresa_id) THEN
      RAISE EXCEPTION 'se requiere una firma de aprobador configurada para la empresa';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM nom_flujo_instancias i
      WHERE i.periodo_id = v_liq.periodo_id AND i.estado = 'aprobado'
    ) THEN
      RAISE EXCEPTION 'el periodo debe estar aprobado para emitir el recibo para empleado';
    END IF;
  END IF;

  IF v_liq.numero_recibo IS NULL THEN
    SELECT siguiente_numero_recibo(v_liq.empresa_id) INTO v_numero;
    UPDATE nom_liquidaciones
       SET numero_recibo = v_numero,
           hash_pdf_empleado = CASE WHEN p_variante = 'empleado' THEN p_hash ELSE hash_pdf_empleado END,
           hash_pdf_empleador = CASE WHEN p_variante = 'empleador' THEN p_hash ELSE hash_pdf_empleador END,
           emitido_empleado   = CASE WHEN p_variante = 'empleado' THEN true ELSE emitido_empleado END,
           emitido_empleador  = CASE WHEN p_variante = 'empleador' THEN true ELSE emitido_empleador END
     WHERE id = p_liquidacion_id;
  ELSE
    v_numero := v_liq.numero_recibo;
    UPDATE nom_liquidaciones
       SET hash_pdf_empleado = CASE WHEN p_variante = 'empleado' THEN p_hash ELSE hash_pdf_empleado END,
           hash_pdf_empleador = CASE WHEN p_variante = 'empleador' THEN p_hash ELSE hash_pdf_empleador END,
           emitido_empleado   = CASE WHEN p_variante = 'empleado' THEN true ELSE emitido_empleado END,
           emitido_empleador  = CASE WHEN p_variante = 'empleador' THEN true ELSE emitido_empleador END
     WHERE id = p_liquidacion_id;
  END IF;

  RETURN v_numero;
END $$;
REVOKE ALL ON FUNCTION emitir_recibo_variante(UUID, TEXT, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION emitir_recibo_variante(UUID, TEXT, TEXT) TO authenticated;