// Intérprete de fórmulas declarativas: tokenizer + parser recursivo-descendente + evaluador de AST.
// Deliberadamente NO usa eval() ni new Function() del entorno JS: es un requisito de
// seguridad porque este código corre server-side (Edge Function) y nunca debe poder
// ejecutar código arbitrario provisto por el usuario.

type Valor = number | boolean

type TipoToken =
  | 'num'
  | 'ident'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'coma'
  | 'interrogacion'
  | 'dosPuntos'
  | 'eof'

interface Token {
  tipo: TipoToken
  valor: string
  pos: number
}

const PALABRAS_CLAVE = new Set(['and', 'or', 'not'])
const OPERADORES_MULTI = ['<=', '>=', '==', '!=']
const OPERADORES_SIMPLES = ['+', '-', '*', '/', '<', '>']
// Operadores de comparación válidos, compartidos entre el tokenizer y el parser.
const OPERADORES_COMPARACION = ['<', '>', '<=', '>=', '==', '!='] as const

function tokenizar(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = expr.length

  while (i < n) {
    const c = expr[i]
    const inicio = i

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }

    if (c === '(') {
      tokens.push({ tipo: 'lparen', valor: c, pos: inicio })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ tipo: 'rparen', valor: c, pos: inicio })
      i++
      continue
    }
    if (c === ',') {
      tokens.push({ tipo: 'coma', valor: c, pos: inicio })
      i++
      continue
    }
    if (c === '?') {
      tokens.push({ tipo: 'interrogacion', valor: c, pos: inicio })
      i++
      continue
    }
    if (c === ':') {
      tokens.push({ tipo: 'dosPuntos', valor: c, pos: inicio })
      i++
      continue
    }

    // operadores de dos caracteres
    const dos = expr.slice(i, i + 2)
    if (OPERADORES_MULTI.includes(dos)) {
      tokens.push({ tipo: 'op', valor: dos, pos: inicio })
      i += 2
      continue
    }

    if (OPERADORES_SIMPLES.includes(c)) {
      tokens.push({ tipo: 'op', valor: c, pos: inicio })
      i++
      continue
    }

    // número: dígitos con punto decimal opcional, o que empieza directamente con "." (ej ".5")
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      let j = i
      while (j < n && /[0-9]/.test(expr[j])) j++
      if (expr[j] === '.' && /[0-9]/.test(expr[j + 1] ?? '')) {
        j++
        while (j < n && /[0-9]/.test(expr[j])) j++
      }
      tokens.push({ tipo: 'num', valor: expr.slice(i, j), pos: inicio })
      i = j
      continue
    }

    // identificador: letras, dígitos, guion bajo (no puede empezar con dígito)
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_]/.test(expr[j])) j++
      tokens.push({ tipo: 'ident', valor: expr.slice(i, j), pos: inicio })
      i = j
      continue
    }

    throw new Error('carácter inesperado en fórmula: ' + c + ' en la posición ' + inicio)
  }

  tokens.push({ tipo: 'eof', valor: '', pos: n })
  return tokens
}

// --- AST ---

type OperadorBinario = '+' | '-' | '*' | '/' | '<' | '>' | '<=' | '>=' | '==' | '!=' | 'and' | 'or'

type Nodo =
  | { tipo: 'numero'; valor: number }
  | { tipo: 'variable'; nombre: string }
  | { tipo: 'llamada'; nombre: string; args: Nodo[] }
  | { tipo: 'unario'; op: '-'; arg: Nodo }
  | { tipo: 'binario'; op: OperadorBinario; izq: Nodo; der: Nodo }
  | { tipo: 'not'; arg: Nodo }
  | { tipo: 'ternario'; cond: Nodo; siVerdadero: Nodo; siFalso: Nodo }

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}

  private actual(): Token {
    return this.tokens[this.pos]
  }

  private esIdent(valor: string): boolean {
    const t = this.actual()
    return t.tipo === 'ident' && t.valor === valor
  }

  private avanzar(): Token {
    const t = this.tokens[this.pos]
    this.pos++
    return t
  }

  // `descripcion` siempre debe ser un texto humano-legible (ej. ")", ":", "fin de la fórmula"),
  // nunca el nombre interno del tipo de token, para que el mensaje de error sea comprensible
  // para alguien sin conocimientos de programación.
  private esperar(tipo: TipoToken, descripcion: string): Token {
    const t = this.actual()
    if (t.tipo !== tipo) {
      throw new Error(
        `error de sintaxis: se esperaba ${descripcion}, se encontró "${t.valor}" en la posición ${t.pos}`
      )
    }
    return this.avanzar()
  }

  parse(): Nodo {
    const nodo = this.parseTernario()
    this.esperar('eof', 'fin de la fórmula')
    return nodo
  }

  private parseTernario(): Nodo {
    const cond = this.parseOr()
    if (this.actual().tipo === 'interrogacion') {
      this.avanzar()
      const siVerdadero = this.parseTernario()
      this.esperar('dosPuntos', '":"')
      const siFalso = this.parseTernario()
      return { tipo: 'ternario', cond, siVerdadero, siFalso }
    }
    return cond
  }

  private parseOr(): Nodo {
    let izq = this.parseAnd()
    while (this.esIdent('or')) {
      this.avanzar()
      const der = this.parseAnd()
      izq = { tipo: 'binario', op: 'or', izq, der }
    }
    return izq
  }

  private parseAnd(): Nodo {
    let izq = this.parseNot()
    while (this.esIdent('and')) {
      this.avanzar()
      const der = this.parseNot()
      izq = { tipo: 'binario', op: 'and', izq, der }
    }
    return izq
  }

  private parseNot(): Nodo {
    if (this.esIdent('not')) {
      this.avanzar()
      const arg = this.parseNot()
      return { tipo: 'not', arg }
    }
    return this.parseComparacion()
  }

  private parseComparacion(): Nodo {
    let izq = this.parseSuma()
    const t = this.actual()
    if (t.tipo === 'op' && (OPERADORES_COMPARACION as readonly string[]).includes(t.valor)) {
      this.avanzar()
      const der = this.parseSuma()
      izq = { tipo: 'binario', op: t.valor as OperadorBinario, izq, der }

      // Detectar encadenamiento de comparaciones (ej. "1 < 2 < 3") y dar un mensaje claro
      // en vez de un error genérico de sintaxis.
      const siguiente = this.actual()
      if (siguiente.tipo === 'op' && (OPERADORES_COMPARACION as readonly string[]).includes(siguiente.valor)) {
        throw new Error(
          `error de sintaxis: no se pueden encadenar comparaciones (ej. "1 < 2 < 3" no es válido, usá "1 < 2 and 2 < 3") en la posición ${siguiente.pos}`
        )
      }
    }
    return izq
  }

  private parseSuma(): Nodo {
    let izq = this.parseProducto()
    while (this.actual().tipo === 'op' && (this.actual().valor === '+' || this.actual().valor === '-')) {
      const op = this.avanzar().valor as OperadorBinario
      const der = this.parseProducto()
      izq = { tipo: 'binario', op, izq, der }
    }
    return izq
  }

  private parseProducto(): Nodo {
    let izq = this.parseUnario()
    while (this.actual().tipo === 'op' && (this.actual().valor === '*' || this.actual().valor === '/')) {
      const op = this.avanzar().valor as OperadorBinario
      const der = this.parseUnario()
      izq = { tipo: 'binario', op, izq, der }
    }
    return izq
  }

  private parseUnario(): Nodo {
    if (this.actual().tipo === 'op' && this.actual().valor === '-') {
      this.avanzar()
      const arg = this.parseUnario()
      return { tipo: 'unario', op: '-', arg }
    }
    // Unario "+" se soporta ignorando el signo (ej. "+5" equivale a "5").
    if (this.actual().tipo === 'op' && this.actual().valor === '+') {
      this.avanzar()
      return this.parseUnario()
    }
    return this.parsePrimario()
  }

  private parsePrimario(): Nodo {
    const t = this.actual()

    if (t.tipo === 'num') {
      this.avanzar()
      return { tipo: 'numero', valor: parseFloat(t.valor) }
    }

    if (t.tipo === 'lparen') {
      this.avanzar()
      const nodo = this.parseTernario()
      this.esperar('rparen', '")"')
      return nodo
    }

    if (t.tipo === 'ident') {
      if (PALABRAS_CLAVE.has(t.valor)) {
        throw new Error(
          'error de sintaxis: uso inesperado de palabra clave "' + t.valor + '" en la posición ' + t.pos
        )
      }
      this.avanzar()
      if (this.actual().tipo === 'lparen') {
        this.avanzar()
        const args: Nodo[] = []
        if (this.actual().tipo !== 'rparen') {
          args.push(this.parseTernario())
          while (this.actual().tipo === 'coma') {
            this.avanzar()
            args.push(this.parseTernario())
          }
        }
        this.esperar('rparen', '")"')
        return { tipo: 'llamada', nombre: t.valor, args }
      }
      return { tipo: 'variable', nombre: t.valor }
    }

    throw new Error('error de sintaxis: token inesperado "' + t.valor + '" en la posición ' + t.pos)
  }
}

// --- Evaluador ---

function aNumero(v: Valor): number {
  if (typeof v !== 'number') throw new Error('se esperaba un número')
  return v
}

function aBooleano(v: Valor): boolean {
  if (typeof v !== 'boolean') throw new Error('se esperaba un booleano')
  return v
}

function sugerenciaPalabraClave(nombre: string): string | null {
  const enMinuscula = nombre.toLowerCase()
  if (PALABRAS_CLAVE.has(enMinuscula) && enMinuscula !== nombre) {
    return enMinuscula
  }
  return null
}

function evaluarNodo(nodo: Nodo, vars: Record<string, Valor>): Valor {
  switch (nodo.tipo) {
    case 'numero':
      return nodo.valor

    case 'variable': {
      if (!(nodo.nombre in vars)) {
        const sugerencia = sugerenciaPalabraClave(nodo.nombre)
        if (sugerencia) {
          throw new Error(
            `variable desconocida: ${nodo.nombre} (¿quisiste decir "${sugerencia}" en minúsculas?)`
          )
        }
        throw new Error('variable desconocida: ' + nodo.nombre)
      }
      return vars[nodo.nombre]
    }

    case 'unario': {
      const v = aNumero(evaluarNodo(nodo.arg, vars))
      return -v
    }

    case 'not': {
      const v = aBooleano(evaluarNodo(nodo.arg, vars))
      return !v
    }

    case 'ternario': {
      const cond = aBooleano(evaluarNodo(nodo.cond, vars))
      return cond ? evaluarNodo(nodo.siVerdadero, vars) : evaluarNodo(nodo.siFalso, vars)
    }

    case 'llamada': {
      const args = nodo.args.map((a) => aNumero(evaluarNodo(a, vars)))
      switch (nodo.nombre) {
        case 'min':
          if (args.length < 1) {
            throw new Error('min necesita al menos un argumento')
          }
          return Math.min(...args)
        case 'max':
          if (args.length < 1) {
            throw new Error('max necesita al menos un argumento')
          }
          return Math.max(...args)
        case 'round':
          // NOTA: por ahora solo se soporta 1 argumento (redondeo fijo a 2 decimales).
          // Un eventual segundo argumento (cantidad de decimales) no está implementado.
          if (args.length !== 1) {
            throw new Error('round necesita exactamente un argumento numérico')
          }
          return Math.round(args[0] * 100) / 100
        default:
          throw new Error('función desconocida: ' + nodo.nombre)
      }
    }

    case 'binario': {
      const { op } = nodo

      if (op === 'and') {
        return aBooleano(evaluarNodo(nodo.izq, vars)) && aBooleano(evaluarNodo(nodo.der, vars))
      }
      if (op === 'or') {
        return aBooleano(evaluarNodo(nodo.izq, vars)) || aBooleano(evaluarNodo(nodo.der, vars))
      }

      const izq = evaluarNodo(nodo.izq, vars)
      const der = evaluarNodo(nodo.der, vars)

      switch (op) {
        case '+':
          return aNumero(izq) + aNumero(der)
        case '-':
          return aNumero(izq) - aNumero(der)
        case '*':
          return aNumero(izq) * aNumero(der)
        case '/': {
          const divisor = aNumero(der)
          if (divisor === 0) {
            throw new Error('división por cero')
          }
          return aNumero(izq) / divisor
        }
        case '<':
          return aNumero(izq) < aNumero(der)
        case '>':
          return aNumero(izq) > aNumero(der)
        case '<=':
          return aNumero(izq) <= aNumero(der)
        case '>=':
          return aNumero(izq) >= aNumero(der)
        case '==':
          return izq === der
        case '!=':
          return izq !== der
        default: {
          // Chequeo de exhaustividad: si se agrega un nuevo OperadorBinario y no se
          // maneja acá, el compilador marcará error en esta línea.
          const _exhaustivo: never = op
          throw new Error('operador desconocido: ' + _exhaustivo)
        }
      }
    }
  }
}

export function parsear(expr: string): Nodo {
  if (expr.trim() === '') {
    throw new Error('la fórmula está vacía')
  }
  const tokens = tokenizar(expr)
  const parser = new Parser(tokens)
  return parser.parse()
}

export function evaluar(expr: string, vars: Record<string, Valor>): Valor {
  const ast = parsear(expr)
  const resultado = evaluarNodo(ast, vars)
  if (typeof resultado === 'number' && !Number.isFinite(resultado)) {
    throw new Error('resultado no numérico o infinito')
  }
  return resultado
}
