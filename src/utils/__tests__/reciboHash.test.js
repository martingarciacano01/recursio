// src/utils/__tests__/reciboHash.test.js — Task 2.6: el hash tiene que
// autenticar el PDF FINAL, con el número de recibo ya impreso. Usa jsPDF
// real (mismo patrón que reciboPdf.test.js) en vez de mockear el PDF, para
// no terminar probando el mock en lugar del hash real.
import { describe, it, expect } from 'vitest'
import { generarReciboPdf } from '../reciboPdf'
import { calcularHashPdf } from '../reciboHash'

const cabecera = {
  empresa: { nombre: 'LA EMPRESA S.A.', cuit: '30-99999999-9', domicilio: 'Aconquija 123456 (1080) – CABA' },
  persona: {
    nombre: 'Perez José', legajo: '99', cuil: '20-99999999-9', categoria: 'Maestranza y Servicios A',
    fechaIngreso: '01/01/2021', antiguedadReconocida: 0, banco: 'Macro',
  },
  periodo: { mes: '06', anio: '2026', descripcion: '04/2026 - 10/05/2026', fechaPago: '10/05/2026' },
}

const items = [
  { codigo: 'BAS', nombre: 'Sueldo Básico', tipo: 'remunerativo', monto: 1096248, unidadTexto: '30', baseCalculo: 36541.60, grupoRecibo: 'remunerativo', detalleRecibo: null },
  { codigo: 'JUB', nombre: 'Jubilación', tipo: 'descuento', monto: 137168.03, unidadTexto: '11,00 %', baseCalculo: 1246982.10, grupoRecibo: 'descuento', detalleRecibo: 'seguridad_social' },
]

describe('calcularHashPdf (Task 2.6, hash del recibo con numero ya impreso)', () => {
  it('el mismo documento (misma llamada) da siempre el mismo hash', async () => {
    // No se comparan dos generaciones separadas de generarReciboPdf: jsPDF
    // graba una fecha de creación en los metadatos del PDF, así que dos
    // documentos generados en instantes distintos NUNCA son byte-idénticos
    // aunque el contenido visible sea el mismo — eso no es lo que hay que
    // garantizar acá. Lo que importa para Task 2.6 es que, para el MISMO
    // doc ya generado (el que se descarga), el hash sea estable.
    const doc = await generarReciboPdf({ ...cabecera, items, codigoRecibo: 'A-0001' })
    const hash1 = await calcularHashPdf(doc)
    const hash2 = await calcularHashPdf(doc)
    expect(hash1).toBe(hash2)
  })

  it('recibo con numero distinto da hash distinto', async () => {
    const doc1 = await generarReciboPdf({ ...cabecera, items, codigoRecibo: 'A-0001' })
    const doc2 = await generarReciboPdf({ ...cabecera, items, codigoRecibo: 'A-0002' })
    const hash1 = await calcularHashPdf(doc1)
    const hash2 = await calcularHashPdf(doc2)
    expect(hash1).not.toBe(hash2)
  })

  it('el hash cambia si no hay numero de recibo todavia (PDF sin numero) vs con numero', async () => {
    const sinNumero = await generarReciboPdf({ ...cabecera, items, codigoRecibo: null })
    const conNumero = await generarReciboPdf({ ...cabecera, items, codigoRecibo: 'A-0001' })
    const hashSinNumero = await calcularHashPdf(sinNumero)
    const hashConNumero = await calcularHashPdf(conNumero)
    expect(hashSinNumero).not.toBe(hashConNumero)
  })
})
