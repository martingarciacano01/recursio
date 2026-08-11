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
import TabImportarCsv from '../components/config/TabImportarCsv'
import TabBonos from '../components/config/TabBonos'
import { useEmpresaFeaturesStore, FEATURES } from '../store/empresaFeaturesStore'
import { DISCLAIMER_CONTADOR } from '../utils/disclaimerRecursio'

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
    tabs: ['Escalas salariales', 'No remunerativos', 'Aportes y contribuciones', 'Adicionales', 'Mis convenios', 'Importar CSV'],
  },
  {
    id: 'empresa',
    label: 'Empresa',
    icono: Building2,
    porConvenio: false,
    tabs: ['Datos de la empresa', 'Parámetros', 'Documentación', 'Alertas', 'Flujo de aprobación'],
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
  // Item 2 (sesión 2026-08-08): al clonar, si la empresa tiene obras y la
  // feature convenios_por_obra está activa, preguntar explícitamente si el
  // clon aplica a toda la empresa o a una obra puntual (antes el selector
  // quedaba discreto y el clon silenciosamente era "toda la empresa").
  const [preguntandoObra, setPreguntandoObra] = useState(false)
  const [ambitoObra, setAmbitoObra] = useState('toda_empresa')
  const push = useToastStore((s) => s.push)

  // Features por empresa (migración 0063, Superadmin → Features): convenio
  // por obra y bonos especiales solo se muestran si la empresa los
  // tiene habilitados. Sin datos cargados todavía, tieneFeature() da false
  // (fail-closed) — no hay parpadeo de "aparece y desaparece".
  const { tieneFeature, cargarFeatures } = useEmpresaFeaturesStore()
  useEffect(() => { if (empresaActiva?.id) cargarFeatures(empresaActiva.id) }, [empresaActiva?.id])
  const convenioPorObraHabilitado = tieneFeature(empresaActiva?.id, FEATURES.CONVENIOS_POR_OBRA)
  const bonosHabilitados = tieneFeature(empresaActiva?.id, FEATURES.BONOS_NO_REMUNERATIVOS)

  // Los bonos especiales viven bajo Convenios: son un adicional por
  // empresa/obra (nom_bono_aplicaciones) que se liquida junto con el
  // convenio. Antes estaban bajo Empresa, donde era fácil no encontrarlos.
  const SECCIONES_VISIBLES = SECCIONES.map((s) =>
    s.id === 'convenios' && bonosHabilitados
      ? { ...s, tabs: [...s.tabs, 'Bonos especiales'] }
      : s
  )
  const seccion = SECCIONES_VISIBLES.find((s) => s.id === seccionId) || SECCIONES_VISIBLES[0]

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
  // Task 6.3 (plan 2026-08-11): al cambiar de empresa (Superadmin), el
  // convenioId de la empresa anterior quedaba set, `convenios.find` daba null
  // y las pestañas por convenio (TabEscalas/TabNoRemunerativos) se veían en
  // blanco. Ahora el efecto corre también cuando el convenio activo ya no está
  // en la lista de la nueva empresa y vuelve a preseleccionar.
  useEffect(() => {
    if (convenios.length === 0) return
    if (convenios.some((c) => c.id === convenioId)) return
    const propio = convenios.find((c) => c.empresaId === empresaActiva?.id)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preselección intencional cuando llegan los convenios o cambia la empresa.
    setConvenioId((propio || convenios[0]).id)
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

  const personalizar = async (obraId) => {
    setClonando(true); setErrorClonado(null)
    const r = await clonarConvenio(convenio.id, empresaActiva.id, obraId ?? undefined)
    setClonando(false)
    if (!r.ok) { setErrorClonado(r.error); return }
    await cargarConvenios(empresaActiva.id)
    setConvenioId(r.convenioId)
    setAmbitoObra('toda_empresa')
    setObraIdParaClonar('')
    setPreguntandoObra(false)
    push(
      obraId ? 'Convenio de obra clonado: ya podés editarlo.' : 'Convenio clonado: ya podés editarlo.',
      'success'
    )
  }

  // Item 2: el clon que "pregunta" — si la feature y las obras hacen que el
  // selector de obra tenga sentido, en vez de clonar directo se abre el
  // paso intermedio con el radio Toda la empresa / Obra puntual.
  const iniciarClonado = () => {
    setErrorClonado(null)
    if (convenioPorObraHabilitado && obras.length > 0) {
      setAmbitoObra('toda_empresa')
      setObraIdParaClonar('')
      setPreguntandoObra(true)
      return
    }
    personalizar(undefined)
  }

  // El selector no aplica a "Mis convenios" (ahí se listan todos los propios)
  // ni a "Bonos especiales" (se definen por empresa/obra, no por convenio).
  // Tampoco se dibuja si no hay nada que elegir: un <select> vacío no informa.
  const sinConvenios = !cargandoConvenios && !errorConvenios && conveniosVisibles.length === 0
  const mostrarSelector = seccion.porConvenio && pestana !== 'Mis convenios' && pestana !== 'Bonos especiales' && conveniosVisibles.length > 0

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
            {SECCIONES_VISIBLES.map((s) => {
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

          {seccion.porConvenio && pestana !== 'Bonos especiales' && sinConvenios && (
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
                {esGlobal && (
                  <button className="btn btn-primary btn-sm" onClick={iniciarClonado} disabled={clonando}>
                    {clonando ? 'Clonando…' : 'Personalizar convenio'}
                  </button>
                )}
              </div>

              {preguntandoObra && esGlobal && (
                <div className="card card-compacta max-900" style={{ marginBottom: 12 }}>
                  <strong style={{ fontSize: '0.9rem', display: 'block', marginBottom: 8 }}>
                    ¿Este convenio aplica a toda la empresa o a una obra puntual?
                  </strong>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem' }}>
                      <input type="radio" name="ambito-clon" checked={ambitoObra === 'toda_empresa'}
                        onChange={() => setAmbitoObra('toda_empresa')} />
                      Toda la empresa
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.86rem' }}>
                      <input type="radio" name="ambito-clon" checked={ambitoObra === 'una_obra'}
                        onChange={() => setAmbitoObra('una_obra')} />
                      Solo una obra puntual
                    </label>
                  </div>
                  {ambitoObra === 'una_obra' && (
                    <div style={{ marginTop: 8 }}>
                      <label className="texto-secundario" htmlFor="selector-obra-clonar" style={{ display: 'block', fontSize: '0.8rem', marginBottom: 4 }}>
                        Obra
                      </label>
                      <select
                        id="selector-obra-clonar"
                        className="input input-medio"
                        value={obraIdParaClonar}
                        onChange={(e) => setObraIdParaClonar(e.target.value)}
                        aria-label="Obra para el convenio clonado"
                      >
                        <option value="">Elegir obra…</option>
                        {obras.map((o) => (
                          <option key={o.id} value={o.id}>{o.nombre}</option>
                        ))}
                      </select>
                      <p className="texto-secundario" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                        Si elegís una obra, la copia solo se aplica al personal de esa obra y sus legajos se re-apuntan al recién clonado.
                      </p>
                    </div>
                  )}
                  {errorClonado && (
                    <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '8px 0 0' }}>Error al clonar: {errorClonado}</p>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => personalizar(ambitoObra === 'una_obra' ? obraIdParaClonar || undefined : undefined)}
                      disabled={clonando || (ambitoObra === 'una_obra' && !obraIdParaClonar)}
                    >
                      {clonando ? 'Clonando…' : 'Confirmar copia'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPreguntandoObra(false)} disabled={clonando}>Cancelar</button>
                  </div>
                </div>
              )}

              {esGlobal && (
                <div className="card card-compacta max-900" style={{ marginBottom: 12, fontSize: '0.86rem' }}>
                  Este convenio es una plantilla de solo lectura. "Personalizar convenio" crea una copia propia de tu empresa
                  (categorías, conceptos y reglas incluidos) y re-apunta tus legajos para poder editarla.
                  {convenioPorObraHabilitado && obras.length > 0 && ' Antes de copiar, vas a poder elegir si el clon aplica a toda la empresa o a una obra puntual.'}
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
          {pestana === 'Importar CSV' && <TabImportarCsv convenioId={convenioId} />}

          {pestana === 'Bonos especiales' && <TabBonos empresaId={empresaActiva.id} />}
          {pestana === 'Datos de la empresa' && (
            <>
              <div className="card card-compacta max-900" style={{ marginBottom: 12, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {DISCLAIMER_CONTADOR}
              </div>
              <TabEmpresa empresaId={empresaActiva.id} />
            </>
          )}
          {pestana === 'Parámetros' && <TabParametros empresaId={empresaActiva.id} />}
          {pestana === 'Documentación' && <TabDocumentacion empresaId={empresaActiva.id} />}
          {pestana === 'Alertas' && <TabAlertas empresaId={empresaActiva.id} />}
          {pestana === 'Flujo de aprobación' && <TabFlujo empresaId={empresaActiva.id} />}
        </>
      )}
    </div>
  )
}
