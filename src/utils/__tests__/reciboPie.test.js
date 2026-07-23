// src/utils/__tests__/reciboPie.test.js
import { describe, it, expect, vi } from 'vitest'
import { dibujarTorta } from '../reciboPie'

function docFake() {
  return {
    triangle: vi.fn(),
    setFillColor: vi.fn(),
    setDrawColor: vi.fn(),
    circle: vi.fn(),
    rect: vi.fn(),
    setFontSize: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
  }
}

describe('dibujarTorta', () => {
  it('no dibuja nada si el total es 0', () => {
    const doc = docFake()
    dibujarTorta(doc, { cx: 100, cy: 100, radio: 20, porciones: [{ label: 'X', valor: 0 }] })
    expect(doc.triangle).not.toHaveBeenCalled()
  })

  it('dibuja triángulos para porciones con valor > 0', () => {
    const doc = docFake()
    dibujarTorta(doc, {
      cx: 100, cy: 100, radio: 20,
      porciones: [{ label: 'A', valor: 60 }, { label: 'B', valor: 40 }],
    })
    expect(doc.triangle).toHaveBeenCalled()
    // leyenda: un rectángulo de color + un text por porción
    expect(doc.text).toHaveBeenCalled()
  })
})
