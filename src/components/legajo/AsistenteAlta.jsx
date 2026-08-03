import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, X, AlertTriangle, Circle } from 'lucide-react'
import { resumenGuia } from '../../utils/guiaAlta'
import EditorDatosLegajo from './EditorDatosLegajo'
import DocumentosLegajo from './DocumentosLegajo'
import TabFamiliares from './TabFamiliares'
import { useModalA11y } from '../../hooks/useModalA11y'

// Asistente de alta: recorre los pasos de la guía uno por uno mostrando, en
// cada uno, el mismo editor que ya usa la ficha (no hay formularios
// duplicados que después queden desincronizados) más el detalle de lo que
// falta en ese paso.
//
// Se puede saltear cualquier paso y cerrar el asistente en cualquier momento:
// lo que quede pendiente sigue marcado en el semáforo del legajo y en el
// Dashboard, igual que hoy.
export default function AsistenteAlta({ pasos, legajo, personalId, empresaId, onCerrar }) {
  const [indice, setIndice] = useState(0)
  const enResumen = indice >= pasos.length
  const paso = pasos[indice]
  const resumen = resumenGuia(pasos)
  const modalRef = useModalA11y(onCerrar)

  const contenidoDelPaso = () => {
    if (!paso) return null
    if (paso.pestana === 'Documentación') {
      return <DocumentosLegajo personalId={personalId} empresaId={empresaId} />
    }
    if (paso.pestana === 'Familiares') {
      return <TabFamiliares personalId={personalId} />
    }
    return <EditorDatosLegajo legajo={legajo} personalId={personalId} empresaId={empresaId} iniciarEditando />
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Guía de alta">
      <div className="modal modal-ancho" ref={modalRef} tabIndex={-1}>
        <div className="modal-header">
          <div>
            <span className="modal-title">Guía de alta</span>
            <p className="grafico-sub">
              {enResumen ? 'Resumen' : `Paso ${indice + 1} de ${pasos.length} · ${paso.titulo}`}
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onCerrar} aria-label="Cerrar guía"><X size={16} /></button>
        </div>

        {/* Puntos de avance */}
        <div className="asistente-pasos">
          {pasos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`asistente-punto${i === indice ? ' activo' : ''}${p.listo ? ' listo' : ''}`}
              onClick={() => setIndice(i)}
              title={p.titulo}
            >
              {p.listo ? <Check size={12} /> : i + 1}
            </button>
          ))}
        </div>

        {!enResumen && (
          <>
            <p className="texto-secundario" style={{ fontSize: '0.86rem', marginBottom: 12 }}>
              {paso.descripcion}
            </p>

            {paso.items.length > 0 && (
              <div className="card card-compacta" style={{ marginBottom: 14 }}>
                <ul className="checklist-items">
                  {paso.items.map((item) => (
                    <li key={item.id} className={item.ok ? 'ok' : item.obligatorio ? 'falta' : 'opcional'}>
                      {/* Triángulo solo para lo obligatorio pendiente: un
                          opcional sin cargar no es una alerta. */}
                      {item.ok ? <Check size={13} /> : item.obligatorio ? <AlertTriangle size={13} /> : <Circle size={13} />}
                      <span>{item.label}</span>
                      {!item.ok && item.obligatorio && <span className="badge badge-warning">obligatorio</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="asistente-contenido">{contenidoDelPaso()}</div>
          </>
        )}

        {enResumen && (
          <div style={{ marginBottom: 16 }}>
            {resumen.completo ? (
              <p style={{ color: 'var(--success)' }}>
                El legajo quedó completo: no falta ningún dato obligatorio para liquidar.
              </p>
            ) : (
              <>
                <p style={{ marginBottom: 10 }}>
                  Podés terminar igual. Quedan <strong>{resumen.pendientesObligatorios}</strong> dato(s)
                  obligatorio(s) pendiente(s); hasta completarlos la liquidación va a saltear a esta persona
                  y el legajo figura como incompleto en el Dashboard.
                </p>
                <ul className="checklist-items">
                  {resumen.nombresPendientes.map((n) => (
                    <li key={n} className="falta"><AlertTriangle size={13} /><span>{n}</span></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="acciones" style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setIndice((i) => Math.max(0, i - 1))}
            disabled={indice === 0}
          >
            <ChevronLeft size={14} /> Anterior
          </button>

          {!enResumen ? (
            <button className="btn btn-primary btn-sm" onClick={() => setIndice((i) => i + 1)}>
              {paso.listo ? 'Siguiente' : 'Saltear por ahora'} <ChevronRight size={14} />
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={onCerrar}>Terminar</button>
          )}
        </div>
      </div>
    </div>
  )
}
