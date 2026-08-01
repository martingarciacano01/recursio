// src/utils/__tests__/reciboPdf.test.js
import { describe, it, expect } from 'vitest'
import { generarReciboPdf } from '../reciboPdf'

const cabecera = {
  empresa: { nombre: 'LA EMPRESA S.A.', cuit: '30-99999999-9', domicilio: 'Aconquija 123456 (1080) – CABA' },
  persona: {
    nombre: 'Perez José', legajo: '99', cuil: '20-99999999-9', categoria: 'Maestranza y Servicios A',
    fechaIngreso: '01/01/2021', antiguedadReconocida: 0, banco: 'Macro',
  },
  periodo: { mes: '06', anio: '2026', descripcion: '04/2026 - 10/05/2026', fechaPago: '10/05/2026' },
  codigoRecibo: 'A-0001',
}

const items = [
  { codigo: 'SIPA', nombre: 'SIPA – Ley 24.241', tipo: 'aporte_patronal', monto: 133545.68, unidadTexto: '10,77 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
  { codigo: 'OSECAC', nombre: 'Contribución Solidaria OSECAC', tipo: 'aporte_patronal', monto: 28000, unidadTexto: '1', baseCalculo: 28000, grupoRecibo: 'cct', detalleRecibo: 'sindical' },
  { codigo: 'BAS', nombre: 'Sueldo Básico', tipo: 'remunerativo', monto: 1096248, unidadTexto: '30', baseCalculo: 36541.60, grupoRecibo: 'remunerativo', detalleRecibo: null },
  { codigo: 'INR', nombre: 'Incremento No Remunerativo', tipo: 'no_remunerativo', monto: 100000, unidadTexto: '30', baseCalculo: 3333.33, grupoRecibo: 'no_remunerativo', detalleRecibo: null },
  { codigo: 'JUB', nombre: 'Jubilación', tipo: 'descuento', monto: 137168.03, unidadTexto: '11,00 %', baseCalculo: 1246982.10, grupoRecibo: 'descuento', detalleRecibo: 'seguridad_social' },
]

// Extrae todo el texto dibujado del stream del PDF. Es el MISMO patrón que
// ya usan los tests previos de este archivo (doc.internal.pages) — probado y
// funcionando en el repo; no inventar otro método.
const textoDe = (doc) => doc.internal.pages.map((p) => (Array.isArray(p) ? p.join(' ') : '')).join(' ')

// generarReciboPdf es async desde que jsPDF se carga con import() dinámico
// (src/utils/cargarJsPDF.js), de ahí los await.
describe('generarReciboPdf (formato costo laboral vertical)', () => {
  it('devuelve un jsPDF en A4 vertical', async () => {
    const doc = await generarReciboPdf({ ...cabecera, items })
    expect(doc).toBeTruthy()
    expect(doc.internal.pageSize.getWidth()).toBeLessThan(doc.internal.pageSize.getHeight()) // portrait
  })

  it('no lanza con items vacíos', async () => {
    await expect(generarReciboPdf({ ...cabecera, items: [] })).resolves.toBeTruthy()
  })

  it('escribe los títulos de sección del modelo', async () => {
    const doc = await generarReciboPdf({ ...cabecera, items })
    const texto = textoDe(doc)
    // Substrings SOLO ASCII: los acentos se codifican distinto en el stream.
    expect(texto).toContain('COSTO TOTAL EMPLEADOR')
    expect(texto).toContain('DERIVADO DEL CCT')
    expect(texto).toContain('SUELDO BRUTO')
    expect(texto).toContain('SUELDO NETO')
    expect(texto).toContain('Detalle de la')
  })

  it('incluye el nombre de la empresa y del empleado', async () => {
    const doc = await generarReciboPdf({ ...cabecera, items })
    const texto = textoDe(doc)
    expect(texto).toContain('LA EMPRESA S.A.')
    expect(texto).toContain('Perez')
  })
})
