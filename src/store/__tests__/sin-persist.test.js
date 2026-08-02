// src/store/__tests__/sin-persist.test.js
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Los stores de nómina tienen sueldos, CUIL y CBU en memoria. Persistirlos
// en localStorage los dejaría legibles por cualquier script del navegador
// y sobrevivirían al logout (Fase 1, Task 1.6).
describe('stores sin persist', () => {
  it('ningun store importa el middleware persist de zustand', () => {
    const dir = join(process.cwd(), 'src/store')
    const infractores = readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => /from\s+['"]zustand\/middleware['"]/.test(readFileSync(join(dir, f), 'utf8')))
    expect(infractores).toEqual([])
  })
})
