import { describe, it, expect } from 'vitest'
import { generarLegajoPdf } from '../legajoPdf'

const datosFake = {
  persona: { nombre: 'Ana Test', dni: '30111222', puesto: 'Oficial' },
  legajo: { cuil: '27-30111222-4', cbu: '000', banco: 'BNA', obraSocial: 'OSDE', jornada: 'completa' },
  familiares: [{ nombre: 'Juan Test', vinculo: 'hijo', fechaNacimiento: '2015-01-01' }],
  sanciones: [{ fecha: '2026-01-01', tipo: 'llamado_atencion', motivo: 'test', diasSuspension: null }],
  ausencias: [{ fecha_desde: '2026-02-01', fecha_hasta: '2026-02-05', tipo: 'vacaciones', estado: 'aprobada' }],
}

describe('generarLegajoPdf', () => {
  it('genera un documento jsPDF con contenido en al menos 1 página', () => {
    const doc = generarLegajoPdf(datosFake)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
  })

  it('incluye el nombre de la persona en el texto del documento', () => {
    const doc = generarLegajoPdf(datosFake)
    const texto = doc.internal.pages.map((p) => (Array.isArray(p) ? p.join(' ') : '')).join(' ')
    expect(texto).toContain('Ana Test')
  })
})
