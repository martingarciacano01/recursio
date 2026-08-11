# Tope de horas por obra — cómo funciona y cómo se aplica

> Documento de referencia para el cliente (pedido 2026-08-11: "quiero saber
> cómo funciona el tope de horas y por qué a veces parece que no se aplica").

## Qué es el tope

El **tope de horas diarias** limita cuántas horas de una jornada se pagan a una
persona. Sirve para que un fichaje desmedido (error de marcación, jornada mal
cerrada, persona que trabajó de más) no dispare una hora extra gigante.

El tope lo configura la **propia empresa** desde **Empresa → Horas por obra**
(tabla `nom_config_obras`, migración 0060). Está perimetrado por obra; si la
persona no tiene obra asignada, cae a la configuración de empresa
(`nom_config_horas`, 0050) y, si tampoco existe, al default de **8 h** (jornada
completa) o **4 h** (jornada parcial).

## Cadena de aplicación

1. **LiquidacionPage** → edge function `liquidar-periodo` (Supabase).
2. La edge function resuelve el tope para cada persona: **obra → empresa →
   default 8h/4h** (`supabase/functions/liquidar-periodo/index.ts:699-764`).
   - La **obra** sale de la persona en Presencio (`persona.obra_id`, vía la
     vista `nom_v_personal`). La obra la ve/vive Presencio; Recursio solo lee.
   - La **jornada** (`jornada_horas`) se resuelve con la misma prioridad.
3. `calcularAsistencia` topea **por día** (`packages/motor/src/asistencia.ts:70-96`):
   el excedente sobre el tope queda fuera de las horas trabajadas del período.
4. Las horas trabajadas **ya topadas** alimentan:
   - el **básico por hora**, para los convenios que pagan por hora;
   - la **hora extra 50/100** (el recargo se calcula sobre horas dentro del tope);
   - la columna **Unidad/Horas** y el CSV de horas liquidadas
     (`horas_liquidadas = Math.ceil(horas_trabajadas)`).

## Qué topa y qué no

**Topa:**

- Horas **normales** y **extra** del día. Un día de 14 h con tope 12 cuenta 12 h
  para el básico y la extra se calcula sobre esas 12 h.
- Feriados y domingos trabajados: se topan igual que las horas normales.
- El excedente sobre el tope queda **directamente afuera** (ni normal ni extra):
  no se paga en silencio vía el básico.

**NO topa:**

- **Topes semanal / quincena / mes**: existen en la tabla `nom_config_obras`
  (columnas `tope_horas_semanales`, `tope_horas_quincena`, `tope_horas_mes`)
  pero hoy **no se aplican**. Están reservados para cuando haya un caso real que
  los necesite. Hoy solo se aplica el **diario**.
- El **básico de modalidad mensual/quincenal**: no depende de horas trabajadas,
  así que el tope no lo modifica.
- **Sin tope configurado** (`tope_horas_diarias` NULL u omitido): la persona se
  debe liquidar exactamente como siempre, sin ningún `Math.min` por medio.

## Cómo se ve

Al expandir la fila de una liquidación en **Liquidaciones**, el panel muestra
`Tope horas/día: X h` junto a la obra (`src/pages/LiquidacionPage.jsx:1020-1024`).

## Por qué "no funciona" (diagnóstico)

El cliente reportó que "cada vez que aplicamos el tope no se nota". Causas
posibles, en orden de probabilidad:

1. **El fix no estaba deployado.** El cambio del motor que topea las horas
   *trabajadas* (no solo la extra) estuvo en el working tree local sin
   commitear; si el deploy de la edge function `liquidar-periodo` usó una
   versión anterior, el tope "recortaba la extra pero el básico seguía pagando
   las horas completas". → Verificar el deploy history de la edge function.
2. **La persona no tiene obra asignada** en Presencio (`personal.obra_id`
   NULL): sin obra, se cae a config de empresa o al default, y el tope de la
   obra puntual no aplica. → Verificar en Presencio que `obra_id` esté cargado.
3. **El tope está configurado pero la jornada/empresa lo tapa**: revisar que la
   config de empresa no tenga otro valor con prioridad para esas personas.