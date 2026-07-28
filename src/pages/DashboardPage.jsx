import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Users, AlertTriangle, CheckSquare, Calculator, UserMinus } from 'lucide-react'
import { legajoIncompleto } from '../utils/legajoCompletitud'
import { periodosPendientesDelMes, urgenciaLiquidacion, bajasSinFinal, valorAlerta, DEFAULTS_ALERTAS } from '../utils/alertasDashboard'
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
import { useAuthStore } from '../store/authStore'

// Dashboard orientado a tareas pendientes (Fase 6 Task 9): qué hay que
// hacer hoy, no cuánta gente hay. Cada tarjeta navega a la pantalla donde
// se resuelve ese pendiente. Los umbrales de alerta se configuran en
// Configuración → Alertas (nom_parametros: alerta_liq_dia, alerta_doc_dias).
export default function DashboardPage() {
  const navigate = useNavigate()
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  // Un Superadmin tiene bypass de RLS (0008_superadmin_bypass.sql) y vería
  // personal/legajos de TODAS las empresas mezclados si no filtramos acá.
  const empresaActiva = empresa || empresaVista
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [datos, setDatos] = useState({
    totalActivo: 0, incompletos: 0, docsPendientes: 0,
    aprobaciones: 0, periodosPendientes: [], bajas: 0, urgencia: 'ok',
  })

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setCargando(true)
      setError('')
      if (!empresaActiva?.id) { setCargando(false); return }
      const empresaId = empresaActiva.id
      const hoy = new Date().toISOString().slice(0, 10)

      const [
        { data: personal, error: errPersonal },
        { data: legajos, error: errLegajos },
        { data: periodos },
        { data: aprobaciones },
        { data: parametros },
        { data: requeridos },
        { data: documentos },
      ] = await Promise.all([
        supabase.from('nom_v_personal').select('id, estado').eq('estado', 'activo').eq('empresa_id', empresaId),
        supabase.from('nom_legajo').select('personal_id, cuil, cbu, convenio_id, categoria_id, fuera_convenio, sueldo_convenido, fecha_baja, liquidacion_final_id').eq('empresa_id', empresaId),
        supabase.from('nom_periodos').select('*').eq('empresa_id', empresaId).order('fecha_desde', { ascending: false }).limit(24),
        supabase.from('nom_flujo_instancias').select('id, estado').eq('empresa_id', empresaId).eq('estado', 'en_progreso'),
        supabase.from('nom_parametros').select('codigo, valor').eq('empresa_id', empresaId),
        supabase.from('nom_documentos_requeridos').select('id, obligatorio').eq('empresa_id', empresaId),
        supabase.from('nom_documentos_legajo').select('personal_id, requerido_id, fecha_vencimiento').eq('empresa_id', empresaId),
      ])
      if (cancelado) return
      if (errPersonal || errLegajos) {
        setError((errPersonal || errLegajos).message)
        setCargando(false)
        return
      }

      const legajoPorPersonal = new Map((legajos || []).map((l) => [l.personal_id, {
        cuil: l.cuil, cbu: l.cbu, convenioId: l.convenio_id, categoriaId: l.categoria_id,
        fueraConvenio: l.fuera_convenio, sueldoConvenido: l.sueldo_convenido,
      }]))
      const incompletos = (personal || []).filter((p) => legajoIncompleto(legajoPorPersonal.get(p.id))).length

      const diasAviso = valorAlerta(parametros, 'alerta_doc_dias', DEFAULTS_ALERTAS.alertaDocDias)
      const diaUmbral = valorAlerta(parametros, 'alerta_liq_dia', DEFAULTS_ALERTAS.alertaLiqDia)

      const obligatorios = (requeridos || []).filter((r) => r.obligatorio).map((r) => r.id)
      const limiteAviso = new Date(Date.now() + diasAviso * 86400000).toISOString().slice(0, 10)
      const docsPorPersona = new Map()
      for (const d of documentos || []) {
        if (!docsPorPersona.has(d.personal_id)) docsPorPersona.set(d.personal_id, [])
        docsPorPersona.get(d.personal_id).push(d)
      }
      // Una persona cuenta como "documentación pendiente" si le falta algún
      // obligatorio o si tiene alguno vencido / por vencer dentro del aviso.
      const docsPendientes = (personal || []).filter((p) => {
        const suyos = docsPorPersona.get(p.id) || []
        const cargados = new Set(suyos.map((d) => d.requerido_id).filter(Boolean))
        const falta = obligatorios.some((id) => !cargados.has(id))
        const porVencer = suyos.some((d) => d.fecha_vencimiento && d.fecha_vencimiento <= limiteAviso)
        return falta || porVencer
      }).length

      const pendientes = periodosPendientesDelMes(periodos, hoy)

      setDatos({
        totalActivo: (personal || []).length,
        incompletos,
        docsPendientes,
        aprobaciones: (aprobaciones || []).length,
        periodosPendientes: pendientes,
        bajas: bajasSinFinal(legajos).length,
        urgencia: urgenciaLiquidacion(pendientes.length, hoy, diaUmbral),
      })
      setCargando(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [empresaActiva?.id])

  const val = (n) => (cargando ? '—' : n)
  const colorUrgencia = datos.urgencia === 'urgente' ? 'var(--danger)' : datos.urgencia === 'normal' ? 'var(--warning)' : 'var(--brand-secondary)'

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Qué hay pendiente hoy</p>
      </div>

      {!empresaActiva && <div className="card">Elegí una empresa en Superadmin → "Entrar" para ver sus pendientes.</div>}

      {error && (
        <div className="card" style={{ borderColor: 'rgba(218,54,51,0.4)', color: 'var(--danger)', marginBottom: '1rem' }}>
          Error al cargar datos: {error}
        </div>
      )}

      {empresaActiva && !error && (
        <>
          <div className="stats-grid">
            <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/aprobaciones')}>
              <CheckSquare size={18} color="var(--brand-secondary)" style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.aprobaciones)}</div>
              <div className="stat-label">Aprobaciones pendientes</div>
            </div>

            <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/liquidacion')}>
              <Calculator size={18} color={colorUrgencia} style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.periodosPendientes.length)}</div>
              <div className="stat-label">
                Liquidaciones a realizar
                {datos.urgencia === 'urgente' && <span className="badge badge-danger" style={{ marginLeft: 6 }}>urgente</span>}
              </div>
            </div>

            <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/legajos')}>
              <AlertTriangle size={18} color="var(--warning)" style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.incompletos + datos.docsPendientes)}</div>
              <div className="stat-label">
                Legajos a revisar
                {!cargando && <span style={{ display: 'block', opacity: 0.7, fontSize: '0.75rem' }}>
                  {datos.incompletos} incompletos · {datos.docsPendientes} con documentación pendiente
                </span>}
              </div>
            </div>

            <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/legajos')}>
              <UserMinus size={18} color="var(--warning)" style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.bajas)}</div>
              <div className="stat-label">Bajas sin liquidación final</div>
            </div>

            <div className="stat-card">
              <Users size={18} color="var(--brand-secondary)" style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.totalActivo)}</div>
              <div className="stat-label">Personal activo</div>
            </div>
          </div>

          {!cargando && datos.periodosPendientes.length > 0 && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>Períodos abiertos este mes</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {datos.periodosPendientes.map((p) => (
                  <button key={p.id} className="btn btn-ghost btn-sm" onClick={() => navigate('/liquidacion')}>
                    {etiquetaPeriodo(p)}
                    <span className="badge badge-neutral" style={{ marginLeft: 6 }}>
                      {p.calculo_estado === 'completo' ? 'calculado' : 'sin calcular'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
