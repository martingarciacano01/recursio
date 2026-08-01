import { describe, it, expect } from 'vitest'
import { generarLegajoPdf } from '../legajoPdf'

const datosFake = {
  empresa: { nombre: 'Asset Construcciones S.A.', cuit: '30-1111-9', domicilio: 'Av. Siempreviva 742', logo: null },
  persona: { id: 'p-123', nombre: 'Ana Test', dni: '30111222', puesto: 'Oficial' },
  legajo: { cuil: '27-30111222-4', cbu: '000', banco: 'BNA', obraSocial: 'OSDE', jornada: 'completa' },
  familiares: [{ nombre: 'Juan Test', vinculo: 'hijo', fechaNacimiento: '2015-01-01' }],
  sanciones: [{ fecha: '2026-01-01', tipo: 'llamado_atencion', motivo: 'test', diasSuspension: null }],
  ausencias: [{ fecha_desde: '2026-02-01', fecha_hasta: '2026-02-05', tipo: 'vacaciones', estado: 'aprobada' }],
  documentos: [{ nombre: 'DNI', fecha_vencimiento: null }],
}

// Extrae todo el texto dibujado del stream del PDF — mismo patrón que
// reciboPdf.test.js (doc.internal.pages).
const textoDe = (doc) => doc.internal.pages.map((p) => (Array.isArray(p) ? p.join(' ') : '')).join(' ')

// generarLegajoPdf es async desde que jsPDF se carga con import() dinámico
// (src/utils/cargarJsPDF.js), de ahí los await.
describe('generarLegajoPdf', () => {
  it('genera un documento jsPDF con contenido en al menos 1 página', async () => {
    const doc = await generarLegajoPdf(datosFake)
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1)
  })

  it('incluye el nombre de la persona en el texto del documento', async () => {
    const doc = await generarLegajoPdf(datosFake)
    const texto = textoDe(doc)
    expect(texto).toContain('Ana Test')
  })

  it('incluye el nombre y CUIT de la empresa en la cabecera', async () => {
    const doc = await generarLegajoPdf(datosFake)
    const texto = textoDe(doc)
    expect(texto).toContain('Asset Construcciones')
    expect(texto).toContain('30-1111-9')
  })

  it('sin logo (logo null) no rompe la generación', async () => {
    await expect(generarLegajoPdf({ ...datosFake, empresa: { ...datosFake.empresa, logo: null } })).resolves.toBeTruthy()
  })

  it('sin empresa (null) tampoco rompe la generación', async () => {
    await expect(generarLegajoPdf({ ...datosFake, empresa: null })).resolves.toBeTruthy()
  })

  it('sin documentos: la sección dice "Sin documentos cargados"', async () => {
    const doc = await generarLegajoPdf({ ...datosFake, documentos: [] })
    const texto = textoDe(doc)
    expect(texto).toContain('Sin documentos cargados')
  })

  it('con documentos: los muestra en vez del mensaje de "sin documentos" (bug FichaLegajoPage.jsx arreglado)', async () => {
    const doc = await generarLegajoPdf({
      ...datosFake,
      documentos: [{ nombre: 'ART vigente', fecha_vencimiento: '2027-01-01' }],
    })
    const texto = textoDe(doc)
    expect(texto).not.toContain('Sin documentos cargados')
    expect(texto).toContain('ART vigente')
  })

  it('un documento vencido se marca como "Vencido" en el texto', async () => {
    const doc = await generarLegajoPdf({
      ...datosFake,
      documentos: [{ nombre: 'ART', fecha_vencimiento: '2020-01-01' }], // muy en el pasado
    })
    const texto = textoDe(doc)
    expect(texto).toContain('Vencido')
  })

  it('con 40 ausencias hace salto de página correcto (más de 1 página)', async () => {
    const muchasAusencias = Array.from({ length: 40 }, (_, i) => ({
      fecha_desde: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      fecha_hasta: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      tipo: 'enfermedad', estado: 'aprobada',
    }))
    const doc = await generarLegajoPdf({ ...datosFake, ausencias: muchasAusencias })
    expect(doc.getNumberOfPages()).toBeGreaterThan(1)
  })

  it('el pie numera "Página N de M" en todas las páginas', async () => {
    const muchasAusencias = Array.from({ length: 40 }, (_, i) => ({
      fecha_desde: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      fecha_hasta: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      tipo: 'enfermedad', estado: 'aprobada',
    }))
    const doc = await generarLegajoPdf({ ...datosFake, ausencias: muchasAusencias })
    const total = doc.getNumberOfPages()
    expect(total).toBeGreaterThan(1)
    const texto = textoDe(doc)
    // "Página" lleva tilde y se codifica distinto en el stream (ver
    // reciboPdf.test.js: "substrings SOLO ASCII"), así que se busca la
    // parte ASCII "de <total>" — debería aparecer una vez por página.
    const ocurrencias = (texto.match(new RegExp(`de ${total}`, 'g')) || []).length
    expect(ocurrencias).toBeGreaterThanOrEqual(total)
  })
})
