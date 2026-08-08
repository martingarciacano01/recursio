import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useConveniosStore } from '../store/conveniosStore'
import { useToastStore } from '../store/toastStore'
import { filtrarConveniosVisibles } from '../utils/convenios'
import { supabase } from '../lib/supabase'
import { Building2, Scale } from 'lucide-react'
import TabEscalas from '../components/config/TabEscalas'
import TabNoRemunerativos from '../components/config/TabNoRemunerativos'
import TabAportes from '../components/config/TabAportes'
import TabAdicionales from '../components/config/TabAdicionales'
import TabParametros from '../components/config/TabParametros'
import TabFlujo from '../components/config/TabFlujo'
import TabEmpresa from '../components/config/TabEmpresa'
import TabDocumentacion from '../components/config/TabDocumentacion'
import TabAlertas from '../components/config/TabAlertas'
import TabConvenios from '../components/config/TabConvenios'
import TabBonos from '../components/config/TabBonos'

// La configuración tiene dos naturalezas distintas y mezclarlas en una sola
// fila de 10 pestañas era confuso:
//   · "Convenios" -> todo lo que depende del convenio seleccionado (escalas,
//                    no remunerativos, aportes, adicionales) + el alta y la
//                    edición de convenios propios.
//   · "Empresa"   -> parámetros generales que no dependen del convenio.
// El selector de convenio solo aparece dentro de la sección Convenios, que es
// donde realmente aplica.
const SECCIONES = [
  {
    id: 'convenios',
    label: 'Convenios',
    icono: Scale,
    porConvenio: true,
    tabs: ['Escalas salariales', 'No remunerativos', 'Aportes y contribuciones', 'Adicionales', 'Mis convenios'],
  },
  {
    id: 'empresa',
    label: 'Empresa',
    icono: Building2,
    porConvenio: false,
    tabs: ['Datos de la empresa', 'Parámetros', 'Documentación', 'Alertas', 'Flujo de aprobación', 'Bonos no remunerativos'],
  },
]

export default function ConfiguracionPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const empresaActiva = empresa || empresaVista
  // `cargando` y `error` se leen explícitamente: sin ellos, una consulta
  // fallida o una base sin convenios se veían igual que una pantalla en
  // blanco — el <select> quedaba sin opciones y la página no decía nada.
  const { convenios, cargando: cargandoConvenios, error: errorConvenios, cargarConvenios, clonarConvenio } = useConveniosStore()
  const [convenioId, setConvenioId] = useState(null)
  const [seccionId, setSeccionId] = useState(SECCIONES[0].id)
  const [pestana, setPestana] = useState(SECCIONES[0].tabs[0])
  const [clonando, setClonando] = useState(false)
  const [errorClonado, setErrorClonado] = useState(null)
  const [obras, setObras] = useState([])
  const [obraIdParaClonar, setObraIdParaClonar] = useState('')
  const push = useToastStore((s) => s.push)

  const seccion = SECCIONES.find((s) => s.id === seccionId) || SECCIONES[0]

  useEffect(() => { if (empresaActiva?.id) cargarConvenios(empresaActiva.id) }, [empresaActiva?.id])
  // Obras de la empresa (Presencio, vía nom_v_obras — migración 0058) para
  // "Personalizar convenio → por obra" (Task 4.2, plan convenios-por-obra
  // 2026-08-07). Sin obras o con error, el selector de obra simplemente no
  // aparece: clonar sigue funcionando como convenio genérico de empresa.
  useEffect(() => {
    if (!empresaActiva?.id) return
    let cancelado = false
    supabase.from('nom_v_obras').select('id, nombre').eq('empresa_id', empresaActiva.id).order('nombre')
      .then(({ data }) => { if (!cancelado) setObras(data || []) })
    return () => { cancelado = true }
  }, [empresaActiva?.id])
  // Selección por defecto: el primer convenio propio; si no hay, el primero global.
  useEffect(() => {
    if (!convenioId && convenios.length > 0) {
      const propio = convenios.find((c) => c.empresaId === empresaActiva?.id)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- selección por defecto intencional cuando llegan los convenios.
      setConvenioId((propio || convenios[0]).id)
    }
  }, [convenios, convenioId, empresaActiva?.id])

  const cambiarSeccion = (s) => {
    setSeccionId(s.id)
    setPestana(s.tabs[0])
  }

  const convenio = convenios.find((c) => c.id === convenioId) || null
  const esGlobal = convenio?.empresaId === null
  // El clon de la empresa pisa al global homónimo en el <select> (evita
  // ver "UOCRA" repetido); `convenios` sin filtrar se sigue usando arriba
  // para resolver el convenio activo y detectar si ya existe un clon.
  const conveniosVisibles = filtrarConveniosVisibles(
    convenios.map((c) => ({ ...c, empresa_id: c.empresaId }))
  )

  const personalizar = async () => {
    setClonando(true); setErrorClonado(null)
    const r = await clonarConvenio(convenio.id, empresaActiva.id, obraIdParaClonar || undefined)
    setClonando(false)
    if (!r.ok) { setErrorClonado(r.error); return }
    await cargarConvenios(empresaActiva.id)
    setConvenioId(r.convenioId)
    push(
      obraIdParaClonar ? 'Convenio de obra clonado: ya podés editarlo.' : 'Convenio clonado: ya podés editarlo.',
      'success'
    )
  }

  // El selector no aplica a "Mis convenios": ahí se listan todos los propios.
  // Tampoco se dibuja si no hay nada que elegir: un <select> vacío no informa.
  const sinConvenios = !cargandoConvenios && !errorConvenios && conveniosVisibles.length === 0
  const mostrarSelector = seccion.porConvenio && pestana !== 'Mis convenios' && conveniosVisibles.length > 0

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Configuración</h1>
        <p className="page-subtitle">
          {seccion.id === 'convenios'
            ? 'Escalas, no remunerativos, aportes y adicionales por convenio'
            : 'Datos, parámetros, documentación y flujo de aprobación de la empresa'}
        </p>
      </div>

      {!empresaActiva && (
        <div className="card">Elegí una empresa en Superadmin → "Entrar" para ver su configuración.</div>
      )}

      {empresaActiva && (
        <>
          {/* Nivel 1: secciones */}
          <div className="tabs" role="tablist" aria-label="Secciones de configuración">
            {SECCIONES.map((s) => {
              const Icono = s.icono
              const activa = s.id === seccionId
              return (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={activa}
                  className={`tab${activa ? ' tab-activa' : ''}`}
                  onClick={() => cambiarSeccion(s)}
                >
                  <Icono size={15} /> {s.label}
                </button>
              )
            })}
          </div>

          {/* Nivel 2: submenú de la sección */}
          <div className="subtabs" role="tablist" aria-label={`Opciones de ${seccion.label}`}>
            {seccion.tabs.map((p) => (
              <button
                key={p}
                role="tab"
                aria-selected={pestana === p}
                className={`subtab${pestana === p ? ' subtab-activa' : ''}`}
                onClick={() => setPestana(p)}
              >
                {p}
              </button>
            ))}
          </div>

          {errorConvenios && (
            <div className="card card-compacta max-900" style={{ color: 'var(--danger)', marginBottom: 12 }}>
              No se pudieron cargar los convenios: {errorConvenios}
            </div>
          )}

          {seccion.porConvenio && sinConvenios && (
            <div className="card card-compacta max-900" style={{ marginBottom: 12, fontSize: '0.86rem' }}>
              No hay convenios cargados en esta base. Creá uno propio desde "Mis convenios", o
              sembrá las plantillas globales (migración <code>0003_seed_convenios.sql</code>) si
              este es un entorno nuevo.
            </div>
          )}

          {mostrarSelector && (
            <>
              <div className="toolbar">
                <label className="texto-secundario" htmlFor="selector-convenio" style={{ fontSize: '0.83rem' }}>
                  Convenio
                </label>
                <select
                  id="selector-convenio"
                  className="input input-medio"
                  value={convenioId ?? ''}
                  onChange={(e) => setConvenioId(e.target.value)}
                >
                  {conveniosVisibles.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}{c.empresaId === null ? ' (plantilla)' : ''}</option>
                  ))}
                </select>
                {esGlobal && obras.length > 0 && (
                  <select
                    id="selector-obra-clonar"
                    className="input input-medio"
                    value={obraIdParaClonar}
                    onChange={(e) => setObraIdParaClonar(e.target.value)}
                    aria-label="Obra para el convenio clonado"
                  >
                    <option value="">Toda la empresa</option>
                    {obras.map((o) => (
                      <option key={o.id} value={o.id}>{o.nombre}</option>
                    ))}
                  </select>
                )}
                {esGlobal && (
                  <button className="btn btn-primary btn-sm" onClick={personalizar} disabled={clonando}>
                    {clonando ? 'Clonando…' : 'Personalizar convenio'}
                  </button>
                )}
              </div>

              {esGlobal && (
                <div className="card card-compacta max-900" style={{ marginBottom: 12, fontSize: '0.86rem' }}>
                  Este convenio es una plantilla de solo lectura. "Personalizar convenio" crea una copia propia de tu empresa
                  (categorías, conceptos y reglas incluidos) y re-apunta tus legajos para poder editarla.
                  {obras.length > 0 && ' Elegí una obra para clonarlo solo a esa obra, o dejá "Toda la empresa" para el comportamiento genérico.'}
                </div>
              )}
              {errorClonado && (
                <div className="card card-compacta max-900" style={{ color: 'var(--danger)', marginBottom: 12 }}>
                  Error al clonar: {errorClonado}
                </div>
              )}
            </>
          )}

          {pestana === 'Escalas salariales' && <TabEscalas convenio={convenio} soloLectura={esGlobal} />}
          {pestana === 'No remunerativos' && <TabNoRemunerativos convenio={convenio} soloLectura={esGlobal} />}
          {pestana === 'Aportes y contribuciones' && <TabAportes convenio={convenio} empresaId={empresaActiva.id} soloLectura={esGlobal} />}
          {pestana === 'Adicionales' && <TabAdicionales convenio={convenio} empresaId={empresaActiva.id} soloLectura={esGlobal} />}
          {pestana === 'Mis convenios' && <TabConvenios empresaId={empresaActiva.id} />}

          {pestana === 'Bonos no remunerativos' && <TabBonos empresaId={empresaActiva.id} />}
          {pestana === 'Datos de la empresa' && <TabEmpresa empresaId={empresaActiva.id} />}
          {pestana === 'Parámetros' && <TabParametros empresaId={empresaActiva.id} />}
          {pestana === 'Documentación' && <TabDocumentacion empresaId={empresaActiva.id} />}
          {pestana === 'Alertas' && <TabAlertas empresaId={empresaActiva.id} />}
          {pestana === 'Flujo de aprobación' && <TabFlujo empresaId={empresaActiva.id} />}
        </>
      )}
    </div>
  )
}
