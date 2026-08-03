# Validación con contador laboralista — pendiente (Task 2.9)

Este documento junta las decisiones de cálculo del motor UOCRA que quedaron
pendientes de confirmar con un contador laboralista antes de liquidar
sueldos reales (Task 2.9 del plan `2026-07-31-produccion-pyme-ejecucion-sonnet5.md`).
Task 2.9 se pospuso; este archivo queda como punto único de seguimiento
para cuando se retome.

## Pendientes

### 1. Asistencia perfecta (20%) — ¿regla de presentismo o adicional aparte?

El CCT 76/75 (UOCRA) menciona un plus de asistencia perfecta del 20%. Hoy
el motor modela el 0/50/100% del `presentismo` con reglas de
tardanzas/faltas (`conceptos-fuera-convenio.ts`, golden 04-07), pero **no**
sembramos un concepto separado `asistencia_perfecta` en la migración 0051
(Task 2.13) — se dejó explícitamente afuera hasta confirmar:

- ¿Es la misma escala de presentismo (0/50/100%), o un adicional
  independiente que se pierde con reglas propias (ej. una sola tardanza)?
- ¿Es acumulable con el presentismo, o son mutuamente excluyentes?

### 2. Divisor de la hora extra UOCRA (jornada 9h)

`conceptos-uocra.ts`/migración 0049 usan `/200` como divisor de la hora
extra (igual que el set fuera de convenio, LCT jornada 8h/200 horas
mensuales). Confirmar si la jornada de 9h/44h semanales de la construcción
usa un divisor distinto (ej. `/220` o el que surja de e-sueldos).

### 3. Multiplicador de vacaciones gozadas para jornalizados UOCRA

`packages/motor/src/especiales.ts` (`valorDiaVacaciones`) usa
`valorHora * 8` para modalidad `'hora'`, sin distinguir la jornada real de
9h de un jornalizado UOCRA (Task 2.10, Step 3). Confirmar si "remuneración
normal y habitual" para vacaciones gozadas se calcula sobre 8h u otro
divisor.

## Cómo cerrar esto

1. Conseguir 5–10 recibos UOCRA reales (Asset u otro piloto).
2. Emitir el mismo recibo con la app y comparar contra el cálculo manual
   del contador.
3. Corregir el motor donde haya divergencia (volver a las tasks 2.1–2.13
   según corresponda) y tachar el punto de esta lista.
