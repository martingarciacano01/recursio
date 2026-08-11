import { useState } from 'react'
import { etiquetaPeriodo, etiquetaTipoPeriodo } from '../utils/etiquetaPeriodo'
import { agruparPorAnio, ordenarPeriodos } from '../utils/ordenarPeriodos'

// Estado del período como badge compacto (mismo vocabulario que el resto de
// la app: abierto / en_flujo / cerrado).
const ETIQUETA_ESTADO = {
  abierto: 'abierto',
  en_flujo: 'en aprobación',
  cerrado: 'cerrado',
}

// Selector de períodos liquidados (Item 6, sesión 2026-08-08). Reemplaza el
// <select> nativo: la consulta por mes/año/quincena quedaba incómoda en una
// lista larga (había que escrolear un optgroup gigante). Ahora se elige el
// año con chips y el período con tarjetitas por mes recreando el orden de
// liquidación (1ra quincena → 2da quincena → mensual → SAC → …).
export default function SelectorPeriodo({ periodos, value, onChange, disabled = false, obrasPorId }) {
  const nombreObra = (id) => (id && obrasPorId ? (obrasPorId.get(id) || id.slice(0, 8)) : null)
  const grupos = agruparPorAnio(periodos)
  const anios = grupos.map(([anio]) => anio)

  // Año mostrado: si el usuario eligió uno a mano lo respeta, sino el del
  // período seleccionado (o el más reciente). Se deriva durante el render,
  // así la carga asíncrona de períodos no deja la grilla vacía (estado
  // inicial '' → el render siguiente cae al año más reciente).
  const anioDelValue = value ? grupos.find(([, delAnio]) => delAnio.some((p) => p.id === value))?.[0] : null
  const [anioSel, setAnioSel] = useState('')
  const anioMostrado = anios.includes(anioSel) ? anioSel : (anioDelValue || anios[0] || '')

  const delAnio = grupos.find(([a]) => a === anioMostrado)?.[1] || []
  const porMes = new Map()
  for (const p of ordenarPeriodos(delAnio)) {
    const mes = Number(String(p.fecha_desde || '').slice(5, 7)) || 0
    if (!porMes.has(mes)) porMes.set(mes, [])
    porMes.get(mes).push(p)
  }

  if (periodos.length === 0) {
    return <span className="texto-secundario" style={{ fontSize: '0.85rem' }}>Todavía no hay períodos cargados.</span>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {anios.map((a) => (
          <button
            key={a}
            type="button"
            className={`btn-chip${a === anioMostrado ? ' chip-activo' : ''}`}
            aria-pressed={a === anioMostrado}
            aria-label={`Año ${a}`}
            onClick={() => setAnioSel(a)}
          >
            {a}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
        {[...porMes.entries()].map(([mes, delMes]) => (
          <div key={mes} className="card card-compacta" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <strong style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{nombreMes(mes)}</strong>
            {delMes.map((p) => {
              const activo = p.id === value
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={activo}
                  onClick={() => onChange(p.id)}
                  className="select-periodo-chip"
                  style={{
                    textAlign: 'left',
                    fontSize: '0.82rem',
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: `1px solid ${activo ? 'var(--acento-borde)' : 'var(--border)'}`,
                    color: activo ? 'var(--brand-secondary)' : 'var(--text-primary)',
                    background: activo ? 'var(--acento-suave)' : 'transparent',
                    cursor: 'pointer',
                    width: '100%',
                  }}
                  title={`${etiquetaPeriodo(p)} · ${p.fecha_desde} a ${p.fecha_hasta}`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{etiquetaTipoPeriodo(p.tipo)}</span>
                    <span className="badge badge-neutral" style={{ fontSize: '0.68rem', flexShrink: 0, whiteSpace: 'nowrap' }}>{ETIQUETA_ESTADO[p.estado] || p.estado}</span>
                  </div>
                  <div style={{ fontSize: '0.7rem', opacity: 0.65, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.fecha_desde} a {p.fecha_hasta}
                  </div>
                  {nombreObra(p.obra_id) && (
                    <div style={{ fontSize: '0.68rem', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--brand-secondary)' }}>
                      {nombreObra(p.obra_id)}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const nombreMes = (n) => MESES[n] || String(n)