import { Fragment, useEffect, useRef, useState } from 'react'
const FragmentoLiquidacion = Fragment
import { useSearchParams } from 'react-router-dom'
import { Lock, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useLiquidacionStore } from '../store/liquidacionStore'
import { useFlujosStore } from '../store/flujosStore'
import { exportarCsv } from '../utils/exportCsv'
import { registrarAcceso } from '../utils/auditoria'
import { puede } from '../utils/permisos'
import { verificarEscalaVigente } from '../utils/verificarEscala'
import SelectorPeriodo from '../components/SelectorPeriodo'
import { etiquetaConcepto } from '../utils/etiquetaConcepto'
import { etiquetaPeriodo } from '../utils/etiquetaPeriodo'
import { generarYDescargarRecibo } from '../utils/emitirReciboLegajo'
import { generarZipRecibos, nombreArchivoZip } from '../utils/reciboZip'
import LiquidacionesIndividuales from '../components/LiquidacionesIndividuales'
import { useToastStore } from '../store/toastStore'
import { useEmpresaFeaturesStore, FEATURES } from '../store/empresaFeaturesStore'
import { useConveniosStore } from '../store/conveniosStore'
import { calcularFechasPeriodo } from '../utils/calcularFechasPeriodo'
import { FUERA_DE_CONVENIO, TIPOS_MANUALES, tiposDisponibles, etiquetaTipo, convenioDelPeriodo, conveniosParaPeriodo } from '../utils/tiposPeriodo'
import BorrarPeriodo from '../components/BorrarPeriodo'

const PESTANAS = ['Nueva liquidación', 'Períodos', 'Liquidaciones individuales']

// Filtros por estado sobre el selector de períodos (Item 6, sesión
// 2026-08-08): el estado es abierto / en_flujo / cerrado (migración 0007).
const FILTROS_ESTADO = [
  { id: 'todos', label: 'Todos' },
  { id: 'abierto', label: 'Abiertos' },
  { id: 'en_flujo', label: 'En aprobación' },
  { id: 'cerrado', label: 'Cerrados' },
]

export default function LiquidacionPage() {
  const [pestana, setPestana] = useState(PESTANAS[0])
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const rol = useAuthStore((s) => s.rol)
  const rolesNomina = useAuthStore((s) => s.rolesNomina)
  // Gating de UI (Fase 1, Task 1.6): la RLS de 0026 ya bloquea la lectura
  // de nom_liquidaciones/nom_liquidacion_items si el rol no corresponde
  // — esto es solo para no mostrar un botón que fallaría igual en el
  // servidor. Superadmin siempre puede, igual que el resto del gating de
  // esta app (ver Sidebar.jsx/ProtectedRoute.jsx).
  const puedeExportar = rol === 'superadmin' || puede(rolesNomina, 'exportar')
  const puedeEmitirRecibos = rol === 'superadmin' || puede(rolesNomina, 'emitir_recibos')
  // Un usuario Superadmin no tiene `empresa` fija: opera sobre la que haya
  // elegido en /superadmin ("entrar en empresa", ver authStore.js). Esto
  // reemplaza al selector local que existía antes en esta misma página.
  const empresaActiva = empresa || empresaVista
  const empresaId = empresaActiva?.id || ''

  const { liquidaciones, calculando, omitidos, advertencias, sinHoras, calcularPeriodo, cargarLiquidaciones, emitirRecibo } = useLiquidacionStore()
  const push = useToastStore((s) => s.push)
  const [mostrarAvisos, setMostrarAvisos] = useState(false)
  const [emitiendoRecibo, setEmitiendoRecibo] = useState(null)
  const [errorRecibo, setErrorRecibo] = useState('')
  const { flujos, cargarFlujos, iniciarFlujo } = useFlujosStore()
  const [flujoElegido, setFlujoElegido] = useState('')
  const [enviandoFlujo, setEnviandoFlujo] = useState(false)
  const [errorFlujo, setErrorFlujo] = useState('')
  const [periodos, setPeriodos] = useState([])
  const [periodoSeleccionado, setPeriodoSeleccionado] = useState('')
  // Item 6 (sesión 2026-08-08): filtro por estado sobre el selector de
  // períodos — "Todos / Abiertos / En aprobación / Cerrados". Ver
  // SelectorPeriodo y los chips que arma con los períodos recibidos.
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [searchParams] = useSearchParams()
  const [personalPorId, setPersonalPorId] = useState(new Map())
  // Obra ACTUAL de cada persona (nom_v_personal.obra_id, Presencio). Se usa
  // como fallback en la grilla/CSV cuando la liquidación es anterior a la
  // migración 0064 (obra_id NULL en la fila) — el dato de Presencio siempre
  // está fresco, aunque el histórico preserve el de la fecha de liquidación.
  const [obraActualPorPersonal, setObraActualPorPersonal] = useState(new Map())
  // Obras de la empresa (Presencio, vía nom_v_obras) para mostrar la obra de
  // cada liquidación (Task 3.1, plan convenios-por-obra: obra_id persistida
  // en nom_liquidaciones por la migración 0064).
  const [obrasPorId, setObrasPorId] = useState(new Map())

  const [nuevoTipo, setNuevoTipo] = useState('')
  const [nuevoAnio, setNuevoAnio] = useState(new Date().getFullYear())
  const [nuevoMes, setNuevoMes] = useState(new Date().getMonth() + 1)
  const [nuevoConvenioId, setNuevoConvenioId] = useState('')
  const [nuevoObraId, setNuevoObraId] = useState('')
  const [nuevoDesde, setNuevoDesde] = useState('')
  const [nuevoHasta, setNuevoHasta] = useState('')
  const [creandoPeriodo, setCreandoPeriodo] = useState(false)
  const [errorCrearPeriodo, setErrorCrearPeriodo] = useState('')
  const [confirmarBorrado, setConfirmarBorrado] = useState(false)
  const [cerrando, setCerrando] = useState(false)
  // Critique 2026-08-09 (P1): cerrar el período y enviar a aprobación son
  // irreversibles y no mostraban ninguna confirmación. Reutilizan el patrón
  // de BorrarPeríodo: pedir un segundo click explícito antes de ejecutar.
  const [confirmarCierre, setConfirmarCierre] = useState(false)
  const [confirmarFlujo, setConfirmarFlujo] = useState(false)
  const [errorCierre, setErrorCierre] = useState('')
  // Task 4.6: mismo chequeo de escala vencida que ReportesPage, unificado
  // en src/utils/verificarEscala.js — antes este punto de cierre no
  // validaba nada.
  const [alertaEscala, setAlertaEscala] = useState(null)
  const { convenios, cargarConvenios } = useConveniosStore()

  const [liqExpandida, setLiqExpandida] = useState(null)
  const [itemsPorLiq, setItemsPorLiq] = useState({})
  const [busqueda, setBusqueda] = useState('')

  // Feature por empresa (migración 0063, Superadmin → Features): el panel
  // de ajuste de horas solo se muestra si el cliente lo tiene habilitado.
  const { tieneFeature, cargarFeatures } = useEmpresaFeaturesStore()
  useEffect(() => { if (empresaId) cargarFeatures(empresaId) }, [empresaId])
  const ajusteHorasHabilitado = tieneFeature(empresaId, FEATURES.AJUSTE_HORAS_PERIODO)
  const bonosHabilitados = tieneFeature(empresaId, FEATURES.BONOS_NO_REMUNERATIVOS)

  // Item 6 (sesión 2026-08-08): columna "Bono especial" en la grilla cuando
  // la feature de bonos está encendida. Los bonos se persisten como items
  // tipo 'bono' (código sintético bono_{bonoId}); se agregan por liquidación
  // en una consulta única y se muestran como columna, sin tener que expandir
  // cada fila para saber cuánto bono cobra cada persona.
  const [bonosPorLiq, setBonosPorLiq] = useState({})
  useEffect(() => {
    if (!periodoSeleccionado || !bonosHabilitados || liquidaciones.length === 0) return
    let cancelado = false
    const ids = liquidaciones.map((l) => l.id)
    supabase.from('nom_liquidacion_items').select('liquidacion_id, monto').eq('tipo', 'bono').in('liquidacion_id', ids)
      .then(({ data }) => {
        if (cancelado) return
        const porLiq = {}
        for (const i of data || []) porLiq[i.liquidacion_id] = (porLiq[i.liquidacion_id] ?? 0) + (Number(i.monto) || 0)
        setBonosPorLiq(porLiq)
      })
    return () => { cancelado = true }
  }, [periodoSeleccionado, bonosHabilitados, liquidaciones])

  // Ajuste GLOBAL de horas por persona y período (Task 4.3, plan
  // convenios-por-obra 2026-08-07): un delta único (puede ser negativo)
  // que se aplica sobre horasTrabajadas antes de calcular el básico —
  // nom_ajustes_horas, migración 0061. Se precarga junto a las
  // liquidaciones del período y se guarda con upsert por
  // (empresa, período, personal).
  const [ajustesHoras, setAjustesHoras] = useState({}) // personalId -> horas_globales guardadas
  const [ajustesHorasForm, setAjustesHorasForm] = useState({}) // personalId -> valor en edición (string)
  const [guardandoAjuste, setGuardandoAjuste] = useState(null) // personalId en curso
  const [errorAjuste, setErrorAjuste] = useState(null)

  const cargarAjustesHoras = async (periodoId) => {
    const { data } = await supabase.from('nom_ajustes_horas').select('personal_id, horas_globales').eq('periodo_id', periodoId)
    const mapa = Object.fromEntries((data || []).map((a) => [a.personal_id, Number(a.horas_globales)]))
    setAjustesHoras(mapa)
    setAjustesHorasForm(Object.fromEntries(Object.entries(mapa).map(([k, v]) => [k, String(v)])))
  }

  const guardarAjusteHoras = async (personalId) => {
    if (!periodoSeleccionado || !empresaId) return
    const valor = Number(ajustesHorasForm[personalId])
    if (Number.isNaN(valor)) { setErrorAjuste('El ajuste de horas tiene que ser un número.'); return }
    setGuardandoAjuste(personalId); setErrorAjuste(null)
    const { error } = await supabase.from('nom_ajustes_horas').upsert(
      { empresa_id: empresaId, periodo_id: periodoSeleccionado, personal_id: personalId, horas_globales: valor },
      { onConflict: 'empresa_id,periodo_id,personal_id' }
    )
    setGuardandoAjuste(null)
    if (error) { setErrorAjuste(error.message); return }
    setAjustesHoras((prev) => ({ ...prev, [personalId]: valor }))
  }

  // Selección múltiple para el ZIP de recibos (plan 2026-07-29 §1).
  const [seleccionadas, setSeleccionadas] = useState(new Set())
  const [generandoZip, setGenerandoZip] = useState(false)
  const [progresoZip, setProgresoZip] = useState(null) // { procesados, total }
  const [erroresZip, setErroresZip] = useState([]) // [{ nombre, error }]
  const [mostrarErroresZip, setMostrarErroresZip] = useState(false)

  const periodoActivo = periodos.find((p) => p.id === periodoSeleccionado)
  // Selector: solo los períodos que pasan el filtro de estado. El seleccionado
  // no se esconde aunque no pase el filtro — la grilla sigue mostrando el que
  // se está mirando.
  const periodosFiltrados = filtroEstado === 'todos'
    ? periodos
    : periodos.filter((p) => p.estado === filtroEstado)
  const fmt = (n) => (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtHs = (n) => `${(Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })} h`
  // Obra de una liquidación: la persistida en la fila (0064) y, si la fila
  // es anterior a esa migración (obra_id NULL), la obra ACTUAL de la persona
  // en Presencio como fallback.
  const nombreObraLiquidacion = (l) => {
    const obraId = l.obraId || obraActualPorPersonal.get(l.personalId)
    return obraId ? (obrasPorId.get(obraId) || obraId.slice(0, 8)) : null
  }

  const toggleDetalle = async (liqId) => {
    if (liqExpandida === liqId) { setLiqExpandida(null); return }
    setLiqExpandida(liqId)
    // Fire-and-forget (Fase 1, Task 1.6): un fallo de log nunca debe
    // bloquear la apertura del detalle. `detalle` es solo contexto (tipo
    // de período), nunca montos ni CUIL — ver src/utils/auditoria.js.
    registrarAcceso(supabase, 'liquidacion_detalle', liqId, `período ${periodoActivo?.tipo || ''}`).catch(() => {})
    if (!itemsPorLiq[liqId]) {
      const { data } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', liqId)
      setItemsPorLiq((prev) => ({ ...prev, [liqId]: data || [] }))
    }
  }

  // seqEmpresa (Task 3.4, M2): un Superadmin puede cambiar de empresa
  // rápido (entrar en A, arrepentirse, entrar en B) — sin guardia, la
  // respuesta de A podía llegar DESPUÉS que la de B (orden de red no
  // garantizado) y pisar la pantalla con los períodos/personal de la
  // empresa vieja mientras se sigue mostrando "empresa B" en el header.
  const seqEmpresaRef = useRef(0)

  // `seqExistente` (Task 4.6 fix): cuando el efecto de más abajo llama acá
  // dentro del mismo render, tiene que pasar SU PROPIO `seq` para que la
  // comparación de "¿sigo siendo la respuesta más reciente?" use el mismo
  // número que la carga de personal — si esta función incrementaba el
  // contador por su cuenta (como hacía antes), el `seq` que el efecto
  // había capturado quedaba viejo antes de que llegara la respuesta de
  // nom_v_personal, esa comparación fallaba siempre y personalPorId nunca
  // se llenaba (bug reportado: nombres reemplazados por el UUID crudo).
  const cargarPeriodos = (seqExistente) => {
    if (!empresaId) return
    const seq = seqExistente ?? ++seqEmpresaRef.current
    supabase.from('nom_periodos').select('*').eq('empresa_id', empresaId).order('fecha_desde', { ascending: false })
      .then(({ data }) => { if (seqEmpresaRef.current === seq) setPeriodos(data || []) })
  }

  useEffect(() => {
    const seq = ++seqEmpresaRef.current
    cargarPeriodos(seq)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset intencional al cambiar de empresa.
    setPeriodoSeleccionado('')
    if (!empresaId) { setPeriodos([]); setPersonalPorId(new Map()); setObraActualPorPersonal(new Map()); setObrasPorId(new Map()); return }
    supabase.from('nom_v_personal').select('id, nombre, obra_id').eq('empresa_id', empresaId)
      .then(({ data }) => {
        if (seqEmpresaRef.current !== seq) return
        const personas = data || []
        setPersonalPorId(new Map(personas.map((p) => [p.id, p.nombre])))
        setObraActualPorPersonal(new Map(personas.filter((p) => p.obra_id).map((p) => [p.id, p.obra_id])))
      })
    supabase.from('nom_v_obras').select('id, nombre').eq('empresa_id', empresaId)
      .then(({ data }) => { if (seqEmpresaRef.current === seq) setObrasPorId(new Map((data || []).map((o) => [o.id, o.nombre]))) })
    cargarFlujos(empresaId)
  }, [empresaId])

  useEffect(() => { if (empresaId) cargarConvenios(empresaId) }, [empresaId])

  // Preselección desde /liquidacion?periodo=<id> (link "Ver detalle" en
  // AprobacionesPage, Task 4.1). Espera a que `periodos` tenga datos antes
  // de intentar el match — si se corre en el mismo render que el cambio de
  // empresa, `periodos` todavía puede estar vacío.
  useEffect(() => {
    const periodoParam = searchParams.get('periodo')
    if (periodoParam && periodos.some((p) => p.id === periodoParam)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- preselección intencional por query param / periodo navegado.
      setPeriodoSeleccionado(periodoParam)
    }
  }, [searchParams, periodos])

  const handleEnviarAFlujo = async () => {
    if (!periodoSeleccionado || !flujoElegido) return
    setConfirmarFlujo(false)
    setEnviandoFlujo(true); setErrorFlujo('')
    const r = await iniciarFlujo(periodoSeleccionado, flujoElegido)
    setEnviandoFlujo(false)
    if (!r.ok) { setErrorFlujo(r.error); return }
    cargarPeriodos()
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset intencional al cambiar de período (Task 3.1, M1: selección y búsqueda no deben sobrevivir el cambio de período).
    setLiqExpandida(null)
    setItemsPorLiq({})
    setSeleccionadas(new Set())
    setBusqueda('')
    setAjustesHoras({}); setAjustesHorasForm({}); setErrorAjuste(null)
    if (periodoSeleccionado) { cargarLiquidaciones(periodoSeleccionado); cargarAjustesHoras(periodoSeleccionado) }
  }, [periodoSeleccionado])

  // Genera el PDF real (art. 140 LCT, src/utils/reciboPdf.js), calcula su
  // hash SHA-256 (src/utils/reciboHash.js) y asigna numero_recibo vía RPC
  // (emitir_recibo, migración 0016) — best-effort en los datos de empresa/
  // legajo que esta pantalla no tenía cargados hasta ahora, para no
  // duplicar todo el fetching que ya hacen FichaLegajoPage/SuperAdminPage.
  const handleEmitirRecibo = async (l) => {
    setErrorRecibo(''); setEmitiendoRecibo(l.id)
    try {
      // Task 2.6: el hash tiene que autenticar el PDF FINAL, con el número
      // de recibo ya impreso (reciboPdf.js dibuja "Recibo N°:" en el
      // documento) — antes se calculaba el hash sobre un PDF sin número
      // (o con el número viejo, en un regenerar) y recién después se
      // asignaba/actualizaba el número real, así que el hash guardado
      // nunca correspondía al PDF que la persona terminaba viendo. Fix:
      // primero reservar/confirmar el número (emitir_recibo es idempotente
      // si ya existe), generar el PDF CON ese número, y recién ahí hashear
      // y guardar el hash definitivo con una segunda llamada (que solo
      // actualiza el hash, no reasigna número).
      const numeroReservado = await emitirRecibo(l.id, null)
      if (!numeroReservado.ok) { setErrorRecibo(numeroReservado.error); setEmitiendoRecibo(null); return }
      const { doc, hash, nombreArchivo } = await generarYDescargarRecibo({
        empresaId,
        personalId: l.personalId,
        nombrePersona: personalPorId.get(l.personalId) || l.personalId,
        periodo: periodoActivo,
        filasItems: itemsPorLiq[l.id] || [],
        numeroRecibo: numeroReservado.numeroRecibo,
      })
      const r = await emitirRecibo(l.id, hash)
      if (!r.ok) { setErrorRecibo(r.error); setEmitiendoRecibo(null); return }
      doc.save(`${nombreArchivo}-${r.numeroRecibo}.pdf`)
      registrarAcceso(supabase, 'recibo_pdf', l.id, `período ${periodoActivo?.tipo || ''} ${periodoActivo?.fecha_desde || ''}`).catch(() => {})
      push(`Recibo N° ${r.numeroRecibo} emitido.`, 'success')
      await cargarLiquidaciones(periodoSeleccionado)
    } catch (e) {
      setErrorRecibo(e instanceof Error ? e.message : String(e))
    }
    setEmitiendoRecibo(null)
  }

  // Cerrar deja el período en solo lectura: `calcularPeriodo` ya se bloquea
  // con estado === 'cerrado' (mismo criterio que el cierre de Reportes, que
  // además valida escalas vencidas antes de cerrar).
  const handleCerrarPeriodo = async () => {
    if (!periodoActivo) return
    setErrorCierre('')

    if (confirmarCierre) {
      setConfirmarCierre(false)
      setCerrando(true)
      const { error: err } = await supabase.from('nom_periodos').update({ estado: 'cerrado' }).eq('id', periodoActivo.id)
      setCerrando(false)
      setAlertaEscala(null)
      if (err) { setErrorCierre(err.message); return }
      setPeriodos((prev) => prev.map((p) => (p.id === periodoActivo.id ? { ...p, estado: 'cerrado' } : p)))
      push('Período cerrado.', 'success')
      return
    }

    if (!alertaEscala) {
      const personalIds = [...new Set(liquidaciones.map((l) => l.personalId))]
      const { data: legajosPeriodo } = personalIds.length
        ? await supabase.from('nom_legajo').select('categoria_id').eq('empresa_id', empresaId).in('personal_id', personalIds)
        : { data: [] }
      const categoriaIds = [...new Set((legajosPeriodo || []).map((l) => l.categoria_id).filter(Boolean))]
      const vencidas = await verificarEscalaVigente(supabase, { categoriaIds, fechaHasta: periodoActivo.fecha_hasta })
      if (vencidas) { setAlertaEscala(vencidas); return }
    }

    // Segundo click confirma: re-ejecuta este mismo handler con
    // confirmarCierre === true y ejecuta el cierre.
    setConfirmarCierre(true)
  }

  const handlePeriodoBorrado = (id) => {
    setConfirmarBorrado(false)
    setPeriodos((prev) => prev.filter((p) => p.id !== id))
    setPeriodoSeleccionado('')
  }

  const handleCalcular = async () => {
    if (!periodoSeleccionado) return
    const periodoAlPedir = periodoSeleccionado
    const r = await calcularPeriodo(periodoAlPedir)
    // Task 6.6 (plan 2026-08-11): antes el error de cálculo salía por un
    // <Toast> legacy que compartía posición con el ToastContainer global
    // (ambos bottom:20 right:20). Unificado: pasa por el toastStore global.
    if (!r.ok) {
      push(r.error, 'error')
      return
    }
    // Task 3.1: el SelectorPeriodo ya queda disabled mientras calculando,
    // pero esto es una segunda guarda defensiva — si por lo que sea el
    // período seleccionado cambió mientras la Edge Function respondía, no
    // recargar liquidaciones del período viejo sobre la pantalla del nuevo.
    if (periodoSeleccionado === periodoAlPedir) cargarLiquidaciones(periodoAlPedir)
  }

  const liquidacionesFiltradas = liquidaciones.filter((l) => {
    const nombre = personalPorId.get(l.personalId) || ''
    return nombre.toLowerCase().includes(busqueda.toLowerCase())
  })

  const descargarCsv = () => {
    // Columnas numéricas marcadas con tipo:'numero' para que exportarCsv las
    // formatee con coma decimal es-AR (antes salían con punto, Excel es-AR
    // las leía como separador de miles y el número quedaba corrompido — ver
    // src/utils/exportCsv.js). Tardanzas/Faltas inj./Faltas just. ya se ven
    // en la grilla pero antes no estaban en el CSV.
    exportarCsv(`liquidacion-${periodoActivo?.tipo}-${periodoActivo?.fecha_desde}.csv`, [
      { titulo: 'Legajo', valor: (l) => l.personalId.slice(0, 8) },
      { titulo: 'Nombre', valor: (l) => personalPorId.get(l.personalId) || l.personalId },
      { titulo: 'Obra', valor: (l) => nombreObraLiquidacion(l) || '' },
      { titulo: 'Horas', valor: (l) => l.detalleHoras?.horasTrabajadas ?? 0, tipo: 'numero' },
      { titulo: 'HE 50%', valor: (l) => l.detalleHoras?.horasExtra50 ?? 0, tipo: 'numero' },
      { titulo: 'HE 100%', valor: (l) => l.detalleHoras?.horasExtra100 ?? 0, tipo: 'numero' },
      { titulo: 'Tardanzas', valor: (l) => l.detalleHoras?.tardanzas ?? 0, tipo: 'numero' },
      { titulo: 'Faltas inj.', valor: (l) => l.detalleHoras?.faltasInjustificadas ?? 0, tipo: 'numero' },
      { titulo: 'Faltas just.', valor: (l) => l.detalleHoras?.faltasJustificadas ?? 0, tipo: 'numero' },
      { titulo: 'Bruto', valor: (l) => l.bruto, tipo: 'numero' },
      { titulo: 'Aportes', valor: (l) => l.totalAportes, tipo: 'numero' },
      { titulo: 'Contribuciones', valor: (l) => l.totalContribuciones, tipo: 'numero' },
      { titulo: 'Neto', valor: (l) => l.neto, tipo: 'numero' },
      ...(bonosHabilitados ? [{ titulo: 'Bono especial', valor: (l) => bonosPorLiq[l.id] ?? 0, tipo: 'numero' }] : []),
    ], liquidacionesFiltradas)
    registrarAcceso(supabase, 'export_csv', null, `liquidacion ${periodoActivo?.tipo || ''} ${periodoActivo?.fecha_desde || ''}`).catch(() => {})
  }

  // Deshabilita el checkbox de selección en anuladas (no tiene sentido
  // re-emitirles recibo) o en las que ya sabemos que no tienen items
  // (itemsPorLiq solo se carga al expandir la fila — si todavía no se
  // expandió, se asume seleccionable y recién se descubre "sin items" si
  // falla al generar el PDF, reportado igual en el panel de errores).
  const puedeSeleccionarse = (l) => !l.anulado && (itemsPorLiq[l.id] === undefined || itemsPorLiq[l.id].length > 0)
  const seleccionablesFiltradas = liquidacionesFiltradas.filter(puedeSeleccionarse)

  const toggleSeleccion = (id) => {
    setSeleccionadas((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleSeleccionTodos = () => {
    setSeleccionadas((s) => {
      const todosSeleccionados = seleccionablesFiltradas.length > 0 && seleccionablesFiltradas.every((l) => s.has(l.id))
      return todosSeleccionados ? new Set() : new Set(seleccionablesFiltradas.map((l) => l.id))
    })
  }

  // Trae los items de una liquidación (reusa el cache de itemsPorLiq que ya
  // llena toggleDetalle al expandir una fila, para no repetir la query si el
  // usuario ya la había abierto).
  const fetchItemsLiquidacion = async (liqId) => {
    if (itemsPorLiq[liqId]) return itemsPorLiq[liqId]
    const { data } = await supabase.from('nom_liquidacion_items').select('*').eq('liquidacion_id', liqId)
    setItemsPorLiq((prev) => ({ ...prev, [liqId]: data || [] }))
    return data || []
  }

  // Descarga en un solo ZIP los recibos de las liquidaciones seleccionadas.
  // Cada PDF pasa por emitir_recibo (queda numerado y auditable, igual que
  // el flujo de "Emitir recibo PDF" de a uno) — ver src/utils/reciboZip.js.
  const handleDescargarZip = async () => {
    setErroresZip([]); setMostrarErroresZip(false)
    const liqsElegidas = liquidacionesFiltradas.filter((l) => seleccionadas.has(l.id))
    if (liqsElegidas.length === 0) return
    setGenerandoZip(true)
    setProgresoZip({ procesados: 0, total: liqsElegidas.length })
    try {
      const { blob, fallidos } = await generarZipRecibos({
        liquidaciones: liqsElegidas,
        empresaId,
        periodo: periodoActivo,
        personalPorId,
        fetchItems: fetchItemsLiquidacion,
        emitirRecibo,
        onProgreso: (procesados, total) => setProgresoZip({ procesados, total }),
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombreArchivoZip(periodoActivo)
      a.click()
      // revokeObjectURL diferido (Task 3.4, M5): revocar la URL en el mismo
      // tick que a.click() es una carrera contra el navegador, que dispara
      // la descarga de forma asíncrona — en algunos navegadores/ZIPs grandes
      // la URL quedaba inválida antes de que la descarga arrancara.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      if (fallidos.length > 0) { setErroresZip(fallidos); setMostrarErroresZip(true) }
      setSeleccionadas(new Set())
      await cargarLiquidaciones(periodoSeleccionado) // refresca los números de recibo asignados
    } catch (e) {
      setErroresZip([{ nombre: '—', error: e instanceof Error ? e.message : String(e) }])
      setMostrarErroresZip(true)
    }
    setGenerandoZip(false)
    setProgresoZip(null)
  }

  // El alta de período va convenio → tipo: la modalidad del convenio decide
  // si corresponde quincena o mes (ver src/utils/tiposPeriodo.js).
  const ES_MANUAL = new Set(TIPOS_MANUALES)
  // "Fuera de convenio (LCT)" no se ofrece acá: para ese personal está la
  // opción "Personal fuera de convenio" (ver src/utils/tiposPeriodo.js).
  const conveniosPropios = conveniosParaPeriodo(convenios, empresaId)
  const tiposParaElConvenio = tiposDisponibles(nuevoConvenioId, conveniosPropios)
  const convenioElegido = convenioDelPeriodo(nuevoConvenioId, nuevoTipo, conveniosPropios)

  // Al cambiar de convenio se reencuadra el tipo al primero válido, para que
  // nunca quede una combinación imposible seleccionada.
  const elegirConvenio = (valor) => {
    setNuevoConvenioId(valor)
    setErrorCrearPeriodo('')
    const tipos = tiposDisponibles(valor, conveniosPropios)
    setNuevoTipo(tipos.includes(nuevoTipo) ? nuevoTipo : (tipos[0] || ''))
  }

  let fechasCalculadas = null
  if (nuevoTipo && !ES_MANUAL.has(nuevoTipo)) {
    try {
      fechasCalculadas = calcularFechasPeriodo({ anio: Number(nuevoAnio), mes: Number(nuevoMes), tipo: nuevoTipo, convenio: convenioElegido })
    } catch {
      fechasCalculadas = null
    }
  }

  // Feedback 2026-08-09: antes se podía crear un período que ya existía y
  // recién se notaba mezclado en la lista. Acá se compara la combinación
  // convenio + tipo + fechas + obra contra los períodos ya creados y se
  // avisa (bloqueando el alta duplicada) antes del insert.
  let candidatoFechas = null
  if (nuevoTipo) {
    if (ES_MANUAL.has(nuevoTipo)) {
      if (nuevoDesde && nuevoHasta) candidatoFechas = { fechaDesde: nuevoDesde, fechaHasta: nuevoHasta }
    } else if (fechasCalculadas) {
      candidatoFechas = fechasCalculadas
    }
  }
  const convenioIdNuevo = convenioElegido?.id ?? null
  const duplicado = candidatoFechas
    ? (periodos || []).find((p) =>
        String(p.convenio_id ?? '') === String(convenioIdNuevo ?? '') &&
        String(p.tipo) === String(nuevoTipo) &&
        String(p.fecha_desde) === String(candidatoFechas.fechaDesde) &&
        String(p.fecha_hasta) === String(candidatoFechas.fechaHasta) &&
        (nuevoObraId
          ? String(p.obra_id ?? '') === String(nuevoObraId)
          : !p.obra_id)
      ) || null
    : null
  const advertenciaDuplicado = duplicado
    ? `Ya existe un período ${etiquetaTipo(duplicado.tipo)} del ${duplicado.fecha_desde} al ${duplicado.fecha_hasta}${duplicado.obra_id ? ` para la obra ${obrasPorId.get(duplicado.obra_id) || duplicado.obra_id}` : ' para toda la empresa'}, ${duplicado.convenio_id ? 'para este convenio' : 'fuera de convenio'}. Revisalo en la pestaña "Períodos".`
    : ''

  const handleCrearPeriodo = async () => {
    setErrorCrearPeriodo('')
    if (!empresaId) {
      setErrorCrearPeriodo('Elegí primero una empresa en Superadmin.')
      return
    }
    if (!nuevoConvenioId) { setErrorCrearPeriodo('Elegí primero un convenio.'); return }
    if (!nuevoTipo) { setErrorCrearPeriodo('Elegí el tipo de período.'); return }

    let fechaDesde, fechaHasta
    if (ES_MANUAL.has(nuevoTipo)) {
      if (!nuevoDesde || !nuevoHasta) { setErrorCrearPeriodo('Completá fecha desde y hasta.'); return }
      if (nuevoHasta < nuevoDesde) { setErrorCrearPeriodo('La fecha hasta no puede ser anterior a la fecha desde.'); return }
      fechaDesde = nuevoDesde; fechaHasta = nuevoHasta
    } else {
      try {
        const f = calcularFechasPeriodo({ anio: Number(nuevoAnio), mes: Number(nuevoMes), tipo: nuevoTipo, convenio: convenioElegido })
        fechaDesde = f.fechaDesde; fechaHasta = f.fechaHasta
      } catch (e) {
        setErrorCrearPeriodo(e instanceof Error ? e.message : String(e))
        return
      }
    }
    setCreandoPeriodo(true)
    const { data, error } = await supabase.from('nom_periodos').insert({
      empresa_id: empresaId,
      tipo: nuevoTipo,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      estado: 'abierto',
      obra_id: nuevoObraId || null,
      ...(convenioElegido && { convenio_id: convenioElegido.id }),
    }).select().single()
    setCreandoPeriodo(false)
    if (error) { setErrorCrearPeriodo(error.message); return }
    setPeriodos((prev) => [data, ...prev])
    setPeriodoSeleccionado(data.id)
    setNuevoDesde('')
    setNuevoHasta('')
    setNuevoConvenioId('')
    setNuevoObraId('')
    setNuevoTipo('')
  }

  return (
    <div className="page">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title">Liquidaciones</h1>
          <p className="page-subtitle">Calcular y revisar liquidaciones por período</p>
        </div>
        {/* Acciones principales siempre a la derecha, no abajo perdidas: Nuevo
            período abre la vista de alta; Calcular/CSV/recibos/Cerrar/Borrar
            operan sobre el período que se está mirando en la vista Períodos. */}
        {empresaActiva && (
          <div className="acciones" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setPestana('Nueva liquidación')}
              disabled={pestana === 'Nueva liquidación'}
            >
              Nuevo período
            </button>
            {pestana === 'Períodos' && (              <>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleCalcular}
                  disabled={!periodoSeleccionado || calculando || periodoActivo?.estado === 'cerrado'}
                  title={periodoActivo?.estado === 'cerrado' ? 'período cerrado: no se puede recalcular' : undefined}
                >
                  {calculando ? 'Calculando…' : 'Calcular'}
                </button>
                {puedeExportar && (
                  <button className="btn btn-ghost btn-sm" onClick={descargarCsv} disabled={liquidacionesFiltradas.length === 0}>
                    Descargar CSV
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={handleDescargarZip} disabled={!puedeEmitirRecibos || seleccionadas.size === 0 || generandoZip}>
                  {generandoZip
                    ? `Generando… (${progresoZip?.procesados ?? 0} de ${progresoZip?.total ?? 0})`
                    : `Descargar recibos (${seleccionadas.size})`}
                </button>
                {periodoActivo && periodoActivo.estado !== 'cerrado' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleCerrarPeriodo}
                    disabled={cerrando}
                    aria-label="Cerrar período"
                  >
                    <Lock size={14} /> {cerrando ? 'Cerrando…' : alertaEscala ? 'Cerrar de todos modos' : 'Cerrar período'}
                  </button>
                )}
                {periodoActivo && (
                  <button className="btn btn-danger btn-sm" onClick={() => setConfirmarBorrado(true)}>
                    <Trash2 size={14} /> Borrar período
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {!empresaActiva && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          Elegí una empresa en Superadmin → "Entrar" para operar la liquidación.
        </div>
      )}

      {empresaActiva && (
        <div className="tabs" role="tablist" aria-label="Vistas de liquidación">
          {PESTANAS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={pestana === p}
              className={`tab${pestana === p ? ' tab-activa' : ''}`}
              onClick={() => setPestana(p)}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {empresaActiva && pestana === 'Liquidaciones individuales' && (
        <LiquidacionesIndividuales empresaId={empresaId} />
      )}

      {confirmarBorrado && periodoActivo && (
        <BorrarPeriodo
          periodo={periodoActivo}
          onBorrado={handlePeriodoBorrado}
          onCancelar={() => setConfirmarBorrado(false)}
        />
      )}

      {empresaActiva && pestana === 'Nueva liquidación' && (
        <div className="card max-900">
          <h3 style={{ fontSize: '1rem', marginBottom: 4 }}>Nueva liquidación</h3>
          <p className="texto-secundario" style={{ fontSize: '0.85rem', marginBottom: 14 }}>
            Elegí el convenio, la obra (opcional) y el período a liquidar. Se crea un período abierto; después
            entrá a "Períodos" para calcularlo.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
            <div className="input-group" style={{ minWidth: 200, flex: '1 1 200px' }}>
              <label className="input-label" htmlFor="np-convenio">Convenio</label>
              <select id="np-convenio" className="input" value={nuevoConvenioId} onChange={(e) => elegirConvenio(e.target.value)}>
                <option value="">Elegir convenio…</option>
                {conveniosPropios.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre} ({c.modalidad})</option>
                ))}
                <option value={FUERA_DE_CONVENIO}>Personal fuera de convenio</option>
              </select>
            </div>

            <div className="input-group" style={{ minWidth: 190, flex: '1 1 190px' }}>
              <label className="input-label" htmlFor="np-tipo">Tipo de período</label>
              <select
                id="np-tipo"
                className="input"
                value={nuevoTipo}
                onChange={(e) => { setNuevoTipo(e.target.value); setErrorCrearPeriodo('') }}
                disabled={!nuevoConvenioId}
              >
                {!nuevoConvenioId && <option value="">Elegí un convenio primero</option>}
                {tiposParaElConvenio.map((t) => <option key={t} value={t}>{etiquetaTipo(t)}</option>)}
              </select>
            </div>

            {nuevoTipo && !ES_MANUAL.has(nuevoTipo) && (
              <>
                <div className="input-group" style={{ minWidth: 90 }}>
                  <label className="input-label" htmlFor="np-anio">Año</label>
                  <input id="np-anio" className="input" type="number" value={nuevoAnio} onChange={(e) => setNuevoAnio(e.target.value)} />
                </div>
                <div className="input-group" style={{ minWidth: 140, flex: '1 1 140px' }}>
                  <label className="input-label" htmlFor="np-mes">Mes</label>
                  <select id="np-mes" className="input" value={nuevoMes} onChange={(e) => setNuevoMes(e.target.value)}>
                    {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => (
                      <option key={m} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {nuevoTipo && ES_MANUAL.has(nuevoTipo) && (
              <>
                <div className="input-group" style={{ minWidth: 150 }}>
                  <label className="input-label" htmlFor="np-desde">Desde</label>
                  <input id="np-desde" type="date" className="input" value={nuevoDesde} onChange={(e) => setNuevoDesde(e.target.value)} />
                </div>
                <div className="input-group" style={{ minWidth: 150 }}>
                  <label className="input-label" htmlFor="np-hasta">Hasta</label>
                  <input id="np-hasta" type="date" className="input" value={nuevoHasta} onChange={(e) => setNuevoHasta(e.target.value)} />
                </div>
              </>
            )}

            {obrasPorId.size > 0 && (
              <div className="input-group" style={{ minWidth: 180, flex: '1 1 180px' }}>
                <label className="input-label" htmlFor="np-obra">Obra / sitio (opcional)</label>
                <select id="np-obra" className="input" value={nuevoObraId} onChange={(e) => { setNuevoObraId(e.target.value); setErrorCrearPeriodo('') }}>
                  <option value="">Toda la empresa</option>
                  {[...obrasPorId.entries()].map(([id, nombre]) => (
                    <option key={id} value={id}>{nombre}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="acciones" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={handleCrearPeriodo} disabled={creandoPeriodo || !nuevoConvenioId || !nuevoTipo || !!duplicado}>
              {creandoPeriodo ? 'Creando…' : 'Crear período'}
            </button>
            {fechasCalculadas && (
              <span className="texto-secundario" style={{ fontSize: '0.85rem' }}>
                Del {fechasCalculadas.fechaDesde} al {fechasCalculadas.fechaHasta}
              </span>
            )}
            {advertenciaDuplicado && (
              <span role="alert" style={{ color: 'var(--warning, #eab308)', fontSize: '0.85rem', fontWeight: 600 }}>
                ⚠ {advertenciaDuplicado}
              </span>
            )}
            {errorCrearPeriodo && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorCrearPeriodo}</span>}
          </div>
        </div>
      )}

      {pestana === 'Períodos' && (
      <>
      {/* Tarjeta 1 — Período: selector + filtro de estado.
          La acción principal (Calcular) vive arriba a la derecha, junto al
          resto de acciones del período. */}
      <div className="card card-compacta" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <strong style={{ fontSize: '0.9rem' }}>Período</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Filtrar períodos por estado">
            {FILTROS_ESTADO.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`btn-chip${filtroEstado === f.id ? ' chip-activo' : ''}`}
                aria-pressed={filtroEstado === f.id}
                onClick={() => setFiltroEstado(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <SelectorPeriodo periodos={periodosFiltrados} value={periodoSeleccionado} onChange={(v) => { setPeriodoSeleccionado(v); setAlertaEscala(null); setErrorCierre('') }} disabled={calculando} obrasPorId={obrasPorId} />

        {periodoActivo?.estado === 'cerrado' && (
          <div style={{ marginTop: 10 }}>
            <span className="badge badge-success"><Lock size={12} /> período cerrado</span>
          </div>
        )}
        {errorCierre && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorCierre}</span>}
      </div>

      {/* Acciones del período que necesitan más lugar que el header: enviar a
          aprobación (flujo) y los paneles de confirmación. */}
      {periodoActivo && (
        <div className="card card-compacta" style={{ marginBottom: '1rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {periodoActivo?.estado === 'abierto' && flujos.length > 0 && (
            <>
              <select className="input" style={{ maxWidth: 220 }} value={flujoElegido} onChange={(e) => { setFlujoElegido(e.target.value); setConfirmarFlujo(false) }}>
                <option value="">Elegir flujo…</option>
                {flujos.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
              </select>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setConfirmarFlujo(true)}
                disabled={!flujoElegido || enviandoFlujo}
              >
                {enviandoFlujo ? 'Enviando…' : 'Enviar a aprobación'}
              </button>
            </>
          )}
          {errorFlujo && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{errorFlujo}</span>}
        </div>
      )}

      {confirmarCierre && periodoActivo && periodoActivo.estado !== 'cerrado' && (
        <div className="card card-compacta" style={{ marginBottom: '1rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--warning-bg, rgba(234,179,8,0.12))', border: '1px solid var(--warning, #eab308)' }}>
          <strong style={{ fontSize: '0.85rem' }}>
            ¿Cerrar el período? {liquidaciones.length > 0 && `Quedan ${liquidaciones.length} liquidación(es) en solo lectura y no se podrá recalcular.`}
          </strong>
          <button className="btn btn-primary btn-sm" onClick={handleCerrarPeriodo} disabled={cerrando}>
            {cerrando ? 'Cerrando…' : 'Sí, cerrar período'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmarCierre(false)} disabled={cerrando}>
            Cancelar
          </button>
        </div>
      )}

      {confirmarFlujo && periodoActivo?.estado === 'abierto' && (
        <div className="card card-compacta" style={{ marginBottom: '1rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--warning-bg, rgba(234,179,8,0.12))', border: '1px solid var(--warning, #eab308)' }}>
          <strong style={{ fontSize: '0.85rem' }}>
            ¿Enviar a aprobación? Se envía el período al flujo "{flujos.find((f) => f.id === flujoElegido)?.nombre || ''}" y deja de poder editarse desde acá.
          </strong>
          <button className="btn btn-primary btn-sm" onClick={handleEnviarAFlujo} disabled={enviandoFlujo}>
            {enviandoFlujo ? 'Enviando…' : 'Sí, enviar a aprobación'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmarFlujo(false)} disabled={enviandoFlujo}>
            Cancelar
          </button>
        </div>
      )}

      {alertaEscala && (
        <div className="card card-compacta" style={{ background: 'rgba(200,168,75,0.08)', border: '1px solid var(--brand-secondary)', marginBottom: '1rem' }}>
          La escala de estas categorías no se actualizó hace más de 90 días respecto al cierre del período: {alertaEscala.join(', ')}.
          Verificá si corresponde cargar una paritaria nueva antes de cerrar.
        </div>
      )}

      {/* Task 6.6: el error de cálculo sale por el toastStore/ToastContainer
          global (ver handleCalcular) — se eliminó el <Toast> legacy que se
          superponía con él en la misma esquina. */}
      {errorRecibo && <div className="card" style={{ color: 'var(--danger)' }}>Error al emitir recibo: {errorRecibo}</div>}

      {erroresZip.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem', background: 'var(--warning-bg, rgba(234,179,8,0.12))', border: '1px solid var(--warning, #eab308)' }}>
          <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => setMostrarErroresZip((v) => !v)}>
            <strong>⚠ {erroresZip.length} recibo(s) no se pudieron generar en el ZIP</strong>
            <span style={{ marginLeft: 'auto' }}>{mostrarErroresZip ? '▾' : '▸'}</span>
          </div>
          {mostrarErroresZip && (
            <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
              {erroresZip.map((e, i) => <div key={i}>• {e.nombre}: {e.error}</div>)}
            </div>
          )}
        </div>
      )}

      {(omitidos.length > 0 || advertencias.length > 0 || sinHoras.length > 0) && (
        <div className="card" style={{ marginBottom: '1rem', background: 'var(--warning-bg, rgba(234,179,8,0.12))', border: '1px solid var(--warning, #eab308)' }}>
          <div
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
            onClick={() => setMostrarAvisos((v) => !v)}
          >
            <strong>
              {omitidos.length > 0 && `${omitidos.length} persona(s) no liquidada(s)`}
              {omitidos.length > 0 && advertencias.length > 0 && ' · '}
              {advertencias.length > 0 && `${advertencias.length} advertencia(s)`}
              {(omitidos.length > 0 || advertencias.length > 0) && sinHoras.length > 0 && ' · '}
              {sinHoras.length > 0 && `${sinHoras.length} sin horas`}
            </strong>
            <span style={{ marginLeft: 'auto' }}>{mostrarAvisos ? '▾' : '▸'}</span>
          </div>
          {mostrarAvisos && (
            <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
              {omitidos.map((o) => (
                <div key={o.personal_id}>• {o.nombre || o.personal_id}: {o.motivo}</div>
              ))}
              {advertencias.map((a, i) => (
                <div key={`${a.personal_id}-${i}`}>• {personalPorId.get(a.personal_id) || a.personal_id}: {a.mensaje}</div>
              ))}
              {sinHoras.length > 0 && (
                <>
                  <div style={{ marginTop: 6 }}>
                    <strong>Personal sin horas en el período</strong>
                  </div>
                  <p className="texto-secundario" style={{ fontSize: '0.85rem', marginTop: 4 }}>
                    No tienen fichajes ni ausencias aprobadas cargadas en este período — no se liquidaron. Revisar si falta cargar asistencia en Presencio o si corresponde una licencia.
                  </p>
                  {sinHoras.map((p) => <div key={p.personal_id}>• {p.nombre}</div>)}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {liquidaciones.length > 0 && periodoActivo && (
        <div className="card" style={{ marginBottom: '1rem', display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong>Período calculado:</strong>
          <span>{etiquetaPeriodo(periodoActivo)}</span>
          {periodoActivo.obra_id && (
            <span className="badge badge-neutral">obra: {obrasPorId.get(periodoActivo.obra_id) || periodoActivo.obra_id.slice(0, 8)}</span>
          )}
          <span className="badge badge-neutral">{periodoActivo.estado}</span>
          <span style={{ opacity: 0.7, fontSize: '0.85rem' }}>{liquidaciones.length} liquidación(es)</span>
        </div>
      )}

      {calculando && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          Calculando liquidación… (puede tardar unos segundos con muchos empleados)
        </div>
      )}

      {!calculando && liquidaciones.length === 0 && periodoSeleccionado && (
        <div className="card" style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          Todavía no hay liquidaciones para este período. Usá "Calcular" para generarlas.
        </div>
      )}

      {!calculando && liquidaciones.length > 0 && (
        <div className="card table-scroll">
          <input className="input" placeholder="Buscar por nombre…" aria-label="Buscar por nombre" value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)} style={{ maxWidth: 260, marginBottom: 12 }} />
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos"
                    checked={seleccionablesFiltradas.length > 0 && seleccionablesFiltradas.every((l) => seleccionadas.has(l.id))}
                    ref={(el) => {
                      if (!el) return
                      const algunos = seleccionablesFiltradas.some((l) => seleccionadas.has(l.id))
                      const todos = seleccionablesFiltradas.length > 0 && seleccionablesFiltradas.every((l) => seleccionadas.has(l.id))
                      el.indeterminate = algunos && !todos
                    }}
                    onChange={toggleSeleccionTodos}
                    disabled={seleccionablesFiltradas.length === 0}
                  />
                </th>
                <th>Persona</th><th>Obra</th>
                <th>Horas</th><th>HE 50%</th><th>HE 100%</th>
                <th>Tardanzas</th><th>Faltas inj.</th><th>Faltas just.</th>
                <th>Bruto</th><th>Aportes</th><th>Contribuciones</th><th>Neto</th>
                {bonosHabilitados && <th>Bono especial</th>}<th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {liquidacionesFiltradas.map((l) => {
                const dh = l.detalleHoras || {}
                const items = itemsPorLiq[l.id] || []
                const grupos = [
                  ['remunerativo', 'Remunerativos'],
                  ['no_remunerativo', 'No remunerativos'],
                  ['descuento', 'Aportes del trabajador'],
                  ['aporte_patronal', 'Contribuciones patronales'],
                  ['informativo', 'Informativos'],
                ]
                return (
                  <FragmentoLiquidacion key={l.id}>
                    <tr
                      onClick={() => toggleDetalle(l.id)}
                      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleDetalle(l.id) } }}
                      style={{ cursor: 'pointer' }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={liqExpandida === l.id}
                      aria-controls={`liq-detalle-${l.id}`}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${personalPorId.get(l.personalId) || l.personalId}`}
                          checked={seleccionadas.has(l.id)}
                          disabled={!puedeSeleccionarse(l)}
                          onChange={() => toggleSeleccion(l.id)}
                        />
                      </td>
                      <td>{personalPorId.get(l.personalId) || l.personalId}</td>
                      <td>{nombreObraLiquidacion(l) || '—'}</td>
                      <td>{fmtHs(dh.horasTrabajadas)}</td>
                      <td>{fmtHs(dh.horasExtra50)}</td>
                      <td>{fmtHs(dh.horasExtra100)}</td>
                      <td>{dh.tardanzas ?? '—'}</td>
                      <td>{dh.faltasInjustificadas ?? '—'}</td>
                      <td>{dh.faltasJustificadas ?? '—'}</td>
                      <td>${fmt(l.bruto)}</td>
                      <td>${fmt(l.totalAportes)}</td>
                      <td>${fmt(l.totalContribuciones)}</td>
                      <td><strong>${fmt(l.neto)}</strong></td>
                      {bonosHabilitados && <td style={{ color: 'var(--text-secondary)' }}>{bonosPorLiq[l.id] ? `+$${fmt(bonosPorLiq[l.id])}` : '—'}</td>}
                      <td>
                        <span className="badge badge-neutral">{l.estado}</span>
                        {l.numeroRecibo && <span className="badge badge-neutral" style={{ marginLeft: 4 }}>recibo #{l.numeroRecibo}{l.version > 1 ? ` v${l.version}` : ''}</span>}
                        {l.anulado && <span className="badge badge-warning" style={{ marginLeft: 4 }}>anulado</span>}
                      </td>
                      <td>{liqExpandida === l.id ? '▾' : '▸'}</td>
                    </tr>
                    {liqExpandida === l.id && (
                      <tr id={`liq-detalle-${l.id}`}>
                        <td colSpan={bonosHabilitados ? 16 : 15} style={{ background: 'var(--bg-overlay)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                            <span className="texto-muted" style={{ fontSize: '0.8rem' }}>
                              Obra: <strong>{nombreObraLiquidacion(l) || '—'}</strong>
                            </span>
                            {dh.topeHorasDiarias != null && (
                              <span className="texto-muted" style={{ fontSize: '0.8rem' }}>
                                Tope horas/día: <strong>{dh.topeHorasDiarias} h</strong>
                              </span>
                            )}
                          </div>
                          {ajusteHorasHabilitado && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }} onClick={(e) => e.stopPropagation()}>
                              <label className="input-label" htmlFor={`ajuste-hs-${l.personalId}`} style={{ margin: 0 }}>
                                Ajuste hs. (global, este período)
                              </label>
                              <input
                                id={`ajuste-hs-${l.personalId}`}
                                className="input input-sm"
                                type="number"
                                step="0.5"
                                style={{ width: 90 }}
                                placeholder="0"
                                value={ajustesHorasForm[l.personalId] ?? String(ajustesHoras[l.personalId] ?? 0)}
                                onChange={(e) => setAjustesHorasForm((f) => ({ ...f, [l.personalId]: e.target.value }))}
                              />
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => guardarAjusteHoras(l.personalId)}
                                disabled={guardandoAjuste === l.personalId}
                              >
                                {guardandoAjuste === l.personalId ? 'Guardando…' : 'Guardar ajuste'}
                              </button>
                              {ajustesHoras[l.personalId] ? (
                                <span className="texto-muted" style={{ fontSize: '0.8rem' }}>
                                  aplicado: {ajustesHoras[l.personalId] > 0 ? '+' : ''}{ajustesHoras[l.personalId]} h (recalculá el período para verlo reflejado)
                                </span>
                              ) : null}
                            </div>
                          )}
                          {ajusteHorasHabilitado && errorAjuste && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 8 }}>{errorAjuste}</p>}
                          {items.length > 0 && !l.anulado && puedeEmitirRecibos && (
                            <button className="btn btn-primary btn-sm" style={{ marginBottom: 8 }}
                              onClick={(e) => { e.stopPropagation(); handleEmitirRecibo(l) }} disabled={emitiendoRecibo === l.id}>
                              {emitiendoRecibo === l.id ? 'Generando…' : l.numeroRecibo ? 'Regenerar recibo PDF' : 'Emitir recibo PDF'}
                            </button>
                          )}
                          {items.length === 0 ? 'Cargando detalle…' : grupos.map(([tipo, titulo]) => {
                            const delGrupo = items.filter((i) => i.tipo === tipo)
                            if (delGrupo.length === 0) return null
                            return (
                              <div key={tipo} style={{ margin: '0.5rem 0' }}>
                                <strong style={{ fontSize: '0.85rem' }}>{titulo}</strong>
                                <table className="table" style={{ marginTop: 4 }}>
                                  <tbody>
                                    {delGrupo.map((i) => (
                                      <tr key={i.id}>
                                        <td style={{ width: '55%' }}>{etiquetaConcepto(i)} <span style={{ opacity: 0.6 }}>({i.concepto_codigo})</span></td>
                                        <td style={{ opacity: 0.6 }}>regla: {i.regla_aplicada}</td>
                                        <td style={{ textAlign: 'right' }}>${fmt(i.monto)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )
                          })}
                        </td>
                      </tr>
                    )}
                  </FragmentoLiquidacion>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}
    </div>
  )
}
