import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generarZipRecibos, nombreArchivoZip } from '../reciboZip'

// Fake JSZip mínimo: solo lo que reciboZip.js usa (file() y generateAsync()).
class FakeJSZip {
  constructor() { this.archivos = {} }
  file(nombre, contenido) { this.archivos[nombre] = contenido }
  async generateAsync() { return { tipo: 'blob-fake', archivos: this.archivos } }
}

vi.mock('../cargarJsZip', () => ({ cargarJsZip: () => Promise.resolve(FakeJSZip) }))

vi.mock('../emitirReciboLegajo', () => ({
  cargarDatosEmpresa: vi.fn().mockResolvedValue({ nombre: 'Asset', cuit: '30-1-9', domicilio: 'X', logo: null }),
  generarYDescargarRecibo: vi.fn(async ({ personalId }) => ({
    doc: { output: () => `pdf-bytes-${personalId}` },
    hash: `hash-${personalId}`,
    nombreArchivo: `recibo-${personalId}`,
  })),
}))

import { cargarDatosEmpresa, generarYDescargarRecibo } from '../emitirReciboLegajo'

const personalPorId = new Map([
  ['p1', 'Juan Pérez'],
  ['p2', 'Ana Gómez'],
  ['p3', 'Luis Ríos'],
])

const periodo = { tipo: 'mensual', fecha_desde: '2026-07-01' }

describe('generarZipRecibos', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('emite y agrega al zip cada liquidación, en orden secuencial', async () => {
    const orden = []
    const emitirRecibo = vi.fn(async (liquidacionId) => {
      orden.push(liquidacionId)
      return { ok: true, numeroRecibo: `000${orden.length}` }
    })
    const fetchItems = vi.fn().mockResolvedValue([{ concepto_codigo: 'basico', monto: 1000 }])

    const liquidaciones = [
      { id: 'liq1', personalId: 'p1', numeroRecibo: null },
      { id: 'liq2', personalId: 'p2', numeroRecibo: null },
      { id: 'liq3', personalId: 'p3', numeroRecibo: null },
    ]

    const r = await generarZipRecibos({
      liquidaciones, empresaId: 'e1', periodo, personalPorId, fetchItems, emitirRecibo,
    })

    expect(cargarDatosEmpresa).toHaveBeenCalledTimes(1) // una sola vez, no por persona
    expect(cargarDatosEmpresa).toHaveBeenCalledWith('e1')
    expect(orden).toEqual(['liq1', 'liq2', 'liq3']) // secuencial, no Promise.all
    expect(r.emitidos).toHaveLength(3)
    expect(r.fallidos).toHaveLength(0)
    // Mismo regex de slug que ya usa emitirReciboLegajo.js (`[^\w.-]` es
    // ASCII-only): los acentos también se reemplazan, no solo espacios.
    // Fase 7 Task 7.5: por defecto variante empleador → sufijo -empleador.
    expect(Object.keys(r.blob.archivos)).toEqual([
      'recibo-0001-Juan_P_rez-empleador.pdf', 'recibo-0002-Ana_G_mez-empleador.pdf', 'recibo-0003-Luis_R_os-empleador.pdf',
    ])
  })

  it('una falla en el medio no corta el lote: sigue con el resto y la reporta', async () => {
    const emitirRecibo = vi.fn(async (liquidacionId) => {
      if (liquidacionId === 'liq2') return { ok: false, error: 'legajo incompleto' }
      return { ok: true, numeroRecibo: '0001' }
    })
    const fetchItems = vi.fn().mockResolvedValue([])

    const liquidaciones = [
      { id: 'liq1', personalId: 'p1', numeroRecibo: null },
      { id: 'liq2', personalId: 'p2', numeroRecibo: null },
      { id: 'liq3', personalId: 'p3', numeroRecibo: null },
    ]

    const r = await generarZipRecibos({ liquidaciones, empresaId: 'e1', periodo, personalPorId, fetchItems, emitirRecibo })

    expect(r.emitidos.map((e) => e.personalId)).toEqual(['p1', 'p3'])
    expect(r.fallidos).toEqual([{ personalId: 'p2', nombre: 'Ana Gómez', error: 'legajo incompleto' }])
    // el zip solo tiene los 2 que sí se emitieron
    expect(Object.keys(r.blob.archivos)).toHaveLength(2)
  })

  it('una excepción al generar el PDF de una persona tampoco corta el lote', async () => {
    generarYDescargarRecibo.mockImplementationOnce(async () => { throw new Error('logo corrupto') })
    const emitirRecibo = vi.fn().mockResolvedValue({ ok: true, numeroRecibo: '0001' })
    const fetchItems = vi.fn().mockResolvedValue([])

    const liquidaciones = [
      { id: 'liq1', personalId: 'p1', numeroRecibo: null },
      { id: 'liq2', personalId: 'p2', numeroRecibo: null },
    ]
    const r = await generarZipRecibos({ liquidaciones, empresaId: 'e1', periodo, personalPorId, fetchItems, emitirRecibo })

    expect(r.fallidos).toEqual([{ personalId: 'p1', nombre: 'Juan Pérez', error: 'logo corrupto' }])
    expect(r.emitidos.map((e) => e.personalId)).toEqual(['p2'])
  })

  it('no emite dos veces la misma liquidación (una sola llamada a emitirRecibo por liquidación)', async () => {
    const emitirRecibo = vi.fn().mockResolvedValue({ ok: true, numeroRecibo: '0001' })
    const fetchItems = vi.fn().mockResolvedValue([])
    const liquidaciones = [{ id: 'liq1', personalId: 'p1', numeroRecibo: null }]
    await generarZipRecibos({ liquidaciones, empresaId: 'e1', periodo, personalPorId, fetchItems, emitirRecibo })
    expect(emitirRecibo).toHaveBeenCalledTimes(1)
    expect(emitirRecibo).toHaveBeenCalledWith('liq1', 'hash-p1')
  })

  it('reporta progreso persona por persona vía onProgreso', async () => {
    const emitirRecibo = vi.fn().mockResolvedValue({ ok: true, numeroRecibo: '0001' })
    const fetchItems = vi.fn().mockResolvedValue([])
    const liquidaciones = [
      { id: 'liq1', personalId: 'p1', numeroRecibo: null },
      { id: 'liq2', personalId: 'p2', numeroRecibo: null },
    ]
    const progresos = []
    await generarZipRecibos({
      liquidaciones, empresaId: 'e1', periodo, personalPorId, fetchItems, emitirRecibo,
      onProgreso: (procesados, total) => progresos.push([procesados, total]),
    })
    expect(progresos).toEqual([[1, 2], [2, 2]])
  })

  it('variante empleado propaga variante+firma a generarYDescargarRecibo y sufija -empleado', async () => {
    const emitirRecibo = vi.fn().mockResolvedValue({ ok: true, numeroRecibo: '0001' })
    const fetchItems = vi.fn().mockResolvedValue([])
    const firma = { dataUrl: 'data:image/png;base64,X=', ancho: 40, alto: 20, formato: 'PNG', nombreCompleto: 'M Lopez', puesto: 'Contadora' }
    const liquidaciones = [{ id: 'liq1', personalId: 'p1', numeroRecibo: null }]

    const r = await generarZipRecibos({
      liquidaciones, empresaId: 'e1', periodo, personalPorId, fetchItems, emitirRecibo,
      variante: 'empleado', firma,
    })

    expect(generarYDescargarRecibo).toHaveBeenCalledWith(expect.objectContaining({ variante: 'empleado', firma }))
    expect(Object.keys(r.blob.archivos)).toEqual(['recibo-0001-Juan_P_rez-empleado.pdf'])
  })
})

describe('nombreArchivoZip', () => {
  it('arma el nombre con tipo y fecha_desde del período', () => {
    expect(nombreArchivoZip({ tipo: 'mensual', fecha_desde: '2026-07-01' })).toBe('recibos-mensual-2026-07-01-empleador.zip')
  })
  it('con período null no revienta', () => {
    expect(nombreArchivoZip(null)).toBe('recibos-periodo--empleador.zip')
  })
  it('sufija -empleado para la variante empleado (Fase 7 Task 7.5)', () => {
    expect(nombreArchivoZip({ tipo: 'quincenal', fecha_desde: '2026-07-01' }, 'empleado')).toBe('recibos-quincenal-2026-07-01-empleado.zip')
  })
})
