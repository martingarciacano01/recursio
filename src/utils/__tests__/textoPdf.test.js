// src/utils/__tests__/textoPdf.test.js
import { describe, it, expect } from 'vitest'
import { ajustarTexto, textoEnPunto } from '../textoPdf'

// Task 3.1 (plan 2026-08-11): los textos largos pisaban las columnas del
// recibo porque se dibujaban con x fijas. aca se trunca con '…' usando un
// doc stub (ajustarTexto es puro; textoEnPunto solo delega en doc.text).
function stubDoc() {
  // getTextWidth aproxima 1 por caracter, como un monoespaciado 7.5pt.
  return {
    getTextWidth: (t) => t.length,
    text: (t, x, y, opts) => ({ t, x, y, opts }),
  }
}

describe('ajustarTexto', () => {
  it('texto corto no se toca', () => {
    expect(ajustarTexto(stubDoc(), 'Sueldo', 10)).toBe('Sueldo')
  })

  it('trunca con … hasta que entre en anchoMax', () => {
    const salida = ajustarTexto(stubDoc(), 'Adicional por zona desfavorable', 12)
    expect(salida.endsWith('…')).toBe(true)
    expect(salida.length).toBeLessThanOrEqual(12)
    expect(salida.length).toBeGreaterThan(2)
  })

  it('anchoMax pequeñísimo devuelve solo …', () => {
    const salida = ajustarTexto(stubDoc(), 'Hola mundo', 1)
    expect(salida).toBe('…')
  })

  it('anchoMax exacto no trunca', () => {
    expect(ajustarTexto(stubDoc(), '12345', 5)).toBe('12345')
  })
})

describe('textoEnPunto', () => {
  it('dibuja el texto en la posición con el texto ya ajustado', () => {
    const doc = stubDoc()
    const llamado = textoEnPunto(doc, 'Adicional por zona desfavorable transferencia', 20, 40, 12)
    expect(llamado.x).toBe(20)
    expect(llamado.y).toBe(40)
    expect(llamado.t.endsWith('…')).toBe(true)
    expect(llamado.t.length).toBeLessThanOrEqual(12)
  })

  it('texto corto llega intacto y propaga opts', () => {
    const doc = stubDoc()
    const llamado = textoEnPunto(doc, 'Basico', 6, 8, 20, { align: 'right' })
    expect(llamado.t).toBe('Basico')
    expect(llamado.opts).toEqual({ align: 'right' })
  })
})