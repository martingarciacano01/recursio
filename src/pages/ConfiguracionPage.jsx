import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'
import { useConveniosStore } from '../store/conveniosStore'
import TabEscalas from '../components/config/TabEscalas'
import TabNoRemunerativos from '../components/config/TabNoRemunerativos'
import TabAportes from '../components/config/TabAportes'
import TabAdicionales from '../components/config/TabAdicionales'
import TabParametros from '../components/config/TabParametros'

const PESTANAS = ['Escalas salariales', 'No remunerativos', 'Aportes y contribuciones', 'Adicionales', 'Parámetros']

export default function ConfiguracionPage() {
  const empresa = useAuthStore((s) => s.empresa)
  const empresaVista = useAuthStore((s) => s.empresaVista)
  const empresaActiva = empresa || empresaVista
  const { convenios, cargarConvenios, clonarConvenio } = useConveniosStore()
  const [convenioId, setConvenioId] = useState(null)
  const [pestana, setPestana] = useState(PESTANAS[0])
  const [clonando, setClonando] = useState(false)
  const [errorClonado, setErrorClonado] = useState(null)

  useEffect(() => { if (empresaActiva?.id) cargarConvenios(empresaActiva.id) }, [empresaActiva?.id])
  // Selección por defecto: el primer convenio propio; si no hay, el primero global.
  useEffect(() => {
    if (!convenioId && convenios.length > 0) {
      const propio = convenios.find((c) => c.empresaId === empresaActiva?.id)
      setConvenioId((propio || convenios[0]).id)
    }
  }, [convenios, convenioId, empresaActiva?.id])

  const convenio = convenios.find((c) => c.id === convenioId) || null
  const esGlobal = convenio?.empresaId === null

  const personalizar = async () => {
    setClonando(true); setErrorClonado(null)
    const r = await clonarConvenio(convenio.id)
    setClonando(false)
    if (!r.ok) { setErrorClonado(r.error); return }
    await cargarConvenios(empresaActiva.id)
    setConvenioId(r.convenioId)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Configuración</h1>
        <p className="page-subtitle">Escalas, no remunerativos, aportes, adicionales y parámetros</p>
      </div>

      {!empresaActiva && (
        <div className="card">Elegí una empresa en Superadmin → "Entrar" para ver su configuración.</div>
      )}

      {empresaActiva && (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <select className="input" style={{ maxWidth: 320 }} value={convenioId ?? ''} onChange={(e) => setConvenioId(e.target.value)}>
              {convenios.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}{c.empresaId === null ? ' (plantilla)' : ''}</option>
              ))}
            </select>
            {esGlobal && (
              <button className="btn btn-primary btn-sm" onClick={personalizar} disabled={clonando}>
                {clonando ? 'Clonando…' : 'Personalizar convenio'}
              </button>
            )}
          </div>
          {esGlobal && (
            <div className="card" style={{ marginBottom: 12 }}>
              Este convenio es una plantilla de solo lectura. "Personalizar convenio" crea una copia propia de tu empresa
              (categorías, conceptos y reglas incluidos) y re-apunta tus legajos para poder editarla.
            </div>
          )}
          {errorClonado && <div className="card" style={{ color: 'var(--danger)' }}>Error al clonar: {errorClonado}</div>}

          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {PESTANAS.map((p) => (
              <button key={p} className={`btn btn-sm ${pestana === p ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPestana(p)}>{p}</button>
            ))}
          </div>

          {pestana === 'Escalas salariales' && <TabEscalas convenio={convenio} soloLectura={esGlobal} />}
          {pestana === 'No remunerativos' && <TabNoRemunerativos convenio={convenio} soloLectura={esGlobal} />}
          {pestana === 'Aportes y contribuciones' && <TabAportes convenio={convenio} empresaId={empresaActiva.id} soloLectura={esGlobal} />}
          {pestana === 'Adicionales' && <TabAdicionales convenio={convenio} empresaId={empresaActiva.id} soloLectura={esGlobal} />}
          {pestana === 'Parámetros' && <TabParametros empresaId={empresaActiva.id} />}
        </>
      )}
    </div>
  )
}
