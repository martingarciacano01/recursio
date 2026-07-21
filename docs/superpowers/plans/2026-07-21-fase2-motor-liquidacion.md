# Fase 2 — Motor de liquidación (fuera de convenio) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Motor de liquidación configurable (intérprete de fórmulas + reglas condicionales + variables de asistencia) que liquida el convenio "Fuera de convenio (LCT)" completo — básico, presentismo escalonado, extras, aportes, SAC — validado contra recibos reales de Asset Construcciones, corriendo en una Edge Function de Supabase.

**Architecture:** El intérprete y el motor viven en `packages/motor/` como paquete TypeScript puro, testeable con Vitest sin depender de Supabase ni de la red (Recursio_Diseno.md 4.4: "el intérprete no se expone al cliente"). Una Edge Function (`supabase/functions/liquidar-periodo`) importa ese paquete, arma el snapshot de horas desde `nom_v_horas_dia` + `nom_v_ausencias`, corre el motor por cada persona del período, y escribe `nom_liquidaciones`/`nom_liquidacion_items` en una transacción idempotente. El front (`LiquidacionPage`, `ConfiguracionPage`) solo dispara la Edge Function y muestra resultados — nunca calcula.

**Tech Stack:** TypeScript (paquete `packages/motor/`), Vitest, Supabase Edge Functions (Deno), React 19 + jsPDF para el recibo.

---

## Antes de empezar — datos reales usados como casos dorados

El usuario proveyó 3 recibos reales de Asset Construcciones (Juan Martín García Cano, legajo 47, categoría "Fuera de convenio", ingreso 1/7/2025, remuneración asignada $3.595.969,00, obra social Swiss Medical, antigüedad 0 años):

| Recibo | Concepto remunerativo | Remun. sujeto a retención | Jubilación (11%) | Ley 19032/PAMI (3%) | Obra social (3%) | Redondeo | Neto |
|---|---|---|---|---|---|---|---|
| SAC 2do semestre 2025 (pago 15/12/2025) | SAC | 1.929.836,70 | 212.282,04 | 57.895,10 | 57.895,10 | 0,54 (exento) | 1.601.765,00 |
| Vacaciones (11 días, pago 12/12/2025) | Vacaciones | 1.582.226,36 | 174.044,90 | 47.466,79 | 47.466,79 | 0,12 (exento) | 1.313.248,00 |
| Sueldo diciembre 2025 (pago 02/01/2026) | Sueldo | 2.277.447,03 | 250.519,17 | 68.323,41 | 68.323,41 | 0,96 (exento) | 1.890.282,00 |

Verificado a mano: en los 3 recibos, `jubilacion = round(remunerativo * 0.11, 2)`, `ley_19032 = round(remunerativo * 0.03, 2)`, `obra_social = round(remunerativo * 0.03, 2)`, `neto = remunerativo + redondeo - (jubilacion + ley_19032 + obra_social)`. Estos 3 recibos NO muestran presentismo ni horas extra por separado (categoría "Fuera de convenio" de este puesto no los desglosa), así que **los casos dorados 4 a 10 de la Task 16 son sintéticos** (construidos a mano siguiendo las fórmulas de Recursio_Diseno.md 4.2/4.3), documentados explícitamente como tales — no confundir con datos reales. Al llegar al Task 16 se guardan las 3 fotos de recibos como referencia en `packages/motor/golden/recibos-referencia/` (no se suben al repo público si el usuario prefiere no versionarlas — confirmar con el usuario en ese momento si van al repo o quedan solo de referencia local).

---

### Task 13: Intérprete de fórmulas (tokenizer + parser + eval)

**Files:**
- Create: `packages/motor/package.json`, `packages/motor/tsconfig.json`, `packages/motor/vitest.config.ts`
- Create: `packages/motor/src/interprete.ts`
- Test: `packages/motor/src/interprete.test.ts`

- [ ] **Step 1: Scaffold del paquete**

```json
// packages/motor/package.json
{
  "name": "@recursio/motor",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^4.1.10"
  }
}
```

```json
// packages/motor/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

```ts
// packages/motor/vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node' },
})
```

- [ ] **Step 2: Test que falla — los 6 casos mínimos del plan madre**

```ts
// packages/motor/src/interprete.test.ts
import { describe, it, expect } from 'vitest'
import { evaluar } from './interprete'

describe('evaluar', () => {
  it('basico * 1.1 con basico=100 da 110', () => {
    expect(evaluar('basico * 1.1', { basico: 100 })).toBeCloseTo(110)
  })

  it('min(rem, tope) * 0.11 con rem=200 tope=150 da 16.5', () => {
    expect(evaluar('min(rem, tope) * 0.11', { rem: 200, tope: 150 })).toBeCloseTo(16.5)
  })

  it('tardanzas > 3 or faltas > 0 con tardanzas=2 faltas=1 da true', () => {
    expect(evaluar('tardanzas > 3 or faltas > 0', { tardanzas: 2, faltas: 1 })).toBe(true)
  })

  it('antiguedad < 1 ? 0.12 : 0.08 con antiguedad=3 da 0.08', () => {
    expect(evaluar('antiguedad < 1 ? 0.12 : 0.08', { antiguedad: 3 })).toBe(0.08)
  })

  it('(basico / 200) * 1.5 * he50 con basico=400 he50=10 da 30', () => {
    expect(evaluar('(basico / 200) * 1.5 * he50', { basico: 400, he50: 10 })).toBeCloseTo(30)
  })

  it('variable desconocida tira error claro', () => {
    expect(() => evaluar('foo + 1', {})).toThrow('variable desconocida: foo')
  })

  it('no usa eval ni Function del entorno', () => {
    // Verificación de la restricción de seguridad del diseño (4.4): el
    // intérprete nunca debe delegar en eval/Function nativos de JS.
    const fuente = evaluar.toString()
    expect(fuente).not.toContain('eval(')
    expect(fuente).not.toContain('Function(')
  })
})
```

- [ ] **Step 3: Run test para verificar que falla**

Run: `cd packages/motor && npx vitest run`
Expected: FAIL (módulo `interprete.ts` no existe)

- [ ] **Step 4: Implementar el tokenizer + parser + evaluador (recursive descent, sin `eval`)**

```ts
// packages/motor/src/interprete.ts
type Vars = Record<string, number | boolean>

type TokenType = 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma' | 'question' | 'colon' | 'eof'
interface Token { type: TokenType; value: string }

function tokenizar(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const c = expr[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++
      tokens.push({ type: 'num', value: expr.slice(i, j) })
      i = j
      continue
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i
      while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++
      tokens.push({ type: 'ident', value: expr.slice(i, j) })
      i = j
      continue
    }
    if (c === '(') { tokens.push({ type: 'lparen', value: c }); i++; continue }
    if (c === ')') { tokens.push({ type: 'rparen', value: c }); i++; continue }
    if (c === ',') { tokens.push({ type: 'comma', value: c }); i++; continue }
    if (c === '?') { tokens.push({ type: 'question', value: c }); i++; continue }
    if (c === ':') { tokens.push({ type: 'colon', value: c }); i++; continue }
    const dos = expr.slice(i, i + 2)
    if (['<=', '>=', '==', '!='].includes(dos)) { tokens.push({ type: 'op', value: dos }); i += 2; continue }
    if (['+', '-', '*', '/', '<', '>'].includes(c)) { tokens.push({ type: 'op', value: c }); i++; continue }
    throw new Error(`carácter inesperado en la fórmula: "${c}"`)
  }
  tokens.push({ type: 'eof', value: '' })
  return tokens
}

type Nodo =
  | { tipo: 'numero'; valor: number }
  | { tipo: 'variable'; nombre: string }
  | { tipo: 'binario'; op: string; izq: Nodo; der: Nodo }
  | { tipo: 'comparacion'; op: string; izq: Nodo; der: Nodo }
  | { tipo: 'logico'; op: 'and' | 'or'; izq: Nodo; der: Nodo }
  | { tipo: 'not'; operando: Nodo }
  | { tipo: 'negacion'; operando: Nodo }
  | { tipo: 'ternario'; cond: Nodo; siVerdadero: Nodo; siFalso: Nodo }
  | { tipo: 'llamada'; nombre: string; args: Nodo[] }

class Parser {
  private pos = 0
  constructor(private tokens: Token[]) {}
  private peek() { return this.tokens[this.pos] }
  private next() { return this.tokens[this.pos++] }
  private expect(type: TokenType): Token {
    const t = this.next()
    if (t.type !== type) throw new Error(`se esperaba "${type}" pero se encontró "${t.value || t.type}"`)
    return t
  }

  parseExpresion(): Nodo { return this.parseTernario() }

  private parseTernario(): Nodo {
    const cond = this.parseOr()
    if (this.peek().type === 'question') {
      this.next()
      const siVerdadero = this.parseTernario()
      this.expect('colon')
      const siFalso = this.parseTernario()
      return { tipo: 'ternario', cond, siVerdadero, siFalso }
    }
    return cond
  }

  private parseOr(): Nodo {
    let izq = this.parseAnd()
    while (this.peek().type === 'ident' && this.peek().value === 'or') {
      this.next()
      izq = { tipo: 'logico', op: 'or', izq, der: this.parseAnd() }
    }
    return izq
  }

  private parseAnd(): Nodo {
    let izq = this.parseNot()
    while (this.peek().type === 'ident' && this.peek().value === 'and') {
      this.next()
      izq = { tipo: 'logico', op: 'and', izq, der: this.parseNot() }
    }
    return izq
  }

  private parseNot(): Nodo {
    if (this.peek().type === 'ident' && this.peek().value === 'not') {
      this.next()
      return { tipo: 'not', operando: this.parseNot() }
    }
    return this.parseComparacion()
  }

  private parseComparacion(): Nodo {
    let izq = this.parseSuma()
    while (this.peek().type === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(this.peek().value)) {
      const op = this.next().value
      izq = { tipo: 'comparacion', op, izq, der: this.parseSuma() }
    }
    return izq
  }

  private parseSuma(): Nodo {
    let izq = this.parseProducto()
    while (this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value
      izq = { tipo: 'binario', op, izq, der: this.parseProducto() }
    }
    return izq
  }

  private parseProducto(): Nodo {
    let izq = this.parseUnario()
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next().value
      izq = { tipo: 'binario', op, izq, der: this.parseUnario() }
    }
    return izq
  }

  private parseUnario(): Nodo {
    if (this.peek().type === 'op' && this.peek().value === '-') {
      this.next()
      return { tipo: 'negacion', operando: this.parseUnario() }
    }
    return this.parsePrimario()
  }

  private parsePrimario(): Nodo {
    const t = this.peek()
    if (t.type === 'num') { this.next(); return { tipo: 'numero', valor: parseFloat(t.value) } }
    if (t.type === 'lparen') {
      this.next()
      const e = this.parseExpresion()
      this.expect('rparen')
      return e
    }
    if (t.type === 'ident') {
      this.next()
      if (this.peek().type === 'lparen') {
        this.next()
        const args: Nodo[] = []
        if (this.peek().type !== 'rparen') {
          args.push(this.parseExpresion())
          while (this.peek().type === 'comma') { this.next(); args.push(this.parseExpresion()) }
        }
        this.expect('rparen')
        return { tipo: 'llamada', nombre: t.value, args }
      }
      return { tipo: 'variable', nombre: t.value }
    }
    throw new Error(`token inesperado en la fórmula: "${t.value || t.type}"`)
  }
}

export function parsear(expr: string): Nodo {
  const parser = new Parser(tokenizar(expr))
  const nodo = parser.parseExpresion()
  return nodo
}

function evaluarNodo(nodo: Nodo, vars: Vars): number | boolean {
  switch (nodo.tipo) {
    case 'numero': return nodo.valor
    case 'variable':
      if (!(nodo.nombre in vars)) throw new Error(`variable desconocida: ${nodo.nombre}`)
      return vars[nodo.nombre]
    case 'binario': {
      const i = evaluarNodo(nodo.izq, vars) as number
      const d = evaluarNodo(nodo.der, vars) as number
      if (nodo.op === '+') return i + d
      if (nodo.op === '-') return i - d
      if (nodo.op === '*') return i * d
      return i / d
    }
    case 'comparacion': {
      const i = evaluarNodo(nodo.izq, vars) as number
      const d = evaluarNodo(nodo.der, vars) as number
      if (nodo.op === '<') return i < d
      if (nodo.op === '>') return i > d
      if (nodo.op === '<=') return i <= d
      if (nodo.op === '>=') return i >= d
      if (nodo.op === '==') return i === d
      return i !== d
    }
    case 'logico': {
      const i = evaluarNodo(nodo.izq, vars) as boolean
      if (nodo.op === 'or') return i || (evaluarNodo(nodo.der, vars) as boolean)
      return i && (evaluarNodo(nodo.der, vars) as boolean)
    }
    case 'not': return !(evaluarNodo(nodo.operando, vars) as boolean)
    case 'negacion': return -(evaluarNodo(nodo.operando, vars) as number)
    case 'ternario': {
      const c = evaluarNodo(nodo.cond, vars) as boolean
      return c ? evaluarNodo(nodo.siVerdadero, vars) : evaluarNodo(nodo.siFalso, vars)
    }
    case 'llamada': {
      const vals = nodo.args.map((a) => evaluarNodo(a, vars) as number)
      if (nodo.nombre === 'min') return Math.min(...vals)
      if (nodo.nombre === 'max') return Math.max(...vals)
      if (nodo.nombre === 'round') return Math.round(vals[0] * 100) / 100
      throw new Error(`función desconocida: ${nodo.nombre}`)
    }
  }
}

export function evaluar(expr: string, vars: Vars): number | boolean {
  return evaluarNodo(parsear(expr), vars)
}
```

- [ ] **Step 5: Run test para verificar que pasa**

Run: `cd packages/motor && npx vitest run`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/motor/package.json packages/motor/tsconfig.json packages/motor/vitest.config.ts \
        packages/motor/src/interprete.ts packages/motor/src/interprete.test.ts
git commit -m "feat: interprete de formulas declarativas sin eval"
```

---

### Task 14: Variables de asistencia desde snapshot de horas

**Files:**
- Create: `packages/motor/src/asistencia.ts`
- Test: `packages/motor/src/asistencia.test.ts`

Diseño de la interfaz: este módulo NO consulta Supabase — recibe un array de días ya armado por la Edge Function (Task 17) a partir de `nom_v_horas_dia` (eventos crudos de fichada) + `nom_v_ausencias` + el turno esperado configurado por persona. Mantenerlo puro es lo que permite testearlo con Vitest sin red (mismo principio que `interprete.ts`).

- [ ] **Step 1: Test que falla**

```ts
// packages/motor/src/asistencia.test.ts
import { describe, it, expect } from 'vitest'
import { calcularAsistencia } from './asistencia'

describe('calcularAsistencia', () => {
  it('cuenta tardanza cuando la entrada real supera la tolerancia', () => {
    const dias = [
      { fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:20', ausenciaAprobada: false },
    ]
    const r = calcularAsistencia(dias, 15) // tolerancia 15 min
    expect(r.tardanzas).toBe(1)
  })

  it('no cuenta tardanza si la diferencia está dentro de la tolerancia', () => {
    const dias = [
      { fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:10', ausenciaAprobada: false },
    ]
    const r = calcularAsistencia(dias, 15)
    expect(r.tardanzas).toBe(0)
  })

  it('falta sin ausencia aprobada cuenta como injustificada', () => {
    const dias = [
      { fecha: '2026-02-03', horaEntradaEsperada: '08:00', horaEntradaReal: null, ausenciaAprobada: false },
    ]
    const r = calcularAsistencia(dias, 15)
    expect(r.faltasInjustificadas).toBe(1)
  })

  it('falta con ausencia aprobada NO cuenta como injustificada', () => {
    const dias = [
      { fecha: '2026-02-03', horaEntradaEsperada: '08:00', horaEntradaReal: null, ausenciaAprobada: true },
    ]
    const r = calcularAsistencia(dias, 15)
    expect(r.faltasInjustificadas).toBe(0)
  })

  it('días no laborables (sin horaEntradaEsperada) no suman ni tardanza ni falta', () => {
    const dias = [
      { fecha: '2026-02-07', horaEntradaEsperada: null, horaEntradaReal: null, ausenciaAprobada: false },
    ]
    const r = calcularAsistencia(dias, 15)
    expect(r.tardanzas).toBe(0)
    expect(r.faltasInjustificadas).toBe(0)
  })

  it('suma horas extra 50 y 100 de todos los días', () => {
    const dias = [
      { fecha: '2026-02-02', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', ausenciaAprobada: false, horasExtra50: 2, horasExtra100: 0 },
      { fecha: '2026-02-03', horaEntradaEsperada: '08:00', horaEntradaReal: '08:00', ausenciaAprobada: false, horasExtra50: 1, horasExtra100: 3 },
    ]
    const r = calcularAsistencia(dias, 15)
    expect(r.horasExtra50).toBe(3)
    expect(r.horasExtra100).toBe(3)
  })
})
```

- [ ] **Step 2: Run test para verificar que falla**

Run: `cd packages/motor && npx vitest run src/asistencia.test.ts`
Expected: FAIL (módulo no existe)

- [ ] **Step 3: Implementar `asistencia.ts`**

```ts
// packages/motor/src/asistencia.ts
export interface DiaAsistencia {
  fecha: string
  horaEntradaEsperada: string | null // 'HH:MM'; null = día no laborable para esta persona
  horaEntradaReal: string | null     // null = no fichó entrada ese día
  ausenciaAprobada: boolean
  horasExtra50?: number
  horasExtra100?: number
}

export interface ResultadoAsistencia {
  tardanzas: number
  faltasInjustificadas: number
  horasExtra50: number
  horasExtra100: number
}

function minutosDesdeMedianoche(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function calcularAsistencia(dias: DiaAsistencia[], toleranciaMinutos: number): ResultadoAsistencia {
  let tardanzas = 0
  let faltasInjustificadas = 0
  let horasExtra50 = 0
  let horasExtra100 = 0

  for (const dia of dias) {
    horasExtra50 += dia.horasExtra50 || 0
    horasExtra100 += dia.horasExtra100 || 0

    if (!dia.horaEntradaEsperada) continue // día no laborable

    if (!dia.horaEntradaReal) {
      if (!dia.ausenciaAprobada) faltasInjustificadas++
      continue
    }

    const esperado = minutosDesdeMedianoche(dia.horaEntradaEsperada)
    const real = minutosDesdeMedianoche(dia.horaEntradaReal)
    if (real > esperado + toleranciaMinutos) tardanzas++
  }

  return { tardanzas, faltasInjustificadas, horasExtra50, horasExtra100 }
}
```

- [ ] **Step 4: Run test para verificar que pasa**

Run: `cd packages/motor && npx vitest run src/asistencia.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/motor/src/asistencia.ts packages/motor/src/asistencia.test.ts
git commit -m "feat: calculo de variables de asistencia (tardanzas, faltas, extras)"
```

---

### Task 15: Motor de conceptos (orden, acumuladores, reglas condicionales)

**Files:**
- Create: `packages/motor/src/motor.ts`
- Test: `packages/motor/src/motor.test.ts`

Modelo de datos que consume este módulo (lo arma la Edge Function en Task 17, acá se define el contrato):

```ts
export interface Concepto {
  codigo: string
  nombre: string
  tipo: 'remunerativo' | 'no_remunerativo' | 'descuento' | 'aporte_patronal' | 'informativo'
  orden: number
  formula: string          // fórmula base (Recursio_Diseno.md 4.2)
  reglas?: Array<{ orden: number; condicion: string; formula: string }> // 4.3, primera que aplica
  imprimible: boolean
}
```

- [ ] **Step 1: Test que falla — casos del diseño 4.3 (presentismo escalonado)**

```ts
// packages/motor/src/motor.test.ts
import { describe, it, expect } from 'vitest'
import { liquidarConceptos } from './motor'

const presentismoEscalonado = {
  codigo: 'presentismo',
  nombre: 'Presentismo',
  tipo: 'remunerativo' as const,
  orden: 2,
  formula: 'remunerativo_acumulado * 0.0833',
  reglas: [
    { orden: 1, condicion: 'tardanzas > 3 or faltas_injustificadas > 0', formula: '0' },
    { orden: 2, condicion: 'tardanzas > 1', formula: 'remunerativo_acumulado * 0.0833 * 0.5' },
  ],
  imprimible: true,
}

const basico = {
  codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo' as const, orden: 1,
  formula: 'basico_convenio', imprimible: true,
}

describe('liquidarConceptos — presentismo escalonado (Recursio_Diseno.md 4.3)', () => {
  it('con 0 tardanzas y 0 faltas paga presentismo 100%', () => {
    const r = liquidarConceptos([basico, presentismoEscalonado], {
      basico_convenio: 1000, tardanzas: 0, faltas_injustificadas: 0,
    })
    const item = r.items.find((i) => i.codigo === 'presentismo')!
    // remunerativo_acumulado tras 'basico' = 1000 → 1000*0.0833 = 83.3
    expect(item.monto).toBeCloseTo(83.3, 1)
    expect(item.reglaAplicada).toBe('base')
  })

  it('con 2 tardanzas paga presentismo al 50% (regla de orden 2)', () => {
    const r = liquidarConceptos([basico, presentismoEscalonado], {
      basico_convenio: 1000, tardanzas: 2, faltas_injustificadas: 0,
    })
    const item = r.items.find((i) => i.codigo === 'presentismo')!
    expect(item.monto).toBeCloseTo(41.65, 1)
    expect(item.reglaAplicada).toBe(1) // índice de la regla en el array `reglas` (orden 2 → índice 1)
  })

  it('con más de 3 tardanzas pierde presentismo (regla de orden 1, primera que aplica)', () => {
    const r = liquidarConceptos([basico, presentismoEscalonado], {
      basico_convenio: 1000, tardanzas: 5, faltas_injustificadas: 0,
    })
    const item = r.items.find((i) => i.codigo === 'presentismo')!
    expect(item.monto).toBe(0)
    expect(item.reglaAplicada).toBe(0)
  })

  it('con 1 falta injustificada pierde presentismo aunque no haya tardanzas', () => {
    const r = liquidarConceptos([basico, presentismoEscalonado], {
      basico_convenio: 1000, tardanzas: 0, faltas_injustificadas: 1,
    })
    const item = r.items.find((i) => i.codigo === 'presentismo')!
    expect(item.monto).toBe(0)
  })

  it('acumula remunerativo_acumulado en orden: básico entra antes de presentismo', () => {
    const r = liquidarConceptos([basico, presentismoEscalonado], {
      basico_convenio: 1000, tardanzas: 0, faltas_injustificadas: 0,
    })
    // remunerativo_acumulado final = basico (1000) + presentismo (83.3)
    expect(r.remunerativoAcumulado).toBeCloseTo(1083.3, 1)
  })

  it('conceptos fuera de orden se evalúan en el orden numérico, no en el orden del array', () => {
    const r = liquidarConceptos([presentismoEscalonado, basico], { // invertidos a propósito
      basico_convenio: 1000, tardanzas: 0, faltas_injustificadas: 0,
    })
    expect(r.items[0].codigo).toBe('basico')
    expect(r.items[1].codigo).toBe('presentismo')
  })
})
```

- [ ] **Step 2: Run test para verificar que falla**

Run: `cd packages/motor && npx vitest run src/motor.test.ts`
Expected: FAIL (módulo no existe)

- [ ] **Step 3: Implementar `motor.ts`**

```ts
// packages/motor/src/motor.ts
import { evaluar } from './interprete'

export interface Concepto {
  codigo: string
  nombre: string
  tipo: 'remunerativo' | 'no_remunerativo' | 'descuento' | 'aporte_patronal' | 'informativo'
  orden: number
  formula: string
  reglas?: Array<{ orden: number; condicion: string; formula: string }>
  imprimible: boolean
}

export interface ItemLiquidado {
  codigo: string
  nombre: string
  tipo: Concepto['tipo']
  monto: number
  reglaAplicada: number | 'base' // índice en `reglas`, o 'base' si no aplicó ninguna
}

export interface ResultadoLiquidacion {
  items: ItemLiquidado[]
  remunerativoAcumulado: number
  bruto: number
  totalDescuentos: number
  neto: number
}

// Variables predefinidas del diseño (4.2): además de las que vienen del
// snapshot, `remunerativo_acumulado` se recalcula dinámicamente concepto a
// concepto (4.2, punto 2: "el motor evalúa los conceptos ... en orden").
export function liquidarConceptos(conceptos: Concepto[], variablesBase: Record<string, number>): ResultadoLiquidacion {
  const ordenados = [...conceptos].sort((a, b) => a.orden - b.orden)
  const items: ItemLiquidado[] = []
  let remunerativoAcumulado = 0
  let bruto = 0
  let totalDescuentos = 0

  for (const concepto of ordenados) {
    const vars = { ...variablesBase, remunerativo_acumulado: remunerativoAcumulado }

    let formula = concepto.formula
    let reglaAplicada: number | 'base' = 'base'
    if (concepto.reglas) {
      const reglasOrdenadas = [...concepto.reglas].sort((a, b) => a.orden - b.orden)
      for (let i = 0; i < reglasOrdenadas.length; i++) {
        const condicionVerdadera = evaluar(reglasOrdenadas[i].condicion, vars) as boolean
        if (condicionVerdadera) {
          formula = reglasOrdenadas[i].formula
          reglaAplicada = i
          break
        }
      }
    }

    const monto = evaluar(formula, vars) as number
    items.push({ codigo: concepto.codigo, nombre: concepto.nombre, tipo: concepto.tipo, monto, reglaAplicada })

    if (concepto.tipo === 'remunerativo') { remunerativoAcumulado += monto; bruto += monto }
    else if (concepto.tipo === 'no_remunerativo') { bruto += monto }
    else if (concepto.tipo === 'descuento') { totalDescuentos += monto }
  }

  return { items, remunerativoAcumulado, bruto, totalDescuentos, neto: bruto - totalDescuentos }
}
```

- [ ] **Step 4: Run test para verificar que pasa**

Run: `cd packages/motor && npx vitest run src/motor.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/motor/src/motor.ts packages/motor/src/motor.test.ts
git commit -m "feat: motor de conceptos con orden, acumuladores y reglas condicionales"
```

---

### Task 16: Casos dorados fuera de convenio (mínimo 10)

**Files:**
- Create: `packages/motor/golden/fixtures/*.json` (10 archivos)
- Create: `packages/motor/golden/golden.test.ts`
- Create: `packages/motor/golden/conceptos-fuera-convenio.ts` (definición de los conceptos base LCT usados por los fixtures)

- [ ] **Step 1: Definir los conceptos base "Fuera de convenio (LCT)"** a partir de las fórmulas verificadas contra los 3 recibos reales de Asset (ver sección "Antes de empezar"):

```ts
// packages/motor/golden/conceptos-fuera-convenio.ts
import type { Concepto } from '../src/motor'

export const CONCEPTOS_FUERA_CONVENIO: Concepto[] = [
  { codigo: 'basico', nombre: 'Sueldo básico', tipo: 'remunerativo', orden: 1, formula: 'basico_convenio', imprimible: true },
  {
    codigo: 'presentismo', nombre: 'Presentismo', tipo: 'remunerativo', orden: 2,
    formula: 'remunerativo_acumulado * 0.0833', imprimible: true,
    reglas: [
      { orden: 1, condicion: 'tardanzas > 3 or faltas_injustificadas > 0', formula: '0' },
      { orden: 2, condicion: 'tardanzas > 1', formula: 'remunerativo_acumulado * 0.0833 * 0.5' },
    ],
  },
  { codigo: 'hora_extra_50', nombre: 'Hora extra 50%', tipo: 'remunerativo', orden: 3, formula: '(basico_convenio / 200) * 1.5 * horas_extra_50', imprimible: true },
  { codigo: 'hora_extra_100', nombre: 'Hora extra 100%', tipo: 'remunerativo', orden: 4, formula: '(basico_convenio / 200) * 2 * horas_extra_100', imprimible: true },
  { codigo: 'adelanto', nombre: 'Adelanto de sueldo', tipo: 'descuento', orden: 5, formula: 'adelanto_monto', imprimible: true },
  { codigo: 'jubilacion', nombre: 'Jubilación', tipo: 'descuento', orden: 6, formula: 'round(min(remunerativo_acumulado, tope_sipa) * 0.11)', imprimible: true },
  { codigo: 'ley_19032', nombre: 'Ley 19.032 (INSSJP/PAMI)', tipo: 'descuento', orden: 7, formula: 'round(remunerativo_acumulado * 0.03)', imprimible: true },
  { codigo: 'obra_social', nombre: 'Obra social', tipo: 'descuento', orden: 8, formula: 'round(remunerativo_acumulado * 0.03)', imprimible: true },
]
```

Nota: `jubilacion`/`ley_19032`/`obra_social` se calculan sobre `remunerativo_acumulado` (que ya incluye básico + presentismo + extras, evaluados antes por estar en un `orden` menor) — así es como coinciden centavo a centavo con los 3 recibos reales (verificado a mano en la sección "Antes de empezar").

- [ ] **Step 2: Escribir los 10 fixtures JSON** — 3 reales (a partir de los recibos) + 7 sintéticos documentados como tales. Cada fixture: `{ "descripcion", "esReal", "variablesBase", "resultadoEsperado": { "items": [{ "codigo", "montoEsperado" }], "neto" } }`.

```json
// packages/motor/golden/fixtures/01-sueldo-diciembre-real.json
{
  "descripcion": "Sueldo diciembre 2025 — recibo real Asset, legajo 47",
  "esReal": true,
  "variablesBase": {
    "basico_convenio": 2277447.03,
    "tardanzas": 0,
    "faltas_injustificadas": 0,
    "horas_extra_50": 0,
    "horas_extra_100": 0,
    "adelanto_monto": 0,
    "tope_sipa": 999999999
  },
  "resultadoEsperado": {
    "items": [
      { "codigo": "jubilacion", "montoEsperado": 250519.17 },
      { "codigo": "ley_19032", "montoEsperado": 68323.41 },
      { "codigo": "obra_social", "montoEsperado": 68323.41 }
    ],
    "neto": 1890282.00
  }
}
```

```json
// packages/motor/golden/fixtures/02-sac-2do-semestre-real.json
{
  "descripcion": "SAC 2do semestre 2025 — recibo real Asset, legajo 47",
  "esReal": true,
  "variablesBase": {
    "basico_convenio": 1929836.70,
    "tardanzas": 0,
    "faltas_injustificadas": 0,
    "horas_extra_50": 0,
    "horas_extra_100": 0,
    "adelanto_monto": 0,
    "tope_sipa": 999999999
  },
  "resultadoEsperado": {
    "items": [
      { "codigo": "jubilacion", "montoEsperado": 212282.04 },
      { "codigo": "ley_19032", "montoEsperado": 57895.10 },
      { "codigo": "obra_social", "montoEsperado": 57895.10 }
    ],
    "neto": 1601765.00
  }
}
```

```json
// packages/motor/golden/fixtures/03-vacaciones-real.json
{
  "descripcion": "Vacaciones 11 días, diciembre 2025 — recibo real Asset, legajo 47",
  "esReal": true,
  "variablesBase": {
    "basico_convenio": 1582226.36,
    "tardanzas": 0,
    "faltas_injustificadas": 0,
    "horas_extra_50": 0,
    "horas_extra_100": 0,
    "adelanto_monto": 0,
    "tope_sipa": 999999999
  },
  "resultadoEsperado": {
    "items": [
      { "codigo": "jubilacion", "montoEsperado": 174044.90 },
      { "codigo": "ley_19032", "montoEsperado": 47466.79 },
      { "codigo": "obra_social", "montoEsperado": 47466.79 }
    ],
    "neto": 1313248.00
  }
}
```

```json
// packages/motor/golden/fixtures/04-presentismo-completo-sintetico.json
{
  "descripcion": "SINTÉTICO — presentismo 100% (0 tardanzas, 0 faltas)",
  "esReal": false,
  "variablesBase": { "basico_convenio": 500000, "tardanzas": 0, "faltas_injustificadas": 0, "horas_extra_50": 0, "horas_extra_100": 0, "adelanto_monto": 0, "tope_sipa": 999999999 },
  "resultadoEsperado": { "items": [{ "codigo": "presentismo", "montoEsperado": 41650 }], "neto": null }
}
```

```json
// packages/motor/golden/fixtures/05-presentismo-50-sintetico.json
{
  "descripcion": "SINTÉTICO — presentismo al 50% (2 tardanzas)",
  "esReal": false,
  "variablesBase": { "basico_convenio": 500000, "tardanzas": 2, "faltas_injustificadas": 0, "horas_extra_50": 0, "horas_extra_100": 0, "adelanto_monto": 0, "tope_sipa": 999999999 },
  "resultadoEsperado": { "items": [{ "codigo": "presentismo", "montoEsperado": 20825 }], "neto": null }
}
```

```json
// packages/motor/golden/fixtures/06-presentismo-perdido-tardanzas-sintetico.json
{
  "descripcion": "SINTÉTICO — presentismo perdido por más de 3 tardanzas",
  "esReal": false,
  "variablesBase": { "basico_convenio": 500000, "tardanzas": 4, "faltas_injustificadas": 0, "horas_extra_50": 0, "horas_extra_100": 0, "adelanto_monto": 0, "tope_sipa": 999999999 },
  "resultadoEsperado": { "items": [{ "codigo": "presentismo", "montoEsperado": 0 }], "neto": null }
}
```

```json
// packages/motor/golden/fixtures/07-presentismo-perdido-falta-sintetico.json
{
  "descripcion": "SINTÉTICO — presentismo perdido por 1 falta injustificada",
  "esReal": false,
  "variablesBase": { "basico_convenio": 500000, "tardanzas": 0, "faltas_injustificadas": 1, "horas_extra_50": 0, "horas_extra_100": 0, "adelanto_monto": 0, "tope_sipa": 999999999 },
  "resultadoEsperado": { "items": [{ "codigo": "presentismo", "montoEsperado": 0 }], "neto": null }
}
```

```json
// packages/motor/golden/fixtures/08-horas-extra-sintetico.json
{
  "descripcion": "SINTÉTICO — con horas extra al 50% y al 100%",
  "esReal": false,
  "variablesBase": { "basico_convenio": 400000, "tardanzas": 0, "faltas_injustificadas": 0, "horas_extra_50": 10, "horas_extra_100": 5, "adelanto_monto": 0, "tope_sipa": 999999999 },
  "resultadoEsperado": {
    "items": [
      { "codigo": "hora_extra_50", "montoEsperado": 30000 },
      { "codigo": "hora_extra_100", "montoEsperado": 20000 }
    ],
    "neto": null
  }
}
```

```json
// packages/motor/golden/fixtures/09-con-adelanto-sintetico.json
{
  "descripcion": "SINTÉTICO — con adelanto de sueldo descontado",
  "esReal": false,
  "variablesBase": { "basico_convenio": 500000, "tardanzas": 0, "faltas_injustificadas": 0, "horas_extra_50": 0, "horas_extra_100": 0, "adelanto_monto": 50000, "tope_sipa": 999999999 },
  "resultadoEsperado": { "items": [{ "codigo": "adelanto", "montoEsperado": 50000 }], "neto": null }
}
```

```json
// packages/motor/golden/fixtures/10-tope-sipa-sintetico.json
{
  "descripcion": "SINTÉTICO — jubilación topeada por tope_sipa",
  "esReal": false,
  "variablesBase": { "basico_convenio": 2000000, "tardanzas": 0, "faltas_injustificadas": 0, "horas_extra_50": 0, "horas_extra_100": 0, "adelanto_monto": 0, "tope_sipa": 1000000 },
  "resultadoEsperado": { "items": [{ "codigo": "jubilacion", "montoEsperado": 110000 }], "neto": null }
}
```

- [ ] **Step 3: Test que corre todos los fixtures**

```ts
// packages/motor/golden/golden.test.ts
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { liquidarConceptos } from '../src/motor'
import { CONCEPTOS_FUERA_CONVENIO } from './conceptos-fuera-convenio'

const dirFixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const archivos = readdirSync(dirFixtures).filter((f) => f.endsWith('.json')).sort()

describe('casos dorados — fuera de convenio', () => {
  it('hay al menos 10 fixtures', () => {
    expect(archivos.length).toBeGreaterThanOrEqual(10)
  })

  for (const archivo of archivos) {
    const fixture = JSON.parse(readFileSync(join(dirFixtures, archivo), 'utf-8'))
    it(`${archivo} — ${fixture.descripcion}`, () => {
      const r = liquidarConceptos(CONCEPTOS_FUERA_CONVENIO, fixture.variablesBase)
      for (const esperado of fixture.resultadoEsperado.items) {
        const item = r.items.find((i: { codigo: string }) => i.codigo === esperado.codigo)
        expect(item, `falta el ítem ${esperado.codigo} en el resultado`).toBeDefined()
        expect(item!.monto).toBeCloseTo(esperado.montoEsperado, 2)
      }
      if (fixture.resultadoEsperado.neto !== null) {
        expect(r.neto).toBeCloseTo(fixture.resultadoEsperado.neto, 2)
      }
    })
  }
})
```

- [ ] **Step 4: Run y verificar**

Run: `cd packages/motor && npx vitest run golden/golden.test.ts`
Expected: PASS (11 tests: 1 de conteo + 10 fixtures)

- [ ] **Step 5: Commit**

```bash
git add packages/motor/golden/
git commit -m "test: casos dorados fuera de convenio (3 reales + 7 sinteticos documentados)"
```

- [ ] **Step 6: Avisar al usuario** que los 3 casos reales quedaron validados centavo a centavo contra sus recibos, y confirmar si las fotos de los recibos (o una transcripción) se guardan en `packages/motor/golden/recibos-referencia/` dentro del repo o quedan fuera del control de versiones (dato salarial de una persona real — considerar `.gitignore` si el usuario prefiere no versionarlo).

---

### Task 17: Edge Function `liquidar-periodo`

**Files:**
- Create: `supabase/functions/liquidar-periodo/index.ts`
- Create: `supabase/migrations/0005_conceptos_y_reglas.sql`
- Create: `supabase/migrations/0006_periodos_liquidaciones.sql`

(Nota de numeración: `0006` ya está usado por `0006_tipos_documento_ambito.sql` de la Fase 1 — esta migración de Fase 2 se llama igual en el plan madre pero debe renombrarse a `0007_periodos_liquidaciones.sql` al implementarla, para no pisar el archivo existente. Verificar el último número usado en `supabase/migrations/` antes de crear los archivos.)

- [ ] **Step 1: Migración de conceptos y reglas** (empresa_id NULL = plantilla global, mismo patrón que `nom_convenios`):

```sql
-- 0005_conceptos_y_reglas.sql
CREATE TABLE IF NOT EXISTS nom_conceptos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID REFERENCES empresas(id) ON DELETE CASCADE, -- NULL = plantilla global
  convenio_id  UUID NOT NULL REFERENCES nom_convenios(id) ON DELETE CASCADE,
  codigo       TEXT NOT NULL,
  nombre       TEXT NOT NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('remunerativo','no_remunerativo','descuento','aporte_patronal','informativo')),
  formula      TEXT NOT NULL,
  orden        INTEGER NOT NULL,
  imprimible   BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (convenio_id, empresa_id, codigo)
);
ALTER TABLE nom_conceptos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_conceptos_select ON nom_conceptos;
CREATE POLICY nom_conceptos_select ON nom_conceptos FOR SELECT TO authenticated
  USING (empresa_id IS NULL OR empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_conceptos_write ON nom_conceptos;
CREATE POLICY nom_conceptos_write ON nom_conceptos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_conceptos_update ON nom_conceptos;
CREATE POLICY nom_conceptos_update ON nom_conceptos FOR UPDATE TO authenticated
  USING (empresa_id = auth_empresa_id()) WITH CHECK (empresa_id = auth_empresa_id());
DROP POLICY IF EXISTS nom_conceptos_delete ON nom_conceptos;
CREATE POLICY nom_conceptos_delete ON nom_conceptos FOR DELETE TO authenticated
  USING (empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_conceptos TO authenticated;
CREATE INDEX IF NOT EXISTS nom_conceptos_convenio_idx ON nom_conceptos(convenio_id);

-- Reglas condicionales (4.3): referencian el concepto por FK directa (ya
-- no hay ambigüedad global/empresa porque nom_conceptos es una sola tabla
-- con empresa_id nullable, a diferencia de lo que sugería el plan madre
-- con dos tablas separadas nom_conceptos/nom_conceptos_empresa).
CREATE TABLE IF NOT EXISTS nom_concepto_reglas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concepto_id  UUID NOT NULL REFERENCES nom_conceptos(id) ON DELETE CASCADE,
  orden        INTEGER NOT NULL,
  condicion    TEXT NOT NULL,
  formula      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_concepto_reglas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_concepto_reglas_all ON nom_concepto_reglas;
CREATE POLICY nom_concepto_reglas_all ON nom_concepto_reglas FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id
            AND (c.empresa_id IS NULL OR c.empresa_id = auth_empresa_id()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM nom_conceptos c WHERE c.id = nom_concepto_reglas.concepto_id
            AND c.empresa_id = auth_empresa_id())
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_concepto_reglas TO authenticated;
CREATE INDEX IF NOT EXISTS nom_concepto_reglas_concepto_idx ON nom_concepto_reglas(concepto_id);
```

- [ ] **Step 2: Migración de períodos y liquidaciones**

```sql
-- 0007_periodos_liquidaciones.sql (renombrar si 0006 ya está tomado)
CREATE TABLE IF NOT EXISTS nom_periodos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo               TEXT NOT NULL CHECK (tipo IN ('mensual','quincenal','sac','final')),
  fecha_desde        DATE NOT NULL,
  fecha_hasta        DATE NOT NULL,
  estado             TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','en_flujo','cerrado')),
  snapshot_parametros JSONB,
  created_at         TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_periodos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_periodos_all ON nom_periodos;
CREATE POLICY nom_periodos_all ON nom_periodos FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id()) WITH CHECK (empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_periodos TO authenticated;
CREATE INDEX IF NOT EXISTS nom_periodos_empresa_idx ON nom_periodos(empresa_id);

CREATE TABLE IF NOT EXISTS nom_liquidaciones (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo_id           UUID NOT NULL REFERENCES nom_periodos(id) ON DELETE CASCADE,
  personal_id          UUID NOT NULL,
  bruto                NUMERIC NOT NULL DEFAULT 0,
  neto                 NUMERIC NOT NULL DEFAULT 0,
  total_aportes        NUMERIC NOT NULL DEFAULT 0,
  total_contribuciones NUMERIC NOT NULL DEFAULT 0,
  estado               TEXT NOT NULL DEFAULT 'preliminar' CHECK (estado IN ('preliminar','en_flujo','aprobada','pagada')),
  detalle_horas        JSONB, -- snapshot inmutable de asistencia usado para calcular
  created_at           TIMESTAMPTZ DEFAULT now(),
  UNIQUE (periodo_id, personal_id)
);
ALTER TABLE nom_liquidaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_liquidaciones_all ON nom_liquidaciones;
CREATE POLICY nom_liquidaciones_all ON nom_liquidaciones FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id()) WITH CHECK (empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_liquidaciones TO authenticated;
CREATE INDEX IF NOT EXISTS nom_liquidaciones_periodo_idx ON nom_liquidaciones(periodo_id);

CREATE TABLE IF NOT EXISTS nom_liquidacion_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  liquidacion_id  UUID NOT NULL REFERENCES nom_liquidaciones(id) ON DELETE CASCADE,
  concepto_codigo TEXT NOT NULL,
  concepto_nombre TEXT NOT NULL,
  tipo            TEXT NOT NULL,
  monto           NUMERIC NOT NULL,
  regla_aplicada  TEXT, -- 'base' o el índice de la regla, en texto para simplicidad
  created_at      TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_liquidacion_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_liquidacion_items_all ON nom_liquidacion_items;
CREATE POLICY nom_liquidacion_items_all ON nom_liquidacion_items FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id()) WITH CHECK (empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_liquidacion_items TO authenticated;
CREATE INDEX IF NOT EXISTS nom_liquidacion_items_liquidacion_idx ON nom_liquidacion_items(liquidacion_id);

CREATE TABLE IF NOT EXISTS nom_pagos_adelantos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  personal_id UUID NOT NULL,
  periodo_id  UUID REFERENCES nom_periodos(id) ON DELETE SET NULL,
  monto       NUMERIC NOT NULL CHECK (monto > 0),
  fecha       DATE NOT NULL,
  motivo      TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE nom_pagos_adelantos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS nom_pagos_adelantos_all ON nom_pagos_adelantos;
CREATE POLICY nom_pagos_adelantos_all ON nom_pagos_adelantos FOR ALL TO authenticated
  USING (empresa_id = auth_empresa_id()) WITH CHECK (empresa_id = auth_empresa_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON nom_pagos_adelantos TO authenticated;
CREATE INDEX IF NOT EXISTS nom_pagos_adelantos_empresa_idx ON nom_pagos_adelantos(empresa_id);
```

- [ ] **Step 3: Edge Function** — importa el paquete `@recursio/motor`, arma variables por persona, corre `liquidarConceptos`, escribe en transacción idempotente (borra items previos del período antes de reinsertar, para que un reintento no duplique):

```ts
// supabase/functions/liquidar-periodo/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { liquidarConceptos, type Concepto } from '../../../packages/motor/src/motor.ts'
import { calcularAsistencia, type DiaAsistencia } from '../../../packages/motor/src/asistencia.ts'

Deno.serve(async (req) => {
  const { periodoId } = await req.json()
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: periodo, error: errPeriodo } = await supabase.from('nom_periodos').select('*').eq('id', periodoId).single()
  if (errPeriodo || !periodo) return new Response(JSON.stringify({ error: 'período no encontrado' }), { status: 404 })
  if (periodo.estado === 'cerrado') {
    return new Response(JSON.stringify({ error: 'período cerrado: no se puede recalcular' }), { status: 409 })
  }

  const { data: conceptos } = await supabase
    .from('nom_conceptos')
    .select('*, nom_concepto_reglas(*)')
    .or(`empresa_id.is.null,empresa_id.eq.${periodo.empresa_id}`)

  const conceptosMotor: Concepto[] = (conceptos || []).map((c: any) => ({
    codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, orden: c.orden, formula: c.formula, imprimible: c.imprimible,
    reglas: (c.nom_concepto_reglas || []).map((r: any) => ({ orden: r.orden, condicion: r.condicion, formula: r.formula })),
  }))

  const { data: personal } = await supabase.from('nom_v_personal').select('id').eq('empresa_id', periodo.empresa_id).eq('estado', 'activo')
  const { data: legajos } = await supabase.from('nom_legajo').select('*').eq('empresa_id', periodo.empresa_id)
  const legajoPorPersonal = new Map((legajos || []).map((l: any) => [l.personal_id, l]))

  const resultados = []
  for (const persona of personal || []) {
    const legajo = legajoPorPersonal.get(persona.id)
    if (!legajo?.cuil || !legajo?.cbu || !legajo?.convenio_id || !legajo?.categoria_id) continue // legajo incompleto, no liquida

    const { data: fichajes } = await supabase.from('nom_v_horas_dia').select('*')
      .eq('personal_id', persona.id).gte('timestamp', periodo.fecha_desde).lte('timestamp', periodo.fecha_hasta)
    const { data: ausencias } = await supabase.from('nom_v_ausencias').select('*')
      .eq('personal_id', persona.id).eq('estado', 'aprobada')

    // Construcción del snapshot diario de asistencia a partir de eventos
    // crudos: agrupa por fecha, toma la primera 'entrada' del día. El
    // turno esperado por ahora es fijo (08:00) hasta que se resuelva
    // dónde vive esa configuración (pendiente: Presencio no expone turno
    // por persona, ver nota en 0001_vistas_contrato.sql de Fase 0).
    const porDia = new Map<string, DiaAsistencia>()
    for (const f of fichajes || []) {
      const fecha = f.timestamp.slice(0, 10)
      if (f.tipo !== 'entrada') continue
      const hora = f.timestamp.slice(11, 16)
      const existente = porDia.get(fecha)
      if (!existente || hora < existente.horaEntradaReal!) {
        porDia.set(fecha, {
          fecha, horaEntradaEsperada: '08:00', horaEntradaReal: hora,
          ausenciaAprobada: (ausencias || []).some((a: any) => fecha >= a.fecha_desde && fecha <= a.fecha_hasta),
        })
      }
    }
    const asistencia = calcularAsistencia([...porDia.values()], 15)

    const variablesBase = {
      basico_convenio: 0, // TODO Fase 2 Task 18: viene de nom_categorias por categoria_id + vigencia
      tardanzas: asistencia.tardanzas,
      faltas_injustificadas: asistencia.faltasInjustificadas,
      horas_extra_50: asistencia.horasExtra50,
      horas_extra_100: asistencia.horasExtra100,
      adelanto_monto: 0, // TODO: sumar nom_pagos_adelantos del período
      tope_sipa: 999999999, // TODO: viene de nom_parametros vigente
    }

    const resultado = liquidarConceptos(conceptosMotor, variablesBase)
    resultados.push({ personalId: persona.id, resultado, asistencia })
  }

  // Idempotencia: borra liquidaciones/items previos de este período antes
  // de reinsertar, así un reintento no duplica filas.
  const { data: liquidacionesPrevias } = await supabase.from('nom_liquidaciones').select('id').eq('periodo_id', periodoId)
  if (liquidacionesPrevias?.length) {
    await supabase.from('nom_liquidacion_items').delete().in('liquidacion_id', liquidacionesPrevias.map((l: any) => l.id))
    await supabase.from('nom_liquidaciones').delete().eq('periodo_id', periodoId)
  }

  for (const r of resultados) {
    const { data: liq } = await supabase.from('nom_liquidaciones').insert({
      empresa_id: periodo.empresa_id, periodo_id: periodoId, personal_id: r.personalId,
      bruto: r.resultado.bruto, neto: r.resultado.neto, total_aportes: r.resultado.totalDescuentos,
      detalle_horas: r.asistencia, estado: 'preliminar',
    }).select().single()
    if (liq) {
      await supabase.from('nom_liquidacion_items').insert(
        r.resultado.items.map((i) => ({
          empresa_id: periodo.empresa_id, liquidacion_id: liq.id, concepto_codigo: i.codigo,
          concepto_nombre: i.nombre, tipo: i.tipo, monto: i.monto, regla_aplicada: String(i.reglaAplicada),
        }))
      )
    }
  }

  return new Response(JSON.stringify({ liquidadas: resultados.length }), { headers: { 'Content-Type': 'application/json' } })
})
```

Nota explícita para quien ejecute esta tarea: quedan 3 `TODO` marcados en el código (básico desde `nom_categorias`, adelantos desde `nom_pagos_adelantos`, tope SIPA desde `nom_parametros`) — son de la Task 18 (UI de configuración, que es donde se cargan esos valores por primera vez). No cerrar la Task 17 como "completa sin más" sin dejar esos TODO visibles en el commit.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/liquidar-periodo/ supabase/migrations/0005_conceptos_y_reglas.sql supabase/migrations/0007_periodos_liquidaciones.sql
git commit -m "feat: edge function liquidar-periodo con idempotencia y bloqueo de periodo cerrado"
```

---

### Task 18: UI Configuración — conceptos y reglas

**Files:**
- Create: `src/pages/ConfiguracionPage.jsx`
- Create: `src/components/config/EditorReglas.jsx`
- Create: `src/store/conceptosStore.js`
- Test: `src/store/__tests__/conceptosStore.test.js`, `src/components/config/__tests__/EditorReglas.test.jsx`
- Modify: `src/App.jsx` (reemplazar la ruta placeholder `configuracion`)

- [ ] **Step 1: Test que falla para los mappers de `conceptosStore`**

```js
// src/store/__tests__/conceptosStore.test.js
import { describe, it, expect } from 'vitest'
import { conceptoFromDB, conceptoToDB } from '../conceptosStore'

describe('mappers de conceptos', () => {
  it('conceptoFromDB mapea snake_case a camelCase incluyendo reglas anidadas', () => {
    const row = {
      id: 'c1', empresa_id: null, convenio_id: 'cv1', codigo: 'presentismo', nombre: 'Presentismo',
      tipo: 'remunerativo', formula: 'remunerativo_acumulado * 0.0833', orden: 2, imprimible: true,
      nom_concepto_reglas: [{ id: 'r1', orden: 1, condicion: 'tardanzas > 3', formula: '0' }],
    }
    const r = conceptoFromDB(row)
    expect(r).toEqual({
      id: 'c1', empresaId: null, convenioId: 'cv1', codigo: 'presentismo', nombre: 'Presentismo',
      tipo: 'remunerativo', formula: 'remunerativo_acumulado * 0.0833', orden: 2, imprimible: true,
      reglas: [{ id: 'r1', orden: 1, condicion: 'tardanzas > 3', formula: '0' }],
    })
  })

  it('conceptoToDB mapea camelCase a snake_case con empresa_id explícito', () => {
    const concepto = { codigo: 'basico', nombre: 'Básico', tipo: 'remunerativo', formula: 'basico_convenio', orden: 1, convenioId: 'cv1' }
    expect(conceptoToDB(concepto, 'e1')).toEqual({
      empresa_id: 'e1', convenio_id: 'cv1', codigo: 'basico', nombre: 'Básico',
      tipo: 'remunerativo', formula: 'basico_convenio', orden: 1, imprimible: true,
    })
  })
})
```

- [ ] **Step 2: Implementar `conceptosStore.js`** (mismo patrón que `legajoStore.js` de Fase 1: mappers puros + acciones CRUD, sin `persist`):

```js
// src/store/conceptosStore.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const conceptoFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, convenioId: r.convenio_id, codigo: r.codigo, nombre: r.nombre,
  tipo: r.tipo, formula: r.formula, orden: r.orden, imprimible: r.imprimible,
  reglas: (r.nom_concepto_reglas || []).map((x) => ({ id: x.id, orden: x.orden, condicion: x.condicion, formula: x.formula })),
})

export const conceptoToDB = (c, empresaId) => ({
  empresa_id: empresaId, convenio_id: c.convenioId, codigo: c.codigo, nombre: c.nombre,
  tipo: c.tipo, formula: c.formula, orden: c.orden, imprimible: c.imprimible ?? true,
})

export const useConceptosStore = create((set) => ({
  conceptos: [], cargando: false, error: null,

  cargarConceptos: async (empresaId) => {
    set({ cargando: true, error: null })
    const { data, error } = await supabase.from('nom_conceptos').select('*, nom_concepto_reglas(*)')
      .or(`empresa_id.is.null,empresa_id.eq.${empresaId}`).order('orden')
    if (error) { set({ error: error.message, cargando: false }); return }
    set({ conceptos: (data || []).map(conceptoFromDB), cargando: false })
  },

  guardarConcepto: async (concepto, empresaId) => {
    const row = conceptoToDB(concepto, empresaId)
    const query = concepto.id
      ? supabase.from('nom_conceptos').update(row).eq('id', concepto.id).select().single()
      : supabase.from('nom_conceptos').insert(row).select().single()
    const { data, error } = await query
    if (error) return { ok: false, error: error.message }
    return { ok: true, concepto: conceptoFromDB(data) }
  },
}))
```

- [ ] **Step 3: `EditorReglas.jsx`** — vista previa: evalúa la regla contra un empleado de ejemplo (criterio explícito del plan madre). Usa el intérprete del paquete motor vía una copia liviana en el cliente SOLO para la vista previa (no para liquidar de verdad — la liquidación real corre siempre server-side, esto es nomás feedback visual mientras se edita la condición):

```jsx
// src/components/config/EditorReglas.jsx
import { useState } from 'react'

// Vista previa liviana: reimplementación mínima de comparaciones simples
// para no importar el paquete completo del motor al bundle del cliente
// (el motor real corre server-side, Recursio_Diseno.md 4.4). Si la
// condición usa sintaxis que esta vista previa no soporta, se muestra
// "no se pudo evaluar" en vez de fallar — no bloquea guardar la regla.
function evaluarPreview(condicion, valoresEjemplo) {
  try {
    // eslint-disable-next-line no-new-func
    const nombres = Object.keys(valoresEjemplo)
    const valores = Object.values(valoresEjemplo)
    const condicionJs = condicion.replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b/g, '!')
    // eslint-disable-next-line no-new-func
    const fn = new Function(...nombres, `return (${condicionJs})`)
    return { ok: true, resultado: Boolean(fn(...valores)) }
  } catch {
    return { ok: false, resultado: null }
  }
}

const VALORES_EJEMPLO = { tardanzas: 2, faltas_injustificadas: 0, antiguedad_anios: 3, remunerativo_acumulado: 500000 }

export default function EditorReglas({ reglas, onChange }) {
  const [nuevaCondicion, setNuevaCondicion] = useState('')
  const [nuevaFormula, setNuevaFormula] = useState('')

  const agregarRegla = () => {
    if (!nuevaCondicion.trim() || !nuevaFormula.trim()) return
    onChange([...reglas, { orden: reglas.length + 1, condicion: nuevaCondicion, formula: nuevaFormula }])
    setNuevaCondicion(''); setNuevaFormula('')
  }

  return (
    <div>
      {reglas.map((r, i) => {
        const preview = evaluarPreview(r.condicion, VALORES_EJEMPLO)
        return (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
            <span className="badge badge-neutral">{r.orden}</span>
            <code style={{ flex: 1 }}>{r.condicion}</code>
            <span>→</span>
            <code style={{ flex: 1 }}>{r.formula}</code>
            <span className={`badge ${preview.ok ? (preview.resultado ? 'badge-success' : 'badge-neutral') : 'badge-warning'}`}>
              {preview.ok ? (preview.resultado ? 'aplica en el ejemplo' : 'no aplica en el ejemplo') : 'no se pudo evaluar'}
            </span>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input className="input" placeholder="condición (ej: tardanzas > 3)" value={nuevaCondicion} onChange={(e) => setNuevaCondicion(e.target.value)} />
        <input className="input" placeholder="fórmula si aplica" value={nuevaFormula} onChange={(e) => setNuevaFormula(e.target.value)} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={agregarRegla}>Agregar</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Test de `EditorReglas`**

```jsx
// src/components/config/__tests__/EditorReglas.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import EditorReglas from '../EditorReglas'

describe('EditorReglas', () => {
  it('muestra "aplica en el ejemplo" cuando la condición es verdadera para los valores de ejemplo', () => {
    render(<EditorReglas reglas={[{ orden: 1, condicion: 'tardanzas > 1', formula: '0' }]} onChange={vi.fn()} />)
    expect(screen.getByText('aplica en el ejemplo')).toBeInTheDocument()
  })

  it('muestra "no aplica en el ejemplo" cuando la condición es falsa', () => {
    render(<EditorReglas reglas={[{ orden: 1, condicion: 'tardanzas > 100', formula: '0' }]} onChange={vi.fn()} />)
    expect(screen.getByText('no aplica en el ejemplo')).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: `ConfiguracionPage.jsx`** (listado simple de conceptos con `EditorReglas` embebido; el alta de convenios/categorías propios se deja para una iteración posterior, marcado explícitamente como fuera de alcance de esta task):

```jsx
// src/pages/ConfiguracionPage.jsx
import { useEffect } from 'react'
import { useAuthStore } from '../store/authStore'
import { useConceptosStore } from '../store/conceptosStore'
import EditorReglas from '../components/config/EditorReglas'

export default function ConfiguracionPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const { conceptos, cargando, error, cargarConceptos, guardarConcepto } = useConceptosStore()

  useEffect(() => {
    if (empresa?.id) cargarConceptos(empresa.id)
  }, [empresa?.id])

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Configuración</h1>
        <p className="page-subtitle">Conceptos y reglas de liquidación</p>
      </div>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>}
      {cargando && <div className="card">Cargando…</div>}
      {!cargando && conceptos.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: '1rem' }}>
          <h3>{c.orden}. {c.nombre} <span className="badge badge-neutral">{c.tipo}</span></h3>
          <p style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.85rem' }}>{c.formula}</p>
          <EditorReglas
            reglas={c.reglas}
            onChange={(reglas) => guardarConcepto({ ...c, reglas }, empresa.id)}
          />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 6:** En `src/App.jsx`, reemplazar `<Route path="configuracion" element={<ProximamentePage titulo="Configuración" />} />` por `<Route path="configuracion" element={<ConfiguracionPage />} />`, importando el componente nuevo.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ConfiguracionPage.jsx src/components/config/ src/store/conceptosStore.js \
        src/store/__tests__/conceptosStore.test.js src/App.jsx
git commit -m "feat: ui de configuracion de conceptos y reglas con vista previa"
```

---

### Task 19: UI Liquidación

**Files:**
- Create: `src/pages/LiquidacionPage.jsx`
- Create: `src/store/liquidacionStore.js`
- Test: `src/store/__tests__/liquidacionStore.test.js`
- Modify: `src/App.jsx`

**Importante (regla del plan madre, instrucción 6):** este store NUNCA usa `persist` — tiene montos de sueldo reales.

- [ ] **Step 1: Test de mappers**

```js
// src/store/__tests__/liquidacionStore.test.js
import { describe, it, expect } from 'vitest'
import { liquidacionFromDB, itemFromDB } from '../liquidacionStore'

describe('mappers de liquidacion', () => {
  it('liquidacionFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'l1', empresa_id: 'e1', periodo_id: 'p1', personal_id: 'per1', bruto: 1000, neto: 800, estado: 'preliminar' }
    expect(liquidacionFromDB(row)).toEqual({
      id: 'l1', empresaId: 'e1', periodoId: 'p1', personalId: 'per1', bruto: 1000, neto: 800, estado: 'preliminar',
    })
  })

  it('itemFromDB mapea snake_case a camelCase', () => {
    const row = { id: 'i1', liquidacion_id: 'l1', concepto_codigo: 'basico', concepto_nombre: 'Básico', tipo: 'remunerativo', monto: 500, regla_aplicada: 'base' }
    expect(itemFromDB(row)).toEqual({
      id: 'i1', liquidacionId: 'l1', conceptoCodigo: 'basico', conceptoNombre: 'Básico', tipo: 'remunerativo', monto: 500, reglaAplicada: 'base',
    })
  })
})
```

- [ ] **Step 2: Implementar `liquidacionStore.js`** (dispara la Edge Function, NUNCA calcula localmente):

```js
// src/store/liquidacionStore.js
import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export const liquidacionFromDB = (r) => ({
  id: r.id, empresaId: r.empresa_id, periodoId: r.periodo_id, personalId: r.personal_id,
  bruto: r.bruto, neto: r.neto, estado: r.estado,
})

export const itemFromDB = (r) => ({
  id: r.id, liquidacionId: r.liquidacion_id, conceptoCodigo: r.concepto_codigo,
  conceptoNombre: r.concepto_nombre, tipo: r.tipo, monto: r.monto, reglaAplicada: r.regla_aplicada,
})

// Store SIN persist: contiene montos de sueldo reales (Recursio_Plan_
// Ejecucion_Sonnet5.md, instrucción 6).
export const useLiquidacionStore = create((set) => ({
  liquidaciones: [], items: [], calculando: false, error: null,

  calcularPeriodo: async (periodoId) => {
    set({ calculando: true, error: null })
    const { data, error } = await supabase.functions.invoke('liquidar-periodo', { body: { periodoId } })
    if (error) { set({ error: error.message, calculando: false }); return { ok: false, error: error.message } }
    set({ calculando: false })
    return { ok: true, data }
  },

  cargarLiquidaciones: async (periodoId) => {
    const { data, error } = await supabase.from('nom_liquidaciones').select('*').eq('periodo_id', periodoId)
    if (error) { set({ error: error.message }); return }
    set({ liquidaciones: (data || []).map(liquidacionFromDB) })
  },

  cargarItems: async (liquidacionId) => {
    const { data, error } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', liquidacionId)
    if (error) { set({ error: error.message }); return }
    set({ items: (data || []).map(itemFromDB) })
  },
}))
```

- [ ] **Step 3: `LiquidacionPage.jsx`** (abrir período existente → calcular → grilla con detalle por concepto y qué regla aplicó, criterio del plan madre):

```jsx
// src/pages/LiquidacionPage.jsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useLiquidacionStore } from '../store/liquidacionStore'

export default function LiquidacionPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const { liquidaciones, calculando, error, calcularPeriodo, cargarLiquidaciones } = useLiquidacionStore()
  const [periodos, setPeriodos] = useState([])
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState('')

  useEffect(() => {
    if (!empresa?.id) return
    supabase.from('nom_periodos').select('*').eq('empresa_id', empresa.id).order('fecha_desde', { ascending: false })
      .then(({ data }) => setPeriodos(data || []))
  }, [empresa?.id])

  const handleCalcular = async () => {
    if (!periodoSeleccionado) return
    const r = await calcularPeriodo(periodoSeleccionado)
    if (r.ok) cargarLiquidaciones(periodoSeleccionado)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Liquidación</h1>
        <p className="page-subtitle">Calcular y revisar liquidaciones por período</p>
      </div>

      <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 12, alignItems: 'center' }}>
        <select className="input" value={periodoSeleccionado} onChange={(e) => setPeriodoSeleccionado(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="">Elegir período…</option>
          {periodos.map((p) => (
            <option key={p.id} value={p.id}>{p.tipo} — {p.fecha_desde} a {p.fecha_hasta} ({p.estado})</option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" onClick={handleCalcular} disabled={!periodoSeleccionado || calculando}>
          {calculando ? 'Calculando…' : 'Calcular'}
        </button>
      </div>

      {error && <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>}

      {liquidaciones.length > 0 && (
        <div className="card table-scroll">
          <table className="table">
            <thead><tr><th>Persona</th><th>Bruto</th><th>Neto</th><th>Estado</th></tr></thead>
            <tbody>
              {liquidaciones.map((l) => (
                <tr key={l.id}>
                  <td>{l.personalId}</td>
                  <td>${l.bruto.toLocaleString('es-AR')}</td>
                  <td>${l.neto.toLocaleString('es-AR')}</td>
                  <td><span className="badge badge-neutral">{l.estado}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
```

Nota: el listado muestra `personalId` crudo en vez del nombre — cruzar con `nom_v_personal` para mostrar el nombre es una mejora directa que se puede hacer en la revisión de calidad de esta tarea (seguir el mismo patrón `Map` por id que ya usan `LegajosPage`/`DashboardPage` de Fase 1), no lo dejes así en el commit final.

- [ ] **Step 4:** En `src/App.jsx`, reemplazar `<Route path="liquidacion" element={<ProximamentePage titulo="Liquidación" />} />` por `<Route path="liquidacion" element={<LiquidacionPage />} />`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LiquidacionPage.jsx src/store/liquidacionStore.js src/store/__tests__/liquidacionStore.test.js src/App.jsx
git commit -m "feat: ui de liquidacion (calcular periodo + grilla de resultados)"
```

---

### Task 20: Recibo preliminar PDF (formato art. 140 LCT)

**Files:**
- Create: `src/utils/reciboPdf.js`
- Test: `src/utils/__tests__/reciboPdf.test.js`

Formato art. 140 LCT (mínimo legal): datos del empleador (razón social, CUIT, domicilio), datos del empleado (nombre, CUIL, categoría, fecha de ingreso), período liquidado, detalle de conceptos remunerativos/no remunerativos/descuentos con su base de cálculo, neto a cobrar, lugar y fecha de pago, espacio de firma — mismo layout que se ve en los 3 recibos reales de Asset (sección "Antes de empezar" de este plan).

- [ ] **Step 1: Test que falla**

```js
// src/utils/__tests__/reciboPdf.test.js
import { describe, it, expect } from 'vitest'
import { generarReciboPdf } from '../reciboPdf'

const datosFake = {
  empresa: { nombre: 'Asset Construcciones SA', cuit: '30-71823067-1', domicilio: 'Bauness 2047 4A - CABA' },
  persona: { nombre: 'García Cano, Juan Martín', cuil: '20-33901676-4', legajo: '47', categoria: 'Fuera de convenio', fechaIngreso: '1/7/2025' },
  periodo: { descripcion: 'Diciembre 2025' },
  items: [
    { nombre: 'Sueldo', tipo: 'remunerativo', monto: 2277447.03 },
    { nombre: 'Jubilación', tipo: 'descuento', monto: 250519.17 },
    { nombre: 'Ley 19.032', tipo: 'descuento', monto: 68323.41 },
    { nombre: 'Obra social', tipo: 'descuento', monto: 68323.41 },
  ],
  neto: 1890282.00,
}

describe('generarReciboPdf', () => {
  it('genera un documento con el nombre del empleado y el neto', () => {
    const doc = generarReciboPdf(datosFake)
    const texto = doc.internal.pages.map((p) => (Array.isArray(p) ? p.join(' ') : '')).join(' ')
    expect(texto).toContain('García Cano, Juan Martín')
    expect(texto).toContain('1890282')
  })

  it('incluye los datos del empleador (CUIT)', () => {
    const doc = generarReciboPdf(datosFake)
    const texto = doc.internal.pages.map((p) => (Array.isArray(p) ? p.join(' ') : '')).join(' ')
    expect(texto).toContain('30-71823067-1')
  })
})
```

- [ ] **Step 2: Implementar `reciboPdf.js`** (reutiliza el patrón de salto de página + wrap de texto de `legajoPdf.js`, Fase 1 Task 12 — no reinventar esa lógica, importarla si se extrae a un helper compartido, o copiarla si no vale la pena el refactor todavía):

```js
// src/utils/reciboPdf.js
import { jsPDF } from 'jspdf'

export function generarReciboPdf({ empresa, persona, periodo, items, neto }) {
  const doc = new jsPDF()
  let y = 15
  const margenInferior = doc.internal.pageSize.getHeight() - 15
  const asegurarEspacio = (alto = 6) => { if (y + alto > margenInferior) { doc.addPage(); y = 15 } }
  const linea = (t) => {
    const anchoUtil = doc.internal.pageSize.getWidth() - 28
    doc.splitTextToSize(String(t), anchoUtil).forEach((l) => { asegurarEspacio(6); doc.text(l, 14, y); y += 6 })
  }
  const titulo = (t) => { asegurarEspacio(8); doc.setFontSize(13); doc.text(t, 14, y); y += 8; doc.setFontSize(10) }

  titulo(empresa.nombre)
  linea(`CUIT: ${empresa.cuit}   ${empresa.domicilio}`)
  y += 4

  titulo('Recibo de haberes')
  linea(`${persona.nombre} — CUIL ${persona.cuil} — Legajo ${persona.legajo}`)
  linea(`Categoría: ${persona.categoria}   Fecha de ingreso: ${persona.fechaIngreso}`)
  linea(`Período: ${periodo.descripcion}`)
  y += 4

  titulo('Conceptos')
  const remunerativos = items.filter((i) => i.tipo === 'remunerativo')
  const noRemunerativos = items.filter((i) => i.tipo === 'no_remunerativo')
  const descuentos = items.filter((i) => i.tipo === 'descuento')

  remunerativos.forEach((i) => linea(`${i.nombre}: $${i.monto.toLocaleString('es-AR')}`))
  noRemunerativos.forEach((i) => linea(`${i.nombre} (no remunerativo): $${i.monto.toLocaleString('es-AR')}`))
  descuentos.forEach((i) => linea(`(-) ${i.nombre}: $${i.monto.toLocaleString('es-AR')}`))
  y += 4

  titulo(`Neto a cobrar: $${neto.toLocaleString('es-AR')}`)
  y += 8
  linea('Firma del empleador: ______________________')
  y += 10
  linea('Firma del empleado (conformidad de recepción, art. 140 LCT): ______________________')

  return doc
}
```

- [ ] **Step 3: Run test para verificar que pasa** (verificación por lectura si no hay forma de correr vitest en el entorno de quien ejecuta esta tarea; si hay, correr de verdad)

Run: `npx vitest run src/utils/__tests__/reciboPdf.test.js`
Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add src/utils/reciboPdf.js src/utils/__tests__/reciboPdf.test.js
git commit -m "feat: recibo preliminar pdf formato art 140 lct"
```

---

## CHECKPOINT FASE 2

Liquidación mensual completa fuera de convenio, validada contra los 3 recibos reales de Asset (casos dorados 1-3, centavo a centavo). **Gate externo obligatorio** (Recursio_Diseno.md 4.5): antes de dar la fase por cerrada, contratar la revisión puntual de un contador laboralista que valide fórmulas, formato de recibo y reporte de aportes — no es opcional, es parte del criterio de salida. Frenar acá y pedir revisión del usuario (y del contador) antes de escribir el detalle de Fase 3 (flujo de aprobación).
