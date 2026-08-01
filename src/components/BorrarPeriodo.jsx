import { useEffect, useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'

// Borrado de un período, para poder corregir uno cargado por error.
//
// Antes de confirmar se cuenta qué se lleva puesto: nom_liquidaciones (y sus
// items) cae por ON DELETE CASCADE de la migración 0007. Si hay recibos ya
// emitidos —numero_recibo asignado, documentación laboral con valor legal—
// se avisa explícitamente y se pide escribir BORRAR, porque esa numeración no
// se recupera.
export default function BorrarPeriodo({ periodo, onBorrado, onCancelar }) {
  const [conteo, setConteo] = useState(null)
  const [confirmacion, setConfirmacion] = useState('')
  const [borrando, setBorrando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelado = false
    async function contar() {
      const { data, error: err } = await supabase
        .from('nom_liquidaciones')
        .select('id, numero_recibo')
        .eq('periodo_id', periodo.id)
      if (cancelado) return
      if (err) { setError(err.message); setConteo({ liquidaciones: 0, recibos: 0 }); return }
      setConteo({
        liquidaciones: (data || []).length,
        recibos: (data || []).filter((l) => l.numero_recibo != null).length,
      })
    }
    contar()
    return () => { cancelado = true }
  }, [periodo.id])

  const conRecibos = (conteo?.recibos || 0) > 0
  const puedeBorrar = conteo !== null && (!conRecibos || confirmacion.trim().toUpperCase() === 'BORRAR')

  const borrar = async () => {
    setBorrando(true); setError('')
    const { error: err } = await supabase.from('nom_periodos').delete().eq('id', periodo.id)
    setBorrando(false)
    if (err) { setError(err.message); return }
    onBorrado(periodo.id)
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Borrar período">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="var(--danger)" /> Borrar período
          </span>
        </div>

        <p style={{ marginBottom: 12 }}>
          Vas a borrar <strong>{etiquetaPeriodo(periodo)}</strong> ({periodo.fecha_desde} a {periodo.fecha_hasta}).
        </p>

        {conteo === null ? (
          <p className="texto-secundario">Revisando qué contiene…</p>
        ) : (
          <div className="card card-compacta" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: '0.88rem', marginBottom: conRecibos ? 8 : 0 }}>
              Se borran también <strong>{conteo.liquidaciones}</strong> liquidación(es) con todos sus conceptos.
            </p>
            {conRecibos && (
              <p style={{ fontSize: '0.88rem', color: 'var(--danger)' }}>
                Atención: <strong>{conteo.recibos}</strong> de esas liquidaciones ya tienen recibo emitido.
                Esos recibos se borran y su numeración no se recupera.
              </p>
            )}
          </div>
        )}

        {conRecibos && (
          <div className="input-group" style={{ marginBottom: 14 }}>
            <label className="input-label" htmlFor="confirmar-borrado">
              Escribí BORRAR para confirmar
            </label>
            <input
              id="confirmar-borrado"
              className="input input-corto"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              autoComplete="off"
            />
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', marginBottom: 12, fontSize: '0.85rem' }}>{error}</p>}

        <div className="acciones">
          <button className="btn btn-danger btn-sm" onClick={borrar} disabled={!puedeBorrar || borrando}>
            <Trash2 size={14} /> {borrando ? 'Borrando…' : 'Borrar período'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onCancelar} disabled={borrando}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
