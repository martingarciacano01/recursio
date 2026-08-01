-- ─────────────────────────────────────────────────────────────────────────────
-- anonimizar-staging.sql
--
-- Reemplaza toda la PII de staging por datos sintéticos, manteniendo la
-- FORMA de los datos (largos, formatos, unicidad, distribución) para que
-- Presencio dev y Recursio se comporten igual que con datos reales.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- ⚠ NUNCA correr contra el proyecto de producción.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── Cuentas de acceso a staging ─────────────────────────────────────────────
-- Estos usuarios NO se anonimizan y se re-insertan en `superadmins` al final.
-- Sin esto, el sync te deja afuera de tu propia staging: is_superadmin()
-- consulta la tabla `superadmins`, que el TRUNCATE vacía y se repuebla con los
-- user_id de prod (que no existen en staging).
-- Agregá acá el email de cualquier cuenta con la que quieras seguir entrando.
CREATE TEMP TABLE _dev_users ON COMMIT DROP AS
SELECT id FROM auth.users
WHERE email = ANY (ARRAY[
  'martingarciacano01@gmail.com'
]);

-- ─── auth.users ──────────────────────────────────────────────────────────────
-- Email sintético + password inutilizable. Mantiene el UUID (las FKs siguen).
-- El hash es bcrypt de una cadena aleatoria: nadie puede loguearse con estos
-- usuarios. Para entrar a staging usá "Enviar magic link" o creá un usuario
-- nuevo desde el dashboard de Supabase.
UPDATE auth.users
SET email              = 'user+' || left(id::text, 8) || '@staging.local',
    encrypted_password = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    phone              = NULL,
    raw_user_meta_data = jsonb_build_object('anonimizado', true),
    email_change       = '',
    phone_change       = ''
WHERE email NOT LIKE '%@staging.local'
  AND id NOT IN (SELECT id FROM _dev_users);

UPDATE auth.identities
SET identity_data = jsonb_build_object(
      'sub',   user_id::text,
      'email', 'user+' || left(user_id::text, 8) || '@staging.local')
WHERE identity_data->>'email' NOT LIKE '%@staging.local'
  AND user_id NOT IN (SELECT id FROM _dev_users);

-- ─── personal (Presencio) ────────────────────────────────────────────────────
-- Nombre sintético estable por id, DNI válido en formato pero falso,
-- descriptor facial (vector 128-d de face-api.js) randomizado → la biometría
-- real no sale de prod, pero el reconocimiento sigue teniendo con qué operar.
UPDATE personal p
SET nombre = (ARRAY['Juan','María','Carlos','Lucía','Diego','Sofía','Martín',
                    'Valeria','Pablo','Camila','Andrés','Rocío','Gonzalo',
                    'Florencia','Nicolás','Julieta']
             )[1 + abs(hashtext(p.id::text)) % 16]
             || ' ' ||
             (ARRAY['Gómez','Fernández','Rodríguez','López','Martínez','Sosa',
                    'Romero','Torres','Ruiz','Álvarez','Benítez','Acosta',
                    'Medina','Herrera','Aguirre','Cabrera']
             )[1 + abs(hashtext(p.id::text || 'salt')) % 16],
    dni        = (20000000 + (abs(hashtext(p.id::text)) % 25000000))::text,
    foto_url   = NULL,
    descriptor = CASE
                   WHEN p.descriptor IS NULL THEN NULL
                   ELSE (SELECT jsonb_agg(round((random() * 2 - 1)::numeric, 6))
                         FROM generate_series(1, 128))
                 END;

-- ─── fichajes ────────────────────────────────────────────────────────────────
-- Los snapshots faciales del momento del fichaje son biometría: se descartan.
-- Timestamps, tipo, método y confianza se conservan (es lo que le importa a
-- Recursio para liquidar).
UPDATE fichajes SET foto_url = NULL WHERE foto_url IS NOT NULL;

-- ─── usuarios / usuarios_empresa ─────────────────────────────────────────────
UPDATE usuarios
SET nombre = 'Usuario ' || left(id::text, 6)
WHERE nombre IS NOT NULL;

UPDATE usuarios_empresa
SET nombre = 'Usuario ' || left(user_id::text, 6),
    email  = 'user+' || left(user_id::text, 8) || '@staging.local'
WHERE email NOT LIKE '%@staging.local';

-- ─── obras / empresas ────────────────────────────────────────────────────────
-- Los nombres de empresa y obra son datos comerciales de clientes reales.
UPDATE obras    SET direccion = 'Av. Siempreviva ' || (100 + abs(hashtext(id::text)) % 4000);
UPDATE empresas SET nombre    = 'Empresa Demo ' || left(id::text, 4)
WHERE nombre NOT LIKE 'Empresa Demo %';

-- ─── documentos_personal ─────────────────────────────────────────────────────
-- Los archivos en Storage no se copian; se anulan las URLs para no dejar
-- referencias colgadas a documentos reales (DNI escaneado, etc.).
UPDATE documentos_personal
SET doc_path = NULL,
    numero   = CASE WHEN numero IS NULL THEN NULL
                    ELSE (10000000 + abs(hashtext(id::text)) % 80000000)::text END,
    nota     = NULL;

-- ─── Recursio (nom_*) — solo si esas tablas tienen datos venidos de prod ─────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'nom_legajo') THEN
    EXECUTE $q$
      UPDATE nom_legajo
      SET cuil      = '20-' || (20000000 + abs(hashtext(id::text)) % 25000000)::text || '-3',
          domicilio = 'Av. Siempreviva ' || (100 + abs(hashtext(id::text)) % 4000),
          cbu       = lpad((abs(hashtext(id::text)) % 1000000000)::text, 22, '0')
    $q$;
  END IF;
END $$;

-- ─── Restaurar acceso superadmin ─────────────────────────────────────────────
-- El TRUNCATE dejó en `superadmins` los user_id de prod, que en staging no
-- existen. Los sacamos y volvemos a poner los de las cuentas de desarrollo.
DELETE FROM superadmins
WHERE user_id NOT IN (SELECT id FROM auth.users);

INSERT INTO superadmins (user_id)
SELECT id FROM _dev_users
ON CONFLICT (user_id) DO NOTHING;

COMMIT;

-- Verificación rápida
SELECT 'personal'  AS tabla, count(*) FROM personal
UNION ALL SELECT 'fichajes', count(*) FROM fichajes
UNION ALL SELECT 'obras',    count(*) FROM obras
UNION ALL SELECT 'empresas', count(*) FROM empresas
UNION ALL SELECT 'auth.users', count(*) FROM auth.users
UNION ALL SELECT 'superadmins', count(*) FROM superadmins;
