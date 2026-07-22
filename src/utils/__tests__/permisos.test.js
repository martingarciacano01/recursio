import { describe, it, expect } from 'vitest'
import { puede } from '../permisos'

describe('puede', () => {
  it('admin puede todo lo que hay en la matriz', () => {
    const roles = [{ rol: 'admin' }]
    expect(puede(roles, 'gestionar_usuarios')).toBe(true)
    expect(puede(roles, 'editar_configuracion')).toBe(true)
    expect(puede(roles, 'aprobar_pago')).toBe(true)
  })

  it('rrhh no puede gestionar usuarios ni aprobar', () => {
    const roles = [{ rol: 'rrhh' }]
    expect(puede(roles, 'calcular_liquidacion')).toBe(true)
    expect(puede(roles, 'gestionar_usuarios')).toBe(false)
    expect(puede(roles, 'aprobar')).toBe(false)
  })

  it('revisor_externo solo puede aprobar', () => {
    const roles = [{ rol: 'revisor_externo' }]
    expect(puede(roles, 'aprobar')).toBe(true)
    expect(puede(roles, 'ver_legajos')).toBe(false)
    expect(puede(roles, 'ver_liquidacion')).toBe(false)
  })

  it('consulta solo lee, nunca exporta ni edita', () => {
    const roles = [{ rol: 'consulta' }]
    expect(puede(roles, 'ver_legajos')).toBe(true)
    expect(puede(roles, 'ver_liquidacion')).toBe(true)
    expect(puede(roles, 'exportar')).toBe(false)
    expect(puede(roles, 'editar_legajos')).toBe(false)
  })

  it('usuario con varios roles obtiene la union de permisos', () => {
    const roles = [{ rol: 'rrhh' }, { rol: 'aprobador_pagos' }]
    expect(puede(roles, 'calcular_liquidacion')).toBe(true)
    expect(puede(roles, 'aprobar_pago')).toBe(true)
  })

  it('sin roles, no puede nada', () => {
    expect(puede([], 'ver_dashboard')).toBe(false)
    expect(puede(null, 'ver_dashboard')).toBe(false)
  })
})
