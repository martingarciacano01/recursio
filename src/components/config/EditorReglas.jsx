import { useState } from 'react'

// Vista previa liviana: reimplementación mínima de comparaciones simples
// para no importar el paquete completo del motor al bundle del cliente
// (el motor real corre server-side, Recursio_Diseno.md 4.4). Si la
// condición usa sintaxis que esta vista previa no soporta, se muestra
// "no se pudo evaluar" en vez de fallar — no bloquea guardar la regla.
//
// SEGURIDAD: `new Function` se usa ACA únicamente para dar feedback visual
// en el cliente mientras se edita una condición (ej. "tardanzas > 3"). Esto
// NUNCA se usa para liquidar sueldos de verdad — la liquidación real siempre
// corre server-side vía la Edge Function `liquidar-periodo`, que usa su
// propio intérprete controlado (no `new Function`). Este código evalúa una
// fórmula que el propio usuario autenticado acaba de escribir en este mismo
// formulario, contra valores de ejemplo hardcodeados en el cliente — no hay
// input de terceros ni datos remotos involucrados.
function evaluarPreview(condicion, valoresEjemplo) {
  try {
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
