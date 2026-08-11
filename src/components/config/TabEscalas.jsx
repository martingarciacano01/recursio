import { useEffect } from 'react'
import { useEscalasStore, agruparVigencias } from '../../store/escalasStore'
import TablaVigencias from './TablaVigencias'
import { descargarPlantillaVigencias } from '../../utils/descargarPlantillaVigencias'

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
        // Task 6.9: estado vacío visible (antes quedaba solo el encabezado)
        // + CTA descargar plantilla CSV.
        mensajeVacio="Sin categorías para este convenio todavía. Agregalas desde “Nueva vigencia” o importalas en lote desde la pestaña “Importar CSV”."
        onDescargarPlantilla={() => descargarPlantillaVigencias(convenio.id)}
        onGuardar={async (filas, fecha) => {
          const r = await guardarVigencias(convenio.id, filas, fecha)
          if (r.ok) await cargarEscala(convenio.id, { forzar: true })
          return r
        }}
      />
    </div>
  )
}
