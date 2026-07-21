-- 0011_total_contribuciones.sql
-- La UI de Liquidación muestra aportes del trabajador (ya existe
-- total_aportes) y contribuciones patronales a nivel fila sin necesidad
-- de traer los items. Se persiste el total al liquidar.
ALTER TABLE nom_liquidaciones
  ADD COLUMN IF NOT EXISTS total_contribuciones NUMERIC NOT NULL DEFAULT 0;
