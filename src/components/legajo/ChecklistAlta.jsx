import { Check, Circle, AlertTriangle } from 'lucide-react'
import { resumenGuia } from '../../utils/guiaAlta'

// Checklist permanente del legajo: qué falta y dónde completarlo. Vive en la
// ficha (no solo durante el alta) porque la documentación vence y los datos
// cambian, así que sirve como control continuo, no solo de alta.
//
// `onIrA` recibe el nombre de la pestaña para que el padre la active.
export default function ChecklistAlta({ pasos, onIrA, onAbrirAsistente }) {
  const resumen = resumenGuia(pasos)

  return (
    <div className="card checklist">
      <div className="checklist-cabecera">
        <div>
          <h3 className="checklist-titulo">
            {resumen.completo ? 'Legajo completo' : 'Alta en curso'}
          </h3>
          <p className="grafico-sub">
            {resumen.completo
              ? 'No falta nada obligatorio para liquidar.'
              : `Faltan ${resumen.pendientesObligatorios} dato(s) obligatorio(s) para poder liquidar.`}
          </p>
        </div>
        {onAbrirAsistente && !resumen.completo && (
          <button className="btn btn-primary btn-sm" onClick={onAbrirAsistente}>
            Guía paso a paso
          </button>
        )}
      </div>

      <div className="barra" style={{ marginBottom: 14 }}>
        <span
          style={{
            width: `${resumen.porcentaje}%`,
            background: resumen.completo ? 'var(--success)' : 'var(--warning)',
          }}
        />
      </div>

      <div className="checklist-pasos">
        {pasos.map((paso) => (
          <div key={paso.id} className="checklist-paso">
            <button type="button" className="checklist-paso-titulo" onClick={() => onIrA?.(paso.pestana)}>
              {paso.listo
                ? <Check size={15} color="var(--success)" />
                : <AlertTriangle size={15} color="var(--warning)" />}
              <span>{paso.titulo}</span>
              <span className="texto-muted" style={{ fontSize: '0.75rem' }}>
                {paso.completos}/{paso.total}
              </span>
            </button>

            <ul className="checklist-items">
              {paso.items.map((item) => (
                <li key={item.id} className={item.ok ? 'ok' : item.obligatorio ? 'falta' : 'opcional'}>
                  {item.ok
                    ? <Check size={13} />
                    : <Circle size={13} />}
                  <span>{item.label}</span>
                  {!item.ok && item.obligatorio && <span className="badge badge-warning">obligatorio</span>}
                </li>
              ))}
              {paso.items.length === 0 && (
                <li className="opcional"><Circle size={13} /><span>Nada configurado</span></li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
