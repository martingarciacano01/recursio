import { describe, it, expect, vi } from 'vitest'
import { validarYGenerarFormula } from '../FormularioConcepto'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import FormularioConcepto from '../FormularioConcepto'

describe('validarYGenerarFormula', () => {
  it('devuelve la fórmula para un config válido', () => {
    const r = validarYGenerarFormula({ modo: 'porcentaje', porcentaje: 11, base: 'remunerativo', tope: 'tope_sipa' })
    expect(r).toEqual({ ok: true, formula: 'min(remunerativo_acumulado, tope_sipa) * 0.11' })
  })
  it('devuelve error para un config inválido', () => {
    const r = validarYGenerarFormula({ modo: 'porcentaje', base: 'remunerativo' })
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})

describe('FormularioConcepto — grupos de recibo', () => {
  it('guarda config.recibo.grupo y config.recibo.detalle', async () => {
    const onGuardar = vi.fn().mockResolvedValue({ ok: true })
    render(<FormularioConcepto concepto={null} categorias={null} conMonto={false} onGuardar={onGuardar} />)
    fireEvent.change(screen.getByLabelText('Sección del recibo'), { target: { value: 'descuento' } })
    fireEvent.change(screen.getByLabelText('Organismo (detalle inferior)'), { target: { value: 'seguridad_social' } })
    fireEvent.change(screen.getByPlaceholderText('%'), { target: { value: '11' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(onGuardar).toHaveBeenCalled())
    const arg = onGuardar.mock.calls.at(-1)[0]
    expect(arg.config.recibo.grupo).toBe('descuento')
    expect(arg.config.recibo.detalle).toBe('seguridad_social')
  })
})
