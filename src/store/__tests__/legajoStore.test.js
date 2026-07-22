import { describe, it, expect, vi, beforeEach } from 'vitest'
import { legajoFromDB, legajoToDB, familiarFromDB, sancionFromDB } from '../legajoStore'

describe('mappers de legajo', () => {
  it('legajoFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'l1', empresa_id: 'e1', personal_id: 'p1', cuil: '20-1-9', fecha_nacimiento: '1990-01-01', domicilio: 'Calle 1', fecha_ingreso: '2020-01-01', convenio_id: 'c1', categoria_id: 'cat1', cbu: '0000', banco: 'BNA', obra_social: 'OSDE', jornada: 'completa' }
    expect(legajoFromDB(row)).toEqual({
      id: 'l1', empresaId: 'e1', personalId: 'p1', cuil: '20-1-9',
      fechaNacimiento: '1990-01-01', domicilio: 'Calle 1', fechaIngreso: '2020-01-01',
      convenioId: 'c1', categoriaId: 'cat1', cbu: '0000', banco: 'BNA',
      obraSocial: 'OSDE', jornada: 'completa',
      fueraConvenio: false, sueldoConvenido: undefined,
    })
  })

  it('legajoToDB mapea camelCase a snake_case incluyendo empresa_id', () => {
    const legajo = { personalId: 'p1', cuil: '20-1-9', cbu: '0000', convenioId: 'c1', categoriaId: 'cat1' }
    expect(legajoToDB(legajo, 'e1')).toEqual({
      empresa_id: 'e1', personal_id: 'p1', cuil: '20-1-9', cbu: '0000',
      convenio_id: 'c1', categoria_id: 'cat1',
    })
  })

  it('familiarFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'f1', empresa_id: 'e1', personal_id: 'p1', vinculo: 'hijo', nombre: 'Juan', cuil: null, fecha_nacimiento: '2015-01-01', doc_path: null }
    expect(familiarFromDB(row)).toEqual({
      id: 'f1', empresaId: 'e1', personalId: 'p1', vinculo: 'hijo',
      nombre: 'Juan', cuil: null, fechaNacimiento: '2015-01-01', docPath: null,
    })
  })

  it('sancionFromDB mapea snake_case a camelCase', () => {
    const row = { id: 's1', empresa_id: 'e1', personal_id: 'p1', tipo: 'suspension', motivo: 'llegadas tarde', fecha: '2026-01-01', dias_suspension: 3, doc_path: null }
    expect(sancionFromDB(row)).toEqual({
      id: 's1', empresaId: 'e1', personalId: 'p1', tipo: 'suspension',
      motivo: 'llegadas tarde', fecha: '2026-01-01', diasSuspension: 3, docPath: null,
    })
  })
})
