import { useEffect } from 'react'
import { useEscalasStore, agruparVigencias } from '../../store/escalasStore'
import TablaVigencias from './TablaVigencias'

export default function TabEscalas({ convenio, soloLectura }) {
  const { categorias, cargando, error, cargarEscala, guardarVigencias } = useEscalasStore()

  useEffect(() => { if (convenio?.id) cargarEscala(convenio.id) }, [convenio?.id])

  if (!convenio) return null
  if (cargando) return <div className="card">Cargando…</div>
  if (error) return <div className="card" style={{ color: 'var(--danger)' }}>Error: {error}</div>

  const hoy = new Date().toISOString().slice(0, 10)
  return (
    <div className="card">
      <TablaVigencias
        items={agruparVigencias(categorias, hoy)}
        etiquetaValor="Básico"
        soloLectura={soloLectura}
        conModalidad
        onGuardar={async (filas, fecha) => {
          const r = await guardarVigencias(convenio.id, filas, fecha)
          if (r.ok) await cargarEscala(convenio.id)
          return r
        }}
      />
    </div>
  )
}
