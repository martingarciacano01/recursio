// src/utils/__tests__/reciboLayout.test.js
import { describe, it, expect } from 'vitest'
import { armarRecibo } from '../reciboLayout'

const items = [
  // Contribuciones patronales
  { codigo: 'SIPA', nombre: 'SIPA – Ley 24.241', tipo: 'aporte_patronal', monto: 133545.68, unidadTexto: '10,77 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
  { codigo: 'OS_EMP', nombre: 'Obra social', tipo: 'aporte_patronal', monto: 83008.93, unidadTexto: '6,00 %', baseCalculo: 1383482.10, grupoRecibo: 'contribucion', detalleRecibo: 'obra_social' },
  // CCT-derivado
  { codigo: 'OSECAC', nombre: 'Contribución Solidaria OSECAC', tipo: 'aporte_patronal', monto: 28000, unidadTexto: '1', baseCalculo: 28000, grupoRecibo: 'cct', detalleRecibo: 'sindical' },
  // Remunerativo
  { codigo: 'BAS', nombre: 'Sueldo Básico', tipo: 'remunerativo', monto: 1096248, unidadTexto: '30', baseCalculo: 36541.60, grupoRecibo: 'remunerativo', detalleRecibo: null },
  // No remunerativo
  { codigo: 'INR', nombre: 'Incremento No Remunerativo', tipo: 'no_remunerativo', monto: 100000, unidadTexto: '30', baseCalculo: 3333.33, grupoRecibo: 'no_remunerativo', detalleRecibo: null },
  // Descuentos
  { codigo: 'JUB', nombre: 'Jubilación', tipo: 'descuento', monto: 137168.03, unidadTexto: '11,00 %', baseCalculo: 1246982.10, grupoRecibo: 'descuento', detalleRecibo: 'seguridad_social' },
  { codigo: 'OS_TRAB', nombre: 'Obra social', tipo: 'descuento', monto: 41504.46, unidadTexto: '3,00 %', baseCalculo: 1383482.10, grupoRecibo: 'descuento', detalleRecibo: 'obra_social' },
]

describe('armarRecibo', () => {
  const r = armarRecibo(items)

  it('agrupa contribuciones y derivados del CCT por separado', () => {
    expect(r.contribuciones.map((i) => i.codigo)).toEqual(['SIPA', 'OS_EMP'])
    expect(r.cct.map((i) => i.codigo)).toEqual(['OSECAC'])
  })

  it('subtotal de contribuciones = contribuciones + cct', () => {
    expect(r.subtotalContribuciones).toBeCloseTo(133545.68 + 83008.93 + 28000)
  })

  it('sueldo bruto = remunerativos + no remunerativos', () => {
    expect(r.totalRemunerativo).toBeCloseTo(1096248)
    expect(r.totalNoRemunerativo).toBeCloseTo(100000)
    expect(r.sueldoBruto).toBeCloseTo(1196248)
  })

  it('total descuentos y neto', () => {
    expect(r.totalDescuentos).toBeCloseTo(137168.03 + 41504.46)
    expect(r.sueldoNeto).toBeCloseTo(1196248 - (137168.03 + 41504.46))
  })

  it('costo total empleador = sueldo bruto + subtotal contribuciones', () => {
    expect(r.costoTotalEmpleador).toBeCloseTo(1196248 + 133545.68 + 83008.93 + 28000)
  })

  it('detalle por organismo separa Empleador (aporte_patronal) de Trabajador (descuento)', () => {
    const segSocial = r.detalle.find((d) => d.organismo === 'seguridad_social')
    expect(segSocial.empleador).toBeCloseTo(133545.68)
    expect(segSocial.trabajador).toBeCloseTo(137168.03)
    const obraSocial = r.detalle.find((d) => d.organismo === 'obra_social')
    expect(obraSocial.empleador).toBeCloseTo(83008.93)
    expect(obraSocial.trabajador).toBeCloseTo(41504.46)
    const sindical = r.detalle.find((d) => d.organismo === 'sindical')
    expect(sindical.empleador).toBeCloseTo(28000)
    expect(sindical.trabajador).toBeCloseTo(0)
  })

  it('torta: sueldo neto + una porción por organismo empleador', () => {
    const labels = r.torta.map((s) => s.label)
    expect(labels[0]).toBe('Sueldo Neto')
    expect(labels).toContain('Seguridad Social')
    const sumaTorta = r.torta.reduce((s, x) => s + x.valor, 0)
    expect(sumaTorta).toBeCloseTo(r.costoTotalEmpleador)
  })
})

// Task 4.5 (plan convenios-por-obra 2026-08-07): el bono no remunerativo se
// graba con grupoRecibo: null (motor.ts lo fuerza) — no debe aparecer en
// NINGUNA sección del recibo ni sumar a sueldoBruto/costoTotalEmpleador,
// aunque sí sume a bruto/neto de la liquidación (eso lo hace el motor, no
// reciboLayout — ver motor.test.ts).
describe('armarRecibo — bono no remunerativo (grupoRecibo null) no se imprime', () => {
  const itemsConBono = [
    ...items,
    { codigo: 'bono_x', nombre: 'Bono X', tipo: 'bono', monto: 50000, unidadTexto: null, baseCalculo: null, grupoRecibo: null, detalleRecibo: null },
  ]
  const r = armarRecibo(itemsConBono)
  const rSinBono = armarRecibo(items)

  it('el bono no aparece en ninguna sección', () => {
    expect(r.contribuciones.map((i) => i.codigo)).not.toContain('bono_x')
    expect(r.cct.map((i) => i.codigo)).not.toContain('bono_x')
    expect(r.remunerativos.map((i) => i.codigo)).not.toContain('bono_x')
    expect(r.noRemunerativos.map((i) => i.codigo)).not.toContain('bono_x')
    expect(r.descuentos.map((i) => i.codigo)).not.toContain('bono_x')
  })

  it('el bono no altera sueldoBruto/sueldoNeto/costoTotalEmpleador del recibo', () => {
    expect(r.sueldoBruto).toBeCloseTo(rSinBono.sueldoBruto)
    expect(r.sueldoNeto).toBeCloseTo(rSinBono.sueldoNeto)
    expect(r.costoTotalEmpleador).toBeCloseTo(rSinBono.costoTotalEmpleador)
  })
})

// Task 2.1 (plan 2026-08-11): los ítems en $0 no se imprimen en el recibo.
// Caso real: resta de quincena 1 en quincena 2 deja el ítem en $0 dentro de
// la lista (index.ts:838-850). Los ítems informativos se conservan aunque el
// monto sea 0 (ej. cantidad de horas sin monto).
describe('armarRecibo — ítems en $0 no se imprimen (Task 2.1)', () => {
  const itemsConCeros = [
    ...items,
    // Remunerativo reducido a $0 por la resta de Q1 (caso Q2 del cliente)
    { codigo: 'Q1', nombre: 'Adelanto Q1', tipo: 'remunerativo', monto: 0, unidadTexto: null, baseCalculo: null, grupoRecibo: 'remunerativo', detalleRecibo: null },
    // Descuento que evaluó en $0 (escala faltante, % con base $0)
    { codigo: 'EXTRA_0', nombre: 'Extra inexistente', tipo: 'descuento', monto: 0, unidadTexto: null, baseCalculo: null, grupoRecibo: 'descuento', detalleRecibo: 'sindical' },
    // Contribución en $0
    { codigo: 'SIPA_0', nombre: 'SIPA $0', tipo: 'aporte_patronal', monto: 0, unidadTexto: null, baseCalculo: null, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
    // Informativo en $0: se conserva (pero no tiene grupoRecibo, no se imprime solo)
    { codigo: 'HORAS', nombre: 'Horas', tipo: 'informativo', monto: 0, unidadTexto: '160', baseCalculo: null, grupoRecibo: null, detalleRecibo: null },
  ]
  const r = armarRecibo(itemsConCeros)
  const rSinCeros = armarRecibo(items)

  it('no aparecen en ninguna sección', () => {
    expect(r.remunerativos.map((i) => i.codigo)).not.toContain('Q1')
    expect(r.descuentos.map((i) => i.codigo)).not.toContain('EXTRA_0')
    expect(r.contribuciones.map((i) => i.codigo)).not.toContain('SIPA_0')
    expect(r.cct.map((i) => i.codigo)).not.toContain('Q1')
  })

  it('los totales del recibo no cambian (sumar $0 no altera nada)', () => {
    expect(r.sueldoBruto).toBeCloseTo(rSinCeros.sueldoBruto)
    expect(r.sueldoNeto).toBeCloseTo(rSinCeros.sueldoNeto)
    expect(r.subtotalContribuciones).toBeCloseTo(rSinCeros.subtotalContribuciones)
    expect(r.costoTotalEmpleador).toBeCloseTo(rSinCeros.costoTotalEmpleador)
    expect(r.detalle).toEqual(rSinCeros.detalle)
  })
})

// Task 2.2 (plan 2026-08-11): armarRecibo con arrays vacíos no rompe y deja
// secciones vacías detectables por reciboPdf.js (sub-encabezados condicionales).
describe('armarRecibo — con arrays vacíos (Task 2.2)', () => {
  const r = armarRecibo([])

  it('secciones vacías y totales en 0', () => {
    expect(r.contribuciones).toEqual([])
    expect(r.cct).toEqual([])
    expect(r.remunerativos).toEqual([])
    expect(r.noRemunerativos).toEqual([])
    expect(r.descuentos).toEqual([])
    expect(r.sueldoBruto).toBe(0)
    expect(r.totalDescuentos).toBe(0)
    expect(r.sueldoNeto).toBe(0)
    expect(r.subtotalContribuciones).toBe(0)
  })

  it('sin detalle de organismos ni torta (salvo Sueldo Neto)', () => {
    expect(r.detalle).toEqual([])
    expect(r.torta.map((s) => s.label)).toEqual(['Sueldo Neto'])
  })
})
