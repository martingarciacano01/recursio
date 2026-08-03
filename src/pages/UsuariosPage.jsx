import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useUsuariosStore } from '../store/usuariosStore'
import { useToastStore } from '../store/toastStore'

const ROLES = ['admin', 'rrhh', 'revisor_interno', 'aprobador_pagos', 'revisor_externo', 'supervisor', 'consulta']

export default function UsuariosPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const empresaActiva = empresa || empresaVista
  const { usuarios, cargando, error, cargarUsuarios, invitarUsuario, quitarRol } = useUsuariosStore()

  const [email, setEmail] = useState('')
  const [rol, setRol] = useState('rrhh')
  const [invitando, setInvitando] = useState(false)
  const [errorInvitar, setErrorInvitar] = useState('')
  const push = useToastStore((s) => s.push)

  useEffect(() => { if (empresaActiva?.id) cargarUsuarios(empresaActiva.id) }, [empresaActiva?.id])

  const handleQuitar = async (u) => {
    const etiqueta = u.email || `usuario ${u.usuarioId.slice(0, 8)}`
    if (!window.confirm(`¿Quitar a ${etiqueta} (rol ${u.rol}) de esta empresa?`)) return
    const r = await quitarRol(u.id)
    if (r && r.ok === false) { push(r.error || 'No se pudo quitar el usuario', 'error'); return }
    push(`${etiqueta} ya no tiene acceso.`, 'success')
    cargarUsuarios(empresaActiva.id)
  }

  const handleInvitar = async () => {
    setErrorInvitar(''); setInvitando(true)
    const r = await invitarUsuario({ email: email.trim(), empresaId: empresaActiva.id, rol, alcanceTipo: 'empresa', alcanceId: null })
    setInvitando(false)
    if (!r.ok) { setErrorInvitar(r.error); return }
    push(r.yaExistia ? 'Usuario vinculado (ya tenía cuenta).' : 'Invitación enviada por email.', 'success')
    setEmail('')
    cargarUsuarios(empresaActiva.id)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Usuarios</h1>
        <p className="page-subtitle">Roles y accesos de la empresa</p>
      </div>

      {!empresaActiva && <div className="card">Elegí una empresa en Superadmin → "Entrar" para gestionar usuarios.</div>}

      {empresaActiva && (
        <>
          <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="input" placeholder="email@empresa.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: 260 }} />
            <select className="input" aria-label="Rol" value={rol} onChange={(e) => setRol(e.target.value)} style={{ maxWidth: 200 }}>
              {ROLES.map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" onClick={handleInvitar} disabled={!email.trim() || invitando}>
              {invitando ? 'Invitando…' : 'Invitar'}
            </button>
          </div>
          {errorInvitar && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{errorInvitar}</div>}
          {error && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error: {error}</div>}

          {cargando ? <div className="card">Cargando…</div> : usuarios.length === 0 ? (
            <div className="card">Todavía no invitaste a nadie a esta empresa.</div>
          ) : (
            <div className="card table-scroll">
              <table className="table">
                <thead><tr><th>Usuario</th><th>Rol</th><th>Alcance</th><th></th></tr></thead>
                <tbody>
                  {usuarios.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email || `usuario ${u.usuarioId.slice(0, 8)}`}</td>
                      <td>{u.rol}</td>
                      <td>{u.alcanceTipo}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleQuitar(u)}>
                          Quitar
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
    </div>
  )
}
