-- 0001_vistas_contrato.sql — contrato de lectura Recursio → Presencio
--
-- Recursio NUNCA escribe en tablas de Presencio (Recursio_Diseno.md 2.2).
-- Estas vistas son la única forma en que Recursio lee personal, fichajes
-- y ausencias. `security_invoker = true` hace que la vista evalúe la RLS
-- de las tablas base con los permisos del usuario que consulta, no con
-- los del dueño de la vista — así el aislamiento por empresa_id que ya
-- existe en Presencio se hereda automáticamente.
--
-- Columnas verificadas contra fichaobra/supabase/migrations/
-- (000_01_schema.sql + alters posteriores) el 2026-07-20. NO usar los
-- nombres de columna del diseño (Recursio_Diseno.md) sin confirmar contra
-- estos archivos: el diseño asumía columnas que no existen en el schema
-- real (turno, horas_normales, horas_extra_50/100, comprobante_path).
--
-- personal real: id, nombre, dni, puesto, obra_id, empresa_id, foto_url,
--   descriptor, estado, created_at, fecha_inactivacion,
--   consentimiento_biometrico, fecha_consentimiento, fecha_ingreso.
-- fichajes real: id, personal_id, obra_id, tipo, metodo, confianza,
--   foto_url, timestamp, empresa_id, estado_validacion, descriptor,
--   origen, justificacion, modificado_por, modificado_en.
--   NO existen horas_normales/horas_extra_50/horas_extra_100 ni turno:
--   fichajes son eventos crudos de entrada/salida, no horas agregadas
--   por día. El cálculo de horas se hace en el motor de liquidación
--   (Fase 2), no en esta vista (decisión confirmada con el usuario).
-- ausencias real: id, personal_id, obra_id, tipo, desde, hasta,
--   certificado, nota, doc_url, doc_nombre, registrado_por, created_at,
--   estado, aprobador_id, fecha_resolucion, motivo_rechazo.

CREATE OR REPLACE VIEW nom_v_personal AS
  SELECT p.id, p.empresa_id, p.nombre, p.dni, p.puesto, p.obra_id,
         p.estado, p.fecha_ingreso, p.created_at AS fecha_alta_sistema,
         p.fecha_inactivacion
  FROM personal p;

-- Eventos crudos de fichada (entrada/salida). El motor de liquidación de
-- Fase 2 arma los pares entrada→salida y calcula horas normales/extra.
CREATE OR REPLACE VIEW nom_v_horas_dia AS
  SELECT f.id, f.empresa_id, f.personal_id, f.obra_id, f.tipo,
         f.metodo, f.timestamp, f.estado_validacion, f.origen
  FROM fichajes f;

CREATE OR REPLACE VIEW nom_v_ausencias AS
  SELECT a.id, a.empresa_id, a.personal_id, a.obra_id, a.tipo,
         a.desde AS fecha_desde, a.hasta AS fecha_hasta,
         a.certificado, a.doc_url, a.estado
  FROM ausencias a;

-- Las vistas heredan RLS de las tablas base (security_invoker), requiere
-- Postgres 15+ (Supabase lo soporta).
ALTER VIEW nom_v_personal  SET (security_invoker = true);
ALTER VIEW nom_v_horas_dia SET (security_invoker = true);
ALTER VIEW nom_v_ausencias SET (security_invoker = true);
