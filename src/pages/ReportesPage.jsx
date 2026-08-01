import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { exportarCsv } from '../utils/exportCsv'
import SelectorPeriodo from '../components/SelectorPeriodo'

// Reportes de cierre de período (Fase 4, Task 30-32): reporte de pago
// (CBU/banco/neto), reporte de aportes/contribuciones por organismo,
// libro de sueldos, y cierre de período con bloqueo + alerta de escala
// vencida (no se recalcula acá — el cálculo ya está en LiquidacionPage;
// esta pantalla consume nom_liquidaciones/items ya generados).
export default function ReportesPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const empresaActiva = empresa || empresaVista
  const empresaId = empresaActiva?.id || ''

  const [periodos, setPeriodos] = useState([])
  const [periodoId, setPeriodoId] = useState('')
  const [liquidaciones, setLiquidaciones] = useState([])
  const [items, setItems] = useState([])
  const [legajoPorPersonal, setLegajoPorPersonal] = useState(new Map())
  const [personalPorId, setPersonalPorId] = useState(new Map())
  const [cargando, setCargando] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  const [errorCierre, setErrorCierre] = useState('')
  const [alertaEscala, setAlertaEscala] = useState(null)

  useEffect(() => {
    if (!empresaId) return
    supabase.from('nom_periodos').select('*').eq('empresa_id', empresaId).order('fecha_desde', { ascending: false })
      .then(({ data }) => setPeriodos(data || []))
  }, [empresaId])

  useEffect(() => {
    if (!periodoId) { setLiquidaciones([]); setItems([]); return }
    setCargando(true)
    Promise.all([
      supabase.from('nom_liquidaciones').select('*').eq('periodo_id', periodoId),
      supabase.from('nom_v_personal').select('id, nombre').eq('empresa_id', empresaId),
      supabase.from('nom_legajo').select('personal_id, cuil, cbu, banco, categoria_id').eq('empresa_id', empresaId),
    ]).then(([liqs, personal, legajos]) => {
      setLiquidaciones(liqs.data || [])
      setPersonalPorId(new Map((personal.data || []).map((p) => [p.id, p.nombre])))
      setLegajoPorPersonal(new Map((legajos.data || []).map((l) => [l.personal_id, l])))
      const ids = (liqs.data || []).map((l) => l.id)
      if (ids.length > 0) {
        supabase.from('nom_liquidacion_items').select('*').in('liquidacion_id', ids)
          .then(({ data }) => { setItems(data || []); setCargando(false) })
      } else {
        setItems([]); setCargando(false)
      }
    })
  }, [periodoId, empresaId])

  const periodo = periodos.find((p) => p.id === periodoId)
  // Ya formatea en es-AR con separador de miles ("100.000,00") ANTES de
  // pasarlo a exportarCsv — por eso las columnas de acá NO llevan
  // `tipo: 'numero'` (ver src/utils/exportCsv.js): ese tipo espera un
  // número crudo y lo formatea él mismo sin separador de miles; aplicarlo
  // sobre un string ya formateado como "100.000,00" lo rompería
  // (Number("100.000,00") no da el valor esperado). El bug de
  // LiquidacionPage.jsx (números crudos con punto decimal, que Excel
  // es-AR interpretaba como separador de miles) no ocurre acá porque
  // nunca se exportó un número sin pasar por este `fmt`.
  const fmt = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const reportePago = () => {
    exportarCsv(`reporte-pago-${periodoId}.csv`,
      [
        { titulo: 'Persona', valor: (l) => personalPorId.get(l.personal_id) || l.personal_id },
        { titulo: 'CUIL', valor: (l) => legajoPorPersonal.get(l.personal_id)?.cuil || '' },
        { titulo: 'Banco', valor: (l) => legajoPorPersonal.get(l.personal_id)?.banco || '' },
        { titulo: 'CBU', valor: (l) => legajoPorPersonal.get(l.personal_id)?.cbu || '' },
        { titulo: 'Neto', valor: (l) => fmt(l.neto) },
      ],
      liquidaciones
    )
  }

  const reporteAportes = () => {
    const porConcepto = new Map()
    for (const i of items) {
      if (i.tipo !== 'descuento' && i.tipo !== 'aporte_patronal') continue
      const key = i.concepto_codigo
      const prev = porConcepto.get(key) || { codigo: i.concepto_codigo, nombre: i.concepto_nombre, tipo: i.tipo, total: 0 }
      prev.total += Number(i.monto)
      porConcepto.set(key, prev)
    }
    exportarCsv(`reporte-aportes-contribuciones-${periodoId}.csv`,
      [
        { titulo: 'Concepto', valor: (c) => c.nombre },
        { titulo: 'Tipo', valor: (c) => c.tipo === 'descuento' ? 'Aporte del trabajador' : 'Contribución patronal' },
        { titulo: 'Total', valor: (c) => fmt(c.total) },
      ],
      [...porConcepto.values()]
    )
  }

  const libroDeSueldos = () => {
    exportarCsv(`libro-sueldos-${periodoId}.csv`,
      [
        { titulo: 'Persona', valor: (l) => personalPorId.get(l.personal_id) || l.personal_id },
        { titulo: 'CUIL', valor: (l) => legajoPorPersonal.get(l.personal_id)?.cuil || '' },
        { titulo: 'Bruto', valor: (l) => fmt(l.bruto) },
        { titulo: 'Aportes', valor: (l) => fmt(l.total_aportes) },
        { titulo: 'Contribuciones', valor: (l) => fmt(l.total_contribuciones) },
        { titulo: 'Neto', valor: (l) => fmt(l.neto) },
        { titulo: 'Recibo', valor: (l) => l.numero_recibo ?? '' },
      ],
      liquidaciones
    )
  }

  const verificarEscalaVigente = async () => {
    // Alerta de escala vencida: para cada categoría usada por los legajos
    // de este período, la última vigencia_desde cargada debería ser <= a
    // la fecha de cierre del período. Si la vigencia más reciente es muy
    // anterior (más de ~90 días antes del cierre), probablemente no se
    // actualizó la paritaria y conviene confirmar antes de cerrar.
    const categoriaIds = [...new Set([...legajoPorPersonal.values()].map((l) => l.categoria_id).filter(Boolean))]
    if (categoriaIds.length === 0) return null
    const { data: cats } = await supabase.from('nom_categorias').select('id, convenio_id, nombre').in('id', categoriaIds)
    const vencidas = []
    for (const cat of cats || []) {
      const { data: vig } = await supabase.from('nom_categorias').select('vigencia_desde')
        .eq('convenio_id', cat.convenio_id).eq('nombre', cat.nombre)
        .order('vigencia_desde', { ascending: false }).limit(1)
      const ultima = vig?.[0]?.vigencia_desde
      if (!ultima) { vencidas.push(cat.nombre); continue }
      const dias = (new Date(periodo.fecha_hasta) - new Date(ultima)) / (1000 * 60 * 60 * 24)
      if (dias > 90) vencidas.push(cat.nombre)
    }
    return vencidas.length > 0 ? vencidas : null
  }

  const handleCerrar = async () => {
    setErrorCierre('')
    const vencidas = await verificarEscalaVigente()
    if (vencidas && !alertaEscala) {
      setAlertaEscala(vencidas)
      return
    }
    setCerrando(true)
    const { error } = await supabase.from('nom_periodos').update({ estado: 'cerrado' }).eq('id', periodoId)
    setCerrando(false)
    setAlertaEscala(null)
    if (error) { setErrorCierre(error.message); return }
    setPeriodos((prev) => prev.map((p) => p.id === periodoId ? { ...p, estado: 'cerrado' } : p))
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Reportes</h1>
        <p className="page-subtitle">Reporte de pago, aportes/contribuciones, libro de sueldos y cierre de período</p>
      </div>

      {!empresaActiva && <div className="card">Elegí una empresa en Superadmin → "Entrar" para ver sus reportes.</div>}

      {empresaActiva && (
        <>
          <div className="card card-compacta" style={{ marginBottom: '1rem', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <SelectorPeriodo periodos={periodos} value={periodoId} onChange={(v) => { setPeriodoId(v); setAlertaEscala(null) }} />
          </div>

          {periodoId && cargando && <div className="card">Cargando…</div>}

          {periodoId && !cargando && (
            <>
              {liquidaciones.length === 0 && <div className="card">Este período todavía no tiene liquidaciones calculadas.</div>}
              {liquidaciones.length > 0 && (
                <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" onClick={reportePago}>Exportar reporte de pago (CSV)</button>
                  <button className="btn btn-primary btn-sm" onClick={reporteAportes}>Exportar aportes/contribuciones (CSV)</button>
                  <button className="btn btn-primary btn-sm" onClick={libroDeSueldos}>Exportar libro de sueldos (CSV)</button>
                </div>
              )}

              <div className="card">
                <h3>Cierre de período</h3>
                {periodo?.estado === 'cerrado' ? (
                  <p>Este período ya está cerrado.</p>
                ) : (
                  <>
                    {alertaEscala && (
                      <div className="card" style={{ background: 'rgba(200,168,75,0.08)', border: '1px solid var(--brand-secondary)', marginBottom: 8 }}>
                        La escala de estas categorías no se actualizó hace más de 90 días respecto al cierre del período: {alertaEscala.join(', ')}.
                        Verificá si corresponde cargar una paritaria nueva antes de cerrar.
                      </div>
                    )}
                    <button className="btn btn-primary btn-sm" onClick={handleCerrar} disabled={cerrando}>
                      {cerrando ? 'Cerrando…' : alertaEscala ? 'Cerrar de todos modos' : 'Cerrar período'}
                    </button>
                    {errorCierre && <p style={{ color: 'var(--danger)' }}>{errorCierre}</p>}
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
