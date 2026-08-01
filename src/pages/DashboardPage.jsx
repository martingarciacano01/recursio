import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts'
import { supabase } from '../lib/supabase'
import { Users, AlertTriangle, CheckSquare, Calculator, UserMinus, ChevronRight } from 'lucide-react'
import { legajoIncompleto } from '../utils/legajoCompletitud'
import { periodosPendientesDelMes, urgenciaLiquidacion, bajasSinFinal, valorAlerta, DEFAULTS_ALERTAS } from '../utils/alertasDashboard'
import { repartoLegajos, personalPorConvenio, periodosRecientes, porcentaje } from '../utils/dashboardGraficos'
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
import { useTemaStore } from '../store/temaStore'
import { useAuthStore } from '../store/authStore'

// Dashboard orientado a tareas pendientes (Fase 6 Task 9): qué hay que hacer
// hoy, no cuánta gente hay. Cada tarjeta navega a la pantalla donde se
// resuelve ese pendiente. Los umbrales de alerta se configuran en
// Configuración → Empresa → Alertas (nom_parametros).
//
// Los gráficos casi no agregan consultas: reutilizan los mismos datos que ya
// se traían para las tarjetas (sólo se suma el nombre de cada convenio).
const COLOR_ESTADO = {
  alDia: 'var(--success)',
  incompletos: 'var(--danger)',
  docPendiente: 'var(--warning)',
}

function Vacio({ children }) {
  return <div className="grafico-vacio">{children}</div>
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const temaEfectivo = useTemaStore((s) => s.efectivo)
  // Un Superadmin tiene bypass de RLS (0008_superadmin_bypass.sql) y vería
  // personal/legajos de TODAS las empresas mezclados si no filtramos acá.
  const empresaActiva = empresa || empresaVista
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [datos, setDatos] = useState({
    totalActivo: 0, incompletos: 0, docsPendientes: 0,
    aprobaciones: 0, periodosPendientes: [], bajas: 0, urgencia: 'ok',
    reparto: { alDia: 0, incompletos: 0, docPendiente: 0, total: 0 },
    porConvenio: [], ultimosPeriodos: [],
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
        { data: convenios },
      ] = await Promise.all([
        supabase.from('nom_v_personal').select('id, estado').eq('estado', 'activo').eq('empresa_id', empresaId),
        supabase.from('nom_legajo').select('personal_id, cuil, cbu, convenio_id, categoria_id, fuera_convenio, sueldo_convenido, fecha_baja, liquidacion_final_id').eq('empresa_id', empresaId),
        supabase.from('nom_periodos').select('*').eq('empresa_id', empresaId).order('fecha_desde', { ascending: false }).limit(24),
        supabase.from('nom_flujo_instancias').select('id, estado').eq('empresa_id', empresaId).eq('estado', 'en_progreso'),
        supabase.from('nom_parametros').select('codigo, valor').eq('empresa_id', empresaId),
        supabase.from('nom_documentos_requeridos').select('id, obligatorio').eq('empresa_id', empresaId),
        supabase.from('nom_documentos_legajo').select('personal_id, requerido_id, fecha_vencimiento').eq('empresa_id', empresaId),
        supabase.from('nom_convenios').select('id, nombre').or(`empresa_id.is.null,empresa_id.eq.${empresaId}`),
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
      const esIncompleto = (p) => legajoIncompleto(legajoPorPersonal.get(p.id))
      const incompletos = (personal || []).filter(esIncompleto).length

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
      const tieneDocPendiente = (p) => {
        const suyos = docsPorPersona.get(p.id) || []
        const cargados = new Set(suyos.map((d) => d.requerido_id).filter(Boolean))
        const falta = obligatorios.some((id) => !cargados.has(id))
        const porVencer = suyos.some((d) => d.fecha_vencimiento && d.fecha_vencimiento <= limiteAviso)
        return falta || porVencer
      }
      const docsPendientes = (personal || []).filter(tieneDocPendiente).length

      const pendientes = periodosPendientesDelMes(periodos, hoy)

      setDatos({
        totalActivo: (personal || []).length,
        incompletos,
        docsPendientes,
        aprobaciones: (aprobaciones || []).length,
        periodosPendientes: pendientes,
        bajas: bajasSinFinal(legajos).length,
        urgencia: urgenciaLiquidacion(pendientes.length, hoy, diaUmbral),
        reparto: repartoLegajos(personal, esIncompleto, tieneDocPendiente),
        porConvenio: personalPorConvenio(personal, legajos, convenios),
        ultimosPeriodos: periodosRecientes(periodos, 6),
      })
      setCargando(false)
    }
    cargar()
    return () => { cancelado = true }
  }, [empresaActiva?.id])

  const val = (n) => (cargando ? '—' : n)
  const colorUrgencia = datos.urgencia === 'urgente' ? 'var(--danger)'
    : datos.urgencia === 'normal' ? 'var(--warning)' : 'var(--brand-secondary)'

  const datosAnillo = useMemo(() => ([
    { clave: 'alDia', nombre: 'Al día', valor: datos.reparto.alDia, color: COLOR_ESTADO.alDia },
    { clave: 'docPendiente', nombre: 'Documentación pendiente', valor: datos.reparto.docPendiente, color: COLOR_ESTADO.docPendiente },
    { clave: 'incompletos', nombre: 'Datos incompletos', valor: datos.reparto.incompletos, color: COLOR_ESTADO.incompletos },
  ].filter((d) => d.valor > 0)), [datos.reparto])

  const pctAlDia = porcentaje(datos.reparto.alDia, datos.reparto.total)

  // Recharts dibuja en SVG y no hereda las variables CSS en tooltips/ejes,
  // así que esos colores se resuelven según el tema activo.
  const estiloTooltip = {
    background: temaEfectivo === 'claro' ? '#ffffff' : '#1c2330',
    border: `1px solid ${temaEfectivo === 'claro' ? 'rgba(26,58,92,0.18)' : 'rgba(255,255,255,0.14)'}`,
    borderRadius: 10,
    color: temaEfectivo === 'claro' ? '#0f1b2d' : '#e6edf3',
    fontSize: '0.8rem',
    padding: '6px 10px',
    boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
  }
  const colorEje = temaEfectivo === 'claro' ? '#7a91a8' : '#8b949e'

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
            <div className="stat-card stat-card-accion" onClick={() => navigate('/aprobaciones')}>
              <CheckSquare size={18} color="var(--brand-secondary)" style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.aprobaciones)}</div>
              <div className="stat-label">Aprobaciones pendientes</div>
            </div>

            <div className="stat-card stat-card-accion" onClick={() => navigate('/liquidacion')}>
              <Calculator size={18} color={colorUrgencia} style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.periodosPendientes.length)}</div>
              <div className="stat-label">
                Liquidaciones a realizar
                {datos.urgencia === 'urgente' && <span className="badge badge-danger" style={{ marginLeft: 6 }}>urgente</span>}
              </div>
            </div>

            <div className="stat-card stat-card-accion" onClick={() => navigate('/legajos')}>
              <AlertTriangle size={18} color="var(--warning)" style={{ marginBottom: 8 }} />
              <div className="stat-value">{val(datos.incompletos + datos.docsPendientes)}</div>
              <div className="stat-label">
                Legajos a revisar
                {!cargando && (
                  <span className="stat-detalle">
                    {datos.incompletos} incompletos · {datos.docsPendientes} con documentación pendiente
                  </span>
                )}
              </div>
            </div>

            <div className="stat-card stat-card-accion" onClick={() => navigate('/legajos')}>
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

          <div className="grid-graficos">
            {/* Anillo: salud de los legajos */}
            <div className="grafico-card">
              <div>
                <div className="grafico-titulo">Estado de los legajos</div>
                <div className="grafico-sub">Sobre {datos.reparto.total} personas activas</div>
              </div>

              {cargando || datos.reparto.total === 0 ? (
                <Vacio>{cargando ? 'Cargando…' : 'Todavía no hay personal activo cargado.'}</Vacio>
              ) : (
                <>
                  <div className="grafico-cuerpo" style={{ position: 'relative', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={datosAnillo}
                          dataKey="valor"
                          nameKey="nombre"
                          innerRadius="64%"
                          outerRadius="94%"
                          paddingAngle={2}
                          stroke="none"
                          isAnimationActive={false}
                        >
                          {datosAnillo.map((d) => <Cell key={d.clave} fill={d.color} />)}
                        </Pie>
                        <Tooltip contentStyle={estiloTooltip} itemStyle={{ color: estiloTooltip.color }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                    }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: 800, lineHeight: 1 }}>
                        {pctAlDia}%
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>al día</div>
                    </div>
                  </div>

                  <div className="leyenda">
                    {datosAnillo.map((d) => (
                      <span key={d.clave} className="leyenda-item">
                        <span className="leyenda-punto" style={{ background: d.color }} />
                        {d.nombre} · <strong>{d.valor}</strong>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Barras: distribución por convenio */}
            <div className="grafico-card">
              <div>
                <div className="grafico-titulo">Personal por convenio</div>
                <div className="grafico-sub">Activos según el convenio del legajo</div>
              </div>

              {cargando || datos.porConvenio.length === 0 ? (
                <Vacio>{cargando ? 'Cargando…' : 'Sin datos para graficar.'}</Vacio>
              ) : (
                <div className="grafico-cuerpo" style={{ width: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={datos.porConvenio}
                      layout="vertical"
                      margin={{ top: 4, right: 16, bottom: 4, left: 4 }}
                      barCategoryGap="28%"
                    >
                      <CartesianGrid horizontal={false} stroke={colorEje} strokeOpacity={0.15} />
                      <XAxis type="number" allowDecimals={false} tick={{ fill: colorEje, fontSize: 12 }} axisLine={false} tickLine={false} />
                      <YAxis
                        type="category"
                        dataKey="nombre"
                        width={128}
                        tick={{ fill: colorEje, fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: colorEje, fillOpacity: 0.08 }}
                        contentStyle={estiloTooltip}
                        itemStyle={{ color: estiloTooltip.color }}
                        formatter={(v) => [v, 'Personas']}
                      />
                      <Bar dataKey="cantidad" fill="var(--brand-blue)" radius={[0, 6, 6, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Últimos períodos */}
            <div className="grafico-card">
              <div>
                <div className="grafico-titulo">Últimos períodos</div>
                <div className="grafico-sub">Estado de cálculo y cierre</div>
              </div>

              {cargando || datos.ultimosPeriodos.length === 0 ? (
                <Vacio>{cargando ? 'Cargando…' : 'Todavía no hay períodos creados.'}</Vacio>
              ) : (
                <div className="pila grafico-cuerpo" style={{ gap: 8, justifyContent: 'flex-start' }}>
                  {datos.ultimosPeriodos.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => navigate('/liquidacion')}
                      className="ficha"
                      style={{ cursor: 'pointer', textAlign: 'left', padding: '0.7rem 0.9rem', width: '100%' }}
                    >
                      <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem' }}>{etiquetaPeriodo(p)}</span>
                      <span className={`badge ${p.cerrado ? 'badge-success' : p.calculado ? 'badge-info' : 'badge-neutral'}`}>
                        {p.cerrado ? 'cerrado' : p.calculado ? 'calculado' : 'sin calcular'}
                      </span>
                      <ChevronRight size={15} color="var(--text-muted)" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {!cargando && datos.periodosPendientes.length > 0 && (
            <div className="card card-compacta" style={{ marginTop: '1rem' }}>
              <strong style={{ fontSize: '0.9rem' }}>Períodos abiertos este mes</strong>
              <div className="acciones" style={{ marginTop: 10 }}>
                {datos.periodosPendientes.map((p) => (
                  <button key={p.id} className="btn btn-ghost btn-sm" onClick={() => navigate('/liquidacion')}>
                    {etiquetaPeriodo(p)}
                    <span className="badge badge-neutral">
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
