import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, AlertCircle, CheckCircle2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'

// Task 4.4: destino de `resetPasswordForEmail` (redirectTo en LoginPage.jsx).
// Supabase-js detecta el token de recovery en el hash de la URL al cargar
// esta página (detectSessionInUrl, default true) y deja una sesión
// temporal activa — alcanza con `updateUser({ password })`, no hace falta
// leer el token a mano. Ruta pública (fuera de ProtectedRoute en App.jsx):
// si se exigiera sesión "normal" antes, un usuario que perdió su contraseña
// nunca podría llegar acá.
export default function RestablecerPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [listo, setListo] = useState(false)

  const handleGuardar = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (password !== confirmar) { setError('Las contraseñas no coinciden.'); return }
    setGuardando(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setGuardando(false)
    if (err) { setError(err.message); return }
    setListo(true)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: '420px' }} className="animate-fade">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2.25rem' }}>
          <Logo alto={52} />
        </div>

        <div className="card" style={{ borderColor: 'var(--border-strong)' }}>
          <h1 className="sr-only">Restablecer contraseña</h1>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '1.5rem' }}>Restablecer contraseña</h2>

          {listo ? (
            <>
              <div style={{ display: 'flex', gap: 8, padding: '0.75rem', background: 'var(--success-bg, #123a1a)', border: '1px solid var(--success)', borderRadius: 'var(--radius)', color: 'var(--success)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />Contraseña actualizada.
              </div>
              <button className="btn btn-primary btn-lg btn-bloque-centro" onClick={() => navigate('/login')}>
                Ir a iniciar sesión
              </button>
            </>
          ) : (
            <form onSubmit={handleGuardar} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="input-group">
                <label className="input-label" htmlFor="nueva-password">Nueva contraseña</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    id="nueva-password"
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    style={{ paddingLeft: '2.2rem' }}
                  />
                </div>
              </div>
              <div className="input-group">
                <label className="input-label" htmlFor="confirmar-password">Confirmar contraseña</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    id="confirmar-password"
                    className="input"
                    type="password"
                    value={confirmar}
                    onChange={(e) => setConfirmar(e.target.value)}
                    required
                    style={{ paddingLeft: '2.2rem' }}
                  />
                </div>
              </div>
              {error && (
                <div style={{ display: 'flex', gap: 8, padding: '0.75rem', background: 'var(--danger-bg)', border: '1px solid rgba(218,54,51,0.3)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: '0.85rem' }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />{error}
                </div>
              )}
              <button className="btn btn-primary btn-lg btn-bloque-centro" type="submit" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar nueva contraseña'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
