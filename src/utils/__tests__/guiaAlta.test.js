import { describe, it, expect } from 'vitest'
import { pasosGuiaAlta, resumenGuia } from '../guiaAlta'

const requeridos = [
  { id: 'r1', nombre: 'DNI', obligatorio: true },
  { id: 'r2', nombre: 'Alta temprana AFIP', obligatorio: true },
  { id: 'r3', nombre: 'Título', obligatorio: false },
]

const legajoCompleto = {
  cuil: '20-1-9', cbu: '000', banco: 'BNA', obraSocial: 'OSDE', jornada: 'completa',
  convenioId: 'c1', categoriaId: 'cat1',
  localidad: 'CABA', provincia: 'CABA', codigoPostal: '1080',
}

const buscar = (pasos, idPaso) => pasos.find((p) => p.id === idPaso)
const item = (pasos, idPaso, idItem) => buscar(pasos, idPaso).items.find((i) => i.id === idItem)

describe('pasosGuiaAlta', () => {
  it('marca CUIL y CBU como obligatorios y pendientes en un legajo vacío', () => {
    const pasos = pasosGuiaAlta({ legajo: null })
    expect(item(pasos, 'identificacion', 'cuil')).toMatchObject({ obligatorio: true, ok: false })
    expect(item(pasos, 'identificacion', 'cbu')).toMatchObject({ obligatorio: true, ok: false })
  })

  it('un legajo de convenio exige convenio y categoría, no sueldo convenido', () => {
    const pasos = pasosGuiaAlta({ legajo: { fueraConvenio: false } })
    const ids = buscar(pasos, 'remuneracion').items.map((i) => i.id)
    expect(ids).toEqual(['convenio', 'categoria'])
  })

  it('un legajo fuera de convenio exige el sueldo convenido en su lugar', () => {
    const pasos = pasosGuiaAlta({ legajo: { fueraConvenio: true, sueldoConvenido: 500000 } })
    const paso = buscar(pasos, 'remuneracion')
    expect(paso.items.map((i) => i.id)).toEqual(['sueldoConvenido'])
    expect(paso.listo).toBe(true)
  })

  it('la documentación sale de lo configurado y respeta si es obligatoria', () => {
    const pasos = pasosGuiaAlta({ legajo: legajoCompleto, requeridos, documentos: [{ requeridoId: 'r1' }] })
    const doc = buscar(pasos, 'documentacion')
    expect(doc.items).toHaveLength(3)
    expect(doc.items.find((i) => i.label === 'DNI').ok).toBe(true)
    expect(doc.items.find((i) => i.label === 'Alta temprana AFIP')).toMatchObject({ ok: false, obligatorio: true })
    expect(doc.items.find((i) => i.label === 'Título')).toMatchObject({ ok: false, obligatorio: false })
    expect(doc.listo).toBe(false)
  })

  it('sin documentación configurada el paso queda listo y lo explica', () => {
    const doc = buscar(pasosGuiaAlta({ legajo: legajoCompleto, requeridos: [] }), 'documentacion')
    expect(doc.listo).toBe(true)
    expect(doc.descripcion).toMatch(/Configuración/)
  })

  it('los familiares nunca son obligatorios', () => {
    const paso = buscar(pasosGuiaAlta({ legajo: legajoCompleto, familiares: [] }), 'familiares')
    expect(paso.items.every((i) => !i.obligatorio)).toBe(true)
    expect(paso.listo).toBe(true)
  })

  it('cada paso informa cuántos ítems tiene completos', () => {
    const paso = buscar(pasosGuiaAlta({ legajo: { cuil: '20-1-9' } }), 'identificacion')
    expect(paso.total).toBe(5)
    expect(paso.completos).toBe(1)
    expect(paso.pendientesObligatorios).toBe(1) // falta el CBU
  })

  it('el paso de domicilio incluye dirección, teléfono y correo como opcionales', () => {
    const pasos = pasosGuiaAlta({ legajo: { domicilio: 'Calle 1', telefono: '+54 9 11', email: 'a@b.com' } })
    const dom = buscar(pasos, 'domicilio')
    expect(dom.items.find((i) => i.id === 'domicilio')).toMatchObject({ obligatorio: false, ok: true, label: 'Dirección' })
    expect(dom.items.find((i) => i.id === 'telefono')).toMatchObject({ obligatorio: false, ok: true, label: 'Teléfono' })
    expect(dom.items.find((i) => i.id === 'email')).toMatchObject({ obligatorio: false, ok: true, label: 'Correo electrónico' })
  })
})

describe('resumenGuia', () => {
  it('un legajo vacío arranca en 0% y no está completo', () => {
    const r = resumenGuia(pasosGuiaAlta({ legajo: null, requeridos }))
    expect(r.completo).toBe(false)
    expect(r.porcentaje).toBe(0)
    expect(r.nombresPendientes).toContain('CUIL')
    expect(r.nombresPendientes).toContain('Alta temprana AFIP')
  })

  it('con todo lo obligatorio cargado llega a 100% aunque falten opcionales', () => {
    const pasos = pasosGuiaAlta({
      legajo: legajoCompleto,
      requeridos,
      documentos: [{ requeridoId: 'r1' }, { requeridoId: 'r2' }],
    })
    const r = resumenGuia(pasos)
    expect(r.completo).toBe(true)
    expect(r.porcentaje).toBe(100)
    expect(r.nombresPendientes).toEqual([])
  })

  it('el porcentaje refleja el avance parcial sobre los obligatorios', () => {
    const r = resumenGuia(pasosGuiaAlta({ legajo: { cuil: '20-1-9', cbu: '000', fueraConvenio: true } }))
    // 3 obligatorios (cuil, cbu, sueldo convenido), 2 hechos
    expect(r.obligatorios).toBe(3)
    expect(r.porcentaje).toBe(67)
  })
})
