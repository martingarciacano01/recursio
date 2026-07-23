const UNIDADES = [
  '', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
  'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
]

const DECENAS = {
  3: 'treinta', 4: 'cuarenta', 5: 'cincuenta', 6: 'sesenta',
  7: 'setenta', 8: 'ochenta', 9: 'noventa',
}

const CENTENAS = {
  1: 'ciento', 2: 'doscientos', 3: 'trescientos', 4: 'cuatrocientos',
  5: 'quinientos', 6: 'seiscientos', 7: 'setecientos', 8: 'ochocientos', 9: 'novecientos',
}

function convertirMenorQueMil(n) {
  if (n === 0) return ''
  if (n < 30) return UNIDADES[n]

  if (n < 100) {
    const d = Math.floor(n / 10)
    const u = n % 10
    if (u === 0) return DECENAS[d]
    return `${DECENAS[d]} y ${UNIDADES[u]}`
  }

  if (n === 100) return 'cien'

  const c = Math.floor(n / 100)
  const resto = n % 100
  const centenaTexto = CENTENAS[c]
  if (resto === 0) return centenaTexto
  return `${centenaTexto} ${convertirMenorQueMil(resto)}`
}

function convertirEntero(n) {
  if (n === 0) return 'cero'

  const millones = Math.floor(n / 1000000)
  const restoMillones = n % 1000000
  const miles = Math.floor(restoMillones / 1000)
  const restoMiles = restoMillones % 1000

  const partes = []

  if (millones > 0) {
    if (millones === 1) {
      partes.push('un millón')
    } else {
      partes.push(`${convertirMenorQueMil(millones)} millones`)
    }
  }

  if (miles > 0) {
    if (miles === 1) {
      partes.push('mil')
    } else {
      partes.push(`${convertirMenorQueMil(miles)} mil`)
    }
  }

  if (restoMiles > 0) {
    partes.push(convertirMenorQueMil(restoMiles))
  }

  return partes.join(' ')
}

export function numeroALetras(monto) {
  const entero = Math.floor(monto)
  const centavos = Math.round((monto - Math.floor(monto)) * 100)

  let texto = convertirEntero(entero)
  texto = texto.charAt(0).toUpperCase() + texto.slice(1)

  const centavosTexto = String(centavos).padStart(2, '0')

  return `${texto} Pesos con ${centavosTexto}/100`
}
