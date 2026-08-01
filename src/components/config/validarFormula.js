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
