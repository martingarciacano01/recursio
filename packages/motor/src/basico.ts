export interface ParamsBasicoPeriodo {
  modalidad: 'hora' | 'mensual' | 'quincenal'
  basico: number
  tipoPeriodo: 'mensual' | 'quincenal' | string
  horasTrabajadas: number
  faltasInjustificadas: number
}

// Base del concepto "básico" según cómo se pactó el sueldo en la escala
// (jornal por hora, mensual fijo, o quincenal fijo) versus el tipo de
// período que se está liquidando. Nunca devuelve 0 en silencio ante una
// modalidad no contemplada: lanza para que el llamador lo reporte.
export function calcularBasicoPeriodo(p: ParamsBasicoPeriodo): number {
  if (p.modalidad === 'hora') {
    return p.basico * p.horasTrabajadas
  }
  if (p.modalidad === 'mensual') {
    const base = p.tipoPeriodo === 'quincenal' ? p.basico / 2 : p.basico
    return base - p.faltasInjustificadas * (p.basico / 30)
  }
  if (p.modalidad === 'quincenal') {
    const base = p.tipoPeriodo === 'mensual' ? p.basico * 2 : p.basico
    return base - p.faltasInjustificadas * (p.basico / 15)
  }
  throw new Error(`modalidad desconocida: ${p.modalidad}`)
}
