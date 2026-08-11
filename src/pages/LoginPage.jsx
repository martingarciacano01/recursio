import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { supabase } from '../lib/supabase'
import { Lock, Mail, AlertCircle, LogIn, ShieldCheck, ArrowLeft } from 'lucide-react'
import Logo from '../components/Logo'
import { DISCLAIMER_CONTADOR } from '../utils/disclaimerRecursio'

// Layout calcado del LoginPage de Presencio (fichaobra/src/pages/LoginPage.jsx),
// ya con el isologo definitivo de Recursio (cambia según tema claro/oscuro).
export default function LoginPage() {
  const login = useAuthStore((s) => s.login)
  const verifyMfa = useAuthStore((s) => s.verifyMfa)
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Segundo factor (TOTP): la cuenta de superadmin comparte el mismo usuario
  // de Supabase Auth que Presencio, así que si ahí se enroló MFA (migración
  // 037_mfa_guard_superadmin.sql), acá también hay que completarlo — sin
  // esto, login() deja la sesión en aal1 y is_superadmin() bloquea todo del
  // lado del servidor sin ningún aviso visible (ver LoginPage.jsx de
  // Presencio, mismo flujo).
  const [mfaActivo, setMfaActivo] = useState(false)
  const [mfaCode, setMfaCode] = useState('')

  // Task 4.4: recuperación de contraseña. `recuperando` alterna el form de
  // login por el de "mandame el email de recupero" (dos pasos, no un modal,
  // para no sumar otra librería). La respuesta es SIEMPRE la misma genérica
  // — ni el éxito ni el error de resetPasswordForEmail deben distinguirse
  // en la UI, si no un atacante podría usar esto para enumerar emails
  // válidos (probar "existe/no existe" contra el formulario de login).
  const [recuperando, setRecuperando] = useState(false)
  const [emailRecupero, setEmailRecupero] = useState('')
  const [enviandoRecupero, setEnviandoRecupero] = useState(false)
  const [recuperoEnviado, setRecuperoEnviado] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await login(email, password)
    setLoading(false)
    if (!result.ok) {
      setError(result.error || 'Credenciales incorrectas')
      return
    }
    if (result.mfaRequired) {
      setMfaActivo(true)
      return
    }
    navigate('/')
  }

  const handleVerifyMfa = async (e) => {
    e.preventDefault()
    if (mfaCode.trim().length < 6) { setError('Ingresá el código de 6 dígitos'); return }
    setLoading(true)
    setError('')
    const result = await verifyMfa(mfaCode.trim())
    setLoading(false)
    if (!result.ok) { setError(result.error || 'Código incorrecto'); return }
    navigate('/')
  }

  const handleRecuperar = async (e) => {
    e.preventDefault()
    setEnviandoRecupero(true)
    await supabase.auth.resetPasswordForEmail(emailRecupero.trim(), {
      redirectTo: `${window.location.origin}/restablecer-password`,
    })
    setEnviandoRecupero(false)
    setRecuperoEnviado(true)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ width: '100%', maxWidth: '420px' }} className="animate-fade">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2.25rem' }}>
          <Logo alto={52} />
        </div>

        <div className="card" style={{ borderColor: 'var(--border-strong)' }}>
          {mfaActivo ? (
            <>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '1.5rem' }}>Verificación en dos pasos</h2>
              <form onSubmit={handleVerifyMfa} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Ingresá el código de 6 dígitos de tu app de autenticación.
                </p>
                <div className="input-group">
                  <label className="input-label" htmlFor="mfa-code">Código</label>
                  <div style={{ position: 'relative' }}>
                    <ShieldCheck size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      id="mfa-code"
                      className="input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                      required
                      autoFocus
                      style={{ paddingLeft: '2.2rem', letterSpacing: '0.3em' }}
                    />
                  </div>
                </div>
                {error && (
                  <div style={{ display: 'flex', gap: 8, padding: '0.75rem', background: 'var(--danger-bg)', border: '1px solid rgba(218,54,51,0.3)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: '0.85rem' }}>
                    <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />{error}
                  </div>
                )}
                <button className="btn btn-primary btn-lg btn-bloque-centro" type="submit" disabled={loading} style={{ marginTop: '0.5rem' }}>
                  {loading ? 'Verificando…' : <><ShieldCheck size={16} /> Verificar</>}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ alignSelf: 'center', gap: 6 }}
                  onClick={() => { setMfaActivo(false); setMfaCode(''); setError('') }}
                >
                  <ArrowLeft size={14} /> Volver
                </button>
              </form>
            </>
          ) : !recuperando ? (
            <>
              <h1 className="sr-only">Iniciar sesión</h1>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '1.5rem' }}>Iniciar sesión</h2>
              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="input-group">
                  <label className="input-label" htmlFor="email">Email</label>
                  <div style={{ position: 'relative' }}>
                    <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      id="email"
                      className="input"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="usuario@empresa.com"
                      required
                      style={{ paddingLeft: '2.2rem' }}
                    />
                  </div>
                </div>
                <div className="input-group">
                  <label className="input-label" htmlFor="password">Contraseña</label>
                  <div style={{ position: 'relative' }}>
                    <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                      id="password"
                      className="input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
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
                <button className="btn btn-primary btn-lg btn-bloque-centro" type="submit" disabled={loading} style={{ marginTop: '0.5rem' }}>
                  {loading ? 'Ingresando…' : <><LogIn size={16} /> Ingresar</>}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ alignSelf: 'center' }}
                  onClick={() => { setRecuperando(true); setEmailRecupero(email); setRecuperoEnviado(false) }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '1.5rem' }}>Recuperar contraseña</h2>
              {recuperoEnviado ? (
                <>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                    Si la cuenta existe, vas a recibir un email con instrucciones para restablecer tu contraseña.
                  </p>
                  <button type="button" className="btn btn-ghost btn-sm btn-bloque-centro" onClick={() => setRecuperando(false)}>
                    Volver a iniciar sesión
                  </button>
                </>
              ) : (
                <form onSubmit={handleRecuperar} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="input-group">
                    <label className="input-label" htmlFor="email-recupero">Email</label>
                    <div style={{ position: 'relative' }}>
                      <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                      <input
                        id="email-recupero"
                        className="input"
                        type="email"
                        value={emailRecupero}
                        onChange={(e) => setEmailRecupero(e.target.value)}
                        placeholder="usuario@empresa.com"
                        required
                        style={{ paddingLeft: '2.2rem' }}
                      />
                    </div>
                  </div>
                  <button className="btn btn-primary btn-lg btn-bloque-centro" type="submit" disabled={enviandoRecupero || !emailRecupero.trim()}>
                    {enviandoRecupero ? 'Enviando…' : 'Enviar instrucciones'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'center' }} onClick={() => setRecuperando(false)}>
                    Volver a iniciar sesión
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Recursio &mdash; Nómina para el ecosistema Presencio
        </p>
        <p style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {DISCLAIMER_CONTADOR}
        </p>
      </div>
    </div>
  )
}
