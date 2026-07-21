import { useState } from 'react'
import { generarFormula } from '../../../packages/motor/src/formulas.ts'
import { evaluar } from '../../../packages/motor/src/interprete.ts'

// Valida generando la fórmula y evaluándola con el intérprete REAL del
// motor sobre valores de ejemplo. Si el intérprete no la acepta, no se
// guarda (spec sección 5). Los valores de ejemplo incluyen el tope que
// referencie el config para que la variable exista al evaluar.
export function validarYGenerarFormula(config) {
  try {
    const formula = generarFormula(config)
    const vars = { remunerativo_acumulado: 1000000, no_remunerativo_acumulado: 100000 }
    if (config.tope) vars[config.tope] = 800000
    evaluar(formula, vars)
    return { ok: true, formula }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Formulario estructurado de un concepto. Props:
//  concepto: existente (con config) o null para alta
//  categorias: nombres disponibles del convenio (para el multiselect; null = ocultar)
//  conMonto: permitir modo nominal (Adicionales sí, Aportes no)
//  onGuardar({ config, formula, categorias }) → { ok, error? }
export default function FormularioConcepto({ concepto, categorias, conMonto, onGuardar }) {
  const cfg = concepto?.config || {}
  const [modo, setModo] = useState(cfg.modo || 'porcentaje')
  const [porcentaje, setPorcentaje] = useState(cfg.porcentaje ?? '')
  const [base, setBase] = useState(cfg.base || 'remunerativo')
  const [conTope, setConTope] = useState(Boolean(cfg.tope))
  const [monto, setMonto] = useState(cfg.monto ?? '')
  const [seleccion, setSeleccion] = useState(concepto?.categorias || [])
  const [error, setError] = useState(null)
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    const config = modo === 'nominal'
      ? { modo, monto: Number(monto) }
      : { modo, porcentaje: Number(porcentaje), base, tope: conTope ? 'tope_sipa' : null }
    const v = validarYGenerarFormula(config)
    if (!v.ok) { setError(v.error); return }
    setGuardando(true); setError(null)
    const r = await onGuardar({ config, formula: v.formula, categorias: seleccion.length > 0 ? seleccion : null })
    setGuardando(false)
    if (!r?.ok) setError(r?.error || 'No se pudo guardar')
  }

  return (
    <div style={{ marginTop: 8 }}>
      {conMonto && (
        <select className="input" style={{ marginBottom: 6 }} value={modo} onChange={(e) => setModo(e.target.value)}>
          <option value="porcentaje">Porcentual</option>
          <option value="nominal">Monto fijo</option>
        </select>
      )}
      {modo === 'nominal' ? (
        <input className="input" type="number" placeholder="monto" value={monto} onChange={(e) => setMonto(e.target.value)} />
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" type="number" step="0.01" placeholder="%" style={{ width: 90 }}
            value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} />
          <span>sobre</span>
          <select className="input" style={{ width: 200 }} value={base} onChange={(e) => setBase(e.target.value)}>
            <option value="remunerativo">lo remunerativo</option>
            <option value="no_remunerativo">lo no remunerativo</option>
            <option value="ambos">remunerativo + no remunerativo</option>
          </select>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={conTope} onChange={(e) => setConTope(e.target.checked)} />
            con tope SIPA
          </label>
        </div>
      )}
      {categorias && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Aplica a:</span>
          {categorias.map((n) => (
            <label key={n} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input type="checkbox" checked={seleccion.includes(n)}
                onChange={(e) => setSeleccion((s) => e.target.checked ? [...s, n] : s.filter((x) => x !== n))} />
              {n}
            </label>
          ))}
          <span style={{ color: 'var(--text-secondary)' }}>(ninguna marcada = todas)</span>
        </div>
      )}
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={guardar} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar'}
      </button>
    </div>
  )
}
