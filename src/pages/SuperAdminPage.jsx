import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogIn, RefreshCw, FlaskConical, Mail, Settings2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useEmpresaFeaturesStore, FEATURES } from '../store/empresaFeaturesStore'

const fmtFecha = (iso) => iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const PLAN_LABEL = { basico: 'Básico', profesional: 'Profesional', enterprise: 'Enterprise' }
const PLAN_COLOR = { basico: 'var(--text-secondary)', profesional: 'var(--info, #3b82f6)', enterprise: 'var(--brand-secondary)' }
const FragmentoEmpresa = Fragment

// Features del plan convenios-por-obra (2026-08-07, migración 0063): no
// todos los clientes las necesitan, así que se habilitan por empresa desde
// acá en vez de estar prendidas para todo el mundo.
const FEATURES_TOGGLEABLES = [
  { key: FEATURES.CONVENIOS_POR_OBRA, label: 'Convenios por obra' },
  { key: FEATURES.TOPES_HORAS_POR_OBRA, label: 'Topes de horas por obra' },
  { key: FEATURES.AJUSTE_HORAS_PERIODO, label: 'Ajuste global de horas' },
  { key: FEATURES.BONOS_NO_REMUNERATIVOS, label: 'Bonos especiales' },
]

function FilaFeatures({ empresaId }) {
  const { features, cargarFeatures, setFeature } = useEmpresaFeaturesStore()
  const [guardando, setGuardando] = useState(null)
  const [errorGuardado, setErrorGuardado] = useState(null)

  useEffect(() => { cargarFeatures(empresaId) }, [empresaId])

  const toggle = async (feature, activo) => {
    setGuardando(feature); setErrorGuardado(null)
    const r = await setFeature(empresaId, feature, activo)
    setGuardando(null)
    if (!r.ok) setErrorGuardado(r.error)
  }

  const activas = features[empresaId] || {}

  return (
    <tr>
      <td colSpan={7} style={{ background: 'var(--bg-overlay)' }}>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', padding: '0.5rem 0' }}>
          {FEATURES_TOGGLEABLES.map((f) => (
            <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!activas[f.key]}
                disabled={guardando === f.key}
                onChange={(e) => toggle(f.key, e.target.checked)}
              />
              {f.label}
            </label>
          ))}
        </div>
        {errorGuardado && <p style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{errorGuardado}</p>}
      </td>
    </tr>
  )
}

// Panel de Superadmin: lista las empresas (vía la RPC
// get_empresas_superadmin(), ya existente y compartida con Presencio —
// mismo proyecto de Supabase, mismo esquema `empresas`) y permite
// "Entrar" para fijar `empresaVista` y así poder operar el resto de
// Recursio (Legajos, Liquidación, Configuración) como esa empresa.
// Presentación (tarjetas con plan, personal activo con barra de
// progreso, usuarios invitados) calcada del equivalente TabEmpresas de
// Presencio (fichaobra/src/pages/SuperAdminPage.jsx).
//
// Alcance intencionalmente acotado respecto a ese panel: acá no hay alta
// de empresas, edición de plan/estado, ni invitación de usuarios — nada
// de eso aplica todavía a Recursio o no hay RPC de escritura habilitada
// desde acá. Si hace falta alguna de esas capacidades, se agrega en una
// iteración posterior.
export default function SuperAdminPage() {
  const rol = useAuthStore((s) => s.rol)
  const entrarEnEmpresa = useAuthStore((s) => s.entrarEnEmpresa)
  const navigate = useNavigate()

  const [empresas, setEmpresas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [entrandoId, setEntrandoId] = useState(null)
  const [featuresAbiertaId, setFeaturesAbiertaId] = useState(null)

  const cargarEmpresas = () => {
    setCargando(true)
    setError('')
    supabase.rpc('get_empresas_superadmin').then(({ data, error: err }) => {
      setCargando(false)
      if (err) { setError(err.message); return }
      setEmpresas(data || [])
    })
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- kickoff intencional del fetch inicial.
    cargarEmpresas()
  }, [])

  const handleEntrar = (empresa) => {
    setEntrandoId(empresa.id)
    entrarEnEmpresa(empresa)
    navigate('/')
  }

  if (rol !== 'superadmin') {
    return (
      <div className="page">
        <div className="card" style={{ color: 'var(--danger)' }}>
          Esta sección es solo para usuarios Superadmin.
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Superadmin</h1>
        <p className="page-subtitle">Elegí una empresa para operar Recursio en su nombre</p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          {empresas.length} empresa{empresas.length !== 1 ? 's' : ''}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={cargarEmpresas} title="Actualizar">
          <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} /> Actualizar
        </button>
      </div>

      {error && <div className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Error: {error}</div>}

      <div className="card table-scroll" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Plan</th>
              <th style={{ color: 'var(--success, #22c55e)' }}>Personal activo</th>
              <th>Usuarios</th>
              <th>Pendientes</th>
              <th>Alta</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Cargando…</td></tr>
            )}
            {!cargando && empresas.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Sin empresas registradas.</td></tr>
            )}
            {empresas.map((e) => {
              const pct = e.max_personal ? Math.min(100, ((e.total_personal || 0) / e.max_personal) * 100) : 0
              return (
                <FragmentoEmpresa key={e.id}>
                <tr style={{ background: e.es_demo ? 'rgba(251,191,36,0.03)' : undefined }}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                        background: e.color_primario || 'var(--brand-primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <span style={{ color: e.color_secundario || 'var(--brand-secondary)', fontWeight: 800, fontSize: '0.72rem' }}>
                          {(e.nombre || '?').slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          {e.nombre}
                          {e.es_demo && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 99, background: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.4)', fontSize: '0.6rem', fontWeight: 800, color: '#fbbf24' }}>
                              <FlaskConical size={9} /> DEMO
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{e.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: PLAN_COLOR[e.plan] || 'var(--text-secondary)' }}>
                      {PLAN_LABEL[e.plan] || e.plan || '—'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 700, color: 'var(--success, #22c55e)' }}>{e.total_personal || 0}</span>
                      {e.max_personal && (
                        <>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>/ {e.max_personal}</span>
                          <div style={{ width: 40, height: 4, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 99, background: pct > 90 ? 'var(--danger)' : 'var(--success, #22c55e)', width: pct + '%' }} />
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                  <td style={{ fontWeight: 600 }}>{e.total_usuarios || 0}</td>
                  <td>
                    {e.usuarios_invitados > 0
                      ? <span className="badge badge-warning"><Mail size={10} style={{ marginRight: 3 }} />{e.usuarios_invitados}</span>
                      : <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>—</span>}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{fmtFecha(e.created_at)}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleEntrar(e)}
                      disabled={entrandoId === e.id}
                      title="Entrar en esta empresa"
                    >
                      <LogIn size={13} /> Entrar
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setFeaturesAbiertaId(featuresAbiertaId === e.id ? null : e.id)}
                      title="Features habilitadas para esta empresa"
                    >
                      <Settings2 size={13} /> Features
                    </button>
                  </td>
                </tr>
                {featuresAbiertaId === e.id && <FilaFeatures empresaId={e.id} />}
                </FragmentoEmpresa>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
