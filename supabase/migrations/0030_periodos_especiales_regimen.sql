-- 0030_periodos_especiales_regimen.sql
-- Amplía nom_periodos.tipo para distinguir SAC 1er/2do semestre y
-- vacaciones (antes solo había 'sac' genérico). Agrega soporte para
-- régimen del convenio normalizado (lct genérico vs. 22250 UOCRA) para que
-- liquidar-periodo sepa qué motor de especiales usar (packages/motor/src/especiales.ts
-- vs. packages/motor/src/uocra.ts, ya existente).

-- Amplía nom_periodos.tipo con nuevas categorías de períodos especiales
ALTER TABLE nom_periodos DROP CONSTRAINT IF EXISTS nom_periodos_tipo_check;
ALTER TABLE nom_periodos ADD CONSTRAINT nom_periodos_tipo_check
  CHECK (tipo IN ('mensual','quincenal','quincena_1','quincena_2','sac','sac_1','sac_2','vacaciones','final'));

-- Normaliza nom_convenios.regimen: migra 'ley_22250' a '22250' (más legible, alinea con norma)
ALTER TABLE nom_convenios DROP CONSTRAINT IF EXISTS nom_convenios_regimen_check;
ALTER TABLE nom_convenios ADD CONSTRAINT nom_convenios_regimen_check
  CHECK (regimen IN ('lct','22250'));

-- Migra datos existentes
UPDATE nom_convenios SET regimen = '22250' WHERE regimen = 'ley_22250';

COMMENT ON COLUMN nom_convenios.regimen IS 'lct: SAC/vacaciones/final genéricos (Ley 20.744). 22250: régimen de la construcción (Ley 22.250) — sin indemnización por despido, ver packages/motor/src/uocra.ts';
