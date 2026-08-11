import { useEffect, useState } from 'react'
import { UserPlus, Mail, UserCog, UserMinus } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { useUsuariosStore } from '../store/usuariosStore'
import { useToastStore } from '../store/toastStore'

const ROLES = [
  { value: 'admin', label: 'Administrador', desc: 'Acceso total a la empresa' },
  { value: 'rrhh', label: 'RRHH', desc: 'Carga legajos, fichajes y reportes' },
  { value: 'revisor_interno', label: 'Revisor interno', desc: 'Revisa liquidaciones y scale' },
  { value: 'aprobador_pagos', label: 'Aprobador de pagos', desc: 'Aprueba y habilita pagos' },
  { value: 'revisor_externo', label: 'Revisor externo', desc: 'Auditoría externa, solo lectura' },
  { value: 'supervisor', label: 'Supervisor', desc: 'Supervisa liquidaciones' },
  { value: 'consulta', label: 'Consulta', desc: 'Solo lectura' },
]

const rolBadge = (rol) => {
  const map = {
    admin: 'badge-danger', rrhh: 'badge-info', revisor_interno: 'badge-warning',
    aprobador_pagos: 'badge-success', revisor_externo: 'badge-neutral',
    supervisor: 'badge-neutral', consulta: 'badge-neutral',
  }
  const def = ROLES.find((r) => r.value === rol)
  return <span className={`badge ${map[rol] || 'badge-neutral'}`}>{def?.label || rol}</span>
}

const iniciales = (email) =>
  (email || '?').slice(0, 2).toUpperCase()

function ModalInvitar({ roles, onClose, onInvite, loading }) {
  const [form, setForm] = useState({ email: '', rol: 'rrhh' })
  const [error, setError] = useState('')
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Invitar usuario</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="input-group">
            <label className="input-label" htmlFor="inv-email">Email</label>
            <input id="inv-email" className="input" type="email" placeholder="usuario@empresa.com"
              value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="input-group">
            <label className="input-label" htmlFor="inv-rol">Rol</label>
            <select id="inv-rol" className="input" value={form.rol} onChange={(e) => setForm((f) => ({ ...f, rol: e.target.value }))}>
              {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {roles.find((r) => r.value === form.rol)?.desc}
            </span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.6rem 0.75rem', background: 'var(--bg-elevated)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <Mail size={12} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />
            Se enviará un email de invitación. El usuario elige su contraseña al aceptar.
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: '0.82rem' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" disabled={!form.email.trim() || loading}
              onClick={() => {
                if (!form.email.trim()) { setError('Ingresá un email.'); return }
                setError('')
                onInvite(form)
              }}>
              {loading ? 'Invitando…' : <><Mail size={16} /> Enviar invitación</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function UsuariosPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const empresaActiva = empresa || empresaVista
  const { usuarios, cargando, error, cargarUsuarios, invitarUsuario, quitarRol } = useUsuariosStore()

  const [modalAbierto, setModalAbierto] = useState(false)
  const [invitando, setInvitando] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const push = useToastStore((s) => s.push)

  useEffect(() => { if (empresaActiva?.id) cargarUsuarios(empresaActiva.id) }, [empresaActiva?.id])

  const handleInvitar = async ({ email, rol }) => {
    setInvitando(true); setInviteError('')
    const r = await invitarUsuario({ email: email.trim(), empresaId: empresaActiva.id, rol, alcanceTipo: 'empresa', alcanceId: null })
    setInvitando(false)
    if (!r.ok) { setInviteError(r.error); return }
    push(r.yaExistia ? 'Usuario vinculado (ya tenía cuenta).' : 'Invitación enviada por email.', 'success')
    setModalAbierto(false)
    cargarUsuarios(empresaActiva.id)
  }

  const handleQuitar = async (u) => {
    const etiqueta = u.email || `usuario ${u.usuarioId.slice(0, 8)}`
    if (!window.confirm(`¿Quitar a ${etiqueta} de esta empresa?`)) return
    const r = await quitarRol(u.id)
    if (r && r.ok === false) { push(r.error || 'No se pudo quitar el usuario', 'error'); return }
    push(`${etiqueta} ya no tiene acceso.`, 'success')
    cargarUsuarios(empresaActiva.id)
  }

  const rolDelUsuario = (u) => u.rol || 'consulta'

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Usuarios</h1>
          <p className="page-subtitle">Roles y accesos a la empresa</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setModalAbierto(true); setInviteError('') }}>
          <UserPlus size={16} /> Invitar usuario
        </button>
      </div>

      {!empresaActiva && <div className="card">Elegí una empresa en Superadmin → "Entrar" para gestionar usuarios.</div>}

      {inviteError && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{inviteError}</div>}
      {error && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error: {error}</div>}

      {empresaActiva && (
        <>
          {/* Cards de roles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {ROLES.map((r) => (
              <div key={r.value} style={{ padding: '0.75rem 1rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <UserCog size={15} color="var(--brand-secondary)" />
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{r.label}</span>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{r.desc}</div>
                <div style={{ marginTop: 6, fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 800, color: 'var(--brand-secondary)' }}>
                  {usuarios.filter((u) => rolDelUsuario(u) === r.value).length}
                </div>
              </div>
            ))}
          </div>

          {cargando ? <div className="card">Cargando…</div> : usuarios.length === 0 ? (
            <div className="card">Todavía no invitaste a nadie a esta empresa.</div>
          ) : (
            <div className="card table-scroll">
              <table className="table">
                <thead><tr><th>Usuario</th><th>Email</th><th>Rol</th><th>Alcance</th><th></th></tr></thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--brand-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0 }}>
                            {iniciales(u.email)}
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>{u.email || `usuario ${u.usuarioId.slice(0, 8)}`}</td>
                      <td>{rolBadge(rolDelUsuario(u))}</td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{u.alcanceTipo}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleQuitar(u)}>
                          <UserMinus size={14} /> Quitar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {modalAbierto && (
        <ModalInvitar roles={ROLES} onClose={() => setModalAbierto(false)} onInvite={handleInvitar} loading={invitando} />
      )}
    </div>
  )
}