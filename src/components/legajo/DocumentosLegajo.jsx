import { useEffect, useState } from 'react'
import { useDocumentosStore, estadoDocumento, faltantes } from '../../store/documentosStore'

const FORM_VACIO = { nombre: '', requeridoId: '', fechaEmision: '', fechaVencimiento: '', observaciones: '', archivo: null }

// Documentación del legajo (Fase 6 Task 6). Muestra una sola lista con los
// documentos propios de Recursio (editables) y los que vienen de Presencio
// (solo lectura — Recursio no escribe en documentos_personal). Los tipos
// requeridos se configuran en Configuración → Documentación.
export default function DocumentosLegajo({ personalId, empresaId }) {
  const requeridos = useDocumentosStore((s) => s.requeridos)
  const documentos = useDocumentosStore((s) => s.documentos)
  const cargando = useDocumentosStore((s) => s.cargando)
  const errorCarga = useDocumentosStore((s) => s.error)
  const cargarRequeridos = useDocumentosStore((s) => s.cargarRequeridos)
  const cargarDocumentos = useDocumentosStore((s) => s.cargarDocumentos)
  const subirDocumento = useDocumentosStore((s) => s.subirDocumento)
  const eliminarDocumento = useDocumentosStore((s) => s.eliminarDocumento)
  const urlFirmada = useDocumentosStore((s) => s.urlFirmada)

  const [form, setForm] = useState(FORM_VACIO)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { cargarDocumentos(personalId) }, [personalId])
  useEffect(() => { if (empresaId) cargarRequeridos(empresaId) }, [empresaId])

  const pendientes = faltantes(requeridos, documentos)
  const diasAvisoDe = (requeridoId) => requeridos.find((r) => r.id === requeridoId)?.diasAviso ?? 30

  const handleCargar = async () => {
    setError('')
    if (!form.nombre.trim()) { setError('Poné un nombre para el documento.'); return }
    setGuardando(true)
    const r = await subirDocumento({
      archivo: form.archivo,
      nombre: form.nombre.trim(),
      requeridoId: form.requeridoId || null,
      fechaEmision: form.fechaEmision || null,
      fechaVencimiento: form.fechaVencimiento || null,
      observaciones: form.observaciones || null,
    }, personalId, empresaId)
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    setForm(FORM_VACIO)
  }

  const handleVer = async (doc) => {
    setError('')
    const r = await urlFirmada(doc.storagePath)
    if (!r.ok) { setError(r.error); return }
    window.open(r.url, '_blank', 'noopener,noreferrer')
  }

  const handleEliminar = async (doc) => {
    setError('')
    const r = await eliminarDocumento(doc.id, personalId)
    if (!r.ok) setError(r.error)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {errorCarga && <p style={{ color: 'var(--danger)' }}>Error al cargar documentos: {errorCarga}</p>}

      {pendientes.length > 0 && (
        <div className="badge badge-warning" style={{ alignSelf: 'flex-start' }}>
          Falta cargar: {pendientes.map((r) => r.nombre).join(', ')}
        </div>
      )}

      {cargando && <p style={{ color: 'var(--text-secondary)' }}>Cargando documentos…</p>}
      {!cargando && documentos.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>Sin documentos cargados.</p>}

      {documentos.length > 0 && (
        <table className="table">
          <thead>
            <tr><th>Documento</th><th>Vence</th><th>Estado</th><th>Origen</th><th></th></tr>
          </thead>
          <tbody>
            {documentos.map((d) => {
              const est = estadoDocumento(d, diasAvisoDe(d.requeridoId))
              return (
                <tr key={d.id}>
                  <td>{d.nombre}</td>
                  <td>{d.fechaVencimiento || '—'}</td>
                  <td><span className={`badge ${est.clase}`}>{est.label}</span></td>
                  <td><span className="badge badge-neutral">{d.origen === 'presencio' ? 'Presencio' : 'Recursio'}</span></td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    {d.storagePath && <button className="btn btn-ghost btn-sm" onClick={() => handleVer(d)}>Ver</button>}
                    {d.origen === 'recursio' && <button className="btn btn-ghost btn-sm" onClick={() => handleEliminar(d)}>Eliminar</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
        <strong style={{ fontSize: '0.9rem' }}>Cargar documento</strong>
        <div>
          <label htmlFor="doc-nombre" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Nombre del documento</label>
          <input id="doc-nombre" className="input" value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="doc-tipo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Tipo requerido</label>
          <select id="doc-tipo" className="input" value={form.requeridoId} onChange={(e) => setForm((f) => ({ ...f, requeridoId: e.target.value }))}>
            <option value="">Sin clasificar</option>
            {requeridos.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="doc-emision" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha de emisión (opcional)</label>
          <input id="doc-emision" className="input" type="date" value={form.fechaEmision} onChange={(e) => setForm((f) => ({ ...f, fechaEmision: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="doc-vence" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Fecha de vencimiento (opcional)</label>
          <input id="doc-vence" className="input" type="date" value={form.fechaVencimiento} onChange={(e) => setForm((f) => ({ ...f, fechaVencimiento: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="doc-archivo" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>Archivo (PDF o imagen, opcional)</label>
          <input id="doc-archivo" className="input" type="file" accept=".pdf,image/*"
            onChange={(e) => setForm((f) => ({ ...f, archivo: e.target.files?.[0] || null }))} />
        </div>

        {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}

        <div>
          <button className="btn btn-primary btn-sm" onClick={handleCargar} disabled={guardando}>
            {guardando ? 'Cargando…' : 'Cargar documento'}
          </button>
        </div>
      </div>
    </div>
  )
}
