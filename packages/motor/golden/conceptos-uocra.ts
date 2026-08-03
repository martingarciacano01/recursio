// packages/motor/golden/conceptos-uocra.ts (Task 2.8)
// Set de conceptos del régimen UOCRA (Ley 22.250, CCT 76/75) tal como están
// sembrados en producción hoy (verificado contra nom_conceptos del convenio
// "UOCRA (Ley 22.250)" antes de escribir esta migración/fixture — ver
// migración 0049_conceptos_uocra.sql). Los descuentos (jubilación, ley
// 19.032, obra social) usan los mismos códigos/fórmulas que el set fuera de
// convenio (conceptos-fuera-convenio.ts) — no son específicos de UOCRA.
import type { Concepto } from '../src/motor'

export const CONCEPTOS_UOCRA: Concepto[] = [
  // Formula real de 0031_seed_conceptos_base.sql: 'basico_periodo' (el
  // básico YA resuelto según la modalidad del legajo por
  // calcularBasicoPeriodo/basico.ts), no 'basico_convenio' (que es el
  // valor CRUDO de la escala — para modalidad 'hora' es el valor de una
  // hora, para 'mensual'/'quincenal' es el sueldo mensual/quincenal
  // pactado). Iba mal en este archivo golden (no en producción).
  { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', orden: 1, formula: 'basico_periodo', imprimible: true },
  {
    // Bug reportado en un recibo real, dos partes:
    // 1) BASE/UNIDAD mostraban el % de config y el básico completo en vez
    //    del valor de UNA hora recargada y la cantidad de horas extra
    //    (redondeada hacia arriba) — fix con recibo.baseFormula/
    //    unidadFormula (mismo mecanismo que ya usa el básico por hora).
    // 2) La fórmula dividía `basico_convenio / 200`, asumiendo que
    //    basico_convenio es SIEMPRE un sueldo mensual (convención LCT:
    //    mensual/200 = valor hora). Para categorías con modalidad 'hora'
    //    (el caso típico jornalizado UOCRA, ej. "Ayudante" $4.948),
    //    basico_convenio YA ES el valor de una hora — dividir por 200 lo
    //    achicaba ~200 veces. Se usa basico_convenio directo, sin dividir.
    //    Para modalidad 'mensual'/'quincenal' (ej. "Sereno" $898.817/mes)
    //    esto queda pendiente de validar con el contador — no hay hoy un
    //    valorHora resuelto para esas modalidades (basico.ts,
    //    calcularBasicoPeriodo devuelve valorHora=0) — ver
    //    docs/VALIDACION-CONTADOR.md.
    codigo: 'hs_feriado', nombre: 'Recargo feriado', tipo: 'remunerativo', orden: 15,
    formula: 'basico_convenio * horas_feriado', imprimible: true,
    config: {
      modo: 'porcentaje', porcentaje: 100, base: 'basico',
      recibo: { grupo: 'remunerativo', detalle: null, baseFormula: 'basico_convenio', unidadFormula: 'ceil(horas_feriado)' },
    },
  },
  {
    codigo: 'hora_extra_50', nombre: 'Hora extra 50%', tipo: 'remunerativo', orden: 16,
    formula: 'basico_convenio * 1.5 * horas_extra_50', imprimible: true,
    config: {
      modo: 'porcentaje', porcentaje: 150, base: 'basico',
      recibo: { grupo: 'remunerativo', detalle: null, baseFormula: 'basico_convenio * 1.5', unidadFormula: 'ceil(horas_extra_50)' },
    },
  },
  {
    codigo: 'hora_extra_100', nombre: 'Hora extra 100%', tipo: 'remunerativo', orden: 17,
    formula: 'basico_convenio * 2 * horas_extra_100', imprimible: true,
    config: {
      modo: 'porcentaje', porcentaje: 200, base: 'basico',
      recibo: { grupo: 'remunerativo', detalle: null, baseFormula: 'basico_convenio * 2', unidadFormula: 'ceil(horas_extra_100)' },
    },
  },
  {
    codigo: 'presentismo', nombre: 'Presentismo', tipo: 'remunerativo', orden: 18,
    formula: 'remunerativo_acumulado * 0.20', imprimible: true,
    config: { modo: 'porcentaje', porcentaje: 20, base: 'remunerativo', recibo: { grupo: 'remunerativo', detalle: null } },
  },
  { codigo: 'jubilacion', nombre: 'Jubilación', tipo: 'descuento', orden: 100, formula: 'min(remunerativo_acumulado, tope_sipa) * 0.11', imprimible: true },
  { codigo: 'ley_19032', nombre: 'Ley 19.032 (INSSJP/PAMI)', tipo: 'descuento', orden: 101, formula: 'remunerativo_acumulado * 0.03', imprimible: true },
  { codigo: 'obra_social', nombre: 'Obra social', tipo: 'descuento', orden: 102, formula: '(remunerativo_acumulado + no_remunerativo_acumulado) * 0.03', imprimible: true },
]

// Variante con tope SIPA consolidado por mes (Task 2.3): jubilación y
// ley_19032 usan la base 'acumulado_mensual' (remunerativo_acumulado +
// remunerativo_quincena1), igual que la migración 0047.
export const CONCEPTOS_UOCRA_TOPE_MENSUAL: Concepto[] = CONCEPTOS_UOCRA.map((c) => {
  if (c.codigo === 'jubilacion') return { ...c, formula: 'min(remunerativo_acumulado + remunerativo_quincena1, tope_sipa) * 0.11' }
  if (c.codigo === 'ley_19032') return { ...c, formula: 'min(remunerativo_acumulado + remunerativo_quincena1, tope_sipa) * 0.03' }
  return c
})
