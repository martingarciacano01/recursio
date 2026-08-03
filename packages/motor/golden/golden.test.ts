// packages/motor/golden/golden.test.ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { liquidarConceptos } from '../src/motor'
import { CONCEPTOS_FUERA_CONVENIO, CONCEPTOS_SOLO_BASICO_Y_DEDUCCIONES } from './conceptos-fuera-convenio'
import { CONCEPTOS_UOCRA, CONCEPTOS_UOCRA_TOPE_MENSUAL } from './conceptos-uocra'

const dirFixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const archivos = readdirSync(dirFixtures).filter((f) => f.endsWith('.json')).sort()

describe('casos dorados — fuera de convenio y UOCRA', () => {
  it('hay al menos 10 fixtures', () => {
    expect(archivos.length).toBeGreaterThanOrEqual(10)
  })

  for (const archivo of archivos) {
    const fixture = JSON.parse(readFileSync(join(dirFixtures, archivo), 'utf-8'))
    it(`${archivo} — ${fixture.descripcion}`, () => {
      // Los 3 fixtures reales (recibos de Asset) liquidan un único concepto
      // remunerativo por recibo (SAC, Vacaciones, o Sueldo del mes) sin
      // desglose de presentismo/horas extra — usar el set reducido de
      // conceptos para no sumarles presentismo indebidamente. Los fixtures
      // sintéticos "fuera de convenio" usan el set completo LCT genérico.
      // Los fixtures UOCRA (Task 2.8, regimen: "22250") usan el set de
      // conceptos real de ese convenio (CONCEPTOS_UOCRA) — o su variante
      // con tope SIPA consolidado por mes (Task 2.3) cuando el fixture
      // marca consolidadoMensual: true.
      let conceptos
      if (fixture.regimen === '22250') {
        conceptos = fixture.consolidadoMensual ? CONCEPTOS_UOCRA_TOPE_MENSUAL : CONCEPTOS_UOCRA
      } else {
        conceptos = fixture.esReal ? CONCEPTOS_SOLO_BASICO_Y_DEDUCCIONES : CONCEPTOS_FUERA_CONVENIO
      }
      const r = liquidarConceptos(conceptos, fixture.variablesBase)
      for (const esperado of fixture.resultadoEsperado.items) {
        const item = r.items.find((i: { codigo: string }) => i.codigo === esperado.codigo)
        expect(item, `falta el ítem ${esperado.codigo} en el resultado`).toBeDefined()
        expect(item!.monto).toBeCloseTo(esperado.montoEsperado, 2)
      }
      if (fixture.resultadoEsperado.neto !== null) {
        if (fixture.esReal) {
          // Los recibos reales redondean el neto final a pesos enteros (una
          // pequeña fracción "de redondeo" queda exenta, ver nota del plan);
          // el motor no modela ese redondeo de centavos, así que para
          // fixtures reales se tolera hasta 1 peso de diferencia absoluta.
          expect(Math.abs(r.neto - fixture.resultadoEsperado.neto)).toBeLessThanOrEqual(1)
        } else {
          expect(r.neto).toBeCloseTo(fixture.resultadoEsperado.neto, 2)
        }
      }
    })
  }
})
