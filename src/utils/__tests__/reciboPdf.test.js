import { describe, it, expect } from 'vitest'
import { generarReciboPdf } from '../reciboPdf'

const datosFake = {
  empresa: { nombre: 'Asset Construcciones SA', cuit: '30-71823067-1', domicilio: 'Bauness 2047 4A - CABA' },
  persona: { nombre: 'García Cano, Juan Martín', cuil: '20-33901676-4', legajo: '47', categoria: 'Fuera de convenio', fechaIngreso: '1/7/2025' },
  periodo: { descripcion: 'Diciembre 2025' },
  items: [
    { nombre: 'Sueldo', tipo: 'remunerativo', monto: 2277447.03 },
    { nombre: 'Jubilación', tipo: 'descuento', monto: 250519.17 },
    { nombre: 'Ley 19.032', tipo: 'descuento', monto: 68323.41 },
    { nombre: 'Obra social', tipo: 'descuento', monto: 68323.41 },
  ],
  neto: 1890282.00,
}

describe('generarReciboPdf', () => {
  it('genera un documento con el nombre del empleado y el neto', () => {
    const doc = generarReciboPdf(datosFake)
    const texto = doc.internal.pages.map((p) => (Array.isArray(p) ? p.join(' ') : '')).join(' ')
    expect(texto).toContain('García Cano, Juan Martín')
    // El neto se formatea con toLocaleString('es-AR'), que usa punto como
    // separador de miles (ej. "1.890.282"), no el número plano.
    expect(texto).toContain((1890282).toLocaleString('es-AR'))
  })

  it('incluye los datos del empleador (CUIT)', () => {
    const doc = generarReciboPdf(datosFake)
    const texto = doc.internal.pages.map((p) => (Array.isArray(p) ? p.join(' ') : '')).join(' ')
    expect(texto).toContain('30-71823067-1')
  })

  it('genera la hoja en A4 apaisado (doble copia lado a lado)', () => {
    const doc = generarReciboPdf(datosFake)
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight())
  })

  it('no tira excepción sin logo, con items no_remunerativos/aporte_patronal y sin CUIT/domicilio de empresa', () => {
    expect(() => generarReciboPdf({
      ...datosFake,
      empresa: { nombre: 'Sin datos fiscales', cuit: null, domicilio: null, logoBase64: null },
      codigoRecibo: '0001',
      items: [
        ...datosFake.items,
        { nombre: 'Bono no remunerativo', tipo: 'no_remunerativo', monto: 50000, codigo: '0099' },
        { nombre: 'Contribución patronal', tipo: 'aporte_patronal', monto: 30000, codigo: '0088' },
      ],
    })).not.toThrow()
  })
})
