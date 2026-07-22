-- 0016_recibo_numeracion.sql — Fase 3, Task 26: numeración correlativa,
-- hash y versionado de recibo.
--
-- Numeración correlativa POR EMPRESA: una SEQUENCE de Postgres es global
-- (no hay "una secuencia por fila"), así que se usa una tabla contador
-- (nom_recibo_secuencia) + función que hace UPDATE...RETURNING atómico
-- (evita duplicados bajo concurrencia sin necesitar SELECT FOR UPDATE
-- explícito: el UPDATE ya toma el lock de fila).
--
-- Versionado: reliquidar un período NO borra la liquidación anterior (a
-- diferencia del comportamiento actual de liquidar-periodo, que sí borra/
-- reinserta — eso queda para períodos NO cerrados/aprobados). Una vez que
-- una liquidación tiene numero_recibo asignado (recibo emitido), reliquidar
-- debe: marcar la vieja anulada con motivo, crear una nueva fila version+1
-- enlazada por liquidacion_anterior_id, y esa nueva es la que obtiene su
-- propio numero_recibo. El hash_pdf se calcula client-side (SHA-256 del
-- PDF ya generado, Web Crypto) y se guarda para auditoría/integridad —
-- no es una firma criptográfica, es un checksum de "este PDF es el que
-- se entregó".

CREATE TABLE IF NOT EXISTS nom_recibo_secuencia (
  empresa_id     UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  ultimo_numero  INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE nom_recibo_secuencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_recibo_secuencia_select ON nom_recibo_secuencia;
CREATE POLICY nom_recibo_secuencia_select ON nom_recibo_secuencia FOR SELECT TO authenticated
  USING (is_superadmin() OR empresa_id = auth_empresa_id());
-- Sin INSERT/UPDATE directo a authenticated: solo la función
-- siguiente_numero_recibo (SECURITY DEFINER) escribe acá.
GRANT SELECT ON nom_recibo_secuencia TO authenticated;

ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS numero_recibo INTEGER;
ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS hash_pdf TEXT;
ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS anulado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS motivo_anulacion TEXT;
ALTER TABLE nom_liquidaciones ADD COLUMN IF NOT EXISTS liquidacion_anterior_id UUID REFERENCES nom_liquidaciones(id);
CREATE UNIQUE INDEX IF NOT EXISTS nom_liquidaciones_numero_recibo_idx ON nom_liquidaciones(empresa_id, numero_recibo) WHERE numero_recibo IS NOT NULL;

-- siguiente_numero_recibo(empresa_id): incrementa y devuelve el próximo
-- número para esa empresa. Valida empresa propia o superadmin (mismo
-- patrón que el resto de las RPC de este archivo de migraciones).
CREATE OR REPLACE FUNCTION siguiente_numero_recibo(p_empresa_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  IF NOT is_superadmin() AND p_empresa_id <> auth_empresa_id() THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;

  INSERT INTO nom_recibo_secuencia (empresa_id, ultimo_numero) VALUES (p_empresa_id, 1)
  ON CONFLICT (empresa_id) DO UPDATE SET ultimo_numero = nom_recibo_secuencia.ultimo_numero + 1
  RETURNING ultimo_numero INTO v_numero;

  RETURN v_numero;
END $$;
REVOKE ALL ON FUNCTION siguiente_numero_recibo(UUID) FROM public;
GRANT EXECUTE ON FUNCTION siguiente_numero_recibo(UUID) TO authenticated;

-- emitir_recibo(liquidacion_id, hash_pdf): asigna número correlativo (si
-- no tenía) y guarda el hash del PDF entregado. Idempotente: si ya tenía
-- número, no lo reasigna (evita huecos por doble click) y solo actualiza
-- el hash si cambió el contenido (versión distinta del PDF).
CREATE OR REPLACE FUNCTION emitir_recibo(p_liquidacion_id UUID, p_hash_pdf TEXT)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_liq nom_liquidaciones%ROWTYPE;
  v_numero INTEGER;
BEGIN
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

  IF v_liq.numero_recibo IS NULL THEN
    v_numero := siguiente_numero_recibo(v_liq.empresa_id);
    UPDATE nom_liquidaciones SET numero_recibo = v_numero, hash_pdf = p_hash_pdf WHERE id = p_liquidacion_id;
  ELSE
    v_numero := v_liq.numero_recibo;
    UPDATE nom_liquidaciones SET hash_pdf = p_hash_pdf WHERE id = p_liquidacion_id;
  END IF;

  RETURN v_numero;
END $$;
REVOKE ALL ON FUNCTION emitir_recibo(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION emitir_recibo(UUID, TEXT) TO authenticated;

-- anular_liquidacion(liquidacion_id, motivo): marca anulado=true con
-- motivo. No borra (auditoría) — la nueva versión (v+1) la crea el
-- llamador (Edge Function o cliente) copiando datos y referenciando
-- liquidacion_anterior_id; esta función solo cierra la vieja.
CREATE OR REPLACE FUNCTION anular_liquidacion(p_liquidacion_id UUID, p_motivo TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_empresa UUID;
BEGIN
  SELECT empresa_id INTO v_empresa FROM nom_liquidaciones WHERE id = p_liquidacion_id;
  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'liquidacion no encontrada';
  END IF;
  IF NOT is_superadmin() AND v_empresa <> auth_empresa_id() THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;
  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RAISE EXCEPTION 'motivo de anulacion requerido';
  END IF;

  UPDATE nom_liquidaciones SET anulado = true, motivo_anulacion = p_motivo WHERE id = p_liquidacion_id;
END $$;
REVOKE ALL ON FUNCTION anular_liquidacion(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION anular_liquidacion(UUID, TEXT) TO authenticated;
