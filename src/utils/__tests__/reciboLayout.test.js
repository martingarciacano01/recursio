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
