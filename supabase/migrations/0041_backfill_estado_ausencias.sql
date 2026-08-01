-- 0041_backfill_estado_ausencias.sql
--
-- Bug: liquidar-periodo filtraba ausencias con .eq('estado','aprobada'),
-- descartando en silencio cualquier fila con estado NULL. Del lado de
-- Presencio (fichaobra/src/store/appStore.js), ausenciaToDB() solo mandaba
-- `estado` al INSERT si venía truthy, así que el alta normal de una ausencia
-- podía terminar sin `estado` en la base (dependiendo del default vigente al
-- momento de esa fila) mientras el cliente la mostraba como "aprobada" via
-- ausenciaFromDB() compensando en el front. Resultado: esas ausencias no se
-- tomaban en la liquidación y esos días caían en faltasInjustificadas.
--
-- Esta migración escribe sobre `ausencias`, tabla de Presencio (fichaobra),
-- no de Recursio. Se aplica con el OK explícito del usuario (Martin,
-- 2026-07-30).
--
-- Idempotente: el UPDATE solo toca filas con estado NULL; el resto de las
-- sentencias son DDL con IF NOT EXISTS / se pueden re-ejecutar sin efecto
-- adicional.

UPDATE ausencias SET estado = 'aprobada' WHERE estado IS NULL;

ALTER TABLE ausencias ALTER COLUMN estado SET DEFAULT 'aprobada';
ALTER TABLE ausencias ALTER COLUMN estado SET NOT NULL;
