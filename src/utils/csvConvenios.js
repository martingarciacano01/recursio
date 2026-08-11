// src/utils/csvConvenios.js
// Importación manual de vigencias por CSV (Fase 5, plan 2026-08-11).
// Separador ';' (estándar es-AR, igual que exportCsv.js), comillas simples
// "..." para escapar ';'/saltos, decimal con coma. Puro: testeable sin UI.

const CONCEPTOS_VALIDOS = ['basico', 'no_remunerativo']
const MODALIDADES_VALIDAS = ['hora', 'mensual', 'quincenal']

// Corta una línea CSV respetando comillas: "a;b" no se parte en el ';'.
function dividirFila(linea) {
  const campos = []
  let actual = ''
  let entreComillas = false
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i]
    if (ch === '"') {
      if (entreComillas && linea[i + 1] === '"') { actual += '"'; i++ }
      else entreComillas = !entreComillas
    } else if (ch === ';' && !entreComillas) {
      campos.push(actual.trim())
      actual = ''
    } else {
      actual += ch
    }
  }
  campos.push(actual.trim())
  return campos
}

// '1234,56' → 1234.56. También acepta punto decimal; los miles se ignoran
// solo si usan '.' (conflicto conocido es-AR) — el formato esperado es coma.
function normalizarValor(texto) {
  const limpio = texto.trim()
  if (/^\d+,\d+$/.test(limpio) || /^\d+$/.test(limpio)) return Number(limpio.replace(',', '.'))
  if (/^\d+\.\d+$/.test(limpio)) return Number(limpio)
  return NaN
}

// '01/08/2026' → '2026-08-01'; 'YYYY-MM-DD' se acepta tal cual.
function normalizarFecha(texto) {
  const t = texto.trim()
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
  const esAr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  let m = t.match(iso)
  if (m) {
    const d = Number(m[3]), mo = Number(m[2])
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  m = t.match(esAr)
  if (m) {
    const d = Number(m[1]), mo = Number(m[2])
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return null
}

export function parseCsvConvenios(texto) {
  const errores = []
  const filas = []
  const lineas = String(texto ?? '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lineas.length === 0) {
    return { ok: false, errores: [{ fila: 1, mensaje: 'el archivo está vacío' }], filas: [] }
  }

  const encabezado = dividirFila(lineas[0])
  const col = (nombre) => encabezado.indexOf(nombre)
  const idxConcepto = col('concepto')
  const idxNombre = col('nombre')
  const idxValor = col('valor')
  const idxModalidad = col('modalidad')
  const idxVigencia = col('vigencia_desde')
  if (idxConcepto < 0 || idxNombre < 0 || idxValor < 0 || idxVigencia < 0) {
    return {
      ok: false,
      errores: [{ fila: 1, mensaje: 'encabezado inválido: se espera concepto;nombre;valor;[modalidad];vigencia_desde' }],
      filas: [],
    }
  }

  for (let n = 1; n < lineas.length; n++) {
    const campos = dividirFila(lineas[n])
    const fila = n + 1
    const get = (i) => (i >= 0 ? (campos[i] ?? '').trim() : '')
    const concepto = get(idxConcepto)
    const nombre = get(idxNombre)
    const faltante = idxModalidad >= 0 ? get(idxModalidad) : ''
    const vigenciaDesde = normalizarFecha(get(idxVigencia))

    const el = (mensaje) => errores.push({ fila, mensaje })

    if (!CONCEPTOS_VALIDOS.includes(concepto)) {
      el(`concepto inválido: se espera ${CONCEPTOS_VALIDOS.join(' o ')}`)
      continue
    }
    if (!nombre) { el('nombre vacío'); continue }
    const valor = normalizarValor(get(idxValor))
    if (Number.isNaN(valor)) { el(`valor no numérico: "${get(idxValor)}"`); continue }
    if (!vigenciaDesde) { el(`fecha inválida: "${get(idxVigencia)}" (se espera DD/MM/YYYY o YYYY-MM-DD)`); continue }

    let modalidad = null
    if (concepto === 'basico') {
      modalidad = faltante || 'hora'
      if (!MODALIDADES_VALIDAS.includes(modalidad)) {
        el(`modalidad inválida: se espera ${MODALIDADES_VALIDAS.join(' o ')}`)
        continue
      }
    }

    filas.push({ fila, concepto, nombre, valor, modalidad, vigenciaDesde })
  }

  return { ok: errores.length === 0, errores, filas }
}

// Plantilla descargable: una fila de ejemplo por tipo, con los nombres de
// categorías ya cargadas para que el usuario los complete (Task 5.2).
export function generarPlantillaCsv(nombresCategorias) {
  const filas = [`basico;${nombresCategorias[0] ?? 'Operario'};1000,00;hora;DD/MM/YYYY`]
  filas.push(`no_remunerativo;${nombresCategorias[1] ?? 'Adicional'};500,00;;DD/MM/YYYY`)
  return ['concepto;nombre;valor;modalidad;vigencia_desde', ...filas].join('\n')
}