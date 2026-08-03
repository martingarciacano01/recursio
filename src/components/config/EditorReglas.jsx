import { useState } from 'react'
import { evaluar } from '../../../packages/motor/src/interprete.ts'

// Vista previa: usa el intérprete REAL del motor (Task 3.4, M7) en vez de
// `new Function` — antes se traducía el texto de la condición a JS
// (and→&&, or→||, not→!) y se ejecutaba con `new Function`, evaluando JS
// arbitrario en el cliente. El intérprete de packages/motor/src/interprete.ts
// ya entiende and/or/not/comparaciones nativamente (mismo parser que corre
// server-side en la Edge Function liquidar-periodo) — sin new Function, sin
// dos implementaciones del mismo lenguaje de condiciones a mantener en
// paralelo.
function evaluarPreview(condicion, valoresEjemplo) {
  try {
    return { ok: true, resultado: Boolean(evaluar(condicion, valoresEjemplo)) }
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
          <div key={r.id ?? i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
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
