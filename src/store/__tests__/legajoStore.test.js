import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFamiliarRow = {
  id: 'f2', empresa_id: 'empresa-1', personal_id: 'personal-1', vinculo: 'hijo',
  nombre: 'Tomás Pérez', cuil: null, fecha_nacimiento: '2015-03-10', doc_path: null,
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      data: null,
      error: null,
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockFamiliarRow, error: null }),
    })),
  },
}))

import { legajoFromDB, legajoToDB, familiarFromDB, sancionFromDB, adicionalLegajoFromDB, adicionalLegajoToDB, useLegajoStore } from '../legajoStore'

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

describe('legajoFromDB / legajoToDB — campos de baja (migracion 0018)', () => {
  it('legajoFromDB mapea fecha_baja, motivo_baja, localidad, provincia, codigo_postal', () => {
    const row = {
      id: 'l1', empresa_id: 'e1', personal_id: 'p1',
      fecha_baja: '2026-06-30', motivo_baja: 'renuncia',
      localidad: 'Merlo', provincia: 'Buenos Aires', codigo_postal: '1722',
    }
    const l = legajoFromDB(row)
    expect(l.fechaBaja).toBe('2026-06-30')
    expect(l.motivoBaja).toBe('renuncia')
    expect(l.localidad).toBe('Merlo')
    expect(l.provincia).toBe('Buenos Aires')
    expect(l.codigoPostal).toBe('1722')
  })

  it('legajoToDB mapea de vuelta esos mismos campos', () => {
    const row = legajoToDB({ personalId: 'p1', fechaBaja: '2026-06-30', motivoBaja: 'renuncia' }, 'e1')
    expect(row.fecha_baja).toBe('2026-06-30')
    expect(row.motivo_baja).toBe('renuncia')
  })
})

describe('useLegajoStore - familiares CRUD', () => {
  it('guardarFamiliar inserta un familiar nuevo (sin id)', async () => {
    const r = await useLegajoStore.getState().guardarFamiliar(
      { vinculo: 'hijo', nombre: 'Tomás Pérez', fechaNacimiento: '2015-03-10' },
      'personal-1', 'empresa-1'
    )
    expect(r.ok).toBe(true)
  })

  it('eliminarFamiliar borra por id y lo saca del estado', async () => {
    useLegajoStore.setState({ familiares: [{ id: 'f1', nombre: 'X' }] })
    const r = await useLegajoStore.getState().eliminarFamiliar('f1')
    expect(r.ok).toBe(true)
    expect(useLegajoStore.getState().familiares).toEqual([])
  })
})

describe('mappers de adicionales por legajo (migración 0040)', () => {
  it('adicionalLegajoFromDB mapea snake_case a camelCase', () => {
    const row = {
      id: 'al1', empresa_id: 'e1', legajo_id: 'l1', concepto_id: 'c1',
      modo: 'porcentaje', porcentaje: '10', monto: null,
      vigencia_desde: '2026-08-01', vigencia_hasta: null,
    }
    expect(adicionalLegajoFromDB(row)).toEqual({
      id: 'al1', empresaId: 'e1', legajoId: 'l1', conceptoId: 'c1',
      modo: 'porcentaje', porcentaje: 10, monto: null,
      vigenciaDesde: '2026-08-01', vigenciaHasta: null,
    })
  })

  it('adicionalLegajoToDB con modo porcentaje solo manda porcentaje (monto null)', () => {
    const row = adicionalLegajoToDB(
      { conceptoId: 'c1', modo: 'porcentaje', porcentaje: 10, vigenciaDesde: '2026-08-01' },
      'l1', 'e1'
    )
    expect(row).toEqual({
      empresa_id: 'e1', legajo_id: 'l1', concepto_id: 'c1', modo: 'porcentaje',
      porcentaje: 10, monto: null, vigencia_desde: '2026-08-01', vigencia_hasta: null,
    })
  })

  it('adicionalLegajoToDB con modo nominal solo manda monto (porcentaje null)', () => {
    const row = adicionalLegajoToDB(
      { conceptoId: 'c1', modo: 'nominal', monto: 45000, vigenciaDesde: '2026-08-01' },
      'l1', 'e1'
    )
    expect(row.monto).toBe(45000)
    expect(row.porcentaje).toBeNull()
  })
})

describe('useLegajoStore - adicionales por legajo CRUD', () => {
  it('guardarAdicionalLegajo inserta una asignación nueva', async () => {
    const r = await useLegajoStore.getState().guardarAdicionalLegajo(
      { conceptoId: 'c1', modo: 'heredado', vigenciaDesde: '2026-08-01' },
      'legajo-1', 'empresa-1'
    )
    expect(r.ok).toBe(true)
  })

  it('quitarAdicionalLegajo borra por id y lo saca del estado', async () => {
    useLegajoStore.setState({ adicionalesLegajo: [{ id: 'al1', conceptoId: 'c1' }] })
    const r = await useLegajoStore.getState().quitarAdicionalLegajo('al1')
    expect(r.ok).toBe(true)
    expect(useLegajoStore.getState().adicionalesLegajo).toEqual([])
  })
})

describe('useLegajoStore - sanciones CRUD', () => {
  it('guardarSancion inserta una sancion nueva', async () => {
    const r = await useLegajoStore.getState().guardarSancion(
      { tipo: 'apercibimiento', motivo: 'Llegada tarde reiterada', fecha: '2026-07-01' },
      'personal-1', 'empresa-1'
    )
    expect(r.ok).toBe(true)
  })

  it('eliminarSancion borra por id', async () => {
    useLegajoStore.setState({ sanciones: [{ id: 's1', motivo: 'X' }] })
    const r = await useLegajoStore.getState().eliminarSancion('s1')
    expect(r.ok).toBe(true)
    expect(useLegajoStore.getState().sanciones).toEqual([])
  })
})

describe('cargarLegajos — cache por empresa', () => {
  beforeEach(async () => {
    useLegajoStore.setState({ legajos: [], cargando: false, error: null, cargadoEmpresaId: null })
    const { supabase } = await import('../../lib/supabase')
    supabase.from.mockClear()
  })

  it('no vuelve a pedir a Supabase si ya cargó para la misma empresa', async () => {
    const { supabase } = await import('../../lib/supabase')
    supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }))

    await useLegajoStore.getState().cargarLegajos('empresa-1')
    await useLegajoStore.getState().cargarLegajos('empresa-1')

    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('SÍ vuelve a pedir si cambia la empresa', async () => {
    const { supabase } = await import('../../lib/supabase')
    supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }))

    await useLegajoStore.getState().cargarLegajos('empresa-1')
    await useLegajoStore.getState().cargarLegajos('empresa-2')

    expect(supabase.from).toHaveBeenCalledTimes(2)
  })

  it('vuelve a pedir si se pasa forzar: true aunque sea la misma empresa', async () => {
    const { supabase } = await import('../../lib/supabase')
    supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }))

    await useLegajoStore.getState().cargarLegajos('empresa-1')
    await useLegajoStore.getState().cargarLegajos('empresa-1', { forzar: true })

    expect(supabase.from).toHaveBeenCalledTimes(2)
  })
})
